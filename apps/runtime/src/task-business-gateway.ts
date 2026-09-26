import * as grpc from "@grpc/grpc-js";
import {
  TaskBusinessOperationProfileSchema,
  TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  type BusinessArtifactReadOptions,
  type BusinessSnapshotPartSelector,
  type GrpcAdapterGateway,
  type StartOperationOptions,
  type TaskBusinessOperationProfile,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  AdapterContractError,
  CapabilityNotSupportedError,
  InvalidParamsError,
  TaskNotFoundOrUnauthorizedError,
  type AuthorizationContext,
  type ExecutionMode,
  type TaskRecord,
} from "../../../packages/domain/src/index.js";
import {
  FrozenErrorCode,
  FrozenProtocolError,
  mapFrozenRuntimeError,
} from "../../../packages/mcp-protocol/src/index.js";
import type { ValidatedManifest } from "../../../packages/operation-registry/src/index.js";
import type {
  OperationSnapshotRepository,
  TaskRepository,
} from "../../../packages/persistence-postgres/src/index.js";

export const TASK_BUSINESS_PROFILE_VERSION = "1.0-rc2" as const;
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TaskBusinessClientBinding {
  externalExecutionId?: string;
  resourceId?: string;
  executionMode?: ExecutionMode;
  simulationId?: string | null;
}

export interface BoundTaskBusinessTask {
  task: TaskRecord;
  externalExecutionId: string;
  resourceId: string;
  profile: TaskBusinessOperationProfile;
  adapterOptions: StartOperationOptions;
}

type BusinessAccess = "context" | "artifact" | "input" | "intervention";
type BusinessAdapter = Pick<
  GrpcAdapterGateway,
  "getBusinessContext" | "getBusinessArtifact" | "getBusinessSnapshotPart"
>;

/** Resolves every business request through the authorized, persisted Task and its operation snapshot. */
export class TaskBusinessGateway {
  constructor(
    readonly manifest: ValidatedManifest,
    readonly tasks: Pick<TaskRepository, "getAuthorized">,
    readonly snapshots: Pick<OperationSnapshotRepository, "loadOperationSnapshot">,
    readonly adapter: BusinessAdapter,
  ) {}

  async resolve(
    taskId: string,
    authorization: AuthorizationContext,
    access: BusinessAccess,
    claimed: TaskBusinessClientBinding = {},
  ): Promise<BoundTaskBusinessTask> {
    if (!taskIdPattern.test(taskId)) throw new InvalidParamsError("TASK_ID_INVALID");
    const task = await this.tasks.getAuthorized(taskId, authorization);
    if (
      task.taskId !== taskId ||
      task.providerId !== this.manifest.providerId ||
      task.authorizationContextHash !== authorization.hash ||
      task.executionMode !== authorization.executionMode ||
      task.simulationId !== authorization.simulationId
    ) {
      throw new TaskNotFoundOrUnauthorizedError();
    }
    const snapshot = await this.snapshots.loadOperationSnapshot(task.operationSnapshotId);
    if (
      snapshot.snapshotId !== task.operationSnapshotId ||
      snapshot.providerId !== task.providerId ||
      snapshot.operation.name !== task.operationName
    ) {
      throw new AdapterContractError("BUSINESS_OPERATION_BINDING_INVALID");
    }
    const profile = TaskBusinessOperationProfileSchema.safeParse(
      snapshot.operation.businessFeedbackProfile,
    );
    if (!profile.success || !this.sourceAvailable(profile.data.source.sourceId)) {
      throw new CapabilityNotSupportedError("TASK_BUSINESS_NOT_SUPPORTED");
    }
    if (access === "input" && !profile.data.methods.inputUpdate) {
      throw new CapabilityNotSupportedError("BUSINESS_INPUT_NOT_SUPPORTED");
    }
    if (
      access === "intervention" &&
      (!profile.data.methods.interventionApply || profile.data.interventionTypes.length === 0)
    ) {
      throw new CapabilityNotSupportedError("BUSINESS_INTERVENTION_NOT_SUPPORTED");
    }
    const externalExecutionId = task.externalExecutionId;
    if (!externalExecutionId) {
      throw new CapabilityNotSupportedError("BUSINESS_EXECUTION_NOT_BOUND");
    }
    const resourceId = boundResourceId(snapshot.operation.resourceBinding, task.arguments);
    if (
      claimed.externalExecutionId !== undefined &&
      claimed.externalExecutionId !== externalExecutionId
    ) {
      throw new InvalidParamsError("BUSINESS_EXECUTION_ID_MISMATCH");
    }
    if (claimed.resourceId !== undefined && claimed.resourceId !== resourceId) {
      throw new InvalidParamsError("BUSINESS_RESOURCE_ID_MISMATCH");
    }
    if (claimed.executionMode !== undefined && claimed.executionMode !== task.executionMode) {
      throw new InvalidParamsError("BUSINESS_EXECUTION_MODE_MISMATCH");
    }
    if (claimed.simulationId !== undefined && claimed.simulationId !== task.simulationId) {
      throw new InvalidParamsError("BUSINESS_SIMULATION_ID_MISMATCH");
    }
    return {
      task,
      externalExecutionId,
      resourceId,
      profile: profile.data,
      adapterOptions: {
        authorizationContextHash: task.authorizationContextHash,
        executionMode: task.executionMode,
        simulationId: task.simulationId,
        externalExecutionId,
        argumentHash: task.argumentHash,
        ...(authorization.correlationId === undefined
          ? {}
          : { correlationId: authorization.correlationId }),
        ...(task.rootTraceparent === null || task.rootTraceparent === undefined
          ? {}
          : { rootTraceparent: task.rootTraceparent }),
        ...(task.rootTracestate === null || task.rootTracestate === undefined
          ? {}
          : { rootTracestate: task.rootTracestate }),
      },
    };
  }

  async getContext(
    taskId: string,
    authorization: AuthorizationContext,
    maxPageBytes: number,
    pageCursor = "",
    claimed: TaskBusinessClientBinding = {},
  ): Promise<Record<string, unknown>> {
    const bound = await this.resolve(taskId, authorization, "context", claimed);
    return this.adapter.getBusinessContext(
      bound.task.taskId,
      bound.externalExecutionId,
      maxPageBytes,
      pageCursor,
      bound.adapterOptions,
    );
  }

  getSnapshotPartForBound(
    bound: BoundTaskBusinessTask,
    selector: BusinessSnapshotPartSelector,
  ): ReturnType<GrpcAdapterGateway["getBusinessSnapshotPart"]> {
    if (!bound.profile.methods.snapshotPartGet) {
      throw new CapabilityNotSupportedError("BUSINESS_SNAPSHOT_PART_NOT_SUPPORTED");
    }
    return this.adapter.getBusinessSnapshotPart(
      bound.task.taskId,
      bound.externalExecutionId,
      selector,
      bound.adapterOptions,
    );
  }

  async getArtifact(
    taskId: string,
    authorization: AuthorizationContext,
    artifactId: string,
    revision: number | undefined,
    representationName: string,
    includeContent: boolean,
    claimed: TaskBusinessClientBinding = {},
    content?: Pick<BusinessArtifactReadOptions, "contentOffset" | "maxContentBytes">,
  ): ReturnType<GrpcAdapterGateway["getBusinessArtifact"]> {
    const bound = await this.resolve(taskId, authorization, "artifact", claimed);
    return this.getArtifactForBound(
      bound,
      artifactId,
      revision,
      representationName,
      includeContent,
      content,
    );
  }

  /** Use the same authorized binding for the read and the response identity check. */
  getArtifactForBound(
    bound: BoundTaskBusinessTask,
    artifactId: string,
    revision: number | undefined,
    representationName: string,
    includeContent: boolean,
    content?: Pick<BusinessArtifactReadOptions, "contentOffset" | "maxContentBytes">,
  ): ReturnType<GrpcAdapterGateway["getBusinessArtifact"]> {
    return this.adapter.getBusinessArtifact(
      bound.task.taskId,
      bound.externalExecutionId,
      artifactId,
      revision,
      representationName,
      includeContent,
      { ...bound.adapterOptions, ...content },
    );
  }

  private sourceAvailable(sourceId: string): boolean {
    return this.manifest.businessEventSources.some(
      (source) =>
        source.sourceId === sourceId &&
        source.deliverySemantics === "durable_at_least_once" &&
        source.replaySupported,
    );
  }
}

function boundResourceId(
  binding: { mode: "NONE" | "ARGUMENT_REFERENCE"; resourceIdJsonPointer?: string } | undefined,
  argumentsValue: Record<string, unknown>,
): string {
  if (binding?.mode !== "ARGUMENT_REFERENCE" || !binding.resourceIdJsonPointer?.startsWith("/")) {
    throw new AdapterContractError("BUSINESS_RESOURCE_BINDING_MISSING");
  }
  let current: unknown = argumentsValue;
  for (const escaped of binding.resourceIdJsonPointer.slice(1).split("/")) {
    const key = escaped.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      throw new AdapterContractError("BUSINESS_RESOURCE_BINDING_INVALID");
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "string" || current.length === 0) {
    throw new AdapterContractError("BUSINESS_RESOURCE_BINDING_INVALID");
  }
  return current;
}

/** Stable JSON-RPC error data for later public task-business methods. */
export function taskBusinessProtocolError(error: unknown): FrozenProtocolError {
  const common = {
    profileVersion: TASK_BUSINESS_PROFILE_VERSION,
    schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  };
  if (error instanceof FrozenProtocolError) {
    return new FrozenProtocolError(error.code, error.message, error.httpStatus, {
      ...common,
      ...error.data,
      reasonCode:
        typeof error.data?.reasonCode === "string"
          ? error.data.reasonCode
          : "TASK_BUSINESS_REQUEST_INVALID",
    });
  }
  const grpcError = error as Partial<grpc.ServiceError> | null;
  if (grpcError && typeof grpcError.code === "number") {
    const fromMetadata = grpcError.metadata?.get("io.sdar.task-business.reason-code")[0];
    const detail = typeof fromMetadata === "string" ? fromMetadata : grpcError.details;
    const reasonCode =
      typeof detail === "string" && /^[A-Z][A-Z0-9_]{2,127}$/.test(detail)
        ? detail
        : "TASK_BUSINESS_ADAPTER_FAILURE";
    if (grpcError.code === grpc.status.UNIMPLEMENTED) {
      return new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404, {
        ...common,
        reasonCode: "TASK_BUSINESS_NOT_SUPPORTED",
      });
    }
    if (
      grpcError.code === grpc.status.NOT_FOUND ||
      grpcError.code === grpc.status.INVALID_ARGUMENT ||
      grpcError.code === grpc.status.FAILED_PRECONDITION ||
      grpcError.code === grpc.status.RESOURCE_EXHAUSTED
    ) {
      return new FrozenProtocolError(
        FrozenErrorCode.InvalidParams,
        "Business request unavailable.",
        400,
        {
          ...common,
          reasonCode,
        },
      );
    }
    return new FrozenProtocolError(FrozenErrorCode.InternalError, "Internal error", 500, {
      ...common,
      reasonCode: "TASK_BUSINESS_ADAPTER_FAILURE",
      retryable: true,
    });
  }
  const mapped = mapFrozenRuntimeError(error);
  return new FrozenProtocolError(mapped.code, mapped.message, mapped.httpStatus, {
    ...common,
    ...mapped.data,
    reasonCode:
      typeof mapped.data?.reasonCode === "string"
        ? mapped.data.reasonCode
        : "TASK_BUSINESS_RUNTIME_FAILURE",
  });
}
