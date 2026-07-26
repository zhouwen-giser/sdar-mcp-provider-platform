import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "node:fs";
import {
  adapterServiceDefinition,
  parseBusinessEventSequence,
  protoStructToJson,
} from "../../adapter-protocol/src/index.js";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import type {
  AvailabilityDecision,
  VehicleBusinessEventHub,
  VehicleSnapshot,
} from "../../vehicle-provider-core/src/index.js";
import type { ExecutionContextRecord, ProviderExecution, ProviderStore } from "./types.js";

type Unary<T> = grpc.ServerUnaryCall<T, unknown>;
interface StartRequest {
  taskId?: string;
  operationName?: string;
  arguments?: unknown;
  argumentHash?: string;
  executionContext?: Record<string, unknown>;
}
interface CommandRequest {
  identity?: Record<string, unknown>;
  inputResponses?: unknown[];
}
interface ReconcileRequest extends StartRequest {
  externalExecutionId?: string;
}

export interface StartVehicleOperation {
  taskId: string;
  operationName: string;
  arguments: Record<string, unknown>;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
}

export interface VehicleCommandIdentity {
  taskId: string;
  externalExecutionId: string;
  operationName: string;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
  commandSequence: string;
}

export interface VehicleAdapterRuntime {
  readonly events: NodeJS.EventEmitter;
  snapshot(): VehicleSnapshot;
  availability(
    operationName: string,
    argumentsValue: Record<string, unknown>,
  ): AvailabilityDecision;
  start(input: StartVehicleOperation): Promise<{
    externalExecutionId: string;
    initialSnapshot: Record<string, unknown>;
  }>;
  get(taskId: string): Promise<ProviderExecution | undefined>;
  reconcile(
    input: StartVehicleOperation & { externalExecutionId?: string },
  ): Promise<Record<string, unknown>>;
  command(
    command: "pause" | "resume" | "cancel",
    identity: VehicleCommandIdentity,
  ): Promise<Record<string, unknown>>;
  updateFire(
    identity: VehicleCommandIdentity,
    responses: unknown,
  ): Promise<Record<string, unknown>>;
  executionSnapshot(execution: ProviderExecution): Record<string, unknown>;
}

export class VehicleProviderGrpcServer {
  readonly #server = new grpc.Server();
  #started = false;
  constructor(
    readonly options: {
      host: string;
      port: number;
      tlsMode: "disabled" | "required";
      tlsCaPath?: string;
      tlsCertPath?: string;
      tlsKeyPath?: string;
      internalErrorCode: string;
      manifest(): Record<string, unknown>;
      resource(snapshot: VehicleSnapshot): Record<string, unknown>;
    },
    readonly runtime: VehicleAdapterRuntime,
    readonly store: ProviderStore,
    readonly businessEvents: VehicleBusinessEventHub,
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
      describeProvider: (_call: Unary<unknown>, callback: grpc.sendUnaryData<unknown>) =>
        callback(null, this.options.manifest()),
      listResources: (_call: Unary<unknown>, callback: grpc.sendUnaryData<unknown>) =>
        callback(null, {
          resources: [this.options.resource(this.runtime.snapshot())],
          nextPageToken: "",
        }),
      checkAvailability: (
        call: Unary<{
          checks?: { requestId?: string; operationName?: string; arguments?: unknown }[];
        }>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        const checkedAt = new Date().toISOString();
        const checks = (call.request.checks ?? []).map((check) => {
          const operationName = check.operationName ?? "";
          const decision = this.runtime.availability(
            operationName,
            protoStructToJson(check.arguments),
          );
          return {
            requestId: check.requestId ?? "",
            operationName,
            ...decision,
            reservationMode: "NONE",
            validUntil: timestamp(new Date(Date.parse(checkedAt) + 1000).toISOString()),
            estimatedDelayMs: "0",
            possibleEffects:
              operationName === "vehicle_emergency_stop" ? ["local_track_preemption"] : [],
          };
        });
        callback(null, { profileVersion: "1.0", checkedAt: timestamp(checkedAt), checks });
      },
      startOperation: (call: Unary<StartRequest>, callback: grpc.sendUnaryData<unknown>) => {
        void this.runtime
          .start(startInput(call.request))
          .then((accepted) => callback(null, { result: "accepted", accepted }))
          .catch((error: unknown) =>
            callback(null, {
              result: "rejected",
              rejected: {
                reasonCode: reason(error, this.options.internalErrorCode),
                message: reason(error, this.options.internalErrorCode),
                retryable: retryable(error),
              },
            }),
          );
      },
      getExecution: (call: Unary<{ taskId?: string }>, callback: grpc.sendUnaryData<unknown>) => {
        void this.runtime
          .get(call.request.taskId ?? "")
          .then((execution) =>
            execution === undefined
              ? callback(notFound())
              : callback(null, this.runtime.executionSnapshot(execution)),
          )
          .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
      },
      reconcileExecution: (
        call: Unary<ReconcileRequest>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        void this.runtime
          .reconcile({
            ...startInput(call.request),
            ...(call.request.externalExecutionId === undefined
              ? {}
              : { externalExecutionId: call.request.externalExecutionId }),
          })
          .then((result) => callback(null, result))
          .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
      },
      requestCancel: (call: Unary<CommandRequest>, callback: grpc.sendUnaryData<unknown>) =>
        this.#command(call, callback, "cancel"),
      pauseExecution: (call: Unary<CommandRequest>, callback: grpc.sendUnaryData<unknown>) =>
        this.#command(call, callback, "pause"),
      resumeExecution: (call: Unary<CommandRequest>, callback: grpc.sendUnaryData<unknown>) =>
        this.#command(call, callback, "resume"),
      updateExecution: (call: Unary<CommandRequest>, callback: grpc.sendUnaryData<unknown>) => {
        void this.runtime
          .updateFire(commandIdentity(call.request.identity), call.request.inputResponses ?? [])
          .then((result) => callback(null, result))
          .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
      },
      streamExecutionEvents: (
        call: grpc.ServerWritableStream<
          { execution?: { taskId?: string }; afterRevision?: string | number },
          unknown
        >,
      ) => {
        const taskId = call.request.execution?.taskId ?? "";
        let unsubscribe: () => void = () => undefined;
        void this.runtime.get(taskId).then((execution) => {
          if (execution === undefined) {
            call.emit("error", notFound());
            return;
          }
          if (execution.revision > Number(call.request.afterRevision ?? 0))
            call.write(
              executionEvent(this.runtime.executionSnapshot(execution), execution.revision),
            );
          const listener = (snapshot: Record<string, unknown>) =>
            call.write(executionEvent(snapshot, Number(snapshot.revision ?? 0)));
          this.runtime.events.on(taskId, listener);
          unsubscribe = () => this.runtime.events.off(taskId, listener);
        });
        call.on("cancelled", unsubscribe);
        call.on("close", unsubscribe);
      },
      streamBusinessEvents: (
        call: grpc.ServerWritableStream<
          {
            sourceId?: string;
            sourceStreamId?: string;
            afterSourceSequence?: string;
            _afterSourceSequence?: string;
          },
          AdapterBusinessEvent
        >,
      ) => this.#businessStream(call),
    };
  }
  #command(
    call: Unary<CommandRequest>,
    callback: grpc.sendUnaryData<unknown>,
    command: "pause" | "resume" | "cancel",
  ): void {
    void this.runtime
      .command(command, commandIdentity(call.request.identity))
      .then((result) => callback(null, result))
      .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
  }
  #businessStream(
    call: grpc.ServerWritableStream<
      {
        sourceId?: string;
        sourceStreamId?: string;
        afterSourceSequence?: string;
        _afterSourceSequence?: string;
      },
      AdapterBusinessEvent
    >,
  ): void {
    const sourceId = call.request.sourceId ?? "";
    const streamId = call.request.sourceStreamId ?? "";
    const source = this.store
      .businessEventSources()
      .find((candidate) => candidate.sourceId === sourceId);
    if (source === undefined) {
      call.emit("error", streamError(grpc.status.NOT_FOUND, "SOURCE_NOT_FOUND"));
      return;
    }
    if (source.sourceStreamId !== streamId) {
      call.emit("error", streamError(grpc.status.FAILED_PRECONDITION, "SOURCE_STREAM_RESET"));
      return;
    }
    const hasCursor = call.request._afterSourceSequence === "afterSourceSequence";
    if (source.deliverySemantics === "best_effort_live" && hasCursor) {
      call.emit("error", streamError(grpc.status.OUT_OF_RANGE, "SOURCE_CURSOR_AHEAD"));
      return;
    }
    let unsubscribe: () => void = () => undefined;
    const live = (event: AdapterBusinessEvent) => call.write(event);
    const begin = async () => {
      if (source.deliverySemantics === "durable_at_least_once") {
        const after = parseBusinessEventSequence(call.request.afterSourceSequence ?? "0", true);
        for (const event of await this.store.replayBusinessEvents(sourceId, streamId, after))
          call.write(event);
      }
      unsubscribe = this.businessEvents.subscribe(sourceId, live);
    };
    void begin().catch((error: unknown) =>
      call.emit(
        "error",
        streamError(
          reason(error, this.options.internalErrorCode) === "SOURCE_CURSOR_AHEAD" ||
            reason(error, this.options.internalErrorCode) === "SOURCE_CURSOR_EXPIRED"
            ? grpc.status.OUT_OF_RANGE
            : grpc.status.FAILED_PRECONDITION,
          reason(error, this.options.internalErrorCode),
        ),
      ),
    );
    call.on("cancelled", unsubscribe);
    call.on("close", unsubscribe);
  }
}

function startInput(request: StartRequest): StartVehicleOperation {
  return {
    taskId: request.taskId ?? "",
    operationName: request.operationName ?? "",
    arguments: protoStructToJson(request.arguments),
    argumentHash: request.argumentHash ?? "",
    executionContext: context(request.executionContext),
  };
}
function commandIdentity(value: Record<string, unknown> | undefined): VehicleCommandIdentity {
  return {
    taskId: string(value?.taskId),
    externalExecutionId: string(value?.externalExecutionId),
    operationName: string(value?.operationName),
    argumentHash: string(value?.argumentHash),
    executionContext: context(record(value?.executionContext) ? value.executionContext : undefined),
    commandSequence: scalarString(value?.commandSequence, "0"),
  };
}
function context(value: Record<string, unknown> | undefined): ExecutionContextRecord {
  return {
    authorizationContextHash: string(value?.authorizationContextHash),
    executionMode: scalarString(value?.executionMode, ""),
    simulationId: string(value?.simulationId),
    correlationId: string(value?.correlationId),
  };
}
function executionEvent(snapshot: Record<string, unknown>, revision: number) {
  return {
    taskId: snapshot.taskId,
    revision: String(revision),
    type: "snapshot",
    occurredAt: snapshot.observedAt,
    reasonCode: snapshot.reasonCode,
    snapshot,
  };
}
function credentials(options: {
  tlsMode: "disabled" | "required";
  tlsCaPath?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}): grpc.ServerCredentials {
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
function notFound(): grpc.ServiceError {
  return Object.assign(new Error("EXECUTION_NOT_FOUND"), {
    code: grpc.status.NOT_FOUND,
    details: "EXECUTION_NOT_FOUND",
    metadata: new grpc.Metadata(),
  });
}
function serviceError(error: unknown, internalErrorCode: string): grpc.ServiceError {
  return Object.assign(new Error(reason(error, internalErrorCode)), {
    code: grpc.status.INTERNAL,
    details: reason(error, internalErrorCode),
    metadata: new grpc.Metadata(),
  });
}
function streamError(code: grpc.status, reasonCode: string): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  metadata.set("io.sdar.business-events.reason-code", reasonCode);
  return Object.assign(new Error(reasonCode), { code, details: reasonCode, metadata });
}
function retryable(error: unknown): boolean {
  return /UNAVAILABLE|TIMEOUT|STALE|INTERNAL/.test(error instanceof Error ? error.message : "");
}
function reason(error: unknown, internalErrorCode: string): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : internalErrorCode;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function scalarString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}
