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
  "ACTIVE" | "DEGRADED" | "DRAFT" | "STALE" | "BLOCKED" | "PENDING" | "FAILED";

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

export interface IncidentSummary {
  readonly incidentId: string;
  readonly title: string;
  readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
  readonly status: "OPEN" | "MITIGATING" | "CLOSED";
  readonly deploymentId: string;
  readonly updatedAt: string;
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
  readonly deployments: readonly RuntimeDeploymentSummary[];
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
  setScenario(scenario: PrototypeScenario): void;
  dashboard(): Promise<DashboardSnapshot>;
  providers(): Promise<readonly ProviderSummary[]>;
  deployments(): Promise<readonly RuntimeDeploymentSummary[]>;
  incidents(): Promise<readonly IncidentSummary[]>;
  startOperation(input: SimulatedOperationInput): PrototypeOperation;
  advanceOperation(operationId: string): PrototypeOperation;
  operations(): readonly PrototypeOperation[];
  subscribe(listener: () => void): () => void;
}
