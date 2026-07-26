import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  createProvider,
  createProviderType,
  createResource,
  environmentId,
  PmsDomainError,
  PmsRepositoryError,
  providerId,
  providerPackageId,
  providerTypeId,
  resourceId,
  transitionProvider,
  type AuditRepository,
  type Page,
  type PageRequest,
  type PmsUnitOfWork,
  type Provider,
  type ProviderHostingMode,
  type ProviderResourceBinding,
  type ProviderStatus,
  type ProviderType,
  type ProviderTypeStatus,
  type Resource,
  type ResourceStatus,
} from "../../pms-domain/src/index.js";
import { requireAuditContext, type AuditContext } from "./audit-service.js";

export interface CreateProviderTypeInput {
  readonly providerTypeId: string;
  readonly displayName: string;
}

export interface CreateProviderInput {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode?: ProviderHostingMode;
  readonly adapterEndpoint?: string;
}

export interface CreateResourceInput {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly metadata: Resource["metadata"];
}

export interface ResourceIdentityInput {
  readonly environment: string;
  readonly resourceId: string;
}

export interface BindResourceInput extends ResourceIdentityInput {
  readonly providerId: string;
}

export class ProviderManagementService {
  constructor(private readonly unitOfWork: PmsUnitOfWork) {}

  async createProviderType(
    input: CreateProviderTypeInput,
    audit: AuditContext,
  ): Promise<ProviderType> {
    requireAuditContext(audit);
    const value = createProviderType({
      providerTypeId: providerTypeId(input.providerTypeId),
      displayName: input.displayName,
      status: "active",
    });
    return this.unitOfWork.transaction(async (repositories) => {
      await repositories.providerTypes.save(value, { mode: "insert" });
      const persisted = required(
        await repositories.providerTypes.get(value.providerTypeId),
        "ProviderType",
      );
      await appendAudit(
        repositories.audit,
        audit,
        "provider_type.created",
        "provider_type",
        value.providerTypeId,
      );
      return persisted;
    });
  }

  async listProviderTypes(
    page: PageRequest,
    status?: ProviderTypeStatus,
  ): Promise<Page<ProviderType>> {
    return this.unitOfWork.transaction((repositories) =>
      repositories.providerTypes.list({ ...page, ...(status === undefined ? {} : { status }) }),
    );
  }

  async getProviderType(id: string): Promise<ProviderType> {
    return this.unitOfWork.transaction(async (repositories) =>
      required(await repositories.providerTypes.get(providerTypeId(id)), "ProviderType"),
    );
  }

  async updateProviderTypeStatus(
    id: string,
    status: ProviderTypeStatus,
    expectedUpdatedAt: Date,
    audit: AuditContext,
  ): Promise<ProviderType> {
    requireAuditContext(audit);
    return this.unitOfWork.transaction(async (repositories) => {
      const existing = required(
        await repositories.providerTypes.get(providerTypeId(id)),
        "ProviderType",
      );
      if (existing.status !== "active" || status !== "deprecated") invalidTransition();
      const updated = createProviderType({ ...existing, status });
      await repositories.providerTypes.save(updated, { mode: "update", expectedUpdatedAt });
      const persisted = required(
        await repositories.providerTypes.get(updated.providerTypeId),
        "ProviderType",
      );
      await appendAudit(
        repositories.audit,
        audit,
        "provider_type.status_updated",
        "provider_type",
        updated.providerTypeId,
        { status },
      );
      return persisted;
    });
  }

  async createProvider(input: CreateProviderInput, audit: AuditContext): Promise<Provider> {
    requireAuditContext(audit);
    const value = createProvider({
      providerId: providerId(input.providerId),
      providerTypeId: providerTypeId(input.providerTypeId),
      ...(input.packageId === undefined ? {} : { packageId: providerPackageId(input.packageId) }),
      ...(input.packageVersion === undefined ? {} : { packageVersion: input.packageVersion }),
      ...(input.hostingMode === undefined ? {} : { hostingMode: input.hostingMode }),
      ...(input.adapterEndpoint === undefined ? {} : { adapterEndpoint: input.adapterEndpoint }),
    });
    return this.unitOfWork.transaction(async (repositories) => {
      required(await repositories.providerTypes.get(value.providerTypeId), "ProviderType");
      if (value.packageId !== undefined && value.packageVersion !== undefined) {
        required(
          await repositories.providerPackages.get({
            packageId: value.packageId,
            packageVersion: value.packageVersion,
          }),
          "ProviderPackage",
        );
      }
      await repositories.providers.insert(value);
      const persisted = required(await repositories.providers.get(value.providerId), "Provider");
      await appendAudit(
        repositories.audit,
        audit,
        "provider.created",
        "provider",
        value.providerId,
        { hostingMode: value.hostingMode },
      );
      return persisted;
    });
  }

  async listProviders(page: PageRequest, status?: ProviderStatus): Promise<Page<Provider>> {
    return this.unitOfWork.transaction((repositories) =>
      repositories.providers.list({ ...page, ...(status === undefined ? {} : { status }) }),
    );
  }

  async getProvider(id: string): Promise<Provider> {
    return this.unitOfWork.transaction(async (repositories) =>
      required(await repositories.providers.get(providerId(id)), "Provider"),
    );
  }

  async updateProviderStatus(
    id: string,
    status: ProviderStatus,
    expectedUpdatedAt: Date,
    audit: AuditContext,
  ): Promise<Provider> {
    requireAuditContext(audit);
    return this.unitOfWork.transaction(async (repositories) => {
      const existing = required(await repositories.providers.get(providerId(id)), "Provider");
      const updated = transitionProvider(existing, status);
      await repositories.providers.update(updated, { expectedUpdatedAt });
      const persisted = required(await repositories.providers.get(updated.providerId), "Provider");
      await appendAudit(
        repositories.audit,
        audit,
        "provider.status_updated",
        "provider",
        updated.providerId,
        { status },
      );
      return persisted;
    });
  }

  async createResource(input: CreateResourceInput, audit: AuditContext): Promise<Resource> {
    requireAuditContext(audit);
    const value = createResource({
      environment: environmentId(input.environment),
      resourceId: resourceId(input.resourceId),
      resourceType: input.resourceType,
      metadata: input.metadata,
      status: "available",
    });
    return this.unitOfWork.transaction(async (repositories) => {
      await repositories.resources.insert(value);
      const persisted = required(
        await repositories.resources.get({
          environment: value.environment,
          resourceId: value.resourceId,
        }),
        "Resource",
      );
      await appendAudit(
        repositories.audit,
        audit,
        "resource.created",
        "resource",
        `${value.environment}:${value.resourceId}`,
      );
      return persisted;
    });
  }

  async listResources(
    environment: string,
    page: PageRequest,
    status?: ResourceStatus,
  ): Promise<Page<Resource>> {
    return this.unitOfWork.transaction((repositories) =>
      repositories.resources.list({
        ...page,
        environment: environmentId(environment),
        ...(status === undefined ? {} : { status }),
      }),
    );
  }

  async getResource(input: ResourceIdentityInput): Promise<Resource> {
    const key = resourceKey(input);
    return this.unitOfWork.transaction(async (repositories) =>
      required(await repositories.resources.get(key), "Resource"),
    );
  }

  async updateResourceStatus(
    input: ResourceIdentityInput,
    status: ResourceStatus,
    expectedUpdatedAt: Date,
    audit: AuditContext,
  ): Promise<Resource> {
    requireAuditContext(audit);
    const key = resourceKey(input);
    return this.unitOfWork.transaction(async (repositories) => {
      const existing = required(await repositories.resources.get(key), "Resource");
      assertResourceTransition(existing.status, status);
      const updated = createResource({ ...existing, status });
      await repositories.resources.update(updated, { expectedUpdatedAt });
      const persisted = required(await repositories.resources.get(key), "Resource");
      await appendAudit(
        repositories.audit,
        audit,
        "resource.status_updated",
        "resource",
        `${updated.environment}:${updated.resourceId}`,
        { status },
      );
      return persisted;
    });
  }

  async bindResource(
    input: BindResourceInput,
    audit: AuditContext,
  ): Promise<ProviderResourceBinding> {
    requireAuditContext(audit);
    const provider = providerId(input.providerId);
    const key = resourceKey(input);
    return this.unitOfWork.transaction(async (repositories) => {
      required(await repositories.providers.get(provider), "Provider");
      required(await repositories.resources.get(key), "Resource");
      const binding = Object.freeze({
        providerId: provider,
        environment: key.environment,
        resourceId: key.resourceId,
        boundAt: new Date(),
      });
      await repositories.providerResourceBindings.bind(binding);
      await appendAudit(
        repositories.audit,
        audit,
        "provider.resource_bound",
        "provider",
        provider,
        { environment: key.environment, resourceId: key.resourceId },
      );
      return binding;
    });
  }

  async unbindResource(input: BindResourceInput, audit: AuditContext): Promise<void> {
    requireAuditContext(audit);
    const provider = providerId(input.providerId);
    const key = resourceKey(input);
    await this.unitOfWork.transaction(async (repositories) => {
      await repositories.providerResourceBindings.unbind(provider, key);
      await appendAudit(
        repositories.audit,
        audit,
        "provider.resource_unbound",
        "provider",
        provider,
        { environment: key.environment, resourceId: key.resourceId },
      );
    });
  }

  async listProviderResources(id: string): Promise<readonly ProviderResourceBinding[]> {
    const provider = providerId(id);
    return this.unitOfWork.transaction((repositories) =>
      repositories.providerResourceBindings.listByProvider(provider),
    );
  }
}

function resourceKey(input: ResourceIdentityInput) {
  return {
    environment: environmentId(input.environment),
    resourceId: resourceId(input.resourceId),
  };
}

function required<T>(value: T | null, aggregate: string): T {
  if (value === null) {
    throw new PmsRepositoryError("ENTITY_NOT_FOUND", `${aggregate} does not exist`, { aggregate });
  }
  return value;
}

function invalidTransition(): never {
  throw new PmsDomainError("INVALID_STATE_TRANSITION", "Invalid state transition");
}

function assertResourceTransition(current: ResourceStatus, target: ResourceStatus): void {
  const allowed: Readonly<Record<ResourceStatus, readonly ResourceStatus[]>> = {
    available: ["unavailable", "retired"],
    unavailable: ["available", "retired"],
    retired: [],
  };
  if (!allowed[current].includes(target)) invalidTransition();
}

async function appendAudit(
  repository: AuditRepository,
  context: AuditContext,
  action: string,
  subjectType: string,
  subjectId: string,
  metadata: Resource["metadata"] = {},
): Promise<void> {
  await repository.append(
    createAuditEvent({
      auditEventId: auditEventId(randomUUID()),
      action,
      actorId: context.actorId,
      correlationId: context.correlationId,
      subjectType,
      subjectId,
      occurredAt: new Date(),
      metadata,
    }),
  );
}
