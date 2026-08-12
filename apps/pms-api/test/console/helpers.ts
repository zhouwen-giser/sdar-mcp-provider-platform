import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import type {
  ProviderManagementService,
  ProviderPackageQueryService,
  RuntimeProcessQueryService,
} from "../../../../packages/pms-application/src/index.js";
import type {
  ConfigurationCenter,
  ConfigurationPublicationService,
} from "../../../../packages/configuration-center/src/index.js";
import type { AuditRepository } from "../../../../packages/pms-domain/src/index.js";
import type { RegistrySnapshotRepository } from "../../../../packages/registry-snapshot/src/index.js";
import {
  createPmsApi,
  type PmsApiOptions,
  type RuntimeDeploymentManagementPort,
} from "../../src/index.js";

export const NOW = new Date("2026-07-30T00:00:00.000Z");
export const PACKAGE = {
  packageId: "pkg-1",
  packageVersion: "1.0.0",
  providerType: "isr.vehicle.ugv",
  hostingModes: ["vendor_managed"],
  configSchemaId: "ugv-config-v1",
  compatibleRuntimeVersion: "1.0.0",
  protocolMode: "frozen_v1",
  qualification: { componentStatus: "passed", realResourceStatus: "qualified" },
} as const;
export const PROVIDER_TYPE = {
  providerTypeId: "isr.vehicle.ugv",
  displayName: "UGV",
  status: "active",
  updatedAt: NOW,
} as const;
export const PROVIDER = {
  providerId: "provider-1",
  providerTypeId: "isr.vehicle.ugv",
  packageId: "pkg-1",
  packageVersion: "1.0.0",
  hostingMode: "vendor_managed",
  status: "draft",
  updatedAt: NOW,
} as const;
export const RESOURCE = {
  environment: "production",
  resourceId: "vehicle:1",
  resourceType: "vehicle",
  metadata: {},
  status: "available",
  updatedAt: NOW,
} as const;
export const BINDING = {
  providerId: "provider-1",
  environment: "production",
  resourceId: "vehicle:1",
  boundAt: NOW,
} as const;
export const DRAFT = {
  draftId: "draft-1",
  definitionId: "definition-1",
  definitionVersion: 1,
  key: {
    environment: "production",
    targetType: "provider",
    targetId: "provider-1",
    configGroup: "runtime",
    dataId: "default",
  },
  ancestorTargetIds: {},
  content: { endpoint: "http://device.invalid" },
  version: 1,
  status: "draft",
  validationIssues: [],
  createdAt: NOW,
  updatedAt: NOW,
} as const;
export const PREVIEW = {
  draftId: "draft-1",
  definitionId: "definition-1",
  definitionVersion: 1,
  content: { endpoint: "http://device.invalid" },
  sources: { endpoint: "provider" },
  applyMode: "restart_required",
  valid: true,
  issues: [],
} as const;
export const REVISION = {
  revisionId: "00000000-0000-4000-8000-000000000001",
  target: DRAFT.key,
  revision: 1,
  checksum: "a".repeat(64),
  applyMode: "restart_required",
  status: "published",
  content: DRAFT.content,
  createdAt: NOW,
} as const;
export const DEPLOYMENT = {
  deploymentId: "deployment-1",
  providerId: "provider-1",
  environment: "production",
  desiredState: "running",
  desiredReplicas: 1,
  runtimeVersion: "1.0.0",
  runtimeAuthority: "platform_managed",
  databaseProfileId: "db-1",
  configProfileId: "config-1",
  status: "ACTIVE",
  desiredRevision: 1,
  observedRevision: 1,
} as const;
export const PROCESS = {
  instanceId: "instance-1",
  deploymentId: "deployment-1",
  processState: "online",
  pid: 42,
  pm2Name: "runtime-1",
  assignedPort: 4100,
  lastHeartbeatAt: NOW.toISOString(),
  observedHealth: "READY",
  readyForActive: true,
  healthReasonCode: "READY",
  stale: false,
  registrationFreshness: "registered",
  logReference: {
    referenceId: "runtime:instance-1",
    tailEndpoint: "/api/v1/runtime-processes/instance-1/logs",
    contentIncluded: false,
  },
} as const;
export const SNAPSHOT = {
  environment: "production",
  revision: 1,
  checksum: "b".repeat(64),
  document: { environment: "production", providers: [] },
  publishedAt: NOW,
  createdAt: NOW,
} as const;
export const AUDIT_EVENT = {
  auditEventId: "00000000-0000-4000-8000-000000000002",
  action: "provider.created",
  actorId: "prototype-user",
  correlationId: "corr-1",
  subjectType: "provider",
  subjectId: "provider-1",
  occurredAt: NOW,
  metadata: {},
} as const;

export interface ConsoleSpies {
  readonly createProvider: ReturnType<typeof vi.fn>;
  readonly createResource: ReturnType<typeof vi.fn>;
  readonly commandDeployment: ReturnType<typeof vi.fn>;
  readonly auditList: ReturnType<typeof vi.fn>;
}

export function createConsoleTestApp(overrides: Partial<PmsApiOptions> = {}): {
  readonly app: FastifyInstance;
  readonly spies: ConsoleSpies;
} {
  const createProvider = vi.fn(async () => PROVIDER);
  const createResource = vi.fn(async () => RESOURCE);
  const commandDeployment = vi.fn(async (input: { readonly command: string }) => ({
    ...DEPLOYMENT,
    ...(input.command === "stop"
      ? { desiredState: "stopped", desiredReplicas: 0, status: "DRAINING" }
      : {}),
  }));
  const auditList = vi.fn(async () => ({ items: [AUDIT_EVENT] }));
  const options: PmsApiOptions = {
    providerPackages: {
      list: vi.fn(() => [PACKAGE]),
      get: vi.fn(() => PACKAGE),
    } as unknown as ProviderPackageQueryService,
    management: {
      listProviderTypes: vi.fn(async () => ({ items: [PROVIDER_TYPE] })),
      getProviderType: vi.fn(async () => PROVIDER_TYPE),
      listProviders: vi.fn(async () => ({ items: [PROVIDER] })),
      createProvider,
      getProvider: vi.fn(async () => PROVIDER),
      updateProviderStatus: vi.fn(async () => ({ ...PROVIDER, status: "active" })),
      listResources: vi.fn(async () => ({ items: [RESOURCE] })),
      createResource,
      getResource: vi.fn(async () => RESOURCE),
      updateResourceStatus: vi.fn(async () => ({ ...RESOURCE, status: "unavailable" })),
      listProviderResources: vi.fn(async () => [BINDING]),
      bindResource: vi.fn(async () => BINDING),
      unbindResource: vi.fn(async () => undefined),
    } as unknown as ProviderManagementService,
    configurationCenter: {
      createDraft: vi.fn(() => DRAFT),
      getDraft: vi.fn(() => DRAFT),
      updateDraft: vi.fn(() => ({ ...DRAFT, version: 2 })),
      validateDraft: vi.fn(() => ({
        ...DRAFT,
        status: "validated",
        version: 2,
        applyMode: "restart_required",
      })),
      effectivePreview: vi.fn(() => PREVIEW),
    } as unknown as ConfigurationCenter,
    configurationPublication: {
      publish: vi.fn(async () => ({ outcome: "published", revision: REVISION })),
      rollback: vi.fn(async () => ({ outcome: "published", revision: REVISION })),
    } as unknown as ConfigurationPublicationService,
    runtimeDeployments: {
      list: vi.fn(async () => ({ items: [DEPLOYMENT] })),
      get: vi.fn(async () => DEPLOYMENT),
      create: vi.fn(async () => DEPLOYMENT),
      command: commandDeployment,
    } as unknown as RuntimeDeploymentManagementPort,
    runtimeProcesses: {
      list: vi.fn(async () => ({ items: [PROCESS] })),
      get: vi.fn(async () => PROCESS),
    } as unknown as RuntimeProcessQueryService,
    registrySnapshots: {
      latest: vi.fn(async () => SNAPSHOT),
      history: vi.fn(async () => [SNAPSHOT]),
      diff: vi.fn(async () => ({
        environment: "production",
        fromRevision: 1,
        toRevision: 2,
        added: [],
        removed: [],
        changed: [],
      })),
    } as unknown as RegistrySnapshotRepository,
    audit: { list: auditList } as unknown as Pick<AuditRepository, "list">,
    ...overrides,
  };
  return {
    app: createPmsApi(options),
    spies: { createProvider, createResource, commandDeployment, auditList },
  };
}

export const WRITE_HEADERS = {
  "x-actor-id": "prototype-user",
  "x-correlation-id": "corr-1",
} as const;

export interface ConsoleOperationCase {
  readonly operationId: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly status: number;
  readonly payload?: unknown;
}

export const SUCCESS_CASES: readonly ConsoleOperationCase[] = [
  {
    operationId: "listProviderPackages",
    method: "GET",
    url: "/api/console/v1/provider-packages",
    status: 200,
  },
  {
    operationId: "getProviderPackage",
    method: "GET",
    url: "/api/console/v1/provider-packages/pkg-1?version=1.0.0",
    status: 200,
  },
  {
    operationId: "listProviderTypes",
    method: "GET",
    url: "/api/console/v1/provider-types",
    status: 200,
  },
  {
    operationId: "getProviderType",
    method: "GET",
    url: "/api/console/v1/provider-types/isr.vehicle.ugv",
    status: 200,
  },
  {
    operationId: "listProviders",
    method: "GET",
    url: "/api/console/v1/providers",
    status: 200,
  },
  {
    operationId: "createProvider",
    method: "POST",
    url: "/api/console/v1/providers",
    status: 201,
    payload: { providerId: "provider-1", providerTypeId: "isr.vehicle.ugv" },
  },
  {
    operationId: "getProvider",
    method: "GET",
    url: "/api/console/v1/providers/provider-1",
    status: 200,
  },
  {
    operationId: "updateProviderStatus",
    method: "PATCH",
    url: "/api/console/v1/providers/provider-1/status",
    status: 200,
    payload: { status: "active", expectedUpdatedAt: NOW.toISOString() },
  },
  {
    operationId: "listResources",
    method: "GET",
    url: "/api/console/v1/resources?environment=production",
    status: 200,
  },
  {
    operationId: "createResource",
    method: "POST",
    url: "/api/console/v1/resources",
    status: 201,
    payload: {
      environment: "production",
      resourceId: "vehicle:1",
      resourceType: "vehicle",
    },
  },
  {
    operationId: "getResource",
    method: "GET",
    url: "/api/console/v1/resources/production/vehicle:1",
    status: 200,
  },
  {
    operationId: "updateResourceStatus",
    method: "PATCH",
    url: "/api/console/v1/resources/production/vehicle:1/status",
    status: 200,
    payload: { status: "unavailable", expectedUpdatedAt: NOW.toISOString() },
  },
  {
    operationId: "listProviderResourceBindings",
    method: "GET",
    url: "/api/console/v1/providers/provider-1/resource-bindings",
    status: 200,
  },
  {
    operationId: "bindProviderResource",
    method: "POST",
    url: "/api/console/v1/providers/provider-1/resource-bindings",
    status: 201,
    payload: { environment: "production", resourceId: "vehicle:1" },
  },
  {
    operationId: "unbindProviderResource",
    method: "DELETE",
    url: "/api/console/v1/providers/provider-1/resource-bindings/production/vehicle:1",
    status: 204,
  },
  {
    operationId: "createConfigurationDraft",
    method: "POST",
    url: "/api/console/v1/configuration-drafts",
    status: 201,
    payload: {
      draftId: "draft-1",
      definitionId: "definition-1",
      environment: "production",
      targetType: "provider",
      targetId: "provider-1",
      configGroup: "runtime",
      dataId: "default",
      content: { endpoint: "http://device.invalid" },
    },
  },
  {
    operationId: "getConfigurationDraft",
    method: "GET",
    url: "/api/console/v1/configuration-drafts/draft-1",
    status: 200,
  },
  {
    operationId: "updateConfigurationDraft",
    method: "PATCH",
    url: "/api/console/v1/configuration-drafts/draft-1",
    status: 200,
    payload: { expectedVersion: 1, content: { endpoint: "http://device.invalid" } },
  },
  {
    operationId: "validateConfigurationDraft",
    method: "POST",
    url: "/api/console/v1/configuration-drafts/draft-1/validate",
    status: 200,
  },
  {
    operationId: "previewEffectiveConfiguration",
    method: "GET",
    url: "/api/console/v1/configuration-drafts/draft-1/effective",
    status: 200,
  },
  {
    operationId: "publishConfigurationDraft",
    method: "POST",
    url: "/api/console/v1/configuration-drafts/draft-1/publish",
    status: 200,
    payload: { expectedDraftVersion: 1, expectedPublishedRevision: null },
  },
  {
    operationId: "rollbackConfigurationDraft",
    method: "POST",
    url: "/api/console/v1/configuration-drafts/draft-1/rollback",
    status: 200,
    payload: {
      expectedDraftVersion: 1,
      expectedPublishedRevision: 1,
      sourceRevisionId: "00000000-0000-4000-8000-000000000001",
    },
  },
  {
    operationId: "listRuntimeDeployments",
    method: "GET",
    url: "/api/console/v1/runtime-deployments?providerId=provider-1",
    status: 200,
  },
  {
    operationId: "createRuntimeDeployment",
    method: "POST",
    url: "/api/console/v1/runtime-deployments",
    status: 202,
    payload: {
      deploymentId: "deployment-1",
      providerId: "provider-1",
      environment: "production",
      runtimeVersion: "1.0.0",
      databaseProfileId: "db-1",
      configProfileId: "config-1",
    },
  },
  {
    operationId: "getRuntimeDeployment",
    method: "GET",
    url: "/api/console/v1/runtime-deployments/deployment-1?providerId=provider-1",
    status: 200,
  },
  ...(
    [
      { operationId: "startRuntimeDeployment", command: "start" },
      { operationId: "stopRuntimeDeployment", command: "stop" },
      { operationId: "restartRuntimeDeployment", command: "restart" },
      { operationId: "reconcileRuntimeDeployment", command: "reconcile" },
    ] as const
  ).map(({ operationId, command }) => ({
    operationId,
    method: "POST" as const,
    url: `/api/console/v1/runtime-deployments/deployment-1/${command}`,
    status: 202,
    payload: { providerId: "provider-1", expectedDesiredRevision: 1 },
  })),
  {
    operationId: "scaleRuntimeDeployment",
    method: "POST",
    url: "/api/console/v1/runtime-deployments/deployment-1/scale",
    status: 202,
    payload: { providerId: "provider-1", expectedDesiredRevision: 1, desiredReplicas: 1 },
  },
  {
    operationId: "listRuntimeProcesses",
    method: "GET",
    url: "/api/console/v1/runtime-processes?providerId=provider-1&deploymentId=deployment-1",
    status: 200,
  },
  {
    operationId: "getRuntimeProcess",
    method: "GET",
    url: "/api/console/v1/runtime-processes/instance-1?providerId=provider-1",
    status: 200,
  },
  {
    operationId: "getLatestRegistrySnapshot",
    method: "GET",
    url: "/api/console/v1/registry/production/latest",
    status: 200,
  },
  {
    operationId: "listRegistryHistory",
    method: "GET",
    url: "/api/console/v1/registry/production/history",
    status: 200,
  },
  {
    operationId: "diffRegistrySnapshots",
    method: "GET",
    url: "/api/console/v1/registry/production/diff?fromRevision=1&toRevision=2",
    status: 200,
  },
  {
    operationId: "listAuditEvents",
    method: "GET",
    url: "/api/console/v1/audit-events",
    status: 200,
  },
];
