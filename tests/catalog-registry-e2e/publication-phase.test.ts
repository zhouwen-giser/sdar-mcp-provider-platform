import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot } from "../../packages/catalog-manager/src/index.js";
import {
  PostgresCatalogSnapshotRepository,
  PostgresRegistrySnapshotRepository,
  runPmsMigrations,
} from "../../packages/pms-persistence-postgres/src/index.js";
import {
  databaseProfileId,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInfrastructureOperationContext,
  runtimeProviderId,
  type RuntimeDeploymentSnapshot,
} from "../../packages/runtime-deployment/src/index.js";
import type { RegistryProviderInput } from "../../packages/registry-snapshot/src/index.js";
import {
  CatalogRegistryPublicationPhase,
  CatalogRegistryReconcileDecorator,
  HttpCatalogRegistryDiscovery,
  type CatalogRegistryStatePort,
} from "../../apps/pms-worker/src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../..");

describe("Ready to Catalog to Registry publication", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `catalog_registry_${randomUUID().replaceAll("-", "")}`;
  const runtime = Fastify({ logger: false });
  let pool: Pool;
  let runtimeEndpoint: string;
  let toolsResult: Record<string, unknown>;
  let catalogs: PostgresCatalogSnapshotRepository;
  let registries: PostgresRegistrySnapshotRepository;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('test.runtime','Runtime','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES
         ('provider-a','test.runtime','vendor_managed','active'),
         ('provider-b','test.runtime','vendor_managed','active'),
         ('provider-c','test.runtime','vendor_managed','active')`,
    );
    catalogs = new PostgresCatalogSnapshotRepository(pool);
    registries = new PostgresRegistrySnapshotRepository(pool);
    toolsResult = completeTools(["operate"]);
    runtime.post("/mcp", (request) => {
      const body = request.body as { method?: string; id?: unknown };
      return {
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "server/discover"
            ? discovery()
            : body.method === "tools/list"
              ? toolsResult
              : {},
      };
    });
    runtimeEndpoint = `${await runtime.listen({ host: "127.0.0.1", port: 0 })}/mcp`;
  });

  afterAll(async () => {
    await runtime.close();
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("moves HEALTH_CHECKING through DISCOVERING to ACTIVE only after both commits", async () => {
    const transitions = ["HEALTH_CHECKING"];
    const state = statePort(transitions);
    const phase = publicationPhase(state);
    const base = {
      reconcile: vi.fn(() => {
        transitions.push("DISCOVERING");
        return Promise.resolve({
          deployment: deployment("provider-a", "production"),
          progressed: true,
          orphanProcessNames: [],
        });
      }),
    };
    const result = await new CatalogRegistryReconcileDecorator(base, phase).reconcile(input());

    expect(result.deployment.status).toBe("ACTIVE");
    expect(transitions).toEqual(["HEALTH_CHECKING", "DISCOVERING", "ACTIVE"]);
    expect(await catalogs.active("provider-a")).toMatchObject({ revision: 1 });
    expect(await registries.latest("production")).toMatchObject({
      revision: 1,
      document: { providers: [{ providerId: "provider-a", catalogRevision: 1 }] },
    });
  });

  it("reuses unchanged Catalog authority while publishing immutable Registry revisions", async () => {
    const state = statePort([]);
    const phase = publicationPhase(state);
    const unchanged = await phase.close(deployment("provider-a", "production"), input().context);
    expect(unchanged.catalog).toMatchObject({ created: false, snapshot: { revision: 1 } });
    expect(unchanged.registry).toMatchObject({ created: true, snapshot: { revision: 2 } });

    toolsResult = completeTools(["inspect", "operate"]);
    const changed = await phase.close(deployment("provider-a", "production"), input().context);
    expect(changed.catalog).toMatchObject({ created: true, snapshot: { revision: 2 } });
    expect(changed.registry).toMatchObject({ created: true, snapshot: { revision: 3 } });
    expect(
      (await registries.latest("production"))?.document.providers[0]?.tools.map(({ name }) => name),
    ).toEqual(["inspect", "operate"]);
  });

  it("does not commit Catalog or Registry and marks FAILED when discovery is incomplete", async () => {
    toolsResult = { tools: [tool("operate")], nextCursor: "page-2" };
    const fail = vi.fn<CatalogRegistryStatePort["fail"]>((value) =>
      Promise.resolve({ ...value, status: "FAILED", observedRevision: value.observedRevision + 1 }),
    );
    const state = { ...statePort([]), fail };

    await expect(
      publicationPhase(state).close(deployment("provider-b", "staging"), input().context),
    ).rejects.toMatchObject({
      code: "CATALOG_DISCOVERY_FAILED",
    });
    expect(fail).toHaveBeenCalledOnce();
    expect(await catalogs.active("provider-b")).toBeNull();
    expect(await registries.latest("staging")).toBeNull();
  });

  it("keeps Registry LKG and prevents ACTIVE when Registry commit fails after Catalog commit", async () => {
    toolsResult = completeTools(["operate"]);
    const fail = vi.fn<CatalogRegistryStatePort["fail"]>((value) =>
      Promise.resolve({ ...value, status: "FAILED", observedRevision: value.observedRevision + 1 }),
    );
    const state = { ...statePort([]), fail };
    const phase = new CatalogRegistryPublicationPhase(
      new HttpCatalogRegistryDiscovery(),
      { resolve: () => Promise.resolve({ endpoint: runtimeEndpoint }) },
      catalogs,
      projection(),
      {
        publish: () => Promise.reject(new Error("REGISTRY_UNAVAILABLE")),
        latest: (environment) => registries.latest(environment),
        get: (environment, revision) => registries.get(environment, revision),
        history: (environment, limit) => registries.history(environment, limit),
        diff: (environment, from, to) => registries.diff(environment, from, to),
      },
      state,
    );

    await expect(
      phase.close(deployment("provider-c", "production"), input().context),
    ).rejects.toMatchObject({
      code: "REGISTRY_COMMIT_FAILED",
    });
    expect(await catalogs.active("provider-c")).toMatchObject({ revision: 1 });
    expect(await registries.latest("production")).toMatchObject({
      revision: 3,
      document: { providers: [{ providerId: "provider-a" }] },
    });
    expect(fail).toHaveBeenCalledOnce();
  });

  function publicationPhase(state: CatalogRegistryStatePort) {
    return new CatalogRegistryPublicationPhase(
      new HttpCatalogRegistryDiscovery(),
      { resolve: () => Promise.resolve({ endpoint: runtimeEndpoint }) },
      catalogs,
      projection(),
      registries,
      state,
    );
  }

  function projection() {
    return {
      providers: ({
        deployment: value,
        catalog,
      }: {
        deployment: RuntimeDeploymentSnapshot;
        catalog: CatalogSnapshot;
      }): Promise<readonly RegistryProviderInput[]> => {
        return Promise.resolve([
          {
            providerId: value.providerId,
            serverId: `server-${value.providerId}`,
            protocolMode: "frozen_v1",
            effectiveEndpoint: runtimeEndpoint,
            catalog,
          },
        ]);
      },
    };
  }
});

function statePort(transitions: string[]): CatalogRegistryStatePort {
  return {
    recordCatalogState() {
      return Promise.resolve();
    },
    activate(value) {
      transitions.push("ACTIVE");
      return Promise.resolve({
        ...value,
        status: "ACTIVE",
        observedRevision: value.observedRevision + 1,
      });
    },
    fail(value) {
      transitions.push("FAILED");
      return Promise.resolve({
        ...value,
        status: "FAILED",
        observedRevision: value.observedRevision + 1,
      });
    },
  };
}

function deployment(provider: string, environment: string): RuntimeDeploymentSnapshot {
  return {
    deploymentId: runtimeDeploymentId(`deployment-${provider}`),
    providerId: runtimeProviderId(provider),
    environment: runtimeEnvironmentId(environment),
    desiredState: "running",
    desiredReplicas: 1,
    runtimeVersion: "2.0.0",
    runtimeAuthority: "platform_managed",
    databaseProfileId: databaseProfileId(`database-${provider}`),
    configProfileId: runtimeConfigProfileId(`config-${provider}`),
    status: "DISCOVERING",
    desiredRevision: 0,
    observedRevision: 5,
  };
}

function input() {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-provider-a",
    context: runtimeInfrastructureOperationContext({
      operationId: "catalog-registry-e2e",
      correlationId: "catalog-registry-e2e",
      idempotencyKey: "catalog-registry-e2e",
      timeoutMs: 2_000,
    }),
  };
}

function discovery(): Record<string, unknown> {
  return {
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: {
      tools: {},
      extensions: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
      },
    },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "sdar-mcp-tasks-provider-runtime",
        version: "2.0.0",
      },
    },
  };
}

function completeTools(names: string[]): Record<string, unknown> {
  return { tools: names.map(tool) };
}

function tool(name: string): Record<string, unknown> {
  return {
    name,
    description: `${name} operation`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    _meta: {
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: "task_required",
        availability: "dynamic",
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsObservations: true,
        supportsInputRequired: true,
        idempotency: "server_managed",
      },
    },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
