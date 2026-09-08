import { requireValue } from "../../packages/gowm-shared-storage-adapter/src/value.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, it, expect } from "vitest";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  VehicleMqttIngress,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { loadGowmStorageConfig } from "../../packages/gowm-shared-storage-adapter/src/index.js";
const url = process.env.SMPP_GOWM_TEST_DATABASE_URL;
if (process.env.SMPP_GOWM_TEST_ENABLE !== "true" || !url || !new URL(url).pathname.includes("test"))
  throw Error("NOT_RUN: explicit isolated test database required");
const appUrl = process.env.SMPP_GOWM_TEST_APP_DATABASE_URL ?? url;
const applicationTarget = new URL(requireValue(appUrl));
const fixtureTarget = new URL(requireValue(url));
if (
  applicationTarget.host !== fixtureTarget.host ||
  applicationTarget.pathname !== fixtureTarget.pathname
)
  throw Error("APP_AND_FIXTURE_DATABASE_MISMATCH");
const admin = new Pool({ connectionString: url });
const cleanup: (() => Promise<unknown>)[] = [() => admin.end()];
afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn();
});
async function request(
  runtime: RuntimeApplication,
  method: string,
  params: Record<string, unknown>,
  name: string,
) {
  const result = await runtime.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "mcp-name": name,
      "x-sdar-subject": "test-user",
      "x-sdar-tenant": "test",
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "same-simulation",
    },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "smpp-gowm-source-smoke", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
          "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: "same-text" },
        },
      },
    },
  });
  const body = result.json<{ error?: unknown; result?: Record<string, unknown> }>();
  expect(body.error, JSON.stringify(body)).toBeUndefined();
  return requireValue(body.result);
}
it("two real source Runtime/UGV instances write the MCP → Execution → Dispatch → Mission chain", async () => {
  const run = randomUUID(),
    scope = `TEST:smpp-source-${run}`;
  await admin.query<Record<string, unknown>>(
    "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','software simulator source smoke')",
    [scope],
  );
  const instances = [];
  for (const letter of ["A", "B"]) {
    const id = `smpp-source-${run}-${letter}`,
      binding = randomUUID(),
      resource = `vehicle:test-${run}-${letter}`,
      entity = `test-${letter}`;
    await admin.query<Record<string, unknown>>(
      "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
      [id, scope],
    );
    await admin.query<Record<string, unknown>>(
      `INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type)
      VALUES($1,$2,$3,$4,$4,'UGV')`,
      [id, scope, run, letter],
    );
    await admin.query<Record<string, unknown>>(
      `INSERT INTO gowm_device.device_service_binding(binding_id,device_id,data_scope_key,smpp_service_key,provider_id,resource_id)
      VALUES($1,$2,$3,'source-test-smpp','source-test-ugv',$4)`,
      [binding, id, scope, resource],
    );
    const env = {
      SMPP_STORAGE_MODE: "gowm-shared",
      GOWM_DATABASE_URL: appUrl,
      SMPP_SERVICE_KEY: "source-test-smpp",
      SMPP_ALLOWED_DEVICE_IDS: JSON.stringify([id]),
      SMPP_GOWM_BINDING_ID: binding,
      SMPP_SOURCE_SESSION_KEY: `test-connection-${letter}`,
    };
    const store = new PostgresProviderStore(
      requireValue(appUrl),
      8,
      "ugv",
      loadGowmStorageConfig(env),
    );
    const identity = {
      providerId: "source-test-ugv",
      resourceId: resource,
      entityId: entity,
      vehicleType: "ugv",
      executionMode: "simulation" as const,
    };
    const ingress = new VehicleMqttIngress(
      "direct_domain_json",
      { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
      ugvMqttProfile(identity),
    );
    ingress.setConnected(true);
    ingress.handle(
      "/ugv/gnss",
      Buffer.from(JSON.stringify({ entity_id: entity, latitude: 30.1, longitude: 114.1 })),
    );
    ingress.handle(
      "/ugv/component_status",
      Buffer.from(
        JSON.stringify({
          entity_id: entity,
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
        }),
      ),
    );
    const device = new MockUgvDeviceMcpClient();
    for (const contract of device.contracts())
      if (contract.name === "ugv_path_follow_mission")
        device.responses.set(contract.name, {
          mission_id: 7,
          state: 0,
          state_label: "accepted",
          message: "test",
          error_code: 0,
        });
    const telemetry = new UgvTelemetry({
      providerId: identity.providerId,
      resourceId: resource,
      enabled: false,
      endpoint: "127.0.0.1:1",
      tlsMode: "disabled",
    });
    const events = new UgvBusinessEventHub(store, resource);
    const provider = new UgvProviderRuntime(
      {
        providerId: identity.providerId,
        resourceId: resource,
        entityId: entity,
        executionMode: "simulation",
        freshness: { chassis: 30000, mission: 30000, health: 30000, target: 30000, payload: 30000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        stationaryStabilityMs: 0,
        pollIntervalMs: 60000,
      },
      store,
      ingress,
      device,
      events,
      telemetry,
    );
    cleanup.push(() => provider.close());
    await provider.initializeLocal();
    await provider.initializeDependencies();
    const server = new UgvProviderServer(
      {
        providerId: identity.providerId,
        providerVersion: "1.0.0",
        identity,
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      provider,
      store,
      events,
    );
    const port = await server.start();
    cleanup.push(() => server.close());
    const config = loadRuntimeConfig({
      ...env,
      PROVIDER_ID: identity.providerId,
      ADAPTER_ENDPOINT: `127.0.0.1:${port}`,
      AUTH_MODE: "trusted_headers",
      LOG_LEVEL: "error",
      BUSINESS_EVENTS_ENABLED: "true",
      OTEL_ENABLED: "false",
    });
    const runtime = createRuntime(config);
    cleanup.push(() => runtime.app.close());
    await runtime.initialize();
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const navigate = () =>
      request(
        runtime,
        "tools/call",
        {
          name: "vehicle_navigate",
          arguments: {
            resourceId: resource,
            mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
            speedLimitKmh: 20,
            stopOnObstacle: true,
          },
        },
        "vehicle_navigate",
      );
    const result = await navigate();
    const replay = await navigate();
    expect(replay.taskId).toBe(result.taskId);
    expect(device.calls.filter((c) => c.name === "ugv_path_follow_mission")).toHaveLength(1);
    expect(result.resultType, JSON.stringify(result)).toBe("task");
    instances.push({
      config,
      id,
      runtime,
      provider,
      device,
      ingress,
      entity,
      taskId: result.taskId as string,
    });
  }
  for (const instance of instances) {
    const chain = await admin.query<Record<string, unknown>>(
      `SELECT t.task_id,e.external_execution_id,j.step_id,l.mission_instance_id,i.native_mission_id
      FROM gowm_business_v1.mcp_tasks t JOIN gowm_business_v1.provider_executions e ON e.device_id=t.device_id AND e.mcp_task_id=t.task_id
      JOIN gowm_business_v1.provider_dispatches j ON j.device_id=e.device_id AND j.task_id=e.task_id
      JOIN gowm_business_v1.mission_links l ON l.device_id=e.device_id AND l.provider_task_record_id=e.task_id AND l.provider_dispatch_step_id=j.step_id
      JOIN gowm_execution.mission_identity i ON i.device_id=l.device_id AND i.mission_instance_id=l.mission_instance_id
      WHERE t.device_id=$1 AND t.task_id=$2 AND l.link_state='LINKED'`,
      [instance.id, instance.taskId],
    );
    expect(chain.rows.length).toBeGreaterThan(0);
    expect(chain.rows[0]?.native_mission_id).toBe("7");
    const snapshot = await request(
      instance.runtime,
      "tasks/get",
      { taskId: instance.taskId },
      instance.taskId,
    );
    expect(snapshot.taskId).toBe(instance.taskId);
  }
  const missions = await admin.query<Record<string, unknown>>(
    "SELECT count(DISTINCT mission_instance_id)::int n FROM gowm_execution.device_mission WHERE device_id=ANY($1)",
    [instances.map((x) => x.id)],
  );
  expect(missions.rows[0]?.n).toBe(2);
  const a = requireValue(instances[0]),
    b = requireValue(instances[1]);
  const starts = (device: MockUgvDeviceMcpClient) =>
    device.calls.filter((c) => c.name === "ugv_path_follow_mission").length;
  const before = starts(a.device);
  a.runtime.beginDrain();
  await a.runtime.app.close();
  const restarted = createRuntime(a.config);
  cleanup.push(() => restarted.app.close());
  await restarted.initialize();
  await restarted.app.listen({ host: "127.0.0.1", port: 0 });
  expect((await request(restarted, "tasks/get", { taskId: a.taskId }, a.taskId)).taskId).toBe(
    a.taskId,
  );
  expect(starts(a.device)).toBe(before);
  const bControls = b.device.calls.filter((c) => c.name === "ugv_mission_control").length;
  await request(restarted, "tasks/cancel", { taskId: a.taskId }, a.taskId);
  const deadline = Date.now() + 5000;
  while (
    !a.device.calls.some(
      (c) => c.name === "ugv_mission_control" && c.arguments.action === "terminate",
    )
  ) {
    if (Date.now() > deadline)
      throw Error("CANCEL_DISPATCH_TIMEOUT:" + JSON.stringify(a.device.calls));
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(b.device.calls.filter((c) => c.name === "ugv_mission_control").length).toBe(bControls);
  expect(starts(a.device)).toBe(before);
  expect((await request(b.runtime, "tasks/get", { taskId: b.taskId }, b.taskId)).status).toBe(
    "working",
  );
  // A simulator receiving the command precedes the asynchronous receipt commit.
  await expect
    .poll(
      async () => {
        const controls = await admin.query<{ n: number }>(
          `SELECT count(*)::int n FROM gowm_business_v1.mission_links WHERE device_id=$1 AND relation_kind='CONTROLLED' AND link_state='LINKED'`,
          [a.id],
        );
        return controls.rows[0]?.n ?? 0;
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  b.ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify({ entity_id: b.entity, id: 7, type: 1, state: 1, progress: 50 })),
  );
  await b.provider.pollActive();
  b.ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify({ entity_id: b.entity, id: 7, type: 1, state: 4, progress: 100 })),
  );
  b.ingress.handle(
    "/ugv/gnss",
    Buffer.from(JSON.stringify({ entity_id: b.entity, latitude: 30.1001, longitude: 114.1001 })),
  );
  const observedAt = Date.now();
  b.ingress.handle(
    "/ugv/speed",
    Buffer.from(JSON.stringify({ entity_id: b.entity, speed_kmh: 0.05 })),
    false,
    new Date(observedAt).toISOString(),
  );
  await b.provider.pollActive();
  b.ingress.handle(
    "/ugv/speed",
    Buffer.from(JSON.stringify({ entity_id: b.entity, speed_kmh: 0 })),
    false,
    new Date(observedAt + 1).toISOString(),
  );
  await b.provider.pollActive();
  const completedBy = Date.now() + 5000;
  for (;;) {
    const value = await request(b.runtime, "tasks/get", { taskId: b.taskId }, b.taskId);
    if (value.status === "completed") break;
    if (Date.now() > completedBy) throw Error("B_TERMINAL_TIMEOUT:" + JSON.stringify(value));
    await new Promise((r) => setTimeout(r, 25));
  }
}, 30000);
