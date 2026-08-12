import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UgvBusinessEventHub } from "../../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../../apps/ugv-provider-adapter/src/server.js";
import { UgvTelemetry } from "../../../apps/ugv-provider-adapter/src/telemetry.js";
import { loadRuntimeConfig } from "../../../apps/runtime/src/config.js";
import { createRuntime } from "../../../apps/runtime/src/runtime.js";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
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
import { OperationRegistry } from "../../../packages/operation-registry/src/index.js";
import {
  OperationSnapshotRepository,
  TaskRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import { buildRegistrySnapshot } from "../../../packages/registry-snapshot/src/index.js";
import { DurableCommandDispatcher, TaskEngine } from "../../../packages/task-engine/src/index.js";
import { MockUgvDeviceMcpClient } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../../packages/vehicle-mqtt-ingress/src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerId = "isr.vehicle.ugv.platform-e2e";
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "simulation",
  simulationId: "ugv-platform-e2e",
  correlationId: "ugv-fire-decline-platform-e2e",
};

describe("vendor_managed UGV Provider platform integration", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const runtimeSchema = `ugv_runtime_${randomUUID().replaceAll("-", "")}`;
  const pmsSchema = `ugv_pms_${randomUUID().replaceAll("-", "")}`;
  let runtimePool: Pool | undefined;
  let pmsPool: Pool | undefined;
  let adapterRuntime: UgvProviderRuntime | undefined;
  let adapterServer: UgvProviderServer | undefined;
  let adapterStore: MemoryProviderStore;
  let adapterIngress: VehicleMqttIngress;
  let device: MockUgvDeviceMcpClient;
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let taskEngine: TaskEngine;
  let runtimeAddress: string;
  const providerDatabaseProvisionCalls = 0;

  beforeAll(async () => {
    const providerPackage = (await loadProviderPackageRegistry(workspaceRoot)).get(
      "builtin.isr.vehicle.ugv",
      "1.0.0",
    );
    if (providerPackage === undefined) throw new Error("UGV_PROVIDER_PACKAGE_MISSING");
    expect(providerPackage.providerType).toBe("isr.vehicle.ugv");
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
    pmsPool = new Pool({
      connectionString,
      options: `-c search_path=${pmsSchema}`,
    });
    await runPmsMigrations(pmsPool, workspaceRoot);
    await seedProviderBinding(pmsPool);

    adapterStore = new MemoryProviderStore();
    adapterIngress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    seedUgv(adapterIngress);
    device = new MockUgvDeviceMcpClient();
    adapterRuntime = new UgvProviderRuntime(
      {
        providerId,
        freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
      },
      adapterStore,
      adapterIngress,
      device,
      new UgvBusinessEventHub(adapterStore),
      new UgvTelemetry({
        providerId,
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
    );
    await adapterRuntime.initialize();
    adapterServer = new UgvProviderServer(
      {
        providerId,
        providerVersion: "1.0.0",
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      adapterRuntime,
      adapterStore,
      new UgvBusinessEventHub(adapterStore),
    );
    const adapterPort = await adapterServer.start();

    const runtimePort = await freePort();
    runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(runtimePort),
        PROVIDER_ID: providerId,
        DATABASE_URL: scopedDatabaseUrl(connectionString, runtimeSchema),
        ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
        ADAPTER_TLS_MODE: "disabled",
        LOG_LEVEL: "error",
        OTEL_ENABLED: "false",
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
        BUSINESS_EVENTS_ENABLED: "false",
        SCHEDULER_POLL_MS: "60000",
      }),
    );
    const manifest = new OperationRegistry().validate(await runtime.initialize());
    const operationSnapshots = await new OperationSnapshotRepository(runtime.pool).saveManifest(
      manifest,
    );
    taskEngine = new TaskEngine(
      manifest,
      operationSnapshots,
      runtime.gateway,
      new TaskRepository(runtime.pool),
    );
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

  it("starts ready with matching identity and discovers the eleven authoritative operations", async () => {
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

    const catalog = await new CatalogDiscoveryClient(
      new HttpCatalogDiscoveryTransport({ endpoint: `${runtimeAddress}/mcp` }),
    ).discover();
    expect(catalog.tools.map(({ name }) => name)).toEqual(
      [
        "vehicle_get_state",
        "vehicle_get_capabilities",
        "vehicle_get_payload_status",
        "vehicle_get_targets",
        "vehicle_laser_range",
        "vehicle_navigate",
        "vehicle_area_recon",
        "vehicle_track_target",
        "vehicle_control_gimbal",
        "vehicle_fire_weapon",
        "vehicle_emergency_stop",
      ].sort((left, right) => left.localeCompare(right)),
    );
  });

  it("commits Catalog and Registry from Runtime discovery without provisioning a Provider DB", async () => {
    if (pmsPool === undefined || runtimePool === undefined) throw new Error("DATABASE_NOT_STARTED");
    const catalog = await new CatalogDiscoveryClient(
      new HttpCatalogDiscoveryTransport({ endpoint: `${runtimeAddress}/mcp` }),
    ).discover();
    const catalogPublication = await new PostgresCatalogSnapshotRepository(pmsPool).publish({
      providerId,
      catalog,
      actorId: "provider-platform-e2e",
      correlationId: "ugv-platform-e2e",
      discoveredAt: new Date(),
    });
    const registryPublication = await new PostgresRegistrySnapshotRepository(pmsPool).publish({
      candidate: buildRegistrySnapshot("test", [
        {
          providerId,
          serverId: "runtime-ugv-platform-e2e",
          protocolMode: "frozen_v1",
          effectiveEndpoint: `${runtimeAddress}/mcp`,
          catalog: catalogPublication.snapshot,
        },
      ]),
      actorId: "provider-platform-e2e",
      correlationId: "ugv-platform-e2e",
      publishedAt: new Date(),
    });

    expect(catalogPublication.snapshot.document.tools).toHaveLength(11);
    const projection = registryPublication.snapshot.document.providers[0];
    expect(projection).toMatchObject({
      providerId,
      catalogRevision: 1,
    });
    expect(projection?.tools.some(({ name }) => name === "vehicle_navigate")).toBe(true);
    expect(providerDatabaseProvisionCalls).toBe(0);
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

  it("maps an acknowledged fire decline to platform cancellation without a device fire call", async () => {
    if (runtime === undefined) throw new Error("RUNTIME_NOT_STARTED");
    seedUgv(adapterIngress);
    seedFireReady(adapterIngress);
    const fireOperation = taskEngine.manifest.operations.find(
      ({ name }) => name === "vehicle_fire_weapon",
    );
    if (fireOperation === undefined) throw new Error("UGV_FIRE_OPERATION_MISSING");

    expect(device.calls).toEqual([]);
    const created = await taskEngine.callOperation(
      fireOperation,
      {
        resourceId: "vehicle:ugv1",
        targetId: "101",
        engagementMode: "single",
        requireConfirmation: true,
      },
      authorization,
    );
    if (created.kind !== "task") throw new Error("UGV_FIRE_TASK_NOT_CREATED");
    const taskId = String(created.task.taskId);
    expect(created.task).toMatchObject({ status: "input_required" });
    expect(await adapterStore.getExecution(taskId)).toMatchObject({ state: "WAITING_INPUT" });

    await taskEngine.updateTaskInputResponses(
      taskId,
      { fire_confirmation: { action: "decline" } },
      authorization,
    );
    const dispatched = await new DurableCommandDispatcher(
      runtime.gateway,
      new TaskRepository(runtime.pool),
    ).tick();
    expect(dispatched).toMatchObject({ claimed: 1, acknowledged: 1, rejected: 0 });

    const command = await runtime.pool.query<{
      state: string;
      adapter_ack: { accepted?: boolean; reasonCode?: string } | null;
    }>(
      `SELECT state,adapter_ack
         FROM task_command
        WHERE task_id=$1 AND command_type='UPDATE'`,
      [taskId],
    );
    expect(command.rows[0]).toMatchObject({
      state: "ACKNOWLEDGED",
      adapter_ack: { accepted: true, reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED" },
    });
    expect(await adapterStore.getExecution(taskId)).toMatchObject({
      state: "CANCELLED",
      reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED",
      result: { status: "cancelled" },
    });

    expect(await taskEngine.getTask(taskId, authorization)).toMatchObject({
      status: "cancelled",
    });
    expect(await new TaskRepository(runtime.pool).getById(taskId)).toMatchObject({
      internalState: "TERMINAL_CANCELLED",
    });
    expect(device.calls).toEqual([]);
  });
});

async function seedProviderBinding(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('isr.vehicle.ugv','UGV','active')`,
  );
  await pool.query(
    `INSERT INTO provider_package(
       package_id,package_version,provider_type_id,hosting_modes,adapter_entry,
       config_schema,migration_set,qualification,checksum,status,source_document
     ) VALUES (
       'builtin.isr.vehicle.ugv','1.0.0','isr.vehicle.ugv',
       ARRAY['vendor_managed','platform_managed'],'{}'::jsonb,'{}'::jsonb,'provider:ugv',
       '{"componentStatus":"passed","realResourceStatus":"pending"}'::jsonb,
       repeat('a',64),'available','{}'::jsonb
     )`,
  );
  await pool.query(
    `INSERT INTO provider(
       provider_id,provider_type_id,package_id,package_version,hosting_mode,status
     ) VALUES ($1,'isr.vehicle.ugv','builtin.isr.vehicle.ugv','1.0.0','vendor_managed','active')`,
    [providerId],
  );
}

function seedUgv(ingress: VehicleMqttIngress): void {
  ingress.setConnected(true);
  ingress.handle(
    "/ugv/gnss",
    Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1}'),
  );
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  ingress.handle(
    "status/ugv",
    Buffer.from(
      '{"vehicle_id":"ugv1","role_name":"ugv","speed_kmh":0,"chassis_task":{"state":-1,"progress":0},"eo_task":{"state":-1,"progress":0},"weapon_task":{"state":-1,"progress":0},"available":true}',
    ),
  );
}

function seedFireReady(ingress: VehicleMqttIngress): void {
  ingress.handle(
    "/ugv/detected_objects",
    Buffer.from(
      '{"entity_id":"ugv1","objects":[{"id":101,"object_type":"3:target-vehicle","x":1,"y":2,"z":0}]}',
    ),
  );
  ingress.applyDeviceObservation(
    { payload: { online: true, lockedTargetId: "101", attackReady: true } },
    [],
  );
}

function scopedDatabaseUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
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
