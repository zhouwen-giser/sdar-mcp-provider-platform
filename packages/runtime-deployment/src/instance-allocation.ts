import { createHash } from "node:crypto";
import {
  runtimeDeploymentId,
  runtimeInstanceId,
  runtimeProviderId,
  type RuntimeDeploymentId,
  type RuntimeInstanceId,
} from "./ids.js";
import type { RuntimeProcessIdentity } from "./process.js";

export interface RuntimeInstanceIdentityInput {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly ordinal: number;
}

export interface RuntimeInstanceIdentity {
  readonly instanceId: RuntimeInstanceId;
  readonly deploymentId: RuntimeDeploymentId;
  readonly pm2Name: string;
  readonly ordinal: number;
}

export interface RuntimePortRange {
  readonly start: number;
  readonly end: number;
}

export interface RuntimePortReleasePolicy {
  readonly kind: "explicit-runtime-port-release";
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly reason: string;
}

export type RuntimeInstanceAllocationErrorCode =
  | "INVALID_RUNTIME_INSTANCE_ALLOCATION"
  | "RUNTIME_INSTANCE_ALLOCATION_CONFLICT"
  | "RUNTIME_PORT_RANGE_EXHAUSTED";

export class RuntimeInstanceAllocationError extends Error {
  constructor(
    readonly code: RuntimeInstanceAllocationErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = "RuntimeInstanceAllocationError";
  }
}

export function deriveRuntimeInstanceIdentity(
  input: RuntimeInstanceIdentityInput,
): RuntimeInstanceIdentity {
  const providerId = runtimeProviderId(input.providerId);
  const deploymentId = runtimeDeploymentId(input.deploymentId);
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > 999) {
    invalidAllocation("ordinal");
  }
  const providerSlug = slug(String(providerId));
  const identityDigest = digest(`${String(providerId)}\0${String(deploymentId)}`);
  const deploymentDigest = digest(String(deploymentId));
  return Object.freeze({
    instanceId: runtimeInstanceId(`runtime-${deploymentDigest}-${String(input.ordinal)}`),
    deploymentId,
    pm2Name: `sdar-runtime-${providerSlug}-${identityDigest}-${String(input.ordinal)}`,
    ordinal: input.ordinal,
  });
}

export function runtimePortRange(start: number, end: number): RuntimePortRange {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1_024 ||
    end > 65_535 ||
    start > end ||
    end - start > 10_000
  ) {
    invalidAllocation("portRange");
  }
  return Object.freeze({ start, end });
}

export function selectRuntimePort(
  range: RuntimePortRange,
  occupiedPorts: ReadonlySet<number>,
): number {
  const validated = runtimePortRange(range.start, range.end);
  for (let port = validated.start; port <= validated.end; port += 1) {
    if (!occupiedPorts.has(port)) return port;
  }
  throw new RuntimeInstanceAllocationError("RUNTIME_PORT_RANGE_EXHAUSTED");
}

export function runtimeProcessIdentity(
  identity: RuntimeInstanceIdentity,
  port: number,
): RuntimeProcessIdentity {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    invalidAllocation("port");
  }
  return Object.freeze({
    instanceId: identity.instanceId,
    deploymentId: identity.deploymentId,
    pm2Name: identity.pm2Name,
    port,
  });
}

export function assertRuntimePortReleasePolicy(
  identity: RuntimeInstanceIdentity,
  policy: unknown,
): asserts policy is RuntimePortReleasePolicy {
  if (
    typeof policy !== "object" ||
    policy === null ||
    !("kind" in policy) ||
    policy.kind !== "explicit-runtime-port-release" ||
    !("providerId" in policy) ||
    typeof policy.providerId !== "string" ||
    policy.providerId.trim().length === 0 ||
    !("deploymentId" in policy) ||
    policy.deploymentId !== identity.deploymentId ||
    !("instanceId" in policy) ||
    policy.instanceId !== identity.instanceId ||
    !("reason" in policy) ||
    typeof policy.reason !== "string" ||
    policy.reason.trim().length < 8
  ) {
    invalidAllocation("releasePolicy");
  }
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized.length === 0 ? "provider" : normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function invalidAllocation(field: string): never {
  throw new RuntimeInstanceAllocationError("INVALID_RUNTIME_INSTANCE_ALLOCATION", field);
}
