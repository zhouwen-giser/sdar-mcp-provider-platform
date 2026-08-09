import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LightExecutionEngine } from "../../../apps/home-assistant-light-provider/src/execution/execution-engine.js";
import { HomeAssistantLightClient } from "../../../apps/home-assistant-light-provider/src/home-assistant.js";
import { LightProviderServer } from "../../../apps/home-assistant-light-provider/src/server.js";
import { LightResourceRegistry } from "../../../apps/home-assistant-light-provider/src/resources.js";
import { MemoryLightStore } from "../../../apps/home-assistant-light-provider/src/store.js";
import { NoopLightTelemetry } from "../../../apps/home-assistant-light-provider/src/telemetry.js";
import { loadRuntimeConfig } from "../../../apps/runtime/src/config.js";
import { createRuntime } from "../../../apps/runtime/src/runtime.js";
import {
  CatalogDiscoveryClient,
  HttpCatalogDiscoveryTransport,
} from "../../../packages/catalog-manager/src/index.js";
import {
  PostgresCatalogSnapshotRepository,
  PostgresRegistrySnapshotRepository,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { loadProviderPackageRegistry } from "../../../packages/provider-package-registry/src/index.js";
import { buildRegistrySnapshot } from "../../../packages/registry-snapshot/src/index.js";
import { FakeHomeAssistantLight } from "../../fixtures/fake-home-assistant-light.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerId = "home-assistant-light-platform-e2e";
const expectedOperations = ["light_get_state", "light_set_brightness", "light_set_power"];

describe("vendor_managed Home Assistant Light platform integration", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const runtimeSchema = `ha_light_runtime_${randomUUID().replaceAll("-", "")}`;
  const pmsSchema = `ha_light_pms_${randomUUID().replaceAll("-", "")}`;
  let runtimePool: Pool | undefined;
  let pmsPool: Pool | undefined;
  let fake: FakeHomeAssistantLight | undefined;
  let provider: LightProviderServer | undefined;
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let runtimeAddress: string;

  beforeAll(async () => {
    const providerPackage = (await loadProviderPackageRegistry(workspaceRoot)).get(
      "builtin.home-assistant.light",
      "0.1.0",
    );
    if (providerPackage === undefined) throw new Error("HA_LIGHT_PROVIDER_PACKAGE_MISSING");
    expect(providerPackage.providerType).toBe("home_assistant.light");
    expect(providerPackage.hostingModes).toEqual(["vendor_managed"]);
    expect(providerPackage.qualification).toMatchObject({
      componentStatus: "passed",
      realResourceStatus: "pending",
    });

    await admin.query(`CREATE SCHEMA ${runtimeSchema}`);
    await admin.query(`CREATE SCHEMA ${pmsSchema}`);
    runtimePool = new Pool({
      connectionString: scopedDatabaseUrl(connectionString, runtimeSchema),
    });
    pmsPool = new Pool({ connectionString, options: `-c search_path=${pmsSchema}` });
    await runPmsMigrations(pmsPool, workspaceRoot);
    await seedProviderBinding(pmsPool);

    fake = new FakeHomeAssistantLight();
    fake.setState("light.platform_e2e", "off", {
      brightness: 128,
      supported_color_modes: ["brightness"],
    });
    await fake.start();
    const resources = new LightResourceRegistry([
      {
        resourceId: "light-platform-e2e",
        entityId: "light.platform_e2e",
        displayName: "Platform E2E Light",
        enabled: true,
      },
    ]);
    const rest = new HomeAssistantLightClient({
      baseUrl: fake.url,
      token: fake.token,
      timeoutMs: 1_000,
    });
    const store = new MemoryLightStore();
    const engine = new LightExecutionEngine(
      store,
      resources,
      rest,
      new NoopLightTelemetry(),
      3_000,
      true,
    );
    provider = new LightProviderServer(
      {
        providerId,
        providerVersion: "0.1.0",
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      resources,
      rest,
      store,
      engine,
    );
    const adapterPort = await provider.start();
    runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(await freePort()),
        PROVIDER_ID: providerId,
        DATABASE_URL: scopedDatabaseUrl(connectionString, runtimeSchema),
        ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
        ADAPTER_TLS_MODE: "disabled",
        LOG_LEVEL: "error",
        OTEL_ENABLED: "false",
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
        BUSINESS_EVENTS_ENABLED: "false",
      }),
    );
    await runtime.initialize();
    runtimeAddress = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await runtime?.app.close();
    await provider?.close();
    await fake?.close();
    await runtimePool?.end();
    await pmsPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${pmsSchema} CASCADE`);
    await admin.end();
  });

  it("proves the generic Runtime path with the three Light operations", async () => {
    if (runtime === undefined) throw new Error("RUNTIME_NOT_STARTED");
    const [live, ready] = await Promise.all([
      fetch(`${runtimeAddress}/health/live`),
      fetch(`${runtimeAddress}/health/ready`),
    ]);
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(runtime.providerIdentityEvidence()).toMatchObject({
      state: "verified",
      bootstrapProviderId: providerId,
      adapterManifestProviderId: providerId,
    });
    const catalog = await discover(runtimeAddress);
    expect(catalog.tools.map(({ name }) => name)).toEqual(expectedOperations);
    expect(catalog.tools.every(({ name }) => name.startsWith("light_"))).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("vehicle_");
  });

  it("preserves Light resource bindings through Catalog and Registry", async () => {
    if (pmsPool === undefined || runtimePool === undefined) throw new Error("DATABASE_NOT_STARTED");
    const catalogPublication = await new PostgresCatalogSnapshotRepository(pmsPool).publish({
      providerId,
      catalog: await discover(runtimeAddress),
      actorId: "provider-platform-e2e",
      correlationId: "ha-light-platform-e2e",
      discoveredAt: new Date(),
    });
    for (const tool of catalogPublication.snapshot.document.tools) {
      expect(tool.resourceBinding).toEqual({
        mode: "ARGUMENT_REFERENCE",
        resourceIdJsonPointer: "/resourceId",
      });
    }
    const registryPublication = await new PostgresRegistrySnapshotRepository(pmsPool).publish({
      candidate: buildRegistrySnapshot("test", [
        {
          providerId,
          serverId: "runtime-ha-light-platform-e2e",
          protocolMode: "frozen_v1",
          effectiveEndpoint: `${runtimeAddress}/mcp`,
          catalog: catalogPublication.snapshot,
        },
      ]),
      actorId: "provider-platform-e2e",
      correlationId: "ha-light-platform-e2e",
      publishedAt: new Date(),
    });
    expect(registryPublication.snapshot.document.providers[0]?.tools).toHaveLength(3);
    expect(JSON.stringify(registryPublication.snapshot)).not.toContain("qualification");
    expect(
      (
        await runtimePool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM information_schema.tables
            WHERE table_schema=$1 AND table_name='runtime_schema_migration'`,
          [runtimeSchema],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });
});

function discover(runtimeAddress: string) {
  return new CatalogDiscoveryClient(
    new HttpCatalogDiscoveryTransport({ endpoint: `${runtimeAddress}/mcp` }),
  ).discover();
}

async function seedProviderBinding(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('home_assistant.light','Home Assistant Light','active')`,
  );
  await pool.query(
    `INSERT INTO provider_package(
       package_id,package_version,provider_type_id,hosting_modes,adapter_entry,
       config_schema,migration_set,qualification,checksum,status,source_document
     ) VALUES (
       'builtin.home-assistant.light','0.1.0','home_assistant.light',
       ARRAY['vendor_managed'],'{}'::jsonb,'{}'::jsonb,NULL,
       '{"componentStatus":"pending","realResourceStatus":"pending"}'::jsonb,
       repeat('a',64),'available','{}'::jsonb
     )`,
  );
  await pool.query(
    `INSERT INTO provider(
       provider_id,provider_type_id,package_id,package_version,hosting_mode,status
     ) VALUES (
       $1,'home_assistant.light','builtin.home-assistant.light','0.1.0',
       'vendor_managed','active'
     )`,
    [providerId],
  );
}

function scopedDatabaseUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("PORT_ALLOCATION_FAILED"));
        return;
      }
      server.close((error) => {
        if (error === undefined) resolvePort(address.port);
        else reject(error);
      });
    });
  });
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
