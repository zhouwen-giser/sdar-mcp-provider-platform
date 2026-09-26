import { InvalidParamsError, type ExecutionMode } from "../../../domain/src/index.js";
import { TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION } from "../../../adapter-protocol/src/index.js";
import { mapFrozenRuntimeError } from "./error-mapper.js";
import { FrozenErrorCode, FrozenProtocolError } from "./errors.js";
import type { FrozenJsonRpcRequest } from "./request-validator.js";
import {
  RuntimeInterventionCommandSchema,
  type RuntimeInterventionCommand,
} from "../../../vehicle-provider-core/src/task-business-interaction.js";
import {
  BusinessObjectRefSchema,
  type BusinessObjectRef,
} from "../../../vehicle-provider-core/src/task-business-contract.js";

export const TASK_BUSINESS_EXTENSION = "io.sdar/taskBusiness";
export const TASK_BUSINESS_PUBLIC_PROFILE_VERSION = "1.0-rc2";

export function mapTaskBusinessRequestError(error: unknown): FrozenProtocolError {
  const mapped = mapFrozenRuntimeError(error);
  return new FrozenProtocolError(mapped.code, mapped.message, mapped.httpStatus, {
    ...mapped.data,
    profileVersion: TASK_BUSINESS_PUBLIC_PROFILE_VERSION,
    schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
    reasonCode:
      typeof mapped.data?.reasonCode === "string"
        ? mapped.data.reasonCode
        : "TASK_BUSINESS_REQUEST_INVALID",
  });
}

export interface PublicBusinessBinding {
  externalExecutionId?: string;
  resourceId?: string;
  executionMode?: ExecutionMode;
  simulationId?: string | null;
}

export interface PublicContextQuery {
  taskId: string;
  maxPageBytes: number;
  pageCursor?: string;
  claimed: PublicBusinessBinding;
}

export interface PublicArtifactQuery {
  taskId: string;
  artifactId: string;
  revision?: number;
  representationName: string;
  includeContent: boolean;
  contentOffset?: number;
  maxContentBytes?: number;
  claimed: PublicBusinessBinding;
}

export interface PublicSnapshotPartQuery {
  taskId: string;
  snapshotToken: string;
  objectRef?: BusinessObjectRef;
  offset: number;
  maxBytes: number;
  claimed: PublicBusinessBinding;
}

export interface PublicInterventionApply {
  command: RuntimeInterventionCommand;
  claimed: PublicBusinessBinding;
}

const contextKeys = new Set([
  "taskId",
  "maxPageBytes",
  "pageCursor",
  "externalExecutionId",
  "resourceId",
  "executionMode",
  "simulationId",
  "_meta",
]);
const artifactKeys = new Set([
  "taskId",
  "artifactId",
  "revision",
  "representationName",
  "includeContent",
  "contentOffset",
  "maxContentBytes",
  "externalExecutionId",
  "resourceId",
  "executionMode",
  "simulationId",
  "_meta",
]);
const snapshotPartKeys = new Set([
  "taskId",
  "snapshotToken",
  "objectRef",
  "offset",
  "maxBytes",
  "externalExecutionId",
  "resourceId",
  "executionMode",
  "simulationId",
  "_meta",
]);
const interventionKeys = new Set([
  "schemaVersion",
  "commandId",
  "taskId",
  "executionId",
  "interventionId",
  "guard",
  "input",
  "externalExecutionId",
  "resourceId",
  "executionMode",
  "simulationId",
  "_meta",
]);

export function requireTaskBusinessCapability(request: FrozenJsonRpcRequest): void {
  const extensions = request.meta.clientCapabilities.extensions;
  const capability = isRecord(extensions) ? extensions[TASK_BUSINESS_EXTENSION] : undefined;
  if (!isRecord(capability) || capability.profileVersion !== TASK_BUSINESS_PUBLIC_PROFILE_VERSION) {
    throw new FrozenProtocolError(
      FrozenErrorCode.MissingRequiredClientCapability,
      "Missing required client capability",
      400,
      {
        requiredCapabilities: {
          extensions: {
            [TASK_BUSINESS_EXTENSION]: { profileVersion: TASK_BUSINESS_PUBLIC_PROFILE_VERSION },
          },
        },
      },
    );
  }
}

export function parsePublicContextQuery(params: Record<string, unknown>): PublicContextQuery {
  assertKeys(params, contextKeys);
  const taskId = nonempty(params.taskId, "TASK_ID_INVALID");
  const maxPageBytes = optionalInteger(
    params.maxPageBytes,
    65_536,
    1_024,
    1_048_576,
    "BUSINESS_PAGE_SIZE_INVALID",
  );
  const pageCursor =
    params.pageCursor === undefined
      ? undefined
      : nonempty(params.pageCursor, "BUSINESS_SNAPSHOT_CURSOR_INVALID", 4_096);
  return {
    taskId,
    maxPageBytes,
    ...(pageCursor === undefined ? {} : { pageCursor }),
    claimed: parseBinding(params),
  };
}

export function parsePublicArtifactQuery(params: Record<string, unknown>): PublicArtifactQuery {
  assertKeys(params, artifactKeys);
  const taskId = nonempty(params.taskId, "TASK_ID_INVALID");
  const artifactId = nonempty(params.artifactId, "ARTIFACT_ID_INVALID", 256);
  const revision =
    params.revision === undefined
      ? undefined
      : optionalInteger(
          params.revision,
          0,
          1,
          Number.MAX_SAFE_INTEGER,
          "ARTIFACT_REVISION_INVALID",
        );
  const representationName =
    params.representationName === undefined
      ? ""
      : boundedString(params.representationName, "ARTIFACT_REPRESENTATION_INVALID", 128);
  const includeContent = params.includeContent ?? false;
  if (typeof includeContent !== "boolean")
    throw new InvalidParamsError("ARTIFACT_CONTENT_FLAG_INVALID");
  const contentOffset =
    params.contentOffset === undefined
      ? undefined
      : optionalInteger(
          params.contentOffset,
          0,
          0,
          Number.MAX_SAFE_INTEGER,
          "ARTIFACT_CONTENT_OFFSET_INVALID",
        );
  const maxContentBytes =
    params.maxContentBytes === undefined
      ? undefined
      : optionalInteger(params.maxContentBytes, 0, 1, 1_048_576, "ARTIFACT_CONTENT_SIZE_INVALID");
  if (!includeContent && (contentOffset !== undefined || maxContentBytes !== undefined)) {
    throw new InvalidParamsError("ARTIFACT_CONTENT_OPTIONS_INVALID");
  }
  return {
    taskId,
    artifactId,
    representationName,
    includeContent,
    ...(revision === undefined ? {} : { revision }),
    ...(contentOffset === undefined ? {} : { contentOffset }),
    ...(maxContentBytes === undefined ? {} : { maxContentBytes }),
    claimed: parseBinding(params),
  };
}

export function parsePublicSnapshotPartQuery(
  params: Record<string, unknown>,
): PublicSnapshotPartQuery {
  assertKeys(params, snapshotPartKeys);
  const taskId = nonempty(params.taskId, "TASK_ID_INVALID");
  const snapshotToken = nonempty(params.snapshotToken, "BUSINESS_SNAPSHOT_CURSOR_INVALID", 4096);
  const objectRef =
    params.objectRef === undefined
      ? undefined
      : BusinessObjectRefSchema.safeParse(params.objectRef);
  if (objectRef !== undefined && !objectRef.success)
    throw new InvalidParamsError("BUSINESS_SNAPSHOT_REF_INVALID");
  return {
    taskId,
    snapshotToken,
    ...(objectRef === undefined ? {} : { objectRef: objectRef.data }),
    offset: optionalInteger(
      params.offset,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "BUSINESS_SNAPSHOT_OFFSET_INVALID",
    ),
    maxBytes: optionalInteger(params.maxBytes, 65_536, 1, 1_048_576, "BUSINESS_PAGE_SIZE_INVALID"),
    claimed: parseBinding(params),
  };
}

export function parsePublicInterventionApply(
  params: Record<string, unknown>,
): PublicInterventionApply {
  assertKeys(params, interventionKeys);
  const parsed = RuntimeInterventionCommandSchema.safeParse({
    schemaVersion: params.schemaVersion,
    commandId: params.commandId,
    taskId: params.taskId,
    executionId: params.executionId,
    interventionId: params.interventionId,
    guard: params.guard,
    input: params.input,
  });
  if (!parsed.success) throw new InvalidParamsError("BUSINESS_INTERVENTION_COMMAND_INVALID");
  return { command: parsed.data, claimed: parseBinding(params) };
}

function parseBinding(params: Record<string, unknown>): PublicBusinessBinding {
  const externalExecutionId =
    params.externalExecutionId === undefined
      ? undefined
      : nonempty(params.externalExecutionId, "BUSINESS_EXECUTION_ID_INVALID", 256);
  const resourceId =
    params.resourceId === undefined
      ? undefined
      : nonempty(params.resourceId, "BUSINESS_RESOURCE_ID_INVALID", 256);
  const executionMode = params.executionMode;
  if (executionMode !== undefined && executionMode !== "live" && executionMode !== "simulation") {
    throw new InvalidParamsError("BUSINESS_EXECUTION_MODE_INVALID");
  }
  const simulationId = params.simulationId;
  if (
    simulationId !== undefined &&
    simulationId !== null &&
    (typeof simulationId !== "string" || simulationId.length === 0 || simulationId.length > 256)
  ) {
    throw new InvalidParamsError("BUSINESS_SIMULATION_ID_INVALID");
  }
  return {
    ...(externalExecutionId === undefined ? {} : { externalExecutionId }),
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(executionMode === undefined ? {} : { executionMode }),
    ...(simulationId === undefined ? {} : { simulationId }),
  };
}

function assertKeys(params: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(params).some((key) => !allowed.has(key))) {
    throw new InvalidParamsError("UNKNOWN_TASK_BUSINESS_FIELD");
  }
}

function nonempty(value: unknown, reason: string, max = 256): string {
  const parsed = boundedString(value, reason, max);
  if (parsed.length === 0) throw new InvalidParamsError(reason);
  return parsed;
}

function boundedString(value: unknown, reason: string, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new InvalidParamsError(reason);
  return value;
}

function optionalInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  reason: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidParamsError(reason);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
