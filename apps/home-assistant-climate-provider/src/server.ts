import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "node:fs";
import {
  adapterServiceDefinition,
  jsonToProtoStruct,
  protoStructToJson,
} from "../../../packages/adapter-protocol/src/index.js";
import { ClimateProviderError, safeClimateError } from "./errors.js";
import { snapshot, timestamp } from "./execution.js";
import type { ClimateExecutionEngine } from "./execution.js";
import { normalizeClimateState } from "./home-assistant.js";
import type { HomeAssistantClimateClient } from "./home-assistant.js";
import { climateManifest } from "./manifest.js";
import type { ClimateResourceRegistry } from "./resources.js";
import type { ClimateStore } from "./store.js";
import type { ClimateOperation, ExecutionContextRecord } from "./types.js";
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
export interface ClimateServerOptions {
  providerId: string;
  providerVersion: string;
  host: string;
  port: number;
  tlsMode: "disabled" | "required";
  tlsCaPath?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}
export class ClimateProviderServer {
  readonly #server = new grpc.Server();
  #started = false;
  constructor(
    readonly options: ClimateServerOptions,
    readonly registry: ClimateResourceRegistry,
    readonly rest: HomeAssistantClimateClient,
    readonly store: ClimateStore,
    readonly engine: ClimateExecutionEngine,
  ) {
    this.#server.addService(adapterServiceDefinition(), this.#handlers());
  }
  start(): Promise<number> {
    return new Promise((resolve, reject) =>
      this.#server.bindAsync(
        `${this.options.host}:${String(this.options.port)}`,
        credentials(this.options),
        (e, p) => {
          if (e !== null) reject(e);
          else {
            this.#started = true;
            resolve(p);
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
        cb(null, climateManifest(this.options.providerId, this.options.providerVersion)),
      listResources: (_c: Call<unknown>, cb: grpc.sendUnaryData<unknown>) =>
        cb(null, {
          resources: this.registry.list().map((r) => ({
            resourceId: r.resourceId,
            displayName: r.displayName,
            resourceType: "home_assistant.climate",
            enabled: r.enabled,
            health: "unknown",
            labels: {},
            metadata: jsonToProtoStruct({
              temperatureRange: r.temperatureRange,
              allowedHvacModes: r.allowedHvacModes,
            }),
          })),
          nextPageToken: "",
        }),
      checkAvailability: (
        c: Call<{ checks?: { requestId?: string; operationName?: string; arguments?: unknown }[] }>,
        cb: grpc.sendUnaryData<unknown>,
      ) => {
        void Promise.all((c.request.checks ?? []).map((x) => this.#availability(x)))
          .then((checks) =>
            cb(null, {
              profileVersion: "1.0",
              checkedAt: timestamp(new Date().toISOString()),
              checks,
            }),
          )
          .catch((e: unknown) => cb(error(e)));
      },
      startOperation: (c: Call<Start>, cb: grpc.sendUnaryData<unknown>) => {
        void this.#start(c.request)
          .then((v) => cb(null, v))
          .catch((e: unknown) => cb(error(e)));
      },
      getExecution: (c: Call<{ taskId?: string }>, cb: grpc.sendUnaryData<unknown>) => {
        const x = this.store.get(c.request.taskId ?? "");
        if (x === undefined) cb(notFound());
        else cb(null, snapshot(x));
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
      const r = this.registry.require(text(args.resourceId));
      const state = normalizeClimateState(r.resourceId, await this.rest.getState(r.entityId));
      if (check.operationName === "climate_set_hvac_mode") {
        const mode = typeof args.hvacMode === "string" ? args.hvacMode : "";
        if (!r.allowedHvacModes.includes(mode))
          return {
            ...base,
            availability: "DISABLED",
            reasonCode: "HVAC_MODE_NOT_ALLOWED",
            description: "HVAC mode is outside the resource allowlist.",
          };
        if (!state.supportedHvacModes.includes(mode))
          return {
            ...base,
            availability: "DISABLED",
            reasonCode: "HVAC_MODE_NOT_SUPPORTED",
            description: "Home Assistant does not report the HVAC mode.",
          };
      }
      return {
        ...base,
        availability: state.reachable ? "AVAILABLE" : "UNKNOWN",
        reasonCode: state.reachable ? "AVAILABLE" : "RESOURCE_STATE_UNKNOWN",
        description: state.reachable
          ? "Configured climate resource is reachable."
          : "Climate state is unavailable.",
        validUntil: timestamp(new Date(Date.now() + 5000).toISOString()),
      };
    } catch (e) {
      const safe = safeClimateError(e);
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
      if (operation === "climate_get_state") {
        const r = this.registry.require(resourceId);
        const state = normalizeClimateState(resourceId, await this.rest.getState(r.entityId));
        await this.engine.observe(state);
        const externalExecutionId = `sync-${request.taskId ?? "query"}`;
        const result = {
          resourceId: state.resourceId,
          power: state.power,
          reachable: state.reachable,
          hvacMode: state.hvacMode,
          currentTemperature: state.currentTemperature,
          targetTemperature: state.targetTemperature,
          temperatureUnit: state.temperatureUnit,
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
              message: "Climate state read.",
              result: jsonToProtoStruct(result),
              evidence: [
                {
                  evidenceId: `home-assistant-climate-state-${resourceId}-${state.observedAt}`,
                  evidenceType: "climate.state.observation",
                  observedAt: state.observedAt,
                  subjectRef: `resource:${resourceId}`,
                  payloadRef: { kind: "structured_content", jsonPointer: "/hvacMode" },
                  producer: [this.options.providerId, "home-assistant"],
                },
              ],
              observedAt: timestamp(state.observedAt),
            },
          },
          result: "accepted",
        };
      }
      const x = await this.engine.start({
        taskId: text(request.taskId),
        operationName: operation,
        resourceId,
        ...(operation === "climate_set_power"
          ? { power: power(args.power) }
          : operation === "climate_set_hvac_mode"
            ? { hvacMode: text(args.hvacMode) }
            : { temperature: temperature(args.targetTemperature) }),
        argumentHash: text(request.argumentHash),
        executionContext: context,
      });
      return {
        accepted: { externalExecutionId: x.externalExecutionId, initialSnapshot: snapshot(x) },
        result: "accepted",
      };
    } catch (e) {
      const safe = safeClimateError(e);
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
  #reconcile(r: Reconcile): Record<string, unknown> {
    const x = this.store.get(r.taskId ?? "");
    if (x === undefined)
      return {
        status: "NOT_FOUND",
        reasonCode: "EXECUTION_NOT_FOUND",
        message: "Execution does not exist.",
        retryable: false,
      };
    if (
      x.operationName !== r.operationName ||
      x.argumentHash !== r.argumentHash ||
      ((r.externalExecutionId ?? "") !== "" && x.externalExecutionId !== r.externalExecutionId) ||
      !sameContext(x.executionContext, r.executionContext)
    )
      return {
        status: "CONFLICT",
        reasonCode: "TASK_IDENTITY_CONFLICT",
        message: "Task identity conflicts.",
        retryable: false,
      };
    return {
      status: "FOUND",
      snapshot: snapshot(x),
      externalExecutionId: x.externalExecutionId,
      reasonCode: "EXECUTION_FOUND",
      message: "Execution recovered.",
      retryable: false,
    };
  }
  #unsupported(r: Command, command: string, reasonCode: string): Record<string, unknown> {
    const x = this.store.get(r.identity?.taskId ?? "");
    const key = `${command}:${String(r.identity?.commandSequence ?? 0)}`;
    const old = x?.commandAcks[key];
    if (old !== undefined) return old;
    const ack = {
      accepted: false,
      reasonCode,
      message: reasonCode,
      commandSequence: r.identity?.commandSequence ?? "0",
      identity: r.identity,
    };
    if (x !== undefined) {
      x.commandAcks[key] = ack;
      this.store.set(x);
    }
    return ack;
  }
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v)
    throw new ClimateProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return v;
}
function temperature(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new ClimateProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return v;
}
function power(v: unknown): "on" | "off" {
  if (v !== "on" && v !== "off")
    throw new ClimateProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return v;
}
function operationName(v: unknown): ClimateOperation {
  if (
    v !== "climate_get_state" &&
    v !== "climate_set_power" &&
    v !== "climate_set_hvac_mode" &&
    v !== "climate_set_temperature"
  )
    throw new ClimateProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return v;
}
function contextOf(v: Record<string, unknown> | undefined): ExecutionContextRecord {
  return {
    authorizationContextHash: string(v?.authorizationContextHash),
    executionMode: string(v?.executionMode),
    simulationId: string(v?.simulationId),
    correlationId: string(v?.correlationId),
  };
}
function string(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function sameContext(a: ExecutionContextRecord, b: Record<string, unknown> | undefined): boolean {
  const v = contextOf(b);
  return (
    a.authorizationContextHash === v.authorizationContextHash &&
    a.executionMode === v.executionMode &&
    a.simulationId === v.simulationId
  );
}
function notFound(): grpc.ServiceError {
  return Object.assign(new Error("EXECUTION_NOT_FOUND"), {
    code: grpc.status.NOT_FOUND,
    details: "EXECUTION_NOT_FOUND",
    metadata: new grpc.Metadata(),
  });
}
function error(e: unknown): grpc.ServiceError {
  const safe = safeClimateError(e);
  return Object.assign(new Error(safe.reasonCode), {
    code: grpc.status.INTERNAL,
    details: safe.reasonCode,
    metadata: new grpc.Metadata(),
  });
}
function credentials(o: ClimateServerOptions): grpc.ServerCredentials {
  if (o.tlsMode === "disabled") return grpc.ServerCredentials.createInsecure();
  if (!o.tlsCaPath || !o.tlsCertPath || !o.tlsKeyPath)
    throw new Error("ADAPTER_MTLS_FILES_REQUIRED");
  return grpc.ServerCredentials.createSsl(
    readFileSync(o.tlsCaPath),
    [{ private_key: readFileSync(o.tlsKeyPath), cert_chain: readFileSync(o.tlsCertPath) }],
    true,
  );
}
