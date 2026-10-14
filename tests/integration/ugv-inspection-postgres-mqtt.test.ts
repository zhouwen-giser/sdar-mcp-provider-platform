import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { connect, type MqttClient } from "mqtt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import {
  PostgresProviderStore,
  PostgresTaskBusinessStore,
  BoundExecutionScope,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  VehicleMqttIngress,
  UgvMqttClient,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { StreamableHttpUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";

const configFile = process.env.SMPP_INSPECTION_TEST_CONFIG_FILE;
if (!configFile) throw Error("ISOLATED_INSPECTION_TEST_CONFIG_REQUIRED");
const config = JSON.parse(readFileSync(configFile, "utf8")) as {
  databaseUrl: string;
  brokerUrl: string;
  owner: string;
};
if (
  config.owner !== "inspection-area-v1" ||
  !config.brokerUrl.startsWith("mqtt://127.0.0.1:") ||
  new URL(config.databaseUrl).hostname !== "127.0.0.1"
)
  throw Error("ISOLATED_INSPECTION_INFRASTRUCTURE_REQUIRED");
const suffix = randomUUID().replaceAll("-", ""),
  schema = "inspection_native_" + suffix;
const temp = mkdtempSync(join(tmpdir(), "inspection-device-"));
let admin: Pool, store: PostgresProviderStore, business: PostgresTaskBusinessStore;
let ingress: VehicleMqttIngress, mqtt: UgvMqttClient, publisher: MqttClient;
let runtime: UgvProviderRuntime, device: StreamableHttpUgvDeviceMcpClient, process_: ChildProcess;
let now = Date.now();
const args = {
  resourceId: "vehicle:ugv1",
  area: {
    boundary: [
      { x: 116, y: 39 },
      { x: 117, y: 39 },
      { x: 117, y: 40 },
      { x: 116, y: 40 },
    ],
  },
};

async function until(predicate: () => Promise<boolean> | boolean) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("INSPECTION_ISOLATED_WAIT_TIMEOUT");
}
async function publish(topic: string, value: unknown, retained = false) {
  const before = ingress.observationCursor(topic);
  now += 5;
  const json = {
    ...(value as Record<string, unknown>),
    header: { stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1000000 } },
  };
  await new Promise<void>((resolve, reject) =>
    publisher.publish(topic, JSON.stringify(json), { qos: 1, retain: retained }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  await until(() => ingress.observationCursor(topic) !== before);
  now = Math.max(now, Date.now());
  await runtime.get("observation-drain");
}
async function status(mission: string, state: number, coverage = 0) {
  await publish("/ugv/area_recon/status", {
    entity_id: "ugv1",
    mission_id: mission,
    status: state,
    scan_mode: 1,
    camera_fault: false,
    out_of_range: false,
    progress: coverage,
    coverage,
    coverage_incomplete: coverage !== 100,
    online: true,
    lock: { stage: 1, target_id: 0 },
    attack_ready: false,
  });
}
async function targets(mission: string, entries: unknown[]) {
  await publish("/ugv/area_recon/targets", {
    entity_id: "ugv1",
    mission_id: mission,
    targets: entries,
  });
}
function target(id: number, time = now + 5) {
  return {
    target_id: id,
    type: 1,
    capture_time_us: time * 1000,
    confidence: 0.9,
    position: { longitude: 116.5, latitude: 39.5 },
  };
}
function startInput(id: string) {
  return {
    taskId: id,
    operationName: "vehicle_inspect_area",
    arguments: args,
    argumentHash: createHash("sha256").update(JSON.stringify(args)).digest("hex"),
    executionContext: {
      executionMode: "simulation",
      simulationId: "ISOLATED-INSPECTION",
      correlationId: id,
      authorizationContextHash: "a".repeat(64),
    },
  };
}
async function start(id: string) {
  now = Math.max(now, Date.now());
  await publish("/ugv/gnss", { entity_id: "ugv1", latitude: 39.5, longitude: 116.5, altitude: 0 });
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
    eo_task: { state: -1, progress: 0 },
    chassis_task: { state: -1, progress: 0 },
    weapon_task: { state: -1, progress: 0 },
  });
  await runtime.start(startInput(id));
  const execution = await store.getExecution(id);
  if (!execution?.downstreamMissionIds[0]) throw Error("INSPECTION_MISSION_NOT_ADMITTED");
  await status(execution.downstreamMissionIds[0], 5);
  expect((await runtime.get(id))?.state).toBe("RUNNING");
  return execution;
}
const mission = (execution: ProviderExecution) => {
  const id = execution.downstreamMissionIds.at(-1);
  if (id === undefined) throw Error("TEST_MISSION_REQUIRED");
  return id;
};
async function terminal(execution: ProviderExecution, count: number) {
  await status(mission(execution), 11, 100);
  const result = await runtime.get(execution.taskId);
  expect(result?.state).toBe("SUCCEEDED");
  expect(result?.result).toMatchObject({
    status: "completed",
    inspectionReport: { findingCount: count },
  });
  if (!result) throw Error("TEST_RESULT_REQUIRED");
  expect(Array.isArray(result.result?.anomalies)).toBe(true);
  return result;
}

describe("ISOLATED inspection: real PostgreSQL, MQTT and HTTP Device MCP", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: config.databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(config.databaseUrl);
    url.searchParams.set("options", "-c search_path=" + schema);
    store = new PostgresProviderStore(url.toString(), 5);
    await runUgvProviderMigrations(store.pool);
    business = new PostgresTaskBusinessStore(store.pool);
    store.enableTaskBusinessSource(business);
    ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    });
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const address = socket.address();
    if (!address || typeof address === "string") throw Error("DEVICE_PORT_REQUIRED");
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    process_ = spawn(
      process.execPath,
      ["--import", "tsx", "apps/mock-ugv-device-mcp/src/main.ts"],
      { env: { ...process.env, MOCK_UGV_DEVICE_MCP_PORT: String(address.port) }, stdio: "ignore" },
    );
    await until(async () => {
      try {
        await fetch(`http://127.0.0.1:${address.port}/mcp`);
        return true;
      } catch {
        return false;
      }
    });
    device = new StreamableHttpUgvDeviceMcpClient(
      {
        url: `http://127.0.0.1:${address.port}/mcp`,
        timeoutMs: 5000,
        maxResponseBytes: 65536,
        useMockContractWhenUnavailable: true,
        contractReportPath: join(temp, "contract.json"),
      },
      store,
    );
    const hub = new UgvBusinessEventHub(store);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      "isr.vehicle.ugv.inspection-isolated",
      "vehicle:ugv1",
      (event) => hub.notifyCommittedTaskBusinessEvent(event),
    );
    runtime = new UgvProviderRuntime(
      {
        providerId: "isr.vehicle.ugv.inspection-isolated",
        resourceId: "vehicle:ugv1",
        entityId: "ugv1",
        executionMode: "simulation",
        inspectionEnabled: true,
        businessManualDecision: {
          maxWaitMs: 300000,
          onExpire: "release_and_resume_scan",
          onDismiss: "release_and_resume_scan",
        },
        fireEnabled: false,
        fireRequiresChassisStopped: true,
        freshness: {
          chassis: 600000,
          mission: 600000,
          health: 600000,
          target: 3000,
          payload: 600000,
        },
        allowNavigationWithRecon: true,
        pollIntervalMs: 60000,
        physicalConfirmationTimeoutMs: 1000,
        now: () => new Date(now),
      },
      store,
      ingress,
      device,
      hub,
      new UgvTelemetry({
        providerId: "isr.vehicle.ugv.inspection-isolated",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    await runtime.initializeLocal();
    mqtt = new UgvMqttClient(
      {
        url: config.brokerUrl,
        clientId: "inspection-native-" + suffix,
        tlsMode: "disabled",
        sessionMode: "clean",
        reconnectMinMs: 100,
        reconnectMaxMs: 1000,
      },
      ingress,
    );
    mqtt.start();
    publisher = connect(config.brokerUrl, {
      clientId: "inspection-publisher-" + suffix,
      reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => {
      publisher.once("connect", () => resolve());
      publisher.once("error", reject);
    });
    await new Promise<void>((resolve, reject) =>
      publisher.publish(
        "status/ugv",
        JSON.stringify({
          vehicle_id: "ugv1",
          role_name: "ugv",
          available: true,
          speed_kmh: 0,
          chassis_task: { state: -1, progress: 0 },
          eo_task: { state: -1, progress: 0 },
          weapon_task: { state: -1, progress: 0 },
        }),
        { qos: 1, retain: true },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    await until(() => ingress.snapshot().connectivity.mqttConnected);
    await runtime.initializeDependencies();
  }, 30000);
  afterAll(async () => {
    await mqtt?.stop();
    await publisher?.endAsync();
    await runtime?.close();
    process_?.kill("SIGTERM");
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
    rmSync(temp, { recursive: true, force: true });
  }, 30000);

  it("keeps inspection identity through RequiredInput and releases once after verified decline", async () => {
    const execution = await start("inspection-input-" + suffix);
    const id = mission(execution);
    await publish("/ugv/area_recon/status", {
      entity_id: "ugv1",
      mission_id: id,
      status: 5,
      scan_mode: 1,
      progress: 20,
      coverage: 20,
      online: true,
      lock: { stage: 3, target_id: 7, role_name: "", duration_sec: 0 },
    });
    const waiting = await runtime.get(execution.taskId);
    expect(waiting?.state).toBe("WAITING_INPUT");
    expect(waiting?.operationName).toBe("vehicle_inspect_area");
    const service = runtime.taskBusiness;
    const pending = service && waiting ? await service.activeRequiredInput(waiting) : undefined;
    if (!pending || !waiting) throw Error("INSPECTION_INPUT_REQUIRED");
    const identity = {
      taskId: waiting.taskId,
      externalExecutionId: waiting.externalExecutionId,
      operationName: waiting.operationName,
      argumentHash: waiting.argumentHash,
      executionContext: waiting.executionContext,
      commandSequence: "18",
    };
    const response = {
      inputs: [],
      inputResponses: [
        {
          key: pending.requestKey,
          result: jsonToProtoStruct({ action: "decline" }),
          verifiedResponder: jsonToProtoStruct({
            source: "jwt_hs256",
            actorType: "user",
            actorId: "isolated-operator",
          }),
        },
      ],
    };
    expect(await runtime.updateInput(identity, response)).toMatchObject({ accepted: true });
    const count = (await store.listMutationJournal(waiting.taskId)).length;
    expect(await runtime.updateInput(identity, response)).toMatchObject({ accepted: true });
    expect((await store.listMutationJournal(waiting.taskId)).length).toBe(count);
    await status(id, 5, 50);
    expect((await runtime.get(waiting.taskId))?.state).toBe("RUNNING");
    await targets(id, []);
    await terminal(waiting, 0);
    const context = await business.getContext(BoundExecutionScope.fromExecution(waiting));
    expect(context?.identity.operationName).toBe("vehicle_inspect_area");
  });
  it("persists discoveries, valid empty reports and source/mission isolation under the inspection identity", async () => {
    const first = await start("inspection-found-" + suffix);
    const firstTarget = target(101);
    await targets(mission(first), [firstTarget]);
    await targets(mission(first), [firstTarget]); // same source revision: no duplicate discovery
    const wrong = target(999);
    await targets("999999", [wrong]);
    const found = await terminal(first, 1);
    expect(found.result).toMatchObject({
      inspectionReport: { completion: "complete" },
      anomalies: [{ targetId: "101", x: 116.5, y: 39.5 }],
    });
    const context = await business.getContextSnapshot(BoundExecutionScope.fromExecution(found));
    expect(context?.context.identity.operationName).toBe("vehicle_inspect_area");
    expect(
      context?.objects.filter(
        (o) => o.kind === "artifact" && o.value.artifactType === "target.object",
      ),
    ).toHaveLength(1);
    const second = await start("inspection-empty-" + suffix);
    await targets(mission(first), [target(102)]); // old mission cannot enter the current task
    await targets(mission(second), []);
    const empty = await terminal(second, 0);
    expect(empty.result).toMatchObject({
      anomalies: [],
      inspectionReport: { completion: "complete", targetReportComplete: true },
      missingEvidence: [],
    });
  });
  it("distinguishes absent target reports and partial coverage from a qualified empty scan", async () => {
    const missing = await start("inspection-missing-" + suffix);
    const result = await terminal(missing, 0);
    expect(result.result).toMatchObject({
      inspectionReport: { completion: "unavailable" },
    });
    expect(result.result?.missingEvidence).toContain("INSPECTION_TARGET_REPORT_MISSING");
    const partial = await start("inspection-partial-" + suffix);
    await targets(mission(partial), []);
    await status(mission(partial), 11, 50);
    expect((await runtime.get(partial.taskId))?.result?.missingEvidence).toContain(
      "INSPECTION_COVERAGE_INCOMPLETE",
    );
    expect((await runtime.get(partial.taskId))?.result).toMatchObject({
      inspectionReport: { completion: "partial", coverageState: "partial" },
    });
  });
  it("archives mission-correlated exception facts as readable business Context", async () => {
    const execution = await start("inspection-events-" + suffix);
    await targets(mission(execution), []);
    await publish("/ugv/area_recon/exception", {
      entity_id: "ugv1",
      mission_id: mission(execution),
      kind: "object_loss",
      level: 1,
      time_us: (now + 5) * 1000,
      target_info: { reason: "simulated observation interruption" },
    });
    const result = await terminal(execution, 1);
    expect(result.result).toMatchObject({
      anomalies: [
        {
          kind: "recon_exception",
          exceptionKind: "object_loss",
          reason: "simulated observation interruption",
        },
      ],
    });
    const context = await business.getContext(BoundExecutionScope.fromExecution(result));
    expect(context?.summary.properties?.inspectionExceptions).toHaveLength(1);
  });

  it("uses native pause/resume/cancel and idempotent recovery without a second dispatch", async () => {
    const execution = await start("inspection-control-" + suffix);
    const identity = {
      taskId: execution.taskId,
      externalExecutionId: execution.externalExecutionId,
      operationName: execution.operationName,
      argumentHash: execution.argumentHash,
      executionContext: execution.executionContext,
      commandSequence: "1",
    };
    const pausedAck = await runtime.command("pause", identity);
    expect(pausedAck.accepted, JSON.stringify(pausedAck)).toBe(true);
    await status(mission(execution), 8);
    expect((await runtime.get(execution.taskId))?.state).toBe("PAUSED");
    expect((await runtime.command("resume", { ...identity, commandSequence: "2" })).accepted).toBe(
      true,
    );
    await status(mission(execution), 5);
    expect((await runtime.get(execution.taskId))?.state).toBe("RUNNING");
    const logsBefore = await store.listMutationJournal(execution.taskId);
    const options = runtime.options;
    await runtime.close();
    const url = new URL(config.databaseUrl);
    url.searchParams.set("options", "-c search_path=" + schema);
    store = new PostgresProviderStore(url.toString(), 5);
    business = new PostgresTaskBusinessStore(store.pool);
    store.enableTaskBusinessSource(business);
    device = new StreamableHttpUgvDeviceMcpClient({ ...device.options }, store);
    const hub = new UgvBusinessEventHub(store);
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      options.providerId,
      "vehicle:ugv1",
      (event) => hub.notifyCommittedTaskBusinessEvent(event),
    );
    runtime = new UgvProviderRuntime(
      options,
      store,
      ingress,
      device,
      hub,
      new UgvTelemetry({
        providerId: options.providerId,
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    await runtime.initializeLocal();
    await runtime.initializeDependencies();
    await runtime.recover();
    await runtime.start(startInput(execution.taskId));
    expect(await store.listMutationJournal(execution.taskId)).toEqual(logsBefore);
    expect((await runtime.command("cancel", { ...identity, commandSequence: "3" })).accepted).toBe(
      true,
    );
    await status(mission(execution), 9);
    const cancelled = await runtime.get(execution.taskId);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(cancelled?.result).toMatchObject({
      status: "cancelled",
      inspectionReport: { completion: "unavailable" },
    });
  });
  it("retains timeout when a late scan completion races an already requested stop", async () => {
    const execution = await start("inspection-late-complete-" + suffix);
    await targets(mission(execution), []);
    const identity = {
      ...startInput(execution.taskId),
      externalExecutionId: execution.externalExecutionId,
      commandSequence: "33",
    };
    expect(await runtime.command("cancel", identity)).toMatchObject({ accepted: true });
    const count = (await store.listMutationJournal(execution.taskId)).filter(
      (e) => e.phase === "CANCEL",
    ).length;
    now += 300001;
    await runtime.get(execution.taskId);
    expect(
      (await store.listMutationJournal(execution.taskId)).filter((e) => e.phase === "CANCEL"),
    ).toHaveLength(count);
    await status(mission(execution), 11, 100);
    const result = await runtime.get(execution.taskId);
    expect(result?.state).toBe("TECHNICAL_FAILED");
    expect(result?.result).toMatchObject({
      status: "timeout",
      inspectionReport: { completion: "partial" },
    });
  });
  it("stops at the fixed scan budget, waits for physical acknowledgement and retains a timeout report", async () => {
    const execution = await start("inspection-timeout-" + suffix);
    now += 300001;
    const stopping = await runtime.get(execution.taskId);
    expect(stopping?.state).toBe("STOPPING");
    await status(mission(execution), 9);
    const expired = await runtime.get(execution.taskId);
    expect(expired?.state).toBe("TECHNICAL_FAILED");
    expect(expired?.result).toMatchObject({
      status: "timeout",
    });
    expect(expired?.result?.missingEvidence).toContain("INSPECTION_TIME_BUDGET_EXPIRED");
    const journal = await store.listMutationJournal(execution.taskId);
    expect(journal.filter((item) => item.phase === "CANCEL")).toHaveLength(1);
  });
});
