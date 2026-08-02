import type {
  AuditEventDto,
  ConfigurationDraftDto,
  ProviderDto,
  ProviderPackageDto,
  RegistrySnapshotDto,
  ResourceDto,
  RuntimeDeploymentDto,
  RuntimeProcessDto,
} from "../api/types.js";
import type {
  AuditEventViewModel,
  ConfigurationDraftViewModel,
  ProviderPackageViewModel,
  ProviderSummaryViewModel,
  RegistrySnapshotViewModel,
  ResourceSummaryViewModel,
  RuntimeDeploymentViewModel,
  RuntimeProcessViewModel,
} from "../view-models/index.js";

export function mapProvider(source: ProviderDto): ProviderSummaryViewModel {
  return {
    providerId: source.providerId,
    providerTypeId: source.providerTypeId,
    packageLabel: source.packageId === undefined ? "未绑定" : `${source.packageId}@${source.packageVersion ?? "latest"}`,
    hostingMode: source.hostingMode,
    adapterEndpoint: source.adapterEndpoint ?? "未配置",
    status: source.status,
    updatedAt: source.updatedAt ?? "未记录",
  };
}

export function mapProviderPackage(source: ProviderPackageDto): ProviderPackageViewModel {
  return {
    packageId: source.packageId,
    version: source.packageVersion,
    providerType: source.providerType,
    hostingModes: source.hostingModes,
    runtimeVersion: source.compatibleRuntimeVersion,
    componentStatus: source.qualification.componentStatus,
    realResourceStatus: source.qualification.realResourceStatus,
  };
}

export function mapResource(source: ResourceDto): ResourceSummaryViewModel {
  return {
    environment: source.environment,
    resourceId: source.resourceId,
    resourceType: source.resourceType,
    displayName: typeof source.metadata.displayName === "string" ? source.metadata.displayName : source.resourceId,
    status: source.status,
    updatedAt: source.updatedAt ?? "未记录",
    metadata: source.metadata,
  };
}

export function mapRuntimeDeployment(source: RuntimeDeploymentDto): RuntimeDeploymentViewModel {
  return {
    deploymentId: source.deploymentId,
    providerId: source.providerId,
    environment: source.environment,
    desiredState: source.desiredState,
    desiredReplicas: source.desiredReplicas as 0 | 1,
    runtimeVersion: source.runtimeVersion ?? "unknown",
    databaseProfileId: source.databaseProfileId,
    configProfileId: source.configProfileId,
    status: source.status,
    desiredRevision: source.desiredRevision,
    observedRevision: source.observedRevision ?? 0,
    converged: source.desiredRevision === source.observedRevision,
  };
}

export function mapRuntimeProcess(source: RuntimeProcessDto, providerId: string): RuntimeProcessViewModel {
  return {
    providerId,
    instanceId: source.instanceId,
    deploymentId: source.deploymentId,
    processState: source.processState,
    readinessState: source.readinessState ?? "unknown",
    registrationState: source.registrationState ?? "unregistered",
    catalogState: source.catalogState ?? "unknown",
    runtimeVersion: source.runtimeVersion ?? "unknown",
    configRevision: source.configRevision ?? 0,
    observedRevision: source.observedRevision ?? 0,
    restartCount: source.restartCount ?? 0,
    lastHeartbeatAt: source.lastHeartbeatAt ?? "未注册",
    observedHealth: source.observedHealth,
    readyForActive: source.readyForActive,
  };
}

export function mapConfigurationDraft(source: ConfigurationDraftDto): ConfigurationDraftViewModel {
  return {
    draftId: source.draftId,
    definitionId: source.definitionId,
    targetLabel: `${source.key.environment}/${source.key.targetType}/${source.key.targetId}`,
    status: source.status,
    version: source.version,
    ...(source.applyMode === undefined ? {} : { applyMode: source.applyMode }),
    content: source.content,
    issues: source.validationIssues,
    updatedAt: source.updatedAt,
  };
}

export function mapRegistrySnapshot(source: RegistrySnapshotDto): RegistrySnapshotViewModel {
  return {
    environment: source.environment,
    revision: source.revision,
    checksum: source.checksum,
    providerCount: source.document.providers.length,
    toolCount: source.document.providers.reduce((count, provider) => count + provider.tools.length, 0),
    publishedAt: source.publishedAt,
    providers: source.document.providers.map(provider => ({ ...provider, tools: provider.tools as readonly Readonly<Record<string, unknown>>[] })),
  };
}

export function mapAuditEvent(source: AuditEventDto): AuditEventViewModel {
  return { ...source };
}
