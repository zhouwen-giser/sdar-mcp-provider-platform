export type HostingMode = "vendor_managed" | "platform_managed";

export interface ProviderSummary {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode: HostingMode;
  readonly status: "draft" | "active" | "degraded" | "disabled" | "retired";
}

export interface ProviderPackageSummary {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly providerType: string;
  readonly hostingModes: readonly HostingMode[];
  readonly compatibleRuntimeVersion: string;
  readonly protocolMode: string;
  readonly qualification: {
    readonly componentStatus: "passed" | "partial" | "pending" | "failed";
    readonly realResourceStatus: "qualified" | "pending" | "failed" | "not_applicable";
  };
}

export interface ResourceSummary {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly status: "available" | "unavailable" | "retired";
}

export interface CreateProviderInput {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode: HostingMode;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export type ConfigurationApplyMode =
  "hot_reload" | "reconnect_required" | "restart_required" | "immutable";

export interface ConfigurationFieldMetadata {
  readonly path: string;
  readonly displayName: string;
  readonly description: string;
  readonly applyMode: ConfigurationApplyMode;
  readonly required: boolean;
  readonly secret: boolean;
}

export interface ConfigurationDraftSummary {
  readonly draftId: string;
  readonly definitionId: string;
  readonly environment: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
  readonly version: number;
  readonly status: "draft" | "validated" | "invalid";
  readonly applyMode?: ConfigurationApplyMode;
  readonly configuredKeys: readonly string[];
  readonly secretConfiguredKeys: readonly string[];
  readonly validationIssues: readonly {
    readonly code: string;
    readonly path: string;
  }[];
}

export interface EffectiveConfigurationSummary {
  readonly applyMode: ConfigurationApplyMode;
  readonly valid: boolean;
  readonly keys: readonly string[];
  readonly sources: Readonly<Record<string, string>>;
}

export interface CreateConfigurationDraftInput {
  readonly draftId: string;
  readonly definitionId: string;
  readonly environment: string;
  readonly targetType: "runtime_deployment";
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface RuntimeDeploymentSummary {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly desiredState: "running" | "stopped";
  readonly desiredReplicas: number;
  readonly runtimeVersion: string;
  readonly status: string;
  readonly desiredRevision: number;
  readonly observedRevision: number;
}

export interface RuntimeProcessSummary {
  readonly instanceId: string;
  readonly deploymentId: string;
  readonly processState: "missing" | "starting" | "online" | "stopping" | "stopped" | "errored";
  readonly livenessState: "unknown" | "live" | "dead";
  readonly readinessState: "unknown" | "ready" | "not_ready";
  readonly observedHealth: string;
  readonly readyForActive: boolean;
  readonly healthReasonCode: string;
  readonly configState: "unknown" | "current" | "stale" | "rejected" | "restart_required";
  readonly configRevision: number | null;
  readonly runtimeVersion: string | null;
  readonly restartCount: number;
}

export interface CatalogToolSummary {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly taskBehavior: "synchronous_only" | "server_directed" | "task_required";
  readonly resourceBindingMode?: "NONE" | "ARGUMENT_REFERENCE";
}

export interface RegistryProviderSummary {
  readonly providerId: string;
  readonly serverId: string;
  readonly protocolMode: "frozen_v1";
  readonly catalogRevision: number;
  readonly tools: readonly CatalogToolSummary[];
}

export interface RegistrySnapshotSummary {
  readonly environment: string;
  readonly revision: number;
  readonly checksum: string;
  readonly publishedAt: string;
  readonly providers: readonly RegistryProviderSummary[];
}

export interface RegistryDiffSummary {
  readonly environment: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly addedProviderIds: readonly string[];
  readonly removedProviderIds: readonly string[];
  readonly changedProviderIds: readonly string[];
}

export interface AuditEventSummary {
  readonly auditEventId: string;
  readonly action: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly occurredAt: string;
}

export interface AuditFilters {
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly correlationId?: string;
}
