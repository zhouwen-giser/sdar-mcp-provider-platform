const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const PROTOCOL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REGISTRATION_FIELDS = [
  "providerId",
  "deploymentId",
  "instanceId",
  "sessionId",
  "runtimeVersion",
  "protocolVersion",
  "configRevision",
  "readinessState",
] as const;
const HEARTBEAT_FIELDS = [...REGISTRATION_FIELDS, "sequence"] as const;

export type RuntimeRegistrationReadiness = "ready" | "not_ready";
export type RuntimeRegistrationFreshness = "registered" | "stale";

export interface ExpectedRuntimeInstance {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
}

export interface RuntimeRegistrationRequest extends ExpectedRuntimeInstance {
  readonly sessionId: string;
  readonly configRevision: number;
  readonly readinessState: RuntimeRegistrationReadiness;
}

export interface RuntimeHeartbeatRequest extends RuntimeRegistrationRequest {
  readonly sequence: number;
}

export interface RuntimeRegistrationSnapshot extends RuntimeRegistrationRequest {
  readonly heartbeatSequence: number;
  readonly registeredAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly expiresAt: Date;
  readonly revision: number;
}

export interface RuntimeRegistrationMutation {
  readonly outcome: "created" | "updated" | "unchanged";
  readonly registration: RuntimeRegistrationSnapshot;
}

export type RuntimeRegistrationErrorCode =
  | "RUNTIME_REGISTRATION_INVALID_REQUEST"
  | "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND"
  | "RUNTIME_REGISTRATION_IDENTITY_MISMATCH"
  | "RUNTIME_REGISTRATION_VERSION_MISMATCH"
  | "RUNTIME_REGISTRATION_PROTOCOL_MISMATCH"
  | "RUNTIME_REGISTRATION_SESSION_MISMATCH"
  | "RUNTIME_REGISTRATION_REPLAY_CONFLICT"
  | "RUNTIME_REGISTRATION_PROJECTION_CONFLICT"
  | "RUNTIME_HEARTBEAT_NOT_REGISTERED"
  | "RUNTIME_HEARTBEAT_SEQUENCE_STALE"
  | "RUNTIME_HEARTBEAT_CLOCK_INVALID";

export class RuntimeRegistrationError extends Error {
  constructor(
    readonly code: RuntimeRegistrationErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = "RuntimeRegistrationError";
  }
}

export function registerRuntime(
  expected: ExpectedRuntimeInstance | null,
  current: RuntimeRegistrationSnapshot | null,
  request: RuntimeRegistrationRequest,
  receivedAt: Date,
  heartbeatTtlMs: number,
): RuntimeRegistrationMutation {
  const resolvedExpected = requireExpected(expected);
  validateExpected(resolvedExpected);
  validateRegistrationRequest(request);
  validateServerInput(receivedAt, heartbeatTtlMs);
  assertExpected(resolvedExpected, request);
  if (current !== null) {
    validateSnapshot(current);
    assertExpected(resolvedExpected, current);
    if (current.sessionId === request.sessionId) {
      if (!registrationPayloadEqual(current, request)) {
        throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_REPLAY_CONFLICT");
      }
      return Object.freeze({ outcome: "unchanged", registration: current });
    }
  }
  return Object.freeze({
    outcome: current === null ? "created" : "updated",
    registration: snapshot({
      ...request,
      heartbeatSequence: 0,
      registeredAt: receivedAt,
      lastHeartbeatAt: receivedAt,
      expiresAt: expiresAt(receivedAt, heartbeatTtlMs),
      revision: (current?.revision ?? -1) + 1,
    }),
  });
}

export function acceptRuntimeHeartbeat(
  expected: ExpectedRuntimeInstance | null,
  current: RuntimeRegistrationSnapshot | null,
  request: RuntimeHeartbeatRequest,
  receivedAt: Date,
  heartbeatTtlMs: number,
): RuntimeRegistrationMutation {
  const resolvedExpected = requireExpected(expected);
  validateExpected(resolvedExpected);
  validateHeartbeatRequest(request);
  validateServerInput(receivedAt, heartbeatTtlMs);
  assertExpected(resolvedExpected, request);
  if (current === null) {
    throw new RuntimeRegistrationError("RUNTIME_HEARTBEAT_NOT_REGISTERED");
  }
  validateSnapshot(current);
  assertExpected(resolvedExpected, current);
  if (current.sessionId !== request.sessionId) {
    throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_SESSION_MISMATCH", "sessionId");
  }
  if (request.sequence < current.heartbeatSequence) {
    throw new RuntimeRegistrationError("RUNTIME_HEARTBEAT_SEQUENCE_STALE", "sequence");
  }
  if (request.sequence === current.heartbeatSequence) {
    if (!heartbeatPayloadEqual(current, request)) {
      throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_REPLAY_CONFLICT");
    }
    return Object.freeze({ outcome: "unchanged", registration: current });
  }
  if (receivedAt.getTime() < current.lastHeartbeatAt.getTime()) {
    throw new RuntimeRegistrationError("RUNTIME_HEARTBEAT_CLOCK_INVALID");
  }
  return Object.freeze({
    outcome: "updated",
    registration: snapshot({
      ...request,
      heartbeatSequence: request.sequence,
      registeredAt: current.registeredAt,
      lastHeartbeatAt: receivedAt,
      expiresAt: expiresAt(receivedAt, heartbeatTtlMs),
      revision: current.revision + 1,
    }),
  });
}

export function runtimeRegistrationFreshness(
  registration: RuntimeRegistrationSnapshot,
  now: Date,
): RuntimeRegistrationFreshness {
  validateSnapshot(registration);
  requireDate(now);
  return now.getTime() >= registration.expiresAt.getTime() ? "stale" : "registered";
}

export function parseRuntimeRegistrationRequest(input: unknown): RuntimeRegistrationRequest {
  const value = exactObject(input, REGISTRATION_FIELDS);
  const request = {
    providerId: value.providerId,
    deploymentId: value.deploymentId,
    instanceId: value.instanceId,
    sessionId: value.sessionId,
    runtimeVersion: value.runtimeVersion,
    protocolVersion: value.protocolVersion,
    configRevision: value.configRevision,
    readinessState: value.readinessState,
  } as RuntimeRegistrationRequest;
  validateRegistrationRequest(request);
  return Object.freeze(request);
}

export function parseRuntimeHeartbeatRequest(input: unknown): RuntimeHeartbeatRequest {
  const value = exactObject(input, HEARTBEAT_FIELDS);
  const request = {
    providerId: value.providerId,
    deploymentId: value.deploymentId,
    instanceId: value.instanceId,
    sessionId: value.sessionId,
    runtimeVersion: value.runtimeVersion,
    protocolVersion: value.protocolVersion,
    configRevision: value.configRevision,
    readinessState: value.readinessState,
    sequence: value.sequence,
  } as RuntimeHeartbeatRequest;
  validateHeartbeatRequest(request);
  return Object.freeze(request);
}

function validateExpected(value: ExpectedRuntimeInstance): void {
  for (const [field, candidate] of [
    ["providerId", value.providerId],
    ["deploymentId", value.deploymentId],
    ["instanceId", value.instanceId],
  ] as const) {
    if (typeof candidate !== "string" || !IDENTIFIER.test(candidate)) invalid(field);
  }
  if (typeof value.runtimeVersion !== "string" || !VERSION.test(value.runtimeVersion)) {
    invalid("runtimeVersion");
  }
  if (typeof value.protocolVersion !== "string" || !PROTOCOL_VERSION.test(value.protocolVersion)) {
    invalid("protocolVersion");
  }
}

function validateRegistrationRequest(value: RuntimeRegistrationRequest): void {
  validateExpected(value);
  if (typeof value.sessionId !== "string" || !IDENTIFIER.test(value.sessionId))
    invalid("sessionId");
  if (!nonNegativeInteger(value.configRevision)) invalid("configRevision");
  if (
    typeof value.readinessState !== "string" ||
    !["ready", "not_ready"].includes(value.readinessState)
  ) {
    invalid("readinessState");
  }
}

function validateHeartbeatRequest(value: RuntimeHeartbeatRequest): void {
  validateRegistrationRequest(value);
  if (!nonNegativeInteger(value.sequence)) invalid("sequence");
}

function validateSnapshot(value: RuntimeRegistrationSnapshot): void {
  validateRegistrationRequest(value);
  if (
    !nonNegativeInteger(value.heartbeatSequence) ||
    !nonNegativeInteger(value.revision) ||
    !validDate(value.registeredAt) ||
    !validDate(value.lastHeartbeatAt) ||
    !validDate(value.expiresAt) ||
    value.lastHeartbeatAt.getTime() < value.registeredAt.getTime() ||
    value.expiresAt.getTime() <= value.lastHeartbeatAt.getTime()
  ) {
    invalid("snapshot");
  }
}

function validateServerInput(receivedAt: Date, heartbeatTtlMs: number): void {
  requireDate(receivedAt);
  if (!Number.isSafeInteger(heartbeatTtlMs) || heartbeatTtlMs < 1_000 || heartbeatTtlMs > 300_000) {
    invalid("heartbeatTtlMs");
  }
}

function assertExpected(expected: ExpectedRuntimeInstance, actual: ExpectedRuntimeInstance): void {
  for (const field of ["providerId", "deploymentId", "instanceId"] as const) {
    if (actual[field] !== expected[field]) {
      throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_IDENTITY_MISMATCH", field);
    }
  }
  if (actual.runtimeVersion !== expected.runtimeVersion) {
    throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_VERSION_MISMATCH", "runtimeVersion");
  }
  if (actual.protocolVersion !== expected.protocolVersion) {
    throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_PROTOCOL_MISMATCH", "protocolVersion");
  }
}

function registrationPayloadEqual(
  current: RuntimeRegistrationSnapshot,
  request: RuntimeRegistrationRequest,
): boolean {
  return (
    current.providerId === request.providerId &&
    current.deploymentId === request.deploymentId &&
    current.instanceId === request.instanceId &&
    current.sessionId === request.sessionId &&
    current.runtimeVersion === request.runtimeVersion &&
    current.protocolVersion === request.protocolVersion &&
    current.configRevision === request.configRevision &&
    current.readinessState === request.readinessState
  );
}

function heartbeatPayloadEqual(
  current: RuntimeRegistrationSnapshot,
  request: RuntimeHeartbeatRequest,
): boolean {
  return (
    registrationPayloadEqual(current, request) && current.heartbeatSequence === request.sequence
  );
}

function snapshot(value: RuntimeRegistrationSnapshot): RuntimeRegistrationSnapshot {
  return Object.freeze({
    ...value,
    registeredAt: new Date(value.registeredAt),
    lastHeartbeatAt: new Date(value.lastHeartbeatAt),
    expiresAt: new Date(value.expiresAt),
  });
}

function exactObject(input: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !fields.includes(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid("request");
  }
  return input as Readonly<Record<string, unknown>>;
}

function requireExpected(value: ExpectedRuntimeInstance | null): ExpectedRuntimeInstance {
  if (value === null) {
    throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND");
  }
  return value;
}

function expiresAt(receivedAt: Date, heartbeatTtlMs: number): Date {
  return new Date(receivedAt.getTime() + heartbeatTtlMs);
}

function requireDate(value: Date): void {
  if (!validDate(value)) invalid("receivedAt");
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(field: string): never {
  throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_INVALID_REQUEST", field);
}
