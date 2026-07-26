import { PmsDomainError } from "./errors.js";
import type {
  AuditEventId,
  ConfigRevisionId,
  EnvironmentId,
  ProviderId,
  ProviderPackageId,
  ProviderTypeId,
  ResourceId,
} from "./ids.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const PROVIDER_HOSTING_MODES = ["vendor_managed", "platform_managed"] as const;
export type ProviderHostingMode = (typeof PROVIDER_HOSTING_MODES)[number];
export type ProviderTypeStatus = "active" | "deprecated";
export type ProviderPackageStatus = "available" | "quarantined" | "retired";
export type ProviderStatus = "draft" | "active" | "degraded" | "disabled" | "retired";
export type ResourceStatus = "available" | "unavailable" | "retired";
export type ConfigRevisionStatus = "draft" | "validated" | "published" | "superseded" | "rejected";
export type ConfigurationApplyMode =
  "hot_reload" | "reconnect_required" | "restart_required" | "immutable";
export type ConfigurationTargetType =
  | "environment"
  | "provider_type"
  | "provider"
  | "runtime_deployment"
  | "runtime_instance"
  | "collector";

export interface ProviderType {
  readonly providerTypeId: ProviderTypeId;
  readonly displayName: string;
  readonly status: ProviderTypeStatus;
}

export interface ProviderPackage {
  readonly packageId: ProviderPackageId;
  readonly packageVersion: string;
  readonly providerTypeId: ProviderTypeId;
  readonly hostingModes: readonly ProviderHostingMode[];
  readonly checksum: string;
  readonly status: ProviderPackageStatus;
}

export interface Provider {
  readonly providerId: ProviderId;
  readonly providerTypeId: ProviderTypeId;
  readonly packageId?: ProviderPackageId;
  readonly packageVersion?: string;
  readonly hostingMode: ProviderHostingMode;
  readonly adapterEndpoint?: string;
  readonly status: ProviderStatus;
}

export interface Resource {
  readonly environment: EnvironmentId;
  readonly resourceId: ResourceId;
  readonly resourceType: string;
  readonly metadata: JsonObject;
  readonly status: ResourceStatus;
}

export interface ConfigurationTarget {
  readonly environment: EnvironmentId;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export interface ConfigRevision {
  readonly revisionId: ConfigRevisionId;
  readonly target: ConfigurationTarget;
  readonly revision: number;
  readonly checksum: string;
  readonly applyMode: ConfigurationApplyMode;
  readonly status: ConfigRevisionStatus;
  readonly content: JsonObject;
  readonly createdAt: Date;
}

export interface AuditEvent {
  readonly auditEventId: AuditEventId;
  readonly action: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly occurredAt: Date;
  readonly metadata: JsonObject;
}

export function createProviderType(input: ProviderType): ProviderType {
  requireNonEmpty(input.displayName, "displayName");
  return Object.freeze({ ...input });
}

export function createProviderPackage(input: ProviderPackage): ProviderPackage {
  requireSemver(input.packageVersion);
  requireSha256(input.checksum);
  if (
    input.hostingModes.length === 0 ||
    new Set(input.hostingModes).size !== input.hostingModes.length
  )
    throw invalidValue("hostingModes");
  return Object.freeze({ ...input, hostingModes: Object.freeze([...input.hostingModes]) });
}

export function createProvider(
  input: Omit<Provider, "hostingMode" | "status"> &
    Partial<Pick<Provider, "hostingMode" | "status">>,
): Provider {
  const hostingMode = input.hostingMode ?? "vendor_managed";
  const status = input.status ?? "draft";
  if ((input.packageId === undefined) !== (input.packageVersion === undefined))
    throw invalidValue("providerPackage");
  if (input.packageVersion !== undefined) requireSemver(input.packageVersion);
  if (hostingMode === "vendor_managed" && input.adapterEndpoint?.trim().length === 0)
    throw invalidValue("adapterEndpoint");
  return Object.freeze({ ...input, hostingMode, status });
}

export function createResource(input: Resource): Resource {
  requireNonEmpty(input.resourceType, "resourceType");
  return Object.freeze({ ...input, metadata: Object.freeze({ ...input.metadata }) });
}

export function createConfigRevision(input: ConfigRevision): ConfigRevision {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw invalidValue("revision");
  requireSha256(input.checksum);
  requireValidDate(input.createdAt, "createdAt");
  for (const field of [input.target.targetId, input.target.configGroup, input.target.dataId]) {
    requireNonEmpty(field, "configurationTarget");
  }
  return Object.freeze({
    ...input,
    target: Object.freeze({ ...input.target }),
    content: Object.freeze({ ...input.content }),
    createdAt: new Date(input.createdAt),
  });
}

export function createAuditEvent(input: AuditEvent): AuditEvent {
  for (const [field, value] of [
    ["action", input.action],
    ["actorId", input.actorId],
    ["correlationId", input.correlationId],
    ["subjectType", input.subjectType],
    ["subjectId", input.subjectId],
  ] as const)
    requireNonEmpty(value, field);
  requireValidDate(input.occurredAt, "occurredAt");
  return Object.freeze({
    ...input,
    occurredAt: new Date(input.occurredAt),
    metadata: Object.freeze({ ...input.metadata }),
  });
}

function requireSemver(value: string): void {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value))
    throw invalidValue("packageVersion");
}

function requireSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw invalidValue("checksum");
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw invalidValue(field);
}

function requireValidDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) throw invalidValue(field);
}

function invalidValue(field: string): PmsDomainError {
  return new PmsDomainError("INVALID_DOMAIN_VALUE", `Invalid domain value: ${field}`, { field });
}
