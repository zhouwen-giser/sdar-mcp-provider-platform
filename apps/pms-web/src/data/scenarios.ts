import { HEALTHY_DATASET } from "./fixtures.js";
import type { PrototypeDataset, PrototypeScenario } from "./types.js";

export const PROTOTYPE_SCENARIOS: readonly PrototypeScenario[] = [
  "healthy",
  "empty",
  "loading",
  "partial-data",
  "network-error",
  "degraded",
  "runtime-stale",
  "config-drift",
  "catalog-breaking",
  "worker-backlog",
  "incident-active",
  "pending-approval",
  "read-only",
  "permission-denied",
];

export function isPrototypeScenario(value: string | null): value is PrototypeScenario {
  return PROTOTYPE_SCENARIOS.some((scenario) => scenario === value);
}

export function buildScenario(scenario: PrototypeScenario): PrototypeDataset {
  if (scenario === "empty") {
    return {
      dashboard: {
        providerCount: 0,
        healthyProviderCount: 0,
        activeDeploymentCount: 0,
        openIncidentCount: 0,
        workerBacklog: 0,
        stale: false,
      },
      providers: [],
      resources: [],
      deployments: [],
      processes: [],
      jobs: [],
      incidents: [],
    };
  }
  let dashboard = structuredClone(HEALTHY_DATASET.dashboard);
  let providers = [...structuredClone(HEALTHY_DATASET.providers)];
  let resources = [...structuredClone(HEALTHY_DATASET.resources)];
  let deployments = [...structuredClone(HEALTHY_DATASET.deployments)];
  let processes = [...structuredClone(HEALTHY_DATASET.processes)];
  let jobs = [...structuredClone(HEALTHY_DATASET.jobs)];
  let incidents = [...structuredClone(HEALTHY_DATASET.incidents)];
  if (scenario === "degraded" || scenario === "partial-data") {
    providers = providers.map((provider, index) =>
      index === 1 ? { ...provider, status: "DEGRADED" } : provider,
    );
    dashboard = { ...dashboard, healthyProviderCount: 2 };
    resources = resources.map((resource, index) =>
      index === 1 ? { ...resource, status: "DEGRADED" } : resource,
    );
  }
  if (
    scenario === "runtime-stale" ||
    scenario === "config-drift" ||
    scenario === "incident-active"
  ) {
    deployments = deployments.map((deployment, index) =>
      index === 0 ? { ...deployment, observedState: "STALE", observedRevision: 15 } : deployment,
    );
    dashboard = { ...dashboard, stale: true };
    processes = processes.map((process, index) =>
      index === 0
        ? {
            ...process,
            healthStatus: "DEGRADED",
            registrationStatus: "STALE",
            observedRevision: 15,
          }
        : process,
    );
  }
  if (scenario === "worker-backlog") {
    dashboard = { ...dashboard, workerBacklog: 47 };
    jobs = [
      ...jobs,
      {
        jobId: "job-reconcile-backlog",
        kind: "RECONCILE_RUNTIME",
        aggregateId: "deploy-ha-primary",
        status: "PENDING",
        attempts: 3,
        updatedAt: "2026-07-29T06:02:00.000Z",
      },
    ];
  }
  if (scenario === "incident-active") {
    incidents = [
      {
        incidentId: "inc-runtime-drift-042",
        title: "Runtime observed revision 持续落后",
        severity: "SEV-2",
        status: "MITIGATING",
        deploymentId: "deploy-ha-primary",
        updatedAt: "2026-07-29T06:02:00.000Z",
      },
    ];
    dashboard = { ...dashboard, openIncidentCount: 1, stale: true };
  }
  if (scenario === "catalog-breaking") {
    providers = providers.map((provider, index) =>
      index === 2 ? { ...provider, status: "BLOCKED" } : provider,
    );
  }
  return { dashboard, providers, resources, deployments, processes, jobs, incidents };
}
