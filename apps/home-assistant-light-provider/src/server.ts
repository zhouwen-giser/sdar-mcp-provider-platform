import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "node:fs";
import {
  adapterServiceDefinition,
  jsonToProtoStruct,
  protoStructToJson,
} from "../../../packages/adapter-protocol/src/index.js";
import { LightProviderError, safeLightError } from "./errors.js";
import type { LightExecutionEngine } from "./execution/execution-engine.js";
import { snapshot, timestamp } from "./execution/snapshots.js";
import { normalizeLightState } from "./home-assistant.js";
import type { HomeAssistantLightClient } from "./home-assistant.js";
import { lightManifest } from "./manifest.js";
import type { LightResourceRegistry } from "./resources.js";
import type { LightStore } from "./store.js";
import type { ExecutionContextRecord, LightOperation } from "./types.js";

type Call<T> = grpc.ServerUnaryCall<T, unknown>;
interface Start {
  taskId?: string;
  operationName?: string;
  arguments?: unknown;
  argumentHash?: string;
  executionContext?: Record<string, unknown>;
}
interface Reconcile {
  taskId?: string;
  operationName?: string;
  argumentHash?: string;
  externalExecutionId?: string;
  executionContext?: Record<string, unknown>;
}
interface Command {
  identity?: { taskId?: string; commandSequence?: string | number; [key: string]: unknown };
}
export interface LightServerOptions {
  providerId: string;
  providerVersion: string;
  host: string;
  port: number;
  tlsMode: "disabled" | "required";
  tlsCaPath?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export class LightProviderServer {
  readonly #server = new grpc.Server();
  #started = false;
  constructor(
    readonly options: LightServerOptions,
    readonly registry: LightResourceRegistry,
    readonly rest: HomeAssistantLightClient,
    readonly store: LightStore,
    readonly engine: LightExecutionEngine,
  ) {
    this.#server.addService(adapterServiceDefinition(), this.#handlers());
  }
  start(): Promise<number> {
    return new Promise((resolve, reject) =>
      this.#server.bindAsync(
        `${this.options.host}:${String(this.options.port)}`,
        credentials(this.options),
        (error, port) => {
          if (error !== null) reject(error);
          else {
            this.#started = true;
            resolve(port);
          }
        },
      ),
    );
  }
  close(): Promise<void> {
    return this.#started
      ? new Promise((resolve) => this.#server.tryShutdown(() => resolve()))
      : Promise.resolve();
  }
  #handlers(): grpc.UntypedServiceImplementation {
    return {
      describeProvider: (_c: Call<unknown>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, lightManifest(this.options.providerId, this.options.providerVersion)),
      listResources: (_c: Call<unknown>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, {
          resources: this.registry.list().map((resource) => ({
            resourceId: resource.resourceId,
            displayName: resource.displayName,
            resourceType: "home_assistant.light",
            enabled: resource.enabled,
            health: "unknown",
            labels: {},
            metadata: jsonToProtoStruct({}),
          })),
          nextPageToken: "",
        }),
      checkAvailability: (
        c: Call<{ checks?: { requestId?: string; operationName?: string; arguments?: unknown }[] }>,
        cb: grpc.sendUnaryData<unknown>,
      ) => {
        void Promise.all((c.request.checks ?? []).map((check) => this.#availability(check)))
          .then((checks) =>
            cb(null, {
              profileVersion: "1.0",
              checkedAt: timestamp(new Date().toISOString()),
              checks,
            }),
          )
          .catch((error: unknown) => cb(adapterError(error)));
      },
      startOperation: (c: Call<Start>, cb: grpc.sendUnaryData<unknown>) => {
        void this.#start(c.request)
          .then((value) => cb(null, value))
          .catch((error: unknown) => cb(adapterError(error)));
      },
      getExecution: (c: Call<{ taskId?: string }>, cb: grpc.sendUnaryData<unknown>) => {
        const execution = this.store.get(c.request.taskId ?? "");
        if (execution === undefined) cb(notFound());
        else cb(null, snapshot(execution));
      },
      reconcileExecution: (c: Call<Reconcile>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, this.#reconcile(c.request)),
      requestCancel: (c: Call<Command>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, this.#unsupported(c.request, "cancel", "CANCEL_NOT_SUPPORTED")),
      updateExecution: (c: Call<Command>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, this.#unsupported(c.request, "update", "UPDATE_NOT_SUPPORTED")),
      pauseExecution: (c: Call<Command>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, this.#unsupported(c.request, "pause", "PAUSE_NOT_SUPPORTED")),
      resumeExecution: (c: Call<Command>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, this.#unsupported(c.request, "resume", "RESUME_NOT_SUPPORTED")),
      streamExecutionEvents: (c: grpc.ServerWritableStream<unknown, unknown>) => c.end(),
    };
  }
  async #availability(check: {
    requestId?: string;
    operationName?: string;
    arguments?: unknown;
  }): Promise<Record<string, unknown>> {
    const base = {
      requestId: check.requestId ?? "",
      operationName: check.operationName ?? "",
      riskLevel: "LOW",
      reservationMode: "NONE",
    };
    try {
      const args = protoStructToJson(check.arguments);
      const resource = this.registry.require(text(args.resourceId));
      const state = normalizeLightState(
        resource.resourceId,
        await this.rest.getState(resource.entityId),
      );
      if (check.operationName === "light_set_brightness" && !state.supportsBrightness)
        return {
          ...base,
          availability: "DISABLED",
          reasonCode: "BRIGHTNESS_NOT_SUPPORTED",
          description: "Home Assistant does not report brightness for this light.",
        };
      return {
        ...base,
        availability: state.reachable ? "AVAILABLE" : "UNKNOWN",
        reasonCode: state.reachable ? "AVAILABLE" : "RESOURCE_STATE_UNKNOWN",
        description: state.reachable
          ? "Configured light resource is reachable."
          : "Light state is unavailable.",
        validUntil: timestamp(new Date(Date.now() + 5000).toISOString()),
      };
    } catch (error) {
      const safe = safeLightError(error);
      return {
        ...base,
        availability: safe.reasonCode.startsWith("RESOURCE_") ? "DISABLED" : "UNKNOWN",
        reasonCode: safe.reasonCode,
        description: safe.reasonCode,
      };
    }
  }
  async #start(request: Start): Promise<Record<string, unknown>> {
    try {
      const operation = operationName(request.operationName);
      const args = protoStructToJson(request.arguments);
      const resourceId = text(args.resourceId);
      const context = contextOf(request.executionContext);
      if (operation === "light_get_state") {
        const resource = this.registry.require(resourceId);
        const state = normalizeLightState(resourceId, await this.rest.getState(resource.entityId));
        await this.engine.observe(state);
        const externalExecutionId = `sync-${request.taskId ?? "query"}`;
        const result = {
          resourceId: state.resourceId,
          power: state.power,
          reachable: state.reachable,
          brightnessPercent: state.brightnessPercent,
          observedAt: state.observedAt,
        };
        return {
          accepted: {
            externalExecutionId,
            initialSnapshot: {
              taskId: request.taskId ?? "",
              externalExecutionId,
              operationName: operation,
              argumentHash: request.argumentHash ?? "",
              executionContext: context,
              state: "SUCCEEDED",
              revision: "1",
              reasonCode: "HOME_ASSISTANT_STATE_READ",
              message: "Light state read.",
              result: jsonToProtoStruct(result),
              evidence: [
                {
                  evidenceId: `home-assistant-light-state-${resourceId}-${state.observedAt}`,
                  evidenceType: "light.state.observation",
                  observedAt: state.observedAt,
                  subjectRef: `resource:${resourceId}`,
                  payloadRef: { kind: "structured_content", jsonPointer: "/power" },
                  producer: [this.options.providerId, "home-assistant"],
                },
              ],
              observedAt: timestamp(state.observedAt),
            },
          },
          result: "accepted",
        };
      }
      const execution = await this.engine.start({
        taskId: text(request.taskId),
        operationName: operation,
        resourceId,
        ...(operation === "light_set_power"
          ? { power: power(args.power) }
          : { brightnessPercent: percentage(args.brightnessPercent) }),
        argumentHash: text(request.argumentHash),
        executionContext: context,
      });
      return {
        accepted: {
          externalExecutionId: execution.externalExecutionId,
          initialSnapshot: snapshot(execution),
        },
        result: "accepted",
      };
    } catch (error) {
      const safe = safeLightError(error);
      return {
        rejected: {
          reasonCode: safe.reasonCode,
          message: safe.reasonCode,
          retryable: safe.retryable,
        },
        result: "rejected",
      };
    }
  }
  #reconcile(request: Reconcile): Record<string, unknown> {
    const execution = this.store.get(request.taskId ?? "");
    if (execution === undefined)
      return {
        status: "NOT_FOUND",
        reasonCode: "EXECUTION_NOT_FOUND",
        message: "Execution does not exist.",
        retryable: false,
      };
    if (
      execution.operationName !== request.operationName ||
      execution.argumentHash !== request.argumentHash ||
      ((request.externalExecutionId ?? "") !== "" &&
        execution.externalExecutionId !== request.externalExecutionId) ||
      !sameContext(execution.executionContext, request.executionContext)
    )
      return {
        status: "CONFLICT",
        reasonCode: "TASK_IDENTITY_CONFLICT",
        message: "Task identity conflicts.",
        retryable: false,
      };
    return {
      status: "FOUND",
      snapshot: snapshot(execution),
      externalExecutionId: execution.externalExecutionId,
      reasonCode: "EXECUTION_FOUND",
      message: "Execution recovered.",
      retryable: false,
    };
  }
  #unsupported(request: Command, command: string, reasonCode: string): Record<string, unknown> {
    const execution = this.store.get(request.identity?.taskId ?? "");
    const key = `${command}:${String(request.identity?.commandSequence ?? 0)}`;
    const old = execution?.commandAcks[key];
    if (old !== undefined) return old;
    const ack = {
      accepted: false,
      reasonCode,
      message: reasonCode,
      commandSequence: request.identity?.commandSequence ?? "0",
      identity: request.identity,
    };
    if (execution !== undefined) {
      execution.commandAcks[key] = ack;
      this.store.set(execution);
    }
    return ack;
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new LightProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return value;
}
function percentage(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new LightProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return value;
}
function power(value: unknown): "on" | "off" {
  if (value !== "on" && value !== "off")
    throw new LightProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return value;
}
function operationName(value: unknown): LightOperation {
  if (
    value !== "light_get_state" &&
    value !== "light_set_power" &&
    value !== "light_set_brightness"
  )
    throw new LightProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return value;
}
function contextOf(value: Record<string, unknown> | undefined): ExecutionContextRecord {
  return {
    authorizationContextHash: string(value?.authorizationContextHash),
    executionMode: string(value?.executionMode),
    simulationId: string(value?.simulationId),
    correlationId: string(value?.correlationId),
  };
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function sameContext(a: ExecutionContextRecord, b: Record<string, unknown> | undefined): boolean {
  const value = contextOf(b);
  return (
    a.authorizationContextHash === value.authorizationContextHash &&
    a.executionMode === value.executionMode &&
    a.simulationId === value.simulationId
  );
}
function notFound(): grpc.ServiceError {
  return Object.assign(new Error("EXECUTION_NOT_FOUND"), {
    code: grpc.status.NOT_FOUND,
    details: "EXECUTION_NOT_FOUND",
    metadata: new grpc.Metadata(),
  });
}
function adapterError(error: unknown): grpc.ServiceError {
  const safe = safeLightError(error);
  return Object.assign(new Error(safe.reasonCode), {
    code: grpc.status.INTERNAL,
    details: safe.reasonCode,
    metadata: new grpc.Metadata(),
  });
}
function credentials(options: LightServerOptions): grpc.ServerCredentials {
  if (options.tlsMode === "disabled") return grpc.ServerCredentials.createInsecure();
  if (!options.tlsCaPath || !options.tlsCertPath || !options.tlsKeyPath)
    throw new Error("ADAPTER_MTLS_FILES_REQUIRED");
  return grpc.ServerCredentials.createSsl(
    readFileSync(options.tlsCaPath),
    [
      {
        private_key: readFileSync(options.tlsKeyPath),
        cert_chain: readFileSync(options.tlsCertPath),
      },
    ],
    true,
  );
}
