import { generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { connect } from "mqtt";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  BoundExecutionScope,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  UgvMqttClient,
  VehicleMqttIngress,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { StreamableHttpUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { TrajectoryHistoryReader } from "../../packages/trajectory-history/src/reader.js";
import { TrajectoryReceptionJournal } from "../../packages/trajectory-history/src/journal.js";

// Only a parent test's private IPC channel may operate this owned loopback fixture.
if (!process.send || !process.env.SMPP_INSPECTION_TEST_CONFIG_FILE)
  throw Error("ISOLATED_PARENT_TEST_REQUIRED");
const config = z
  .object({
    owner: z.literal("inspection-area-v1"),
    databaseUrl: z.url(),
    brokerUrl: z.string(),
  })
  .parse(JSON.parse(readFileSync(process.env.SMPP_INSPECTION_TEST_CONFIG_FILE, "utf8")));
if (
  new URL(config.databaseUrl).hostname !== "127.0.0.1" ||
  !config.brokerUrl.startsWith("mqtt://127.0.0.1:")
)
  throw Error("ISOLATED_OWNED_INFRASTRUCTURE_REQUIRED");
const suffix = randomUUID().replaceAll("-", "");
const adapterSchema = "inspection_adapter_" + suffix,
  runtimeSchema = "inspection_runtime_" + suffix;
const temp = mkdtempSync(join(tmpdir(), "inspection-cross-"));
const admin = new Pool({ connectionString: config.databaseUrl, max: 1 });
await admin.query(`CREATE SCHEMA ${adapterSchema}`);
await admin.query(`CREATE SCHEMA ${runtimeSchema}`);
const providerId = "isr.vehicle.ugv.ugv1",
  resourceId = "vehicle:ugv1";
const db = (schema: string) => {
  const url = new URL(config.databaseUrl);
  url.searchParams.set("options", "-c search_path=" + schema);
  return url.toString();
};
const store = new PostgresProviderStore(db(adapterSchema), 8);
await runUgvProviderMigrations(store.pool);
const business = new PostgresTaskBusinessStore(store.pool);
store.enableTaskBusinessSource(business);
const ingress = new VehicleMqttIngress(
  "direct_domain_json",
  {
    maxPayloadBytes: 65536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  },
  ugvMqttProfile({
    providerId,
    resourceId,
    entityId: "ugv1",
    vehicleType: "ugv",
    executionMode: "simulation",
  }),
);
const net = createServer();
await new Promise<void>((resolve) => net.listen(0, "127.0.0.1", resolve));
const address = net.address();
if (!address || typeof address === "string") throw Error("DEVICE_ADDRESS_REQUIRED");
await new Promise<void>((resolve) => net.close(() => resolve()));
const deviceProcess = spawn(
  process.execPath,
  ["--import", "tsx", "apps/mock-ugv-device-mcp/src/main.ts"],
  {
    env: {
      ...process.env,
      MOCK_UGV_DEVICE_MCP_PORT: String(address.port),
      MOCK_UGV_ISOLATED_OBSERVATIONS: "true",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  },
);
async function observeDeviceMission(missionId: string, state: number, progress: number) {
  const id = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("MOCK_DEVICE_OBSERVATION_TIMEOUT")), 5000);
    const listener = (value: unknown) => {
      const ack = z.object({ id: z.string(), accepted: z.boolean() }).safeParse(value);
      if (!ack.success || ack.data.id !== id) return;
      clearTimeout(timer);
      deviceProcess.off("message", listener);
      if (ack.data.accepted) resolve();
      else reject(Error("MOCK_DEVICE_MISSION_CONFLICT"));
    };
    deviceProcess.on("message", listener);
    deviceProcess.send({
      id,
      kind: "mission_observation",
      missionId: Number(missionId),
      state,
      progress,
    });
  });
}
async function until(test: () => Promise<boolean> | boolean) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("ISOLATED_FIXTURE_TIMEOUT");
}
await until(async () => {
  try {
    await fetch(`http://127.0.0.1:${address.port}/mcp`);
    return true;
  } catch {
    return false;
  }
});
const device = new StreamableHttpUgvDeviceMcpClient(
  {
    url: `http://127.0.0.1:${address.port}/mcp`,
    timeoutMs: 5000,
    maxResponseBytes: 65536,
    useMockContractWhenUnavailable: true,
    contractReportPath: join(temp, "device-contract.json"),
  },
  store,
);
const historyStore = new PostgresReceptionStore(store.pool, {
  providerId,
  resourceId,
  deviceId: "ugv1",
  deviceIdentityAuthority: "PROVIDER_RESOURCE_CONFIGURATION",
  sourceSessionKey: "isolated:" + suffix,
});
const historyJournal = new TrajectoryReceptionJournal(historyStore, ingress, "SIMULATED", 256);
await historyJournal.initialize();
const history = new TrajectoryHistoryReader(
  historyStore,
  generateKeyPairSync("ed25519").privateKey,
  "SIMULATED",
);
const hub = new UgvBusinessEventHub(store);
const businessService = new UgvTaskBusinessContextService(
  store,
  business,
  providerId,
  resourceId,
  (e) => hub.notifyCommittedTaskBusinessEvent(e),
);
const adapter = new UgvProviderRuntime(
  {
    providerId,
    resourceId,
    entityId: "ugv1",
    executionMode: "simulation",
    inspectionEnabled: true,
    fireEnabled: false,
    fireRequiresChassisStopped: true,
    freshness: { chassis: 600000, mission: 600000, health: 600000, payload: 600000, target: 3000 },
    allowNavigationWithRecon: true,
    pollIntervalMs: 100,
    physicalConfirmationTimeoutMs: 5000,
    trajectorySampleEveryMs: 0,
    trajectoryHistory: history,
  },
  store,
  ingress,
  device,
  hub,
  new UgvTelemetry({ providerId, enabled: false, endpoint: "127.0.0.1:7002", tlsMode: "disabled" }),
  businessService,
);
await adapter.initializeLocal();
const mqtt = new UgvMqttClient(
  {
    url: config.brokerUrl,
    clientId: "inspection-cross-ingress-" + suffix,
    tlsMode: "disabled",
    sessionMode: "clean",
    reconnectMinMs: 100,
    reconnectMaxMs: 1000,
    receptionJournal: historyJournal,
  },
  ingress,
);
mqtt.start();
const publisher = connect(config.brokerUrl, {
  clientId: "inspection-cross-publisher-" + suffix,
  reconnectPeriod: 0,
});
await new Promise<void>((resolve, reject) => {
  publisher.once("connect", () => resolve());
  publisher.once("error", reject);
});
// A fresh broker has no previous traffic. Qualify the real subscription with
// current fixture GNSS observations, including a publish after its SUBACK.
await until(async () => {
  const time = Date.now();
  await publisher.publishAsync(
    "/ugv/gnss",
    JSON.stringify({
      entity_id: "ugv1",
      longitude: 116,
      latitude: 39,
      altitude: 0,
      header: { stamp: { sec: Math.floor(time / 1000), nanosec: (time % 1000) * 1000000 } },
    }),
    { qos: 1 },
  );
  return ingress.snapshot().connectivity.mqttConnected;
});
async function publish(topic: string, value: Record<string, unknown>) {
  const before = ingress.observationCursor(topic);
  const now = Date.now();
  await new Promise<void>((resolve, reject) =>
    publisher.publish(
      topic,
      JSON.stringify({
        ...value,
        header: { stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1000000 } },
      }),
      { qos: 1 },
      (e) => (e ? reject(e) : resolve()),
    ),
  );
  await until(() => ingress.observationCursor(topic) !== before);
  await adapter.pollActive();
}
let currentPosition = { longitude: 116, latitude: 39 };
async function health(longitude = 116, latitude = 39) {
  currentPosition = { longitude, latitude };
  await publish("/ugv/gnss", { entity_id: "ugv1", longitude, latitude, altitude: 0 });
  await publish("/ugv/component_status", {
    entity_id: "ugv1",
    power_battery: 0,
    lvbattery: 0,
    fuel: 0,
    water_temp: 0,
    motor: 0,
    sensor: 0,
    gnss: 0,
    comms: 0,
    weapon: 0,
    navigation: 0,
  });
  await publish("status/ugv", {
    vehicle_id: "ugv1",
    role_name: "ugv",
    available: true,
    speed_kmh: 0,
    chassis_task: { state: -1, progress: 0 },
    eo_task: { state: -1, progress: 0 },
    weapon_task: { state: -1, progress: 0 },
  });
}
await health();
await adapter.initializeDependencies();
let heartbeatFailure: unknown;
let heartbeatFlight: Promise<void> | undefined;
// The simulated device continuously observes its current position, including
// while a human is reviewing child plans. Freshness gates retain their real limits.
const positionHeartbeat = setInterval(() => {
  if (heartbeatFlight) return;
  heartbeatFlight = publish("/ugv/gnss", { entity_id: "ugv1", ...currentPosition, altitude: 0 })
    .catch((error: unknown) => {
      heartbeatFailure = error;
    })
    .finally(() => {
      heartbeatFlight = undefined;
    });
}, 250);
positionHeartbeat.unref();
const grpc = new UgvProviderServer(
  { providerId, providerVersion: "1.0.0", host: "127.0.0.1", port: 0, tlsMode: "disabled" },
  adapter,
  store,
  hub,
);
const grpcPort = await grpc.start();
const runtime = createRuntime(
  loadRuntimeConfig({
    RUNTIME_ENV: "test",
    PROVIDER_ID: providerId,
    DATABASE_URL: db(runtimeSchema),
    ADAPTER_ENDPOINT: `127.0.0.1:${grpcPort}`,
    ADAPTER_TLS_MODE: "disabled",
    AUTH_MODE: "development",
    LOG_LEVEL: "error",
    OTEL_ENABLED: "false",
    PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
    BUSINESS_EVENTS_ENABLED: "true",
    SCHEDULER_POLL_MS: "100",
    BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
    RATE_LIMIT_MAX: "10000",
  }),
);
runtime.app.addHook("onSend", (request, reply, payload, done) => {
  if (reply.statusCode >= 400)
    process.stderr.write(
      JSON.stringify({
        event: "inspection_fixture.http_error",
        url: request.url,
        statusCode: reply.statusCode,
        payload: String(payload).slice(0, 1000),
      }) + "\n",
    );
  done(null, payload);
});
await runtime.initialize();
await runtime.app.listen({ host: "127.0.0.1", port: 0 });
const http = runtime.app.server.address();
if (!http || typeof http === "string") throw Error("MCP_ADDRESS_REQUIRED");
process.send({
  kind: "ready",
  endpoint: `http://127.0.0.1:${http.port}/mcp`,
  schemas: [adapterSchema, runtimeSchema],
});
let closed = false;
async function close() {
  if (closed) return;
  closed = true;
  clearInterval(positionHeartbeat);
  await heartbeatFlight;
  await runtime.app.close();
  await grpc.close();
  await mqtt.stop();
  await publisher.endAsync();
  await adapter.close();
  deviceProcess.kill("SIGTERM");
  await admin.query(`DROP SCHEMA ${adapterSchema} CASCADE`);
  await admin.query(`DROP SCHEMA ${runtimeSchema} CASCADE`);
  await admin.end();
  rmSync(temp, { recursive: true, force: true });
}
let queue = Promise.resolve();
process.on("message", (value: unknown) => {
  queue = queue.then(async () => {
    if (!value || typeof value !== "object") throw Error("FIXTURE_COMMAND_INVALID");
    const request = value as { id: string; action: string; mode?: string };
    try {
      if (request.action !== "close" && heartbeatFailure)
        throw heartbeatFailure instanceof Error
          ? heartbeatFailure
          : Error("MOCK_POSITION_HEARTBEAT_FAILED");
      const active = await store.listActiveExecutions();
      if (request.action === "probe") {
        process.send?.({
          id: request.id,
          result: active.map((e) => ({
            taskId: e.taskId,
            operationName: e.operationName,
            state: e.state,
            reasonCode: e.reasonCode,
            missionId: e.downstreamMissionIds.at(-1),
          })),
        });
        return;
      }
      if (request.action === "close") {
        await close();
        process.send?.({ id: request.id, result: { closed: true } });
        process.disconnect();
        return;
      }
      if (request.action === "reset") {
        await health();
        process.send?.({ id: request.id, result: { ready: true } });
        return;
      }
      if (request.action === "control_observation") {
        const state = request.mode === "paused" ? 8 : request.mode === "cancelled" ? 9 : 5;
        for (const run of active) {
          const missionId = run.downstreamMissionIds.at(-1);
          if (run.operationName !== "vehicle_inspect_area" || !missionId) continue;
          await publish("/ugv/area_recon/status", {
            entity_id: "ugv1",
            mission_id: missionId,
            status: state,
            scan_mode: 1,
            online: true,
            camera_fault: false,
            out_of_range: false,
            progress: 0,
            coverage: 0,
            coverage_incomplete: true,
            lock: { stage: 1, target_id: 0 },
            attack_ready: false,
          });
        }
        process.send?.({ id: request.id, result: { observed: active.length } });
        return;
      }
      if (request.action !== "observe") throw Error("FIXTURE_COMMAND_UNSUPPORTED");
      for (const run of active) {
        const missionId = run.downstreamMissionIds.at(-1);
        if (!missionId) continue;
        if (run.operationName === "vehicle_inspect_area") {
          const status = async (state: number, coverage: number) =>
            publish("/ugv/area_recon/status", {
              entity_id: "ugv1",
              mission_id: missionId,
              status: state,
              scan_mode: 1,
              online: true,
              camera_fault: false,
              out_of_range: false,
              progress: coverage,
              coverage,
              coverage_incomplete: coverage !== 100,
              lock: { stage: 1, target_id: 0 },
              attack_ready: false,
            });
          if (request.mode === "cancel") {
            await status(9, 0);
            continue;
          }
          await status(5, 0);
          if (request.mode !== "missing")
            await publish("/ugv/area_recon/targets", {
              entity_id: "ugv1",
              mission_id: missionId,
              targets:
                request.mode === "findings"
                  ? [
                      {
                        target_id: 7,
                        type: 1,
                        capture_time_us: Date.now() * 1000,
                        position: { longitude: 116.5, latitude: 39.5 },
                      },
                    ]
                  : [],
            });
          await status(request.mode === "failed" ? 10 : 11, request.mode === "partial" ? 50 : 100);
        } else if (run.operationName === "vehicle_navigate") {
          const mission = run.arguments.mission as {
            target?: { longitude: number; latitude: number };
          };
          await observeDeviceMission(missionId, 1, 20);
          await publish("/ugv/mission_state", {
            entity_id: "ugv1",
            id: Number(missionId),
            state: 1,
            progress: 20,
          });
          await publish("status/ugv", {
            vehicle_id: "ugv1",
            available: true,
            speed_kmh: 0,
            chassis_task: { id: Number(missionId), state: 1, progress: 20 },
            eo_task: { state: -1, progress: 0 },
            weapon_task: { state: -1, progress: 0 },
          });
          // Produce two device observations while this exact mission owns the
          // chassis. A final-position snapshot alone cannot prove a trajectory.
          await publish("/ugv/gnss", { entity_id: "ugv1", ...currentPosition, altitude: 0 });
          const scope = BoundExecutionScope.fromExecution(run);
          await until(async () =>
            Boolean((await business.getContext(scope))?.summary.properties?.trajectoryLast),
          );
          currentPosition = {
            longitude: mission.target?.longitude ?? 116.5,
            latitude: mission.target?.latitude ?? 39.5,
          };
          await publish("/ugv/gnss", { entity_id: "ugv1", ...currentPosition, altitude: 0 });
          await until(async () => {
            const context = await business.getContext(scope);
            const ref = context?.activeRefs.trajectory;
            if (!ref) return false;
            const artifact = await business.getArtifactLatest(scope, ref.id);
            return (
              artifact?.availability === "available" &&
              artifact.content.kind === "geojson" &&
              artifact.content.geometry.type === "LineString"
            );
          });
          await observeDeviceMission(missionId, request.mode === "cancel" ? 3 : 4, 100);
          await publish("/ugv/mission_state", {
            entity_id: "ugv1",
            id: Number(missionId),
            state: request.mode === "cancel" ? 3 : 4,
            progress: 100,
          });
          await publish("status/ugv", {
            vehicle_id: "ugv1",
            available: true,
            speed_kmh: 0,
            chassis_task: {
              id: Number(missionId),
              state: request.mode === "cancel" ? 3 : 4,
              progress: 100,
            },
            eo_task: { state: -1, progress: 0 },
            weapon_task: { state: -1, progress: 0 },
          });
        }
      }
      process.send?.({ id: request.id, result: { observed: active.length } });
    } catch (error) {
      process.send?.({
        id: request.id,
        error: error instanceof Error ? error.message : "FIXTURE_FAILED",
      });
    }
  });
});
process.once("disconnect", () => void close());
process.once("SIGTERM", () => void close());
