import type {
  PublicProviderPackage,
  RuntimeProcessView,
} from "../../../../packages/pms-application/src/index.js";
import type {
  ConfigurationDraft,
  ConfigurationPublicationResult,
  EffectiveConfigurationPreview,
} from "../../../../packages/configuration-center/src/index.js";
import type {
  AuditEvent,
  Page,
  Provider,
  ProviderResourceBinding,
  ProviderType,
  Resource,
} from "../../../../packages/pms-domain/src/index.js";
import type {
  RegistrySnapshot,
  RegistrySnapshotDiff,
} from "../../../../packages/registry-snapshot/src/index.js";
import type { RuntimeDeploymentView } from "../runtime-deployment-routes.js";

export function mapProviderPackage(value: PublicProviderPackage): unknown {
  return serializable(value);
}

export function mapProviderType(value: ProviderType): unknown {
  return {
    providerTypeId: value.providerTypeId,
    displayName: value.displayName,
    status: value.status,
    ...optionalDate("updatedAt", value.updatedAt),
  };
}

export function mapProvider(value: Provider): unknown {
  return {
    providerId: value.providerId,
    providerTypeId: value.providerTypeId,
    ...optional("packageId", value.packageId),
    ...optional("packageVersion", value.packageVersion),
    hostingMode: value.hostingMode,
    ...optional("adapterEndpoint", value.adapterEndpoint),
    status: value.status,
    ...optionalDate("updatedAt", value.updatedAt),
  };
}

export function mapResource(value: Resource): unknown {
  return {
    environment: value.environment,
    resourceId: value.resourceId,
    resourceType: value.resourceType,
    metadata: serializable(value.metadata),
    status: value.status,
    ...optionalDate("updatedAt", value.updatedAt),
  };
}

export function mapProviderResourceBinding(value: ProviderResourceBinding): unknown {
  return {
    providerId: value.providerId,
    environment: value.environment,
    resourceId: value.resourceId,
    boundAt: value.boundAt.toISOString(),
  };
}

export function mapConfigurationDraft(value: ConfigurationDraft): unknown {
  return {
    draftId: value.draftId,
    definitionId: value.definitionId,
    definitionVersion: value.definitionVersion,
    key: serializable(value.key),
    ancestorTargetIds: serializable(value.ancestorTargetIds),
    content: serializable(value.content),
    version: value.version,
    status: value.status,
    ...optional("applyMode", value.applyMode),
    validationIssues: serializable(value.validationIssues),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

export function mapEffectiveConfiguration(value: EffectiveConfigurationPreview): unknown {
  return {
    draftId: value.draftId,
    definitionId: value.definitionId,
    definitionVersion: value.definitionVersion,
    content: serializable(value.content),
    sources: serializable(value.sources),
    applyMode: value.applyMode,
    valid: value.valid,
    issues: serializable(value.issues),
  };
}

export function mapConfigurationPublication(value: ConfigurationPublicationResult): unknown {
  return {
    outcome: value.outcome,
    revision: {
      revisionId: value.revision.revisionId,
      target: serializable(value.revision.target),
      revision: value.revision.revision,
      checksum: value.revision.checksum,
      applyMode: value.revision.applyMode,
      status: value.revision.status,
      content: serializable(value.revision.content),
      createdAt: value.revision.createdAt.toISOString(),
    },
  };
}

export function mapRuntimeDeployment(value: RuntimeDeploymentView): unknown {
  return {
    deploymentId: value.deploymentId,
    providerId: value.providerId,
    environment: value.environment,
    desiredState: value.desiredState,
    desiredReplicas: value.desiredReplicas,
    runtimeVersion: value.runtimeVersion,
    databaseProfileId: value.databaseProfileId,
    configProfileId: value.configProfileId,
    ...optional("adapterEndpoint", value.adapterEndpoint),
    status: value.status,
    desiredRevision: value.desiredRevision,
    observedRevision: value.observedRevision,
  };
}

export function mapRuntimeDeploymentIntent(
  value: RuntimeDeploymentView,
  operationId: string,
): unknown {
  return { operationId, deployment: mapRuntimeDeployment(value) };
}

export function mapRuntimeProcess(value: RuntimeProcessView): unknown {
  return {
    instanceId: value.instanceId,
    deploymentId: value.deploymentId,
    processState: value.processState,
    ...optional("livenessState", value.livenessState),
    ...optional("readinessState", value.readinessState),
    ...optional("registrationState", value.registrationState),
    ...optional("catalogState", value.catalogState),
    ...optional("runtimeVersion", value.runtimeVersion),
    ...optional("configRevision", value.configRevision),
    ...optional("observedRevision", value.observedRevision),
    ...optional("restartCount", value.restartCount),
    lastHeartbeatAt: value.lastHeartbeatAt,
    observedHealth: value.observedHealth,
    readyForActive: value.readyForActive,
    ...optional("healthReasonCode", value.healthReasonCode),
    stale: value.stale,
    registrationFreshness: value.registrationFreshness,
    logReference: serializable(value.logReference),
  };
}

export function mapRegistrySnapshot(value: RegistrySnapshot): unknown {
  return {
    environment: value.environment,
    revision: value.revision,
    checksum: value.checksum,
    document: serializable(value.document),
    publishedAt: value.publishedAt.toISOString(),
    createdAt: value.createdAt.toISOString(),
  };
}

export function mapRegistryDiff(value: RegistrySnapshotDiff): unknown {
  return serializable(value);
}

export function mapAuditEvent(value: AuditEvent): unknown {
  return {
    auditEventId: value.auditEventId,
    action: value.action,
    actorId: value.actorId,
    correlationId: value.correlationId,
    subjectType: value.subjectType,
    subjectId: value.subjectId,
    occurredAt: value.occurredAt.toISOString(),
  };
}

export function mapPage<T>(value: Page<T>, mapper: (item: T) => unknown): unknown {
  return {
    items: value.items.map(mapper),
    ...optional("nextCursor", value.nextCursor),
  };
}

export function mapArrayPage<T>(
  items: readonly T[],
  mapper: (item: T) => unknown,
  nextCursor?: string,
): unknown {
  return { items: items.map(mapper), ...optional("nextCursor", nextCursor) };
}

function serializable(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializable);
  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Error
  ) {
    throw new TypeError("PMS_CONSOLE_RESPONSE_VALUE_UNSUPPORTED");
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = serializable(item);
    }
    return output;
  }
  return null;
}

function optional(key: string, value: unknown): Readonly<Record<string, unknown>> {
  return value === undefined ? {} : { [key]: value };
}

function optionalDate(key: string, value: Date | undefined): Readonly<Record<string, string>> {
  return value === undefined ? {} : { [key]: value.toISOString() };
}
