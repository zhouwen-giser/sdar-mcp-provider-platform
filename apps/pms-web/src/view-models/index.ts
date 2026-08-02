export interface ProviderSummaryViewModel {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageLabel: string;
  readonly hostingMode: "vendor_managed" | "platform_managed";
  readonly adapterEndpoint: string;
  readonly status: "draft" | "active" | "degraded" | "disabled" | "retired";
  readonly updatedAt: string;
}
export interface ProviderPackageViewModel {
  readonly packageId: string;
  readonly version: string;
  readonly providerType: string;
  readonly hostingModes: readonly string[];
  readonly runtimeVersion: string;
  readonly componentStatus: string;
  readonly realResourceStatus: string;
}
export interface ResourceSummaryViewModel {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly displayName: string;
  readonly status: "available" | "unavailable" | "retired";
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface RuntimeDeploymentViewModel {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly desiredState: "running" | "stopped" | "draining";
  readonly desiredReplicas: 0 | 1;
  readonly runtimeVersion: string;
  readonly databaseProfileId: string;
  readonly configProfileId: string;
  readonly status: string;
  readonly desiredRevision: number;
  readonly observedRevision: number;
  readonly converged: boolean;
}
export interface RuntimeProcessViewModel {
  readonly providerId: string;
  readonly instanceId: string;
  readonly deploymentId: string;
  readonly processState: string;
  readonly readinessState: string;
  readonly registrationState: string;
  readonly catalogState: string;
  readonly runtimeVersion: string;
  readonly configRevision: number;
  readonly observedRevision: number;
  readonly restartCount: number;
  readonly lastHeartbeatAt: string;
  readonly observedHealth: string;
  readonly readyForActive: boolean;
}
export interface ConfigurationDraftViewModel {
  readonly draftId: string;
  readonly definitionId: string;
  readonly targetLabel: string;
  readonly status: "draft" | "validated" | "invalid";
  readonly version: number;
  readonly applyMode?: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
  readonly updatedAt: string;
}
export interface RegistryProviderViewModel { readonly providerId: string; readonly serverId: string; readonly protocolMode: string; readonly effectiveEndpoint: string; readonly catalogRevision: number; readonly tools: readonly Readonly<Record<string, unknown>>[] }
export interface RegistrySnapshotViewModel {
  readonly environment: string;
  readonly revision: number;
  readonly checksum: string;
  readonly providerCount: number;
  readonly toolCount: number;
  readonly publishedAt: string;
  readonly providers: readonly RegistryProviderViewModel[];
}
export interface AuditEventViewModel {
  readonly auditEventId: string;
  readonly action: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly occurredAt: string;
}
