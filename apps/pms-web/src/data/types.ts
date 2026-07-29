export type PrototypeScenario =
  | "healthy"
  | "empty"
  | "loading"
  | "partial-data"
  | "network-error"
  | "degraded"
  | "runtime-stale"
  | "config-drift"
  | "catalog-breaking"
  | "worker-backlog"
  | "incident-active"
  | "pending-approval"
  | "read-only"
  | "permission-denied";

export type EntityStatus =
  | "ACTIVE"
  | "DEGRADED"
  | "DRAFT"
  | "STALE"
  | "BLOCKED"
  | "PENDING"
  | "FAILED"
  | "REQUESTED"
  | "PROVISIONING"
  | "STARTING"
  | "STOPPED";

export interface ProviderSummary {
  readonly providerId: string;
  readonly name: string;
  readonly type: string;
  readonly environment: string;
  readonly status: EntityStatus;
  readonly resourceCount: number;
  readonly deploymentCount: number;
  readonly observedAt: string;
}

export interface ResourceSummary {
  readonly resourceId: string;
  readonly providerId: string;
  readonly name: string;
  readonly kind: string;
  readonly environment: string;
  readonly status: EntityStatus;
  readonly capabilities: readonly string[];
  readonly observedAt: string;
}

export interface ProviderOnboardingDraft {
  readonly name: string;
  readonly providerId: string;
  readonly packageId: string;
  readonly hostingMode: "platform-managed" | "vendor-managed";
  readonly adapterEndpoint: string;
  readonly databaseProfileId: string;
  readonly runtimeRelease: string;
  readonly environment: string;
}

export interface MockCheckResult {
  readonly passed: boolean;
  readonly code: string;
  readonly summary: string;
  readonly blockers: readonly string[];
}

export interface RuntimeDeploymentSummary {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly release: string;
  readonly desiredState: "ACTIVE" | "STOPPED";
  readonly observedState: EntityStatus;
  readonly desiredRevision: number;
  readonly observedRevision: number;
  readonly configRevision: number;
}

export interface RuntimeProcessSummary {
  readonly processId: string;
  readonly deploymentId: string;
  readonly providerId: string;
  readonly pm2Status: "online" | "stopped" | "errored";
  readonly healthStatus: EntityStatus;
  readonly registrationStatus: "REGISTERED" | "STALE" | "UNREGISTERED";
  readonly observedRevision: number;
  readonly heartbeatAt: string;
}

export interface WorkerJobSummary {
  readonly jobId: string;
  readonly kind: "RECONCILE_RUNTIME" | "DISCOVER_CATALOG" | "PUBLISH_CONFIG";
  readonly aggregateId: string;
  readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  readonly attempts: number;
  readonly updatedAt: string;
  readonly leaseOwner: string;
  readonly fenceToken: string;
  readonly timeline: readonly string[];
}

export interface RuntimeDeploymentDraft {
  readonly providerId: string;
  readonly release: string;
  readonly databaseProfileId: string;
  readonly configurationProfileId: string;
  readonly placement: string;
  readonly replicas: number;
}

export type ConfigurationApplyMode = "HOT_RELOAD" | "RECONNECT" | "RESTART" | "IMMUTABLE";

export interface ConfigurationField {
  readonly key: string;
  readonly value: string | number | boolean;
  readonly defaultValue: string | number | boolean;
  readonly source: "platform-default" | "provider-profile" | "environment-override";
  readonly applyMode: ConfigurationApplyMode;
  readonly secretRef?: string;
}

export interface ConfigurationProfile {
  readonly profileId: string;
  readonly name: string;
  readonly status: "DRAFT" | "PUBLISHED" | "PENDING_APPROVAL";
  readonly currentRevision: number;
  readonly publishedRevision: number;
  readonly fields: readonly ConfigurationField[];
}

export interface RuntimeConfigurationAck {
  readonly runtimeId: string;
  readonly profileId: string;
  readonly revision: number;
  readonly status:
    | "APPLIED"
    | "RESTART_REQUIRED"
    | "OFFLINE"
    | "REJECTED"
    | "PENDING";
  readonly detail: string;
}

export interface IncidentSummary {
  readonly incidentId: string;
  readonly title: string;
  readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
  readonly status: "OPEN" | "MITIGATING" | "CLOSED";
  readonly deploymentId: string;
  readonly jobId: string;
  readonly owner: string;
  readonly updatedAt: string;
  readonly timeline: readonly string[];
}

export interface CatalogOperationSummary {
  readonly providerId: string;
  readonly operationName: string;
  readonly method: "tool" | "resource";
  readonly revision: number;
  readonly compatibility: "COMPATIBLE" | "BREAKING" | "REVIEW";
  readonly registryStatus: "PUBLISHED" | "BLOCKED" | "DRAFT";
  readonly schema: Readonly<Record<string, unknown>>;
  readonly previousSchema: Readonly<Record<string, unknown>>;
  readonly profile: string;
  readonly evidence: readonly string[];
}

export interface RegistryRevision {
  readonly revision: number;
  readonly status: "PUBLISHED" | "BLOCKED" | "DRAFT";
  readonly checksum: string;
  readonly operationCount: number;
  readonly createdAt: string;
}

export interface AuditEvent {
  readonly auditId: string;
  readonly action: string;
  readonly aggregateId: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface DashboardSnapshot {
  readonly providerCount: number;
  readonly healthyProviderCount: number;
  readonly activeDeploymentCount: number;
  readonly openIncidentCount: number;
  readonly workerBacklog: number;
  readonly stale: boolean;
}

export interface PrototypeDataset {
  readonly dashboard: DashboardSnapshot;
  readonly providers: readonly ProviderSummary[];
  readonly resources: readonly ResourceSummary[];
  readonly deployments: readonly RuntimeDeploymentSummary[];
  readonly processes: readonly RuntimeProcessSummary[];
  readonly jobs: readonly WorkerJobSummary[];
  readonly incidents: readonly IncidentSummary[];
}

export interface PrototypeOperationStep {
  readonly id: string;
  readonly label: string;
  readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
}

export interface PrototypeOperation {
  readonly operationId: string;
  readonly label: string;
  readonly simulated: true;
  readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  readonly steps: readonly PrototypeOperationStep[];
  readonly resultMessage?: string;
}

export interface SimulatedOperationInput {
  readonly label: string;
  readonly steps: readonly string[];
  readonly failAtStep?: number;
}

export interface PmsWebDataSource {
  scenario(): PrototypeScenario;
  revision(): number;
  setScenario(scenario: PrototypeScenario): void;
  dashboard(): Promise<DashboardSnapshot>;
  providers(): Promise<readonly ProviderSummary[]>;
  provider(providerId: string): Promise<ProviderSummary | undefined>;
  resources(): Promise<readonly ResourceSummary[]>;
  deployments(): Promise<readonly RuntimeDeploymentSummary[]>;
  deployment(deploymentId: string): Promise<RuntimeDeploymentSummary | undefined>;
  runtimeProcesses(): Promise<readonly RuntimeProcessSummary[]>;
  jobs(): Promise<readonly WorkerJobSummary[]>;
  requeueJob(jobId: string): PrototypeOperation;
  configurationProfiles(): Promise<readonly ConfigurationProfile[]>;
  runtimeConfigurationAcks(profileId: string): Promise<readonly RuntimeConfigurationAck[]>;
  publishConfiguration(profileId: string): PrototypeOperation;
  createRuntimeDeployment(draft: RuntimeDeploymentDraft): {
    readonly deployment: RuntimeDeploymentSummary;
    readonly operation: PrototypeOperation;
  };
  reconcileRuntime(deploymentId: string): {
    readonly job: WorkerJobSummary;
    readonly operation: PrototypeOperation;
  };
  incidents(): Promise<readonly IncidentSummary[]>;
  closeIncident(incidentId: string): PrototypeOperation;
  catalogOperations(): Promise<readonly CatalogOperationSummary[]>;
  registryRevisions(): Promise<readonly RegistryRevision[]>;
  rediscoverCatalog(providerId: string): PrototypeOperation;
  publishCatalog(providerId: string): PrototypeOperation;
  auditEvents(): Promise<readonly AuditEvent[]>;
  checkAdapter(draft: ProviderOnboardingDraft): Promise<MockCheckResult>;
  preflightProvider(draft: ProviderOnboardingDraft): Promise<MockCheckResult>;
  onboardProvider(draft: ProviderOnboardingDraft): {
    readonly provider: ProviderSummary;
    readonly operation: PrototypeOperation;
  };
  startOperation(input: SimulatedOperationInput): PrototypeOperation;
  advanceOperation(operationId: string): PrototypeOperation;
  operations(): readonly PrototypeOperation[];
  subscribe(listener: () => void): () => void;
}
