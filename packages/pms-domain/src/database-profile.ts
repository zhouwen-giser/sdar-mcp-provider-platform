import { PmsDomainError } from "./errors.js";
import type { EnvironmentId, ProviderId } from "./ids.js";

declare const databaseProfileBrand: unique symbol;
export type DatabaseProfileId = string & {
  readonly [databaseProfileBrand]: "DatabaseProfileId";
};
export type DatabaseClusterRef = string & {
  readonly [databaseProfileBrand]: "DatabaseClusterRef";
};
export type SecretRefId = string & {
  readonly [databaseProfileBrand]: "SecretRefId";
};

export interface SecretRef {
  readonly secretRef: SecretRefId;
}

export const DATABASE_MODES = ["provisioned", "preexisting"] as const;
export type DatabaseMode = (typeof DATABASE_MODES)[number];

export const POSTGRES_SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;
export type PostgresSslMode = (typeof POSTGRES_SSL_MODES)[number];

export interface DatabaseProfile {
  readonly profileId: DatabaseProfileId;
  readonly providerId: ProviderId;
  readonly environment: EnvironmentId;
  readonly clusterRef: DatabaseClusterRef;
  readonly host: string;
  readonly port: number;
  readonly databaseMode: DatabaseMode;
  readonly databaseName: string;
  readonly runtimeRoleName: string;
  readonly sslMode: PostgresSslMode;
  readonly adminSecretRef: SecretRef;
  readonly runtimeSecretRef: SecretRef;
}

export interface CreateDatabaseProfileInput {
  readonly profileId: string;
  readonly providerId: ProviderId;
  readonly environment: EnvironmentId;
  readonly clusterRef: string;
  readonly host: string;
  readonly port?: number;
  readonly databaseMode?: DatabaseMode;
  readonly sslMode?: PostgresSslMode;
  readonly adminSecretRef: SecretRef;
  readonly runtimeSecretRef: SecretRef;
}

const LOGICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export function databaseProfileId(value: string): DatabaseProfileId {
  return parse(value, "profileId", LOGICAL_ID) as DatabaseProfileId;
}

export function databaseClusterRef(value: string): DatabaseClusterRef {
  return parse(value, "clusterRef", LOGICAL_ID) as DatabaseClusterRef;
}

export function secretRef(value: string): SecretRef {
  return Object.freeze({
    secretRef: parse(value, "secretRef", SECRET_REF) as SecretRefId,
  });
}

export function providerDatabaseNames(providerId: ProviderId): {
  readonly databaseName: string;
  readonly runtimeRoleName: string;
} {
  const source = String(providerId);
  const slug =
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "provider";
  const suffix = stableDigest(source);
  return Object.freeze({
    databaseName: `sdar_rt_${slug}_${suffix}`,
    runtimeRoleName: `sdar_rt_${slug}_${suffix}_app`,
  });
}

export function createDatabaseProfile(input: CreateDatabaseProfileInput): DatabaseProfile {
  const profileId = databaseProfileId(input.profileId);
  const clusterRef = databaseClusterRef(input.clusterRef);
  const host = normalizeHost(input.host);
  const port = input.port ?? 5432;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) invalid("port");
  const databaseMode = input.databaseMode ?? "provisioned";
  if (!DATABASE_MODES.includes(databaseMode)) invalid("databaseMode");
  const sslMode = input.sslMode ?? "verify-full";
  if (!POSTGRES_SSL_MODES.includes(sslMode)) invalid("sslMode");
  if (
    typeof input.adminSecretRef?.secretRef !== "string" ||
    typeof input.runtimeSecretRef?.secretRef !== "string"
  ) {
    invalid("secretRef");
  }
  if (input.adminSecretRef.secretRef === input.runtimeSecretRef.secretRef) {
    invalid("secretSeparation");
  }
  const names = providerDatabaseNames(input.providerId);
  return Object.freeze({
    profileId,
    providerId: input.providerId,
    environment: input.environment,
    clusterRef,
    host,
    port,
    databaseMode,
    ...names,
    sslMode,
    adminSecretRef: secretRef(String(input.adminSecretRef.secretRef)),
    runtimeSecretRef: secretRef(String(input.runtimeSecretRef.secretRef)),
  });
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!HOST.test(host) || host.includes("..")) invalid("host");
  return host;
}

function parse(value: string, field: string, pattern: RegExp): string {
  if (!pattern.test(value)) invalid(field);
  return value;
}

function stableDigest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

function invalid(field: string): never {
  throw new PmsDomainError("INVALID_DOMAIN_VALUE", `Invalid database profile: ${field}`, {
    field,
  });
}
