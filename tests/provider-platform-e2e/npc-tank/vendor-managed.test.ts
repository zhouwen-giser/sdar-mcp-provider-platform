import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../../apps/runtime/src/config.js";
import { createRuntime } from "../../../apps/runtime/src/runtime.js";
import { NpcTankProviderRuntime } from "../../../apps/npc-tank-provider-adapter/src/runtime.js";
import { NpcTankProviderServer } from "../../../apps/npc-tank-provider-adapter/src/server.js";
import {
  CatalogDiscoveryClient,
  HttpCatalogDiscoveryTransport,
} from "../../../packages/catalog-manager/src/index.js";
import {
  PostgresCatalogSnapshotRepository,
  PostgresRegistrySnapshotRepository,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { MemoryProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import { loadProviderPackageRegistry } from "../../../packages/provider-package-registry/src/index.js";
import { buildRegistrySnapshot } from "../../../packages/registry-snapshot/src/index.js";
import { MockNpcTankDeviceMcpClient } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  VehicleBusinessEventHub,
  VehicleTelemetry,
  type NpcTankSnapshot,
} from "../../../packages/vehicle-provider-core/src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerId = "isr.vehicle.npc-tank.platform-e2e";
const expectedOperations = [
  "vehicle_get_state",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_laser_range",
  "vehicle_navigate",
  "vehicle_area_recon",
  "vehicle_track_target",
  "vehicle_fire_weapon",
  "vehicle_emergency_stop",
].sort((left, right) => left.localeCompare(right));

describe("vendor_managed NPC Tank Provider platform integration", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const runtimeSchema = `npc_runtime_${randomUUID().replaceAll("-", "")}`;
  const pmsSchema = `npc_pms_${randomUUID().replaceAll("-", "")}`;
  let runtimePool: Pool | undefined;
  let pmsPool: Pool | undefined;
  let adapterRuntime: NpcTankProviderRuntime | undefined;
  let adapterServer: NpcTankProviderServer | undefined;
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let runtimeAddress: string;

  beforeAll(async () => {
    const providerPackage = (await loadProviderPackageRegistry(workspaceRoot)).get(
      "builtin.isr.vehicle.npc-tank",
      "0.1.0",
    );
    if (providerPackage === undefined) throw new Error("NPC_PROVIDER_PACKAGE_MISSING");
    expect(providerPackage.providerType).toBe("isr.vehicle.npc_tank");
    expect(providerPackage.hostingModes).toContain("vendor_managed");
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

    const store = new MemoryProviderStore();
    const ingress = new VehicleMqttIngress<NpcTankSnapshot>(
      "direct_domain_json",
      { maxPayloadBytes: 65_536, maxDepth: 16, maxNodes: 4_096, maxStringBytes: 16_384 },
      npcTankMqttProfile(),
    );
    seedNpcTank(ingress);
    const businessEvents = new VehicleBusinessEventHub(store, {
      reasonPrefix: "NPC_TANK",
      resourceId: "vehicle:npc_tank1",
    });
    adapterRuntime = new NpcTankProviderRuntime(
      {
        providerId,
        providerVersion: "0.1.0",
        freshness: {
          chassis: 3_000,
          mission: 3_000,
          health: 5_000,
          target: 3_000,
          payload: 3_000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        navigationReportPath: `/tmp/${runtimeSchema}-navigation.json`,
        eoScanReportPath: `/tmp/${runtimeSchema}-eo.json`,
      },
      store,
      ingress,
      new MockNpcTankDeviceMcpClient(),
      businessEvents,
      new VehicleTelemetry({
        providerId,
        resourceId: "vehicle:npc_tank1",
        resourceType: "isr.vehicle.npc_tank",
        enabled: false,
        endpoint: "127.0.0.1:7005",
        tlsMode: "disabled",
      }),
    );
    await adapterRuntime.initialize();
    adapterServer = new NpcTankProviderServer(
      {
        providerId,
        providerVersion: "0.1.0",
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      adapterRuntime,
      store,
      businessEvents,
    );
    const adapterPort = await adapterServer.start();

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
    await adapterServer?.close();
    await adapterRuntime?.close();
    await runtimePool?.end();
    await pmsPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${pmsSchema} CASCADE`);
    await admin.end();
  });

  it("becomes ready and publishes the exact capability-conditioned NPC Catalog", async () => {
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
    const areaRecon = catalog.tools.find(({ name }) => name === "vehicle_area_recon");
    expect(areaRecon).toBeDefined();
    expect(JSON.stringify(areaRecon?.inputSchema)).toContain("circular");
  });

  it("uses an independent Runtime DB and publishes Registry without overstating qualification", async () => {
    if (pmsPool === undefined || runtimePool === undefined) throw new Error("DATABASE_NOT_STARTED");
    const catalogPublication = await new PostgresCatalogSnapshotRepository(pmsPool).publish({
      providerId,
      catalog: await discover(runtimeAddress),
      actorId: "provider-platform-e2e",
      correlationId: "npc-platform-e2e",
      discoveredAt: new Date(),
    });
    const registryPublication = await new PostgresRegistrySnapshotRepository(pmsPool).publish({
      candidate: buildRegistrySnapshot("test", [
        {
          providerId,
          serverId: "runtime-npc-platform-e2e",
          protocolMode: "frozen_v1",
          effectiveEndpoint: `${runtimeAddress}/mcp`,
          catalog: catalogPublication.snapshot,
        },
      ]),
      actorId: "provider-platform-e2e",
      correlationId: "npc-platform-e2e",
      publishedAt: new Date(),
    });

    expect(catalogPublication.snapshot.document.tools).toHaveLength(9);
    expect(registryPublication.snapshot.document.providers[0]?.tools).toHaveLength(9);
    expect(JSON.stringify(registryPublication.snapshot)).not.toContain("qualified");
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
     VALUES ('isr.vehicle.npc_tank','NPC Tank','active')`,
  );
  await pool.query(
    `INSERT INTO provider_package(
       package_id,package_version,provider_type_id,hosting_modes,adapter_entry,
       config_schema,migration_set,qualification,checksum,status,source_document
     ) VALUES (
       'builtin.isr.vehicle.npc-tank','0.1.0','isr.vehicle.npc_tank',
       ARRAY['vendor_managed','platform_managed'],'{}'::jsonb,'{}'::jsonb,'provider:npc-tank',
       '{"componentStatus":"passed","realResourceStatus":"pending"}'::jsonb,
       repeat('b',64),'available','{}'::jsonb
     )`,
  );
  await pool.query(
    `INSERT INTO provider(
       provider_id,provider_type_id,package_id,package_version,hosting_mode,status
     ) VALUES (
       $1,'isr.vehicle.npc_tank','builtin.isr.vehicle.npc-tank','0.1.0',
       'vendor_managed','active'
     )`,
    [providerId],
  );
}

function seedNpcTank(ingress: VehicleMqttIngress<NpcTankSnapshot>): void {
  ingress.setConnected(true);
  ingress.handle(
    "/npc_tank1/gnss",
    Buffer.from('{"entity_id":"npc_tank1","latitude":30.1,"longitude":114.1}'),
  );
  ingress.handle(
    "/npc_tank1/component_status",
    Buffer.from(
      '{"entity_id":"npc_tank1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  ingress.handle(
    "/npc_tank1/status",
    Buffer.from(
      '{"vehicle_id":"npc_tank1","role_name":"npc_tank1","speed_kmh":0,"chassis_task":{"state":-1,"progress":0},"eo_task":{"state":-1,"progress":0},"weapon_task":{"state":-1,"progress":0},"available":true}',
    ),
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
