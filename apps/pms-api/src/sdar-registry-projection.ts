import { createHash } from "node:crypto";
import type { RegistrySnapshot } from "../../../packages/registry-snapshot/src/index.js";

export const SDAR_REGISTRY_PROJECTION_CONTRACT = "sdar-registry-v1";
export const SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT = 2_592_000;

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,62}$/;
const CATALOG_REVISION = /^[1-9][0-9]*$/;

export type SdarRegistryProjectionErrorCode =
  | "SDAR_REGISTRY_PROJECTION_NOT_FOUND"
  | "SDAR_REGISTRY_PROJECTION_SOURCE_ID_INVALID"
  | "SDAR_REGISTRY_PROJECTION_TTL_INVALID"
  | "SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID"
  | "SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID";

export class SdarRegistryProjectionError extends Error {
  constructor(readonly code: SdarRegistryProjectionErrorCode) {
    super(code);
    this.name = "SdarRegistryProjectionError";
  }
}

export interface SdarRegistryProjectionProvider {
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly serverEndpoint: string;
  readonly catalogRevision: string;
  readonly labels: Readonly<{
    readonly environment: string;
    readonly protocolMode: "frozen_v1";
  }>;
}

export interface SdarRegistryProjection {
  readonly revision: number;
  readonly checksum: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly providers: readonly SdarRegistryProjectionProvider[];
}

export interface SdarRegistryProjectionChecksumInput {
  readonly smppSourceId: string;
  readonly revision: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly candidates: readonly SdarRegistryProjectionProvider[];
}

export function projectSdarRegistrySnapshot(
  native: RegistrySnapshot,
  smppSourceId: string,
  ttlSeconds = SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT,
): SdarRegistryProjection {
  const sourceId = validateSdarRegistryProjectionSourceId(smppSourceId);
  validateSdarRegistryProjectionTtlSeconds(ttlSeconds);
  validateNativeSnapshot(native);
  const generatedAt = native.publishedAt.toISOString();
  const expiresAtDate = new Date(native.publishedAt.getTime() + ttlSeconds * 1_000);
  if (Number.isNaN(expiresAtDate.getTime())) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_TTL_INVALID");
  }
  const expiresAt = expiresAtDate.toISOString();
  const providers = native.document.providers
    .map((provider): SdarRegistryProjectionProvider => {
      if (!Number.isSafeInteger(provider.catalogRevision) || provider.catalogRevision < 1) {
        throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
      }
      return Object.freeze({
        externalProviderId: requiredIdentity(provider.providerId),
        externalServerId: requiredIdentity(provider.serverId),
        serverEndpoint: safeHttpUrl(provider.effectiveEndpoint),
        catalogRevision: String(provider.catalogRevision),
        labels: Object.freeze({
          environment: native.environment,
          protocolMode: provider.protocolMode,
        }),
      });
    })
    .sort((left, right) =>
      compositeIdentity(sourceId, left).localeCompare(compositeIdentity(sourceId, right)),
    );
  const checksum = hashSdarRegistryProjection({
    smppSourceId: sourceId,
    revision: native.revision,
    generatedAt,
    expiresAt,
    candidates: providers,
  });
  return Object.freeze({
    revision: native.revision,
    checksum,
    generatedAt,
    expiresAt,
    providers: Object.freeze(providers),
  });
}

export function hashSdarRegistryProjection(input: SdarRegistryProjectionChecksumInput): string {
  assertExactKeys(input, ["smppSourceId", "revision", "generatedAt", "expiresAt", "candidates"]);
  const sourceId = validateSdarRegistryProjectionSourceId(input.smppSourceId);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
  assertTimestamp(input.generatedAt);
  assertTimestamp(input.expiresAt);
  if (Date.parse(input.expiresAt) <= Date.parse(input.generatedAt)) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_TTL_INVALID");
  }
  const candidates = input.candidates
    .map((candidate) => normalizeCandidate(candidate))
    .sort((left, right) =>
      compositeIdentity(sourceId, left).localeCompare(compositeIdentity(sourceId, right)),
    );
  const identities = candidates.map((candidate) => compositeIdentity(sourceId, candidate));
  if (new Set(identities).size !== identities.length) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
  const checksumCandidates: CanonicalJson[] = candidates.map((candidate) => ({
    externalProviderId: candidate.externalProviderId,
    externalServerId: candidate.externalServerId,
    serverEndpoint: candidate.serverEndpoint,
    catalogRevision: candidate.catalogRevision,
    labels: {
      environment: candidate.labels.environment,
      protocolMode: candidate.labels.protocolMode,
    },
  }));
  return createHash("sha256")
    .update(
      canonicalJson({
        smppSourceId: sourceId,
        revision: input.revision,
        generatedAt: input.generatedAt,
        expiresAt: input.expiresAt,
        candidates: checksumCandidates,
      }),
    )
    .digest("hex");
}

export function validateSdarRegistryProjectionSourceId(value: string): string {
  const normalized = value.trim();
  if (!SOURCE_ID.test(normalized)) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_SOURCE_ID_INVALID");
  }
  return normalized;
}

export function validateSdarRegistryProjectionTtlSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_TTL_INVALID");
  }
}

export function safeSdarRegistryProjectionUrl(value: string): string {
  return safeHttpUrl(value);
}

function normalizeCandidate(input: SdarRegistryProjectionProvider): SdarRegistryProjectionProvider {
  assertExactKeys(input, [
    "externalProviderId",
    "externalServerId",
    "serverEndpoint",
    "catalogRevision",
    "labels",
  ]);
  const labels = input.labels;
  assertExactKeys(labels, ["environment", "protocolMode"]);
  const environment: unknown = (labels as unknown as Record<string, unknown>).environment;
  const protocolMode: unknown = (labels as unknown as Record<string, unknown>).protocolMode;
  if (
    typeof environment !== "string" ||
    !ENVIRONMENT.test(environment) ||
    protocolMode !== "frozen_v1"
  ) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
  return Object.freeze({
    externalProviderId: requiredIdentity(input.externalProviderId),
    externalServerId: requiredIdentity(input.externalServerId),
    serverEndpoint: safeHttpUrl(input.serverEndpoint),
    catalogRevision: requiredCatalogRevision(input.catalogRevision),
    labels: Object.freeze({
      environment,
      protocolMode,
    }),
  });
}

function validateNativeSnapshot(native: RegistrySnapshot): void {
  if (
    !Number.isSafeInteger(native.revision) ||
    native.revision < 1 ||
    native.document.environment !== native.environment ||
    Number.isNaN(native.publishedAt.getTime())
  ) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
}

function requiredIdentity(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 256) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
  return normalized;
}

function requiredCatalogRevision(value: string): string {
  if (!CATALOG_REVISION.test(value)) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
  return value;
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const canonicalExpected = [...expected].sort((left, right) => left.localeCompare(right));
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
}

function compositeIdentity(
  sourceId: string,
  candidate: Pick<SdarRegistryProjectionProvider, "externalProviderId" | "externalServerId">,
): string {
  return `${sourceId}::${candidate.externalProviderId}::${candidate.externalServerId}`;
}

function safeHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function assertTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new SdarRegistryProjectionError("SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID");
  }
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
