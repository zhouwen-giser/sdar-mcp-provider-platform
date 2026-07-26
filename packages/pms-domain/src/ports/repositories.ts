import type {
  ConfigRevision,
  ConfigRevisionStatus,
  ConfigurationApplyMode,
  ConfigurationTarget,
  JsonObject,
  Provider,
  ProviderHostingMode,
  ProviderPackage,
  ProviderStatus,
  ProviderType,
  ProviderTypeStatus,
  Resource,
  ResourceStatus,
} from "../entities.js";
import type {
  ConfigRevisionId,
  EnvironmentId,
  ProviderId,
  ProviderPackageId,
  ProviderTypeId,
  ResourceId,
} from "../ids.js";
import type { ProviderResourceBinding } from "../bindings.js";
import type {
  LastModifiedPrecondition,
  Page,
  PageRequest,
  RevisionPrecondition,
  SavePrecondition,
} from "./common.js";

export interface ProviderTypeQuery extends PageRequest {
  readonly status?: ProviderTypeStatus;
}

export interface ProviderTypeRepository {
  get(providerTypeId: ProviderTypeId): Promise<ProviderType | null>;
  list(query: ProviderTypeQuery): Promise<Page<ProviderType>>;
  save(providerType: ProviderType, precondition: SavePrecondition): Promise<void>;
}

export interface ProviderPackageKey {
  readonly packageId: ProviderPackageId;
  readonly packageVersion: string;
}

export interface ProviderPackageQuery extends PageRequest {
  readonly providerTypeId?: ProviderTypeId;
  readonly status?: ProviderPackage["status"];
}

export interface ProviderPackageRepository {
  get(key: ProviderPackageKey): Promise<ProviderPackage | null>;
  list(query: ProviderPackageQuery): Promise<Page<ProviderPackage>>;
  save(providerPackage: ProviderPackage, precondition: SavePrecondition): Promise<void>;
}

export interface ProviderQuery extends PageRequest {
  readonly providerTypeId?: ProviderTypeId;
  readonly hostingMode?: ProviderHostingMode;
  readonly status?: ProviderStatus;
}

export interface ProviderRepository {
  get(providerId: ProviderId): Promise<Provider | null>;
  list(query: ProviderQuery): Promise<Page<Provider>>;
  insert(provider: Provider): Promise<void>;
  update(provider: Provider, precondition: LastModifiedPrecondition): Promise<void>;
}

export interface ResourceKey {
  readonly environment: EnvironmentId;
  readonly resourceId: ResourceId;
}

export interface ResourceQuery extends PageRequest {
  readonly environment: EnvironmentId;
  readonly resourceType?: string;
  readonly status?: ResourceStatus;
}

export interface ResourceRepository {
  get(key: ResourceKey): Promise<Resource | null>;
  list(query: ResourceQuery): Promise<Page<Resource>>;
  insert(resource: Resource): Promise<void>;
  update(resource: Resource, precondition: LastModifiedPrecondition): Promise<void>;
}

export interface ProviderResourceBindingRepository {
  bind(binding: ProviderResourceBinding): Promise<void>;
  unbind(providerId: ProviderId, key: ResourceKey): Promise<void>;
  listByProvider(providerId: ProviderId): Promise<readonly ProviderResourceBinding[]>;
  listByResource(key: ResourceKey): Promise<readonly ProviderResourceBinding[]>;
}

export interface ConfigurationDefinition {
  readonly definitionId: string;
  readonly target: ConfigurationTarget;
  readonly schema: JsonObject;
  readonly defaultContent: JsonObject;
  readonly secretPaths: readonly string[];
  readonly fieldMetadata: JsonObject;
  readonly status: "active" | "deprecated";
}

export interface ConfigAck {
  readonly ackId: string;
  readonly revisionId: ConfigRevisionId;
  readonly runtimeInstanceId: string;
  readonly status: "applied" | "rejected" | "restart_required" | "stale" | "unavailable";
  readonly appliedChecksum?: string;
  readonly reasonCode?: string;
  readonly details: JsonObject;
  readonly acknowledgedAt: Date;
}

export interface NewConfigRevision {
  readonly revisionId: ConfigRevisionId;
  readonly target: ConfigurationTarget;
  readonly checksum: string;
  readonly applyMode: ConfigurationApplyMode;
  readonly content: JsonObject;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface ConfigurationRepository {
  getDefinition(target: ConfigurationTarget): Promise<ConfigurationDefinition | null>;
  saveDefinition(
    definition: ConfigurationDefinition,
    precondition: SavePrecondition,
  ): Promise<void>;
  getRevision(revisionId: ConfigRevisionId): Promise<ConfigRevision | null>;
  getPublishedRevision(target: ConfigurationTarget): Promise<ConfigRevision | null>;
  listRevisions(target: ConfigurationTarget, page: PageRequest): Promise<Page<ConfigRevision>>;
  createRevision(
    revision: NewConfigRevision,
    precondition: RevisionPrecondition,
  ): Promise<ConfigRevision>;
  transitionRevision(
    revisionId: ConfigRevisionId,
    targetStatus: ConfigRevisionStatus,
    expectedStatus: ConfigRevisionStatus,
  ): Promise<ConfigRevision>;
  appendAck(ack: ConfigAck): Promise<void>;
  listAcks(revisionId: ConfigRevisionId, page: PageRequest): Promise<Page<ConfigAck>>;
}
