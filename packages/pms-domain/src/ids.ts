import { PmsDomainError } from "./errors.js";

declare const brand: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brand]: Name };

export type ProviderTypeId = Branded<string, "ProviderTypeId">;
export type ProviderId = Branded<string, "ProviderId">;
export type ResourceId = Branded<string, "ResourceId">;
export type ProviderPackageId = Branded<string, "ProviderPackageId">;
export type ConfigRevisionId = Branded<string, "ConfigRevisionId">;
export type AuditEventId = Branded<string, "AuditEventId">;
export type EnvironmentId = Branded<string, "EnvironmentId">;

const LogicalIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ProviderTypePattern = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/;
const PackageIdPattern = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EnvironmentPattern = /^[a-z][a-z0-9-]{0,62}$/;

export function providerTypeId(value: string): ProviderTypeId {
  return parseId(value, "ProviderTypeId", ProviderTypePattern) as ProviderTypeId;
}

export function providerId(value: string): ProviderId {
  return parseId(value, "ProviderId", LogicalIdPattern) as ProviderId;
}

export function resourceId(value: string): ResourceId {
  return parseId(value, "ResourceId", LogicalIdPattern) as ResourceId;
}

export function providerPackageId(value: string): ProviderPackageId {
  return parseId(value, "ProviderPackageId", PackageIdPattern) as ProviderPackageId;
}

export function configRevisionId(value: string): ConfigRevisionId {
  return parseId(value, "ConfigRevisionId", UuidPattern) as ConfigRevisionId;
}

export function auditEventId(value: string): AuditEventId {
  return parseId(value, "AuditEventId", UuidPattern) as AuditEventId;
}

export function environmentId(value: string): EnvironmentId {
  return parseId(value, "EnvironmentId", EnvironmentPattern) as EnvironmentId;
}

function parseId(value: string, kind: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new PmsDomainError("INVALID_IDENTIFIER", `Invalid ${kind}`, { kind });
  }
  return value;
}
