import { RuntimeDeploymentError } from "./errors.js";
import type { RuntimeDeploymentId, RuntimeInstanceId } from "./ids.js";

export const RUNTIME_PROCESS_STATES = [
  "missing",
  "starting",
  "online",
  "stopping",
  "stopped",
  "errored",
] as const;
export type RuntimeProcessState = (typeof RUNTIME_PROCESS_STATES)[number];

export type RuntimeLivenessState = "unknown" | "live" | "dead";
export type RuntimeReadinessState = "unknown" | "ready" | "not_ready";
export type RuntimeRegistrationState = "unregistered" | "registered" | "identity_mismatch";
export type RuntimeCatalogState = "unknown" | "pending" | "valid" | "invalid";
export type RuntimeConfigState = "unknown" | "current" | "stale" | "rejected" | "restart_required";

export interface RuntimeProcessIdentity {
  readonly instanceId: RuntimeInstanceId;
  readonly deploymentId: RuntimeDeploymentId;
  readonly pm2Name: string;
  readonly port: number;
}

export interface RuntimeProcessObservation {
  readonly pid: number | null;
  readonly processState: RuntimeProcessState;
  readonly livenessState: RuntimeLivenessState;
  readonly readinessState: RuntimeReadinessState;
  readonly registrationState: RuntimeRegistrationState;
  readonly catalogState: RuntimeCatalogState;
  readonly configState: RuntimeConfigState;
  readonly lastHeartbeatAt: Date | null;
  readonly runtimeVersion: string | null;
  readonly configRevision: number | null;
  readonly restartCount: number;
}

export interface RuntimeProcessProjection
  extends RuntimeProcessIdentity, RuntimeProcessObservation {
  readonly observedRevision: number;
}

export type RuntimeObservedHealth =
  "STOPPED" | "STARTING" | "NOT_READY" | "STALE" | "DEGRADED" | "FAILED" | "READY";

export interface RuntimeObservedHealthEvaluation {
  readonly health: RuntimeObservedHealth;
  readonly readyForActive: boolean;
  readonly reasonCode:
    | "PROCESS_ABSENT"
    | "PROCESS_NOT_ONLINE"
    | "PROCESS_ERRORED"
    | "LIVENESS_UNKNOWN"
    | "LIVENESS_FAILED"
    | "READINESS_UNKNOWN"
    | "READINESS_FAILED"
    | "REGISTRATION_MISSING"
    | "IDENTITY_MISMATCH"
    | "HEARTBEAT_MISSING"
    | "HEARTBEAT_STALE"
    | "RUNTIME_VERSION_MISSING"
    | "CATALOG_PENDING"
    | "CATALOG_INVALID"
    | "CONFIG_UNKNOWN"
    | "CONFIG_STALE"
    | "CONFIG_REJECTED"
    | "CONFIG_RESTART_REQUIRED"
    | "READY";
}

export interface RuntimeObservedHealthOptions {
  readonly now: Date;
  readonly heartbeatStaleAfterMs: number;
}

export function createRuntimeProcessProjection(
  identity: RuntimeProcessIdentity,
  observation: RuntimeProcessObservation,
): RuntimeProcessProjection {
  validateIdentity(identity);
  validateObservation(observation);
  return freezeProjection({ ...identity, ...observation, observedRevision: 0 });
}

export function rehydrateRuntimeProcessProjection(
  projection: RuntimeProcessProjection,
): RuntimeProcessProjection {
  validateIdentity(projection);
  validateObservation(projection);
  requireNonNegativeInteger(projection.observedRevision, "observedRevision");
  return freezeProjection(projection);
}

export function updateRuntimeProcessObservation(
  current: RuntimeProcessProjection,
  observation: RuntimeProcessObservation,
  expectedRevision: number,
): RuntimeProcessProjection {
  validateIdentity(current);
  validateObservation(observation);
  requireNonNegativeInteger(expectedRevision, "expectedRevision");
  if (observationsEqual(current, observation)) return current;
  if (expectedRevision !== current.observedRevision) {
    throw new RuntimeDeploymentError(
      "RUNTIME_PROCESS_REVISION_CONFLICT",
      "RuntimeProcess observed revision precondition does not match",
      {
        expectedRevision,
        actualRevision: current.observedRevision,
        instanceId: current.instanceId,
      },
    );
  }
  return freezeProjection({
    instanceId: current.instanceId,
    deploymentId: current.deploymentId,
    pm2Name: current.pm2Name,
    port: current.port,
    ...observation,
    observedRevision: current.observedRevision + 1,
  });
}

export function evaluateRuntimeObservedHealth(
  process: RuntimeProcessProjection,
  options: RuntimeObservedHealthOptions,
): RuntimeObservedHealthEvaluation {
  validateIdentity(process);
  validateObservation(process);
  requireValidDate(options.now, "now");
  if (!Number.isSafeInteger(options.heartbeatStaleAfterMs) || options.heartbeatStaleAfterMs < 1) {
    invalidProjection("heartbeatStaleAfterMs");
  }

  if (["missing", "stopped"].includes(process.processState)) {
    return evaluation("STOPPED", "PROCESS_ABSENT");
  }
  if (process.processState === "errored") return evaluation("FAILED", "PROCESS_ERRORED");
  if (process.processState !== "online") {
    return evaluation("STARTING", "PROCESS_NOT_ONLINE");
  }
  if (process.livenessState === "dead") return evaluation("FAILED", "LIVENESS_FAILED");
  if (process.livenessState === "unknown") return evaluation("NOT_READY", "LIVENESS_UNKNOWN");
  if (process.readinessState === "not_ready") {
    return evaluation("NOT_READY", "READINESS_FAILED");
  }
  if (process.readinessState === "unknown") {
    return evaluation("NOT_READY", "READINESS_UNKNOWN");
  }
  if (process.registrationState === "identity_mismatch") {
    return evaluation("FAILED", "IDENTITY_MISMATCH");
  }
  if (process.registrationState === "unregistered") {
    return evaluation("NOT_READY", "REGISTRATION_MISSING");
  }
  if (process.lastHeartbeatAt === null) return evaluation("STALE", "HEARTBEAT_MISSING");
  if (options.now.getTime() - process.lastHeartbeatAt.getTime() > options.heartbeatStaleAfterMs) {
    return evaluation("STALE", "HEARTBEAT_STALE");
  }
  if (process.runtimeVersion === null) {
    return evaluation("NOT_READY", "RUNTIME_VERSION_MISSING");
  }
  if (process.catalogState === "invalid") return evaluation("FAILED", "CATALOG_INVALID");
  if (process.catalogState !== "valid") return evaluation("NOT_READY", "CATALOG_PENDING");
  if (process.configState === "rejected") return evaluation("FAILED", "CONFIG_REJECTED");
  if (process.configState === "unknown" || process.configRevision === null) {
    return evaluation("NOT_READY", "CONFIG_UNKNOWN");
  }
  if (process.configState === "stale") return evaluation("DEGRADED", "CONFIG_STALE");
  if (process.configState === "restart_required") {
    return evaluation("DEGRADED", "CONFIG_RESTART_REQUIRED");
  }
  return evaluation("READY", "READY");
}

function evaluation(
  health: RuntimeObservedHealth,
  reasonCode: RuntimeObservedHealthEvaluation["reasonCode"],
): RuntimeObservedHealthEvaluation {
  return Object.freeze({ health, readyForActive: health === "READY", reasonCode });
}

function validateIdentity(identity: RuntimeProcessIdentity): void {
  if (!/^sdar-runtime-[a-z0-9][a-z0-9-]{0,126}$/.test(identity.pm2Name)) {
    invalidProjection("pm2Name");
  }
  if (!Number.isSafeInteger(identity.port) || identity.port < 1 || identity.port > 65_535) {
    invalidProjection("port");
  }
}

function validateObservation(observation: RuntimeProcessObservation): void {
  if (observation.pid !== null && (!Number.isSafeInteger(observation.pid) || observation.pid < 1)) {
    invalidProjection("pid");
  }
  if (!RUNTIME_PROCESS_STATES.includes(observation.processState)) {
    invalidProjection("processState");
  }
  if (observation.lastHeartbeatAt !== null) {
    requireValidDate(observation.lastHeartbeatAt, "lastHeartbeatAt");
  }
  if (observation.runtimeVersion?.trim().length === 0) {
    invalidProjection("runtimeVersion");
  }
  if (
    observation.configRevision !== null &&
    (!Number.isSafeInteger(observation.configRevision) || observation.configRevision < 0)
  ) {
    invalidProjection("configRevision");
  }
  requireNonNegativeInteger(observation.restartCount, "restartCount");
}

function observationsEqual(
  current: RuntimeProcessObservation,
  candidate: RuntimeProcessObservation,
): boolean {
  return (
    current.pid === candidate.pid &&
    current.processState === candidate.processState &&
    current.livenessState === candidate.livenessState &&
    current.readinessState === candidate.readinessState &&
    current.registrationState === candidate.registrationState &&
    current.catalogState === candidate.catalogState &&
    current.configState === candidate.configState &&
    current.lastHeartbeatAt?.getTime() === candidate.lastHeartbeatAt?.getTime() &&
    current.runtimeVersion === candidate.runtimeVersion &&
    current.configRevision === candidate.configRevision &&
    current.restartCount === candidate.restartCount
  );
}

function freezeProjection(projection: RuntimeProcessProjection): RuntimeProcessProjection {
  return Object.freeze({
    ...projection,
    ...(projection.lastHeartbeatAt === null
      ? { lastHeartbeatAt: null }
      : { lastHeartbeatAt: new Date(projection.lastHeartbeatAt) }),
  });
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalidProjection(field);
}

function requireValidDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) invalidProjection(field);
}

function invalidProjection(field: string): never {
  throw new RuntimeDeploymentError(
    "INVALID_RUNTIME_PROCESS_PROJECTION",
    `Invalid RuntimeProcess projection: ${field}`,
    { field },
  );
}
