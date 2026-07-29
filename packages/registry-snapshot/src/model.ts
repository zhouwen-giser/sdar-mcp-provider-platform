import type { CatalogSnapshot, CatalogTool } from "../../catalog-manager/src/index.js";

const ENVIRONMENT = /^[a-z][a-z0-9-]{0,62}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface RegistryProviderInput {
  readonly providerId: string;
  readonly serverId: string;
  readonly protocolMode: "frozen_v1";
  readonly effectiveEndpoint: string;
  readonly catalog: CatalogSnapshot;
}

export interface RegistryProviderProjection {
  readonly providerId: string;
  readonly serverId: string;
  readonly protocolMode: "frozen_v1";
  readonly effectiveEndpoint: string;
  readonly catalogRevision: number;
  readonly tools: readonly CatalogTool[];
}

export interface RegistrySnapshotDocument {
  readonly environment: string;
  readonly providers: readonly RegistryProviderProjection[];
}

export interface RegistrySnapshotCandidate {
  readonly document: RegistrySnapshotDocument;
  readonly checksum: string;
  readonly canonicalJson: string;
}

export interface RegistrySnapshot {
  readonly environment: string;
  readonly revision: number;
  readonly checksum: string;
  readonly document: RegistrySnapshotDocument;
  readonly publishedAt: Date;
  readonly createdAt: Date;
}

export interface PublishRegistrySnapshot {
  readonly candidate: RegistrySnapshotCandidate;
  readonly actorId: string;
  readonly correlationId: string;
  readonly publishedAt: Date;
}

export interface RegistrySnapshotPublication {
  readonly created: boolean;
  readonly snapshot: RegistrySnapshot;
}

export interface RegistryProviderChange {
  readonly providerId: string;
  readonly before?: RegistryProviderProjection;
  readonly after?: RegistryProviderProjection;
}

export interface RegistrySnapshotDiff {
  readonly environment: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly added: readonly RegistryProviderProjection[];
  readonly removed: readonly RegistryProviderProjection[];
  readonly changed: readonly RegistryProviderChange[];
}

export interface RegistrySnapshotRepository {
  publish(input: PublishRegistrySnapshot): Promise<RegistrySnapshotPublication>;
  latest(environment: string): Promise<RegistrySnapshot | null>;
  get(environment: string, revision: number): Promise<RegistrySnapshot | null>;
  history(environment: string, limit?: number): Promise<readonly RegistrySnapshot[]>;
  diff(
    environment: string,
    fromRevision: number,
    toRevision: number,
  ): Promise<RegistrySnapshotDiff>;
}

export function validateRegistryEnvironment(environment: string): void {
  if (!ENVIRONMENT.test(environment)) throw new Error("REGISTRY_ENVIRONMENT_INVALID");
}

export function validateRegistryProviderIdentity(input: RegistryProviderInput): void {
  if (!IDENTIFIER.test(input.providerId) || !IDENTIFIER.test(input.serverId)) {
    throw new Error("REGISTRY_PROVIDER_IDENTITY_INVALID");
  }
  if (input.catalog.providerId !== input.providerId) {
    throw new Error("REGISTRY_CATALOG_PROVIDER_MISMATCH");
  }
}
