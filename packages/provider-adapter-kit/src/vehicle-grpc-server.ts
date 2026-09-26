import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "node:fs";
import {
  adapterServiceDefinition,
  jsonToProtoStruct,
  parseBusinessEventSequence,
  protoStructToJson,
} from "../../adapter-protocol/src/index.js";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import type { BusinessSnapshotPartSelector } from "../../adapter-protocol/src/index.js";
import type {
  AvailabilityDecision,
  VehicleBusinessEventHub,
  VehicleSnapshot,
} from "../../vehicle-provider-core/src/index.js";
import type { ExecutionContextRecord, ProviderExecution, ProviderStore } from "./types.js";
import { SmppDiagnosticResponseLossError } from "./diagnostics.js";

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
  inputs?: unknown[];
  businessInputCommand?: unknown;
  command?: unknown;
}
interface BusinessReadRequest {
  taskId?: string;
  externalExecutionId?: string;
  executionContext?: Record<string, unknown>;
  maxPageBytes?: number;
  pageCursor?: string;
  contextRevision?: string | number;
  objectKind?: string;
  objectId?: string;
  objectRevision?: string | number;
  offset?: string | number;
  maxBytes?: number;
  artifactId?: string;
  revision?: string | number;
  representationName?: string;
  includeContent?: boolean;
  contentOffset?: string | number;
  maxContentBytes?: number;
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

export interface VehicleBusinessReadIdentity {
  taskId: string;
  externalExecutionId: string;
  executionContext: ExecutionContextRecord;
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
  /** Operation-bound reply routing; older adapters retain the updateFire fallback. */
  updateInput?(
    identity: VehicleCommandIdentity,
    update: { inputs: readonly unknown[]; inputResponses: readonly unknown[] },
  ): Promise<Record<string, unknown>>;
  getBusinessContext?(
    identity: VehicleBusinessReadIdentity,
    maxPageBytes: number,
    pageCursor: string,
  ): Promise<Record<string, unknown> | undefined>;
  getBusinessSnapshotPart?(
    identity: VehicleBusinessReadIdentity,
    selector: BusinessSnapshotPartSelector,
  ): Promise<{
    jsonBytes: Uint8Array;
    totalBytes: number;
    sha256: string;
    nextOffset?: number;
  }>;
  getBusinessArtifact?(
    identity: VehicleBusinessReadIdentity,
    artifactId: string,
    revision: number | undefined,
    representationName: string,
    includeContent: boolean,
  ): Promise<
    | {
        artifact: Record<string, unknown>;
        contentBytes?: Uint8Array;
        mediaType?: string;
        sha256?: string;
      }
    | undefined
  >;
  updateTaskBusinessInput?(
    identity: VehicleCommandIdentity,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  applyIntervention?(
    identity: VehicleCommandIdentity,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  executionSnapshot(
    execution: ProviderExecution,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
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
          .catch((error: unknown) => {
            if (error instanceof SmppDiagnosticResponseLossError) {
              callback(responseLossServiceError(error));
              return;
            }
            callback(null, {
              result: "rejected",
              rejected: {
                reasonCode: reason(error, this.options.internalErrorCode),
                message: reason(error, this.options.internalErrorCode),
                retryable: retryable(error),
              },
            });
          });
      },
      getExecution: (call: Unary<{ taskId?: string }>, callback: grpc.sendUnaryData<unknown>) => {
        void this.runtime
          .get(call.request.taskId ?? "")
          .then(async (execution) => {
            if (execution === undefined) callback(notFound());
            else callback(null, await this.runtime.executionSnapshot(execution));
          })
          .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
      },
      getBusinessContext: (
        call: Unary<BusinessReadRequest>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        if (!this.runtime.getBusinessContext) {
          callback(businessMethodUnavailable());
          return;
        }
        void this.runtime
          .getBusinessContext(
            businessReadIdentity(call.request),
            call.request.maxPageBytes ?? 1_048_576,
            call.request.pageCursor ?? "",
          )
          .then((page) =>
            page === undefined
              ? callback(businessNotFound())
              : callback(null, { page: jsonToProtoStruct(page) }),
          )
          .catch((error: unknown) =>
            callback(businessServiceError(error, this.options.internalErrorCode)),
          );
      },
      getBusinessSnapshotPart: (
        call: Unary<BusinessReadRequest>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        if (!this.runtime.getBusinessSnapshotPart) {
          callback(businessMethodUnavailable());
          return;
        }
        const contextRevision = Number(call.request.contextRevision ?? -1);
        const offset = Number(call.request.offset ?? 0);
        const requestedMax = call.request.maxBytes ?? 0;
        const maxBytes = requestedMax === 0 ? 1_048_576 : requestedMax;
        const objectKind = call.request.objectKind ?? "";
        const objectId = call.request.objectId ?? "";
        const objectRevision = call.request.objectRevision;
        const isObject = objectKind !== "" || objectId !== "" || objectRevision !== undefined;
        const validKind = ["artifact", "action", "input_request", "intervention"].includes(
          objectKind,
        );
        const parsedObjectRevision = Number(objectRevision);
        if (
          !Number.isSafeInteger(contextRevision) ||
          contextRevision < 0 ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isInteger(maxBytes) ||
          maxBytes < 1 ||
          maxBytes > 1_048_576 ||
          (isObject &&
            (!validKind ||
              objectId.length < 1 ||
              objectId.length > 256 ||
              !Number.isSafeInteger(parsedObjectRevision) ||
              parsedObjectRevision < 1))
        ) {
          callback(businessInvalidArgument("BUSINESS_SNAPSHOT_PART_INVALID"));
          return;
        }
        const selector: BusinessSnapshotPartSelector = {
          contextRevision,
          offset,
          maxBytes,
          ...(isObject
            ? {
                objectRef: {
                  kind: objectKind as NonNullable<
                    BusinessSnapshotPartSelector["objectRef"]
                  >["kind"],
                  id: objectId,
                  revision: parsedObjectRevision,
                },
              }
            : {}),
        };
        void this.runtime
          .getBusinessSnapshotPart(businessReadIdentity(call.request), selector)
          .then((part) =>
            callback(null, {
              jsonBytes: Buffer.from(part.jsonBytes),
              totalBytes: String(part.totalBytes),
              sha256: part.sha256,
              ...(part.nextOffset === undefined ? {} : { nextOffset: String(part.nextOffset) }),
            }),
          )
          .catch((error: unknown) =>
            callback(businessServiceError(error, this.options.internalErrorCode)),
          );
      },
      getBusinessArtifact: (
        call: Unary<BusinessReadRequest>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        if (!this.runtime.getBusinessArtifact) {
          callback(businessMethodUnavailable());
          return;
        }
        const revision =
          call.request.revision === undefined ? undefined : Number(call.request.revision);
        if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
          callback(businessInvalidArgument("ARTIFACT_REVISION_INVALID"));
          return;
        }
        const offset = Number(call.request.contentOffset ?? 0);
        const requestedMax = call.request.maxContentBytes ?? 0;
        const maxBytes = requestedMax === 0 ? 1_048_576 : requestedMax;
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isInteger(maxBytes) ||
          maxBytes < 1 ||
          maxBytes > 1_048_576
        ) {
          callback(businessInvalidArgument("ARTIFACT_CONTENT_RANGE_INVALID"));
          return;
        }
        void this.runtime
          .getBusinessArtifact(
            businessReadIdentity(call.request),
            call.request.artifactId ?? "",
            revision,
            call.request.representationName ?? "",
            call.request.includeContent ?? false,
          )
          .then((result) => {
            if (result === undefined) {
              callback(businessNotFound());
              return;
            }
            const bytes = call.request.includeContent ? result.contentBytes : undefined;
            if (bytes && offset > bytes.length) {
              callback(businessError(grpc.status.OUT_OF_RANGE, "ARTIFACT_CONTENT_OFFSET_AHEAD"));
              return;
            }
            const end = bytes ? Math.min(offset + maxBytes, bytes.length) : 0;
            callback(null, {
              artifact: jsonToProtoStruct(result.artifact),
              ...(bytes === undefined
                ? {}
                : { contentBytes: Buffer.from(bytes.subarray(offset, end)) }),
              mediaType: result.mediaType ?? "",
              sha256: result.sha256 ?? "",
              contentTotalBytes: String(bytes?.length ?? 0),
              ...(bytes && end < bytes.length ? { nextContentOffset: String(end) } : {}),
            });
          })
          .catch((error: unknown) =>
            callback(businessServiceError(error, this.options.internalErrorCode)),
          );
      },
      reconcileExecution: (
        call: Unary<ReconcileRequest>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        void this.runtime
          .reconcile({
            ...startInput(call.request),
            ...(call.request.externalExecutionId === undefined ||
            call.request.externalExecutionId.length === 0
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
        const inputs = call.request.inputs ?? [];
        const inputResponses = call.request.inputResponses ?? [];
        if (
          call.request.businessInputCommand !== undefined &&
          call.request.businessInputCommand !== null
        ) {
          if (inputResponses.length > 0 || inputs.length > 0) {
            callback(businessInvalidArgument("BUSINESS_INPUT_AMBIGUOUS"));
            return;
          }
          if (!this.runtime.updateTaskBusinessInput) {
            callback(businessMethodUnavailable());
            return;
          }
          void this.runtime
            .updateTaskBusinessInput(
              commandIdentity(call.request.identity),
              protoStructToJson(call.request.businessInputCommand),
            )
            .then((result) => callback(null, result))
            .catch((error: unknown) =>
              callback(serviceError(error, this.options.internalErrorCode)),
            );
          return;
        }
        if (inputResponses.length > 0 && inputs.length > 0) {
          callback(businessInvalidArgument("INPUT_RESPONSE_WIRE_AMBIGUOUS"));
          return;
        }
        const identity = commandIdentity(call.request.identity);
        const update = this.runtime.updateInput
          ? this.runtime.updateInput(identity, { inputs, inputResponses })
          : this.runtime.updateFire(identity, inputResponses);
        void update
          .then((result) => callback(null, result))
          .catch((error: unknown) => callback(serviceError(error, this.options.internalErrorCode)));
      },
      applyIntervention: (call: Unary<CommandRequest>, callback: grpc.sendUnaryData<unknown>) => {
        if (!this.runtime.applyIntervention) {
          callback(businessMethodUnavailable());
          return;
        }
        void this.runtime
          .applyIntervention(
            commandIdentity(call.request.identity),
            protoStructToJson(call.request.command),
          )
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
        const subscription = streamSubscription(call);
        const afterRevision = Number(call.request.afterRevision ?? 0);
        let deliveredRevision = afterRevision;
        let initializing = true;
        const queued: Record<string, unknown>[] = [];
        const listener = (snapshot: Record<string, unknown>) => {
          if (subscription.isClosed()) return;
          if (initializing) {
            queued.push(snapshot);
            return;
          }
          const revision = Number(snapshot.revision ?? 0);
          if (revision <= deliveredRevision) return;
          call.write(executionEvent(snapshot, revision));
          deliveredRevision = revision;
        };
        this.runtime.events.on(taskId, listener);
        subscription.attach(() => this.runtime.events.off(taskId, listener));
        void this.runtime
          .get(taskId)
          .then(async (execution) => {
            if (subscription.isClosed()) return;
            if (execution === undefined) {
              call.emit("error", notFound());
              return;
            }
            if (execution.revision > afterRevision) {
              const snapshot = await this.runtime.executionSnapshot(execution);
              if (subscription.isClosed()) return;
              call.write(executionEvent(snapshot, execution.revision));
              deliveredRevision = execution.revision;
            }
            queued.sort((left, right) => Number(left.revision ?? 0) - Number(right.revision ?? 0));
            initializing = false;
            for (const snapshot of queued) {
              if (subscription.isClosed()) break;
              listener(snapshot);
            }
          })
          .catch((error: unknown) => {
            if (!subscription.isClosed()) {
              call.emit("error", serviceError(error, this.options.internalErrorCode));
            }
          });
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
    const subscription = streamSubscription(call);
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
    const live = (event: AdapterBusinessEvent) => !subscription.isClosed() && call.write(event);
    const begin = async () => {
      if (source.deliverySemantics === "durable_at_least_once") {
        const after = parseBusinessEventSequence(call.request.afterSourceSequence ?? "0", true);
        for (const event of await this.store.replayBusinessEvents(sourceId, streamId, after)) {
          if (subscription.isClosed()) return;
          call.write(event);
        }
      }
      if (subscription.isClosed()) return;
      subscription.attach(this.businessEvents.subscribe(sourceId, live));
    };
    void begin().catch((error: unknown) => {
      if (subscription.isClosed()) return;
      call.emit(
        "error",
        streamError(
          reason(error, this.options.internalErrorCode) === "SOURCE_CURSOR_AHEAD" ||
            reason(error, this.options.internalErrorCode) === "SOURCE_CURSOR_EXPIRED"
            ? grpc.status.OUT_OF_RANGE
            : grpc.status.FAILED_PRECONDITION,
          reason(error, this.options.internalErrorCode),
        ),
      );
    });
  }
}

function streamSubscription(call: NodeJS.EventEmitter) {
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    unsubscribe = undefined;
    call.removeListener("cancelled", close);
    call.removeListener("close", close);
    call.removeListener("error", close);
  };
  call.once("cancelled", close);
  call.once("close", close);
  call.once("error", close);
  return {
    isClosed() {
      return closed;
    },
    attach(cleanup: () => void) {
      if (closed) cleanup();
      else unsubscribe = cleanup;
    },
  };
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
function businessReadIdentity(request: BusinessReadRequest): VehicleBusinessReadIdentity {
  return {
    taskId: request.taskId ?? "",
    externalExecutionId: request.externalExecutionId ?? "",
    executionContext: context(request.executionContext),
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
function businessNotFound(): grpc.ServiceError {
  return businessError(grpc.status.NOT_FOUND, "BUSINESS_OBJECT_NOT_FOUND");
}
function businessMethodUnavailable(): grpc.ServiceError {
  return businessError(grpc.status.UNIMPLEMENTED, "BUSINESS_METHOD_NOT_ENABLED");
}
function businessInvalidArgument(reasonCode: string): grpc.ServiceError {
  return businessError(grpc.status.INVALID_ARGUMENT, reasonCode);
}
function businessError(code: grpc.status, reasonCode: string): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  metadata.set("io.sdar.task-business.reason-code", reasonCode);
  return Object.assign(new Error(reasonCode), { code, details: reasonCode, metadata });
}
function businessServiceError(error: unknown, internalErrorCode: string): grpc.ServiceError {
  const code = reason(error, internalErrorCode);
  if (code === "BUSINESS_METHOD_NOT_ENABLED") return businessMethodUnavailable();
  if (
    [
      "BUSINESS_EXECUTION_NOT_FOUND",
      "ARTIFACT_REVISION_NOT_FOUND",
      "BUSINESS_SNAPSHOT_REF_NOT_FOUND",
      "BUSINESS_READ_SCOPE_MISMATCH",
      "BUSINESS_READ_PROVIDER_MISMATCH",
    ].includes(code)
  ) {
    return businessError(grpc.status.NOT_FOUND, code);
  }
  if (
    [
      "BUSINESS_CONTEXT_NOT_AVAILABLE",
      "BUSINESS_SNAPSHOT_REF_NOT_ACTIVE",
      "ARTIFACT_CONTENT_EXPIRED",
      "ARTIFACT_NOT_AVAILABLE",
    ].includes(code)
  ) {
    return businessError(grpc.status.FAILED_PRECONDITION, code);
  }
  if (
    [
      "BUSINESS_EXECUTION_ID_REQUIRED",
      "ARTIFACT_REPRESENTATION_NOT_FOUND",
      "BUSINESS_SNAPSHOT_PAGE_LIMIT_INVALID",
      "BUSINESS_SNAPSHOT_CURSOR_INVALID",
      "BUSINESS_SNAPSHOT_REVISION_CHANGED",
      "BUSINESS_SNAPSHOT_PART_INVALID",
    ].includes(code)
  ) {
    return businessError(grpc.status.INVALID_ARGUMENT, code);
  }
  if (code === "BUSINESS_SNAPSHOT_TOO_LARGE")
    return businessError(grpc.status.RESOURCE_EXHAUSTED, code);
  if (code === "BUSINESS_SNAPSHOT_OFFSET_AHEAD")
    return businessError(grpc.status.OUT_OF_RANGE, code);
  return serviceError(error, internalErrorCode);
}
function serviceError(error: unknown, internalErrorCode: string): grpc.ServiceError {
  return Object.assign(new Error(reason(error, internalErrorCode)), {
    code: grpc.status.INTERNAL,
    details: reason(error, internalErrorCode),
    metadata: new grpc.Metadata(),
  });
}
function responseLossServiceError(error: SmppDiagnosticResponseLossError): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  metadata.set("sdar-diagnostic-lease-id", error.leaseId);
  metadata.set("sdar-task-id", error.taskId);
  metadata.set("sdar-external-execution-id", error.externalExecutionId);
  metadata.set("sdar-device-mission-id", error.deviceMissionId);
  return Object.assign(new Error(error.code), {
    code: grpc.status.UNAVAILABLE,
    details: error.code,
    metadata,
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
