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
export type RuntimeConfigState =
  "unknown" | "current" | "externally_managed" | "stale" | "rejected" | "restart_required";

export const RUNTIME_PROCESS_MANAGERS = ["pm2", "direct_container"] as const;
export type RuntimeProcessManager = (typeof RUNTIME_PROCESS_MANAGERS)[number];

interface RuntimeProcessIdentityBase {
  readonly instanceId: RuntimeInstanceId;
  readonly deploymentId: RuntimeDeploymentId;
}

/**
 * A missing processManager is accepted only as a backwards-compatible spelling
 * of the legacy PM2 identity. Rehydrated and newly allocated projections always
 * expose it explicitly.
 */
export interface Pm2RuntimeProcessIdentity extends RuntimeProcessIdentityBase {
  readonly processManager?: "pm2";
  readonly pm2Name: string;
  readonly port: number;
  readonly controlEndpoint?: never;
  readonly advertisedEndpoint?: never;
}

export interface DirectContainerRuntimeProcessIdentity extends RuntimeProcessIdentityBase {
  readonly processManager: "direct_container";
  readonly pm2Name: null;
  readonly port: null;
  /** PMS-only base URL used for probes and catalog discovery. */
  readonly controlEndpoint: string;
  /** Consumer-reachable base URL used when publishing Registry endpoints. */
  readonly advertisedEndpoint: string;
}

export type RuntimeProcessIdentity =
  Pm2RuntimeProcessIdentity | DirectContainerRuntimeProcessIdentity;

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

export type RuntimeProcessProjection = RuntimeProcessIdentity &
  RuntimeProcessObservation & {
    readonly observedRevision: number;
  };

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
    ...current,
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
  const raw = identity as unknown as {
    readonly processManager?: unknown;
    readonly pm2Name?: unknown;
    readonly port?: unknown;
    readonly controlEndpoint?: unknown;
    readonly advertisedEndpoint?: unknown;
  };
  if (raw.processManager === "direct_container") {
    if (raw.pm2Name !== null) invalidProjection("pm2Name");
    if (raw.port !== null) invalidProjection("port");
    if (typeof raw.controlEndpoint !== "string") invalidProjection("controlEndpoint");
    if (typeof raw.advertisedEndpoint !== "string") invalidProjection("advertisedEndpoint");
    validateEndpoint(raw.controlEndpoint, "controlEndpoint");
    validateEndpoint(raw.advertisedEndpoint, "advertisedEndpoint");
    return;
  }
  if (raw.processManager !== undefined && raw.processManager !== "pm2") {
    invalidProjection("processManager");
  }
  if (
    typeof raw.pm2Name !== "string" ||
    !/^sdar-runtime-[a-z0-9][a-z0-9-]{0,126}$/.test(raw.pm2Name)
  ) {
    invalidProjection("pm2Name");
  }
  if (
    typeof raw.port !== "number" ||
    !Number.isSafeInteger(raw.port) ||
    raw.port < 1 ||
    raw.port > 65_535
  ) {
    invalidProjection("port");
  }
}

function validateEndpoint(value: string, field: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 2_048) {
    invalidProjection(field);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalidProjection(field);
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0 ||
    endpoint.pathname !== "/"
  ) {
    invalidProjection(field);
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
    processManager: projection.processManager ?? "pm2",
    ...(projection.lastHeartbeatAt === null
      ? { lastHeartbeatAt: null }
      : { lastHeartbeatAt: new Date(projection.lastHeartbeatAt) }),
  }) as RuntimeProcessProjection;
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
