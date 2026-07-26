import type { RuntimeDeploymentStatus } from "../model.js";

export const RUNTIME_INFRASTRUCTURE_STEPS = [
  "database_prepare",
  "database_migrate",
  "bootstrap_render",
  "process_start",
  "process_stop",
  "process_restart",
  "process_delete",
  "process_inspect",
  "process_list",
  "health_probe",
] as const;

export type RuntimeInfrastructureStep = (typeof RUNTIME_INFRASTRUCTURE_STEPS)[number];

export interface RuntimeInfrastructureOperationContext {
  readonly operationId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface RuntimeInfrastructureDeploymentTarget {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly environment: string;
  readonly runtimeVersion: string;
}

export interface RuntimeInfrastructureInstanceTarget extends RuntimeInfrastructureDeploymentTarget {
  readonly instanceId: string;
  readonly ordinal: number;
  readonly processName: string;
}

export interface RuntimeDatabasePrepareRequest {
  readonly target: RuntimeInfrastructureDeploymentTarget;
  readonly databaseProfileId: string;
}

export interface RuntimeDatabasePrepareResult {
  readonly databaseProfileId: string;
  readonly outcome: "created" | "ready";
  readonly evidenceRef: string;
}

export interface RuntimeDatabaseMigrationRequest {
  readonly target: RuntimeInfrastructureDeploymentTarget;
  readonly databaseProfileId: string;
  readonly migrationSet: "runtime";
}

export interface RuntimeDatabaseMigrationResult {
  readonly migrationSet: "runtime";
  readonly outcome: "applied" | "already_applied";
  readonly appliedCount: number;
  readonly evidenceRef: string;
}

export interface RuntimeBootstrapRenderRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly configRevision: number;
  readonly configChecksum: string;
  readonly httpPort: number;
  readonly databaseUrlSecretRef: string;
  readonly pmsTokenSecretRef?: string;
}

export interface RuntimeBootstrapArtifact {
  readonly artifactId: string;
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly configRevision: number;
  readonly configChecksum: string;
  readonly httpPort: number;
  readonly databaseUrlFileRef: string;
  readonly pmsTokenFileRef?: string;
  readonly redactedPreview: Readonly<Record<string, string | number>>;
}

export interface RuntimeProcessStartRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly bootstrap: RuntimeBootstrapArtifact;
}

export interface RuntimeProcessTargetRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
}

export type RuntimeInfrastructureProcessState =
  "missing" | "starting" | "online" | "stopping" | "stopped" | "errored";

export interface RuntimeInfrastructureProcessObservation {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly state: RuntimeInfrastructureProcessState;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly restartCount: number;
  readonly opaqueLogRef?: string;
}

export interface RuntimeProcessListRequest {
  readonly providerId?: string;
  readonly deploymentId?: string;
}

export interface RuntimeHealthProbeRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly expectedDeploymentStatus: RuntimeDeploymentStatus;
}

export interface RuntimeHealthObservation {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly processState: RuntimeInfrastructureProcessState;
  readonly live: boolean;
  readonly ready: boolean;
  readonly identityVerified: boolean;
  readonly checkedAt: string;
}

export interface RuntimeInfrastructureSuccess<T> {
  readonly step: RuntimeInfrastructureStep;
  readonly state: "succeeded";
  readonly outcome: "changed" | "unchanged";
  readonly operationId: string;
  readonly value: T;
}

export interface RuntimeInfrastructureAdapterPort {
  prepareDatabase(
    request: RuntimeDatabasePrepareRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeDatabasePrepareResult>>;
  migrateDatabase(
    request: RuntimeDatabaseMigrationRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeDatabaseMigrationResult>>;
  renderBootstrap(
    request: RuntimeBootstrapRenderRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeBootstrapArtifact>>;
  startProcess(
    request: RuntimeProcessStartRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeInfrastructureProcessObservation>>;
  stopProcess(
    request: RuntimeProcessTargetRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeInfrastructureProcessObservation>>;
  restartProcess(
    request: RuntimeProcessStartRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeInfrastructureProcessObservation>>;
  deleteProcess(
    request: RuntimeProcessTargetRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeInfrastructureProcessObservation>>;
  inspectProcess(
    request: RuntimeProcessTargetRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeInfrastructureProcessObservation>>;
  listProcesses(
    request: RuntimeProcessListRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<readonly RuntimeInfrastructureProcessObservation[]>>;
  probeHealth(
    request: RuntimeHealthProbeRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeInfrastructureSuccess<RuntimeHealthObservation>>;
}

export type RuntimeInfrastructureAdapterErrorCode =
  | "RUNTIME_INFRASTRUCTURE_INVALID_REQUEST"
  | "RUNTIME_INFRASTRUCTURE_NOT_FOUND"
  | "RUNTIME_INFRASTRUCTURE_CONFLICT"
  | "RUNTIME_INFRASTRUCTURE_UNAVAILABLE"
  | "RUNTIME_INFRASTRUCTURE_UNAUTHORIZED"
  | "RUNTIME_INFRASTRUCTURE_TIMEOUT"
  | "RUNTIME_INFRASTRUCTURE_CANCELLED"
  | "RUNTIME_INFRASTRUCTURE_VERIFICATION_FAILED"
  | "RUNTIME_INFRASTRUCTURE_INTERNAL";

export type RuntimeInfrastructureFailureState = "failed" | "timed_out" | "cancelled";

export class RuntimeInfrastructureAdapterError extends Error {
  constructor(
    readonly code: RuntimeInfrastructureAdapterErrorCode,
    readonly step: RuntimeInfrastructureStep,
    readonly state: RuntimeInfrastructureFailureState,
    readonly retryable: boolean,
    readonly operationId: string,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RuntimeInfrastructureAdapterError";
  }
}

export function runtimeInfrastructureOperationContext(input: {
  readonly operationId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): RuntimeInfrastructureOperationContext {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
  if (
    !identifier.test(input.operationId) ||
    !identifier.test(input.correlationId) ||
    !identifier.test(input.idempotencyKey) ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 300_000
  ) {
    throw new RuntimeInfrastructureAdapterError(
      "RUNTIME_INFRASTRUCTURE_INVALID_REQUEST",
      "process_inspect",
      "failed",
      false,
      validOperationId(input.operationId),
    );
  }
  return Object.freeze({
    operationId: input.operationId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: input.timeoutMs,
    signal: input.signal ?? new AbortController().signal,
  });
}

function validOperationId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) ? value : "invalid-operation";
}
