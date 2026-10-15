import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { AirportRoadPlanner } from "../../apps/ugv-provider-adapter/src/navigation-planner.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { openUgvTaskBusinessStore } from "../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";
import {
  BoundExecutionScope,
  PostgresProviderStore,
  type PostgresTaskBusinessStore,
} from "../../packages/provider-adapter-kit/src/index.js";
import { DISABLED_UGV_TASK_BUSINESS_SETTINGS } from "../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { UgvBusinessSemanticsSchema } from "../../packages/vehicle-provider-core/src/ugv-business-semantics.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL required for isolated development business wire test");
const suffix = randomUUID().replaceAll("-", "");
const runtimeSchema = `ugvb_dev_runtime_${suffix}`;
const providerSchema = `ugvb_dev_provider_${suffix}`;
const providerId = "isr.vehicle.ugv.development-wire";
const gps = (x: number, y = 100) => ({
  longitude: 106.81485 + x / 111320,
  latitude: 29.7195 + y / 110540,
});
let admin: Pool;
let runtime: RuntimeApplication;
let adapter: UgvProviderRuntime;
let server: UgvProviderServer;
let store: PostgresProviderStore;
let business: PostgresTaskBusinessStore;
let service: UgvTaskBusinessContextService;
let ingress: VehicleMqttIngress;
let device: MockUgvDeviceMcpClient;
let planner: WebSocketServer;
let endpoint: string;
let nextMission = 0;
let nativeMission = { id: -1, type: -1, state: -1, progress: 0 };
const manual = {
  maxWaitMs: 30000,
  onExpire: "release_and_resume_scan" as const,
  onDismiss: "release_and_resume_scan" as const,
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("EXPECTED_OBJECT");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("EXPECTED_ID");
  return value;
}
function ack(missionId: number) {
  return {
    mission_id: missionId,
    state: 0,
    state_label: "accepted",
    message: "accepted",
    error_code: 0,
  };
}

beforeAll(async () => {
  admin = new Pool({ connectionString: databaseUrl, max: 2 });
  await admin.query(`CREATE SCHEMA ${runtimeSchema}`);
  await admin.query(`CREATE SCHEMA ${providerSchema}`);
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.searchParams.set("options", `-c search_path=${runtimeSchema}`);
  const providerUrl = new URL(databaseUrl);
  providerUrl.searchParams.set("options", `-c search_path=${providerSchema}`);
  const migrations = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
  try {
    await runMigrations(migrations);
  } finally {
    await migrations.end();
  }
  store = new PostgresProviderStore(providerUrl.toString(), 4);
  await runUgvProviderMigrations(store.pool, resolve(import.meta.dirname, "../.."));
  await store.initialize();
  const opened = await openUgvTaskBusinessStore(store, {
    ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
    enabled: true,
    visualLockOwner: "provider",
    decisionMode: "user_required",
    coverage: { mode: "device_reported" },
  });
  if (!opened) throw new Error("BUSINESS_STORE_MISSING");
  business = opened;
  ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  });
  ingress.setConnected(true);
  base();
  device = new MockUgvDeviceMcpClient();
  device.handlers.set("ugv_path_follow_mission", () => ack(++nextMission));
  device.handlers.set("ugv_area_recon_configure", () => ({
    ...ack(++nextMission),
    res: true,
    fail_data: "",
  }));
  device.handlers.set("get_status", () => ({
    available: true,
    speed_kmh: 0,
    chassis_task: nativeMission,
  }));
  const hub = new UgvBusinessEventHub(store);
  service = new UgvTaskBusinessContextService(
    store,
    business,
    providerId,
    "vehicle:ugv1",
    (event) => hub.notifyCommittedTaskBusinessEvent(event),
  );
  // Controlled planner protocol fixture: actual WebSocket transport, never a field route claim.
  planner = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(planner, "listening");
  planner.on("connection", (socket) => {
    socket.send("0{}");
    socket.on("message", (data) => {
      const frame = (
        Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      ).toString("utf8");
      if (frame === "40") socket.send("40{}");
      else if (frame.startsWith("42")) {
        const event = JSON.parse(frame.slice(2)) as [string, { points: [number, number][] }];
        if (event[0] !== "plan_route") throw new Error("UNEXPECTED_PLANNER_EVENT");
        const points = [[-340, 100], ...event[1].points];
        socket.send(
          "42" +
            JSON.stringify([
              "route_candidates",
              {
                target: "ugv",
                ok: true,
                candidates: [
                  { id: "controlled-route", points, num_points: points.length, length_m: 148 },
                ],
              },
            ]),
        );
      }
    });
  });
  const address = planner.address();
  if (!address || typeof address === "string") throw new Error("PLANNER_BIND_FAILED");
  adapter = new UgvProviderRuntime(
    {
      providerId,
      resourceId: "vehicle:ugv1",
      entityId: "ugv1",
      // Omit executionMode deliberately: this must exercise the production live fallback.
      freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
      allowNavigationWithRecon: true,
      fireEnabled: false,
      fireRequiresChassisStopped: true,
      pollIntervalMs: 60000,
      stationaryStabilityMs: 0,
      stationaryMinimumSamples: 1,
      navigationPlanner: new AirportRoadPlanner(`http://127.0.0.1:${address.port}`),
      navigationAdjustments: true,
      businessVisualLockOwner: "provider",
      businessManualDecision: manual,
    },
    store,
    ingress,
    device,
    hub,
    new UgvTelemetry({
      providerId,
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    }),
    service,
  );
  await adapter.initialize();
  server = new UgvProviderServer(
    { providerId, providerVersion: "1.0.0", host: "127.0.0.1", port: 0, tlsMode: "disabled" },
    adapter,
    store,
    hub,
  );
  const port = await server.start();
  runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      PROVIDER_ID: providerId,
      DATABASE_URL: runtimeUrl.toString(),
      ADAPTER_ENDPOINT: `127.0.0.1:${port}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "development",
      LOG_LEVEL: "error",
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      BUSINESS_EVENTS_ENABLED: "true",
      SCHEDULER_POLL_MS: "100",
      RECOVERY_POLL_MS: "500",
      BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const runtimeAddress = runtime.app.server.address();
  if (!runtimeAddress || typeof runtimeAddress === "string") throw new Error("RUNTIME_BIND_FAILED");
  endpoint = `http://127.0.0.1:${runtimeAddress.port}/mcp`;
}, 30000);

afterAll(async () => {
  await runtime?.app.close();
  await server?.close();
  await adapter?.close();
  if (planner) {
    for (const socket of planner.clients) socket.terminate();
    await new Promise<void>((resolve) => planner.close(() => resolve()));
  }
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${providerSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`);
    await admin.end();
  }
});

function base() {
  const stamp = new Date().toISOString();
  ingress.handle("/ugv/gnss", Buffer.from(JSON.stringify(gps(-340))), false, stamp);
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      JSON.stringify({
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
    false,
    stamp,
  );
  ingress.handle(
    "status/ugv",
    Buffer.from(
      JSON.stringify({
        available: true,
        speed_kmh: 0,
        chassis_task: nativeMission,
        eo_task: { state: -1 },
        weapon_task: { state: -1 },
      }),
    ),
    false,
    stamp,
  );
}
async function rpc(
  method: string,
  params: Record<string, unknown>,
  name?: string,
  extraHeaders: Record<string, string> = {},
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "ugvb-dev-live-test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: {
              "io.modelcontextprotocol/tasks": {},
              "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
              "io.sdar/businessEvents": { profileVersion: "1.0" },
            },
          },
          ...record(params._meta ?? {}),
        },
      },
    }),
  });
  return { status: response.status, body: record(await response.json()) };
}
async function ok(method: string, params: Record<string, unknown>, name?: string) {
  const response = await rpc(method, params, name);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.error).toBeUndefined();
  return record(response.body.result);
}
async function create(name: string, args: Record<string, unknown>) {
  base();
  const result = await ok(
    "tools/call",
    {
      name,
      arguments: { resourceId: "vehicle:ugv1", ...args },
      _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: randomUUID() } },
    },
    name,
  );
  expect(result.resultType).toBe("task");
  return id(result.taskId);
}
async function execution(taskId: string) {
  const run = await store.getExecution(taskId);
  if (!run) throw new Error("EXECUTION_MISSING");
  return run;
}
async function context(taskId: string) {
  const r = await ok("io.sdar/taskBusiness/context/get", { taskId }, taskId);
  return TaskBusinessContextSchema.parse(record(r.snapshot).context);
}
async function until(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 80; i++) {
    // The controlled device keeps emitting position/health while native task
    // transitions remain explicit in recon()/mission(). Do not relax freshness.
    base();
    await adapter.pollActive();
    if (await check()) return;
    await delay(25);
  }
  throw new Error(`WAIT_FAILED:${label}`);
}
async function recon(taskId: string, status: number, stage = 1, targetId = 0, strict = false) {
  await delay(5);
  const run = await execution(taskId);
  const raw = {
    status,
    scan_mode: 1,
    out_of_range: false,
    camera_fault: false,
    online: true,
    recon_type: 2,
    lock: { stage, target_id: targetId },
    ...(strict ? { mission_id: run.downstreamMissionIds.at(-1) } : {}),
  };
  device.responses.set("ugv_area_recon_get_status", raw);
  ingress.handle(
    "/ugv/area_recon/status",
    Buffer.from(JSON.stringify(raw)),
    false,
    new Date().toISOString(),
  );
  await adapter.pollActive();
}
async function mission(missionId: number, state: number) {
  await delay(5);
  nativeMission = { id: missionId, type: 1, state, progress: 10 };
  base();
  ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify(nativeMission)),
    false,
    new Date().toISOString(),
  );
  await adapter.pollActive();
}

describe("development anonymous LIVE HTTP -> Runtime PostgreSQL -> gRPC -> UGV PostgreSQL (controlled device fixtures)", () => {
  it("queries semantic state without identity, execution-mode or scene headers", async () => {
    for (const name of ["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"]) {
      const result = await ok(
        "tools/call",
        { name, arguments: { resourceId: "vehicle:ugv1" } },
        name,
      );
      expect(
        UgvBusinessSemanticsSchema.safeParse(record(result.structuredContent).businessSemantics)
          .success,
      ).toBe(true);
    }
    base();
    ingress.handle(
      "/ugv/area_recon/targets",
      Buffer.from(JSON.stringify({ targets: [] })),
      false,
      new Date().toISOString(),
    );
    ingress.handle(
      "/ugv/area_recon/status",
      Buffer.from(JSON.stringify({ status: 1, scan_mode: 1, online: true })),
      false,
      new Date().toISOString(),
    );
    const blocked = await ok("io.sdar/taskExecution/checkAvailability", {
      profileVersion: "1.0",
      checks: [
        {
          requestId: "fire-disabled",
          operationName: "vehicle_fire_weapon",
          arguments: {
            state: "complete",
            value: {
              resourceId: "vehicle:ugv1",
              targetId: "7",
              engagementMode: "single",
              requireConfirmation: true,
            },
          },
        },
      ],
    });
    // Availability reports the first failed precondition; no target is present here.
    expect(blocked.results).toMatchObject([{ availability: "disabled" }]);
    expect(adapter.options.fireEnabled).toBe(false);
    expect(device.calls.some((call) => call.name === "ugv_area_recon_attack_confirm")).toBe(false);
  });

  it.each(["accept", "decline", "cancel"] as const)(
    "answers inferred Recon %s through durable anonymous input and confirms release/cancel",
    async (action) => {
      const taskId = await create("vehicle_area_recon", { scanMode: "circular", scanCount: 1 });
      expect((await execution(taskId)).executionContext).toMatchObject({ executionMode: "LIVE" });
      await recon(taskId, 5);
      await delay(5);
      ingress.handle(
        "/ugv/area_recon/targets",
        Buffer.from(
          JSON.stringify({ targets: [{ target_id: 7, capture_time_us: Date.now() * 1000 }] }),
        ),
        false,
        new Date().toISOString(),
      );
      await adapter.pollActive();
      expect(device.calls.at(-1)).toMatchObject({
        name: "ugv_area_recon_lock",
        arguments: {
          lock: true,
          target_id: 7,
          mission_id: Number((await execution(taskId)).downstreamMissionIds.at(-1)),
        },
      });
      expect(await service.activeRequiredInput(await execution(taskId))).toBeUndefined();
      await recon(taskId, 8, 2, 7);
      expect(await service.activeRequiredInput(await execution(taskId))).toBeUndefined();
      await recon(taskId, 8, 3, 7);
      expect(await service.activeRequiredInput(await execution(taskId))).toMatchObject({
        state: "pending",
      });
      expect((await execution(taskId)).state).toBe("WAITING_INPUT");
      await until(
        async () => (await ok("tasks/get", { taskId }, taskId)).status === "input_required",
        "Runtime input projection",
      );
      const waiting = await ok("tasks/get", { taskId }, taskId);
      expect(waiting.status).toBe("input_required");
      const keys = Object.keys(record(waiting.inputRequests));
      expect(keys).toHaveLength(1);
      const requestKey = id(keys[0]);
      const response =
        action === "accept"
          ? { action, content: { decision: "continue_observation" } }
          : { action };
      const forged = await rpc(
        "tasks/update",
        {
          taskId,
          inputResponses: { [requestKey]: { ...response, respondedBy: { type: "user" } } },
        },
        taskId,
      );
      expect(forged.status).toBe(400);
      const foreign = await rpc(
        "tasks/update",
        { taskId, inputResponses: { [requestKey]: response } },
        taskId,
        { "x-sdar-subject": "unrelated" },
      );
      expect(foreign.status).not.toBe(200);
      await ok("tasks/update", { taskId, inputResponses: { [requestKey]: response } }, taskId);
      await until(
        async () => !(await service.activeRequiredInput(await execution(taskId))),
        "anonymous input application",
      );
      const scope = BoundExecutionScope.fromExecution(await execution(taskId));
      const ref = (await business.getContext(scope))?.requiredInputRefs.at(-1);
      if (!ref) throw new Error("INPUT_REF_MISSING");
      expect(await business.getObjectVersion(scope, ref)).toMatchObject({
        kind: "input_request",
        value: {
          state: action === "accept" ? "answered" : action === "decline" ? "declined" : "cancelled",
        },
      });
      const audit = await runtime.pool.query<{ response_json: unknown }>(
        "SELECT response_json FROM task_input_response_inbox WHERE task_id=$1",
        [taskId],
      );
      expect(JSON.stringify(audit.rows)).toContain("development_anonymous");
      if (action !== "accept")
        expect((await execution(taskId)).controlConfirmation?.command).toBe("input_release");
      await recon(taskId, 5, 1, 0);
      expect((await execution(taskId)).controlConfirmation).toBeUndefined();
      await ok("tasks/cancel", { taskId }, taskId);
      await until(
        async () =>
          device.calls.some(
            (c) =>
              c.taskId === taskId &&
              c.name === "ugv_area_recon_control" &&
              c.arguments.cmd_type === 4,
          ),
        "recon cancel dispatch",
      );
      await recon(taskId, 9);
      await until(
        async () => (await ok("tasks/get", { taskId }, taskId)).status === "cancelled",
        "Runtime cancelled projection",
      );
    },
    20000,
  );

  it("adopts a live route, pauses/resumes, applies anonymous guarded adjustment, and confirms cancellation", async () => {
    const taskId = await create("vehicle_navigate", {
      mission: { type: "point", target: gps(-192) },
      planningMode: "road_network",
    });
    const original = Number((await execution(taskId)).downstreamMissionIds.at(-1));
    await mission(original, 1);
    await mission(original, 1);
    await until(
      async () =>
        record(record((await ok("tasks/get", { taskId }, taskId))._meta)["io.sdar/taskExecution"])
          .substate === "running",
      "Runtime running projection",
    );
    await ok("io.sdar/taskExecution/tasks/pause", { taskId }, taskId);
    await until(
      async () => (await execution(taskId)).controlConfirmation?.command === "pause",
      "pause dispatch",
    );
    await mission(original, 2);
    await mission(original, 2);
    await until(
      async () =>
        record(record((await ok("tasks/get", { taskId }, taskId))._meta)["io.sdar/taskExecution"])
          .substate === "paused",
      "anonymous pause confirmation",
    );
    await ok("io.sdar/taskExecution/tasks/resume", { taskId }, taskId);
    await until(async () => (await execution(taskId)).state === "RESUMING", "resume dispatch");
    await mission(original, 1);
    await mission(original, 1);
    await until(
      async () =>
        record(record((await ok("tasks/get", { taskId }, taskId))._meta)["io.sdar/taskExecution"])
          .substate === "running",
      "anonymous resume confirmation",
    );
    const current = await context(taskId);
    expect(current.activeRefs.route).toBeDefined();
    const intervention = current.activeRefs.navigationAdjustment;
    if (!intervention) throw new Error("ADJUSTMENT_MISSING");
    const command = {
      schemaVersion: "sdar.runtime-intervention-command/1.0-rc2",
      commandId: randomUUID(),
      taskId,
      executionId: current.identity.executionId,
      interventionId: intervention.id,
      guard: {
        mode: "semantic",
        expectedInterventionRevision: intervention.revision,
        expectedEffectivePlanRevision: current.effectivePlanRevision,
      },
      input: { waypoints: [gps(-140)], density: "adaptive" },
    };
    for (const invalid of [
      { ...command, executionId: randomUUID() },
      {
        ...command,
        guard: { ...command.guard, expectedInterventionRevision: intervention.revision + 1 },
      },
      {
        ...command,
        guard: {
          ...command.guard,
          expectedEffectivePlanRevision: current.effectivePlanRevision + 1,
        },
      },
    ]) {
      const invalidCommand = { ...invalid, commandId: randomUUID() };
      const rejected = await rpc(
        "io.sdar/taskBusiness/interventions/apply",
        invalidCommand,
        taskId,
      );
      if (invalidCommand.executionId !== current.identity.executionId) {
        expect(JSON.stringify(rejected.body.error)).toContain("BUSINESS_EXECUTION_ID_MISMATCH");
      } else {
        // Runtime durably receives a well-formed intent; Provider checks business revisions.
        expect(record(record(rejected.body.result).receipt).durablyAccepted).toBe(true);
        await until(async () => {
          const receipt = await ok(
            "io.sdar/taskBusiness/interventions/apply",
            invalidCommand,
            taskId,
          );
          return record(receipt.receipt).commandState === "REJECTED";
        }, "asynchronous intervention guard rejection");
        const rejectedReceipt = await ok(
          "io.sdar/taskBusiness/interventions/apply",
          invalidCommand,
          taskId,
        );
        expect(record(rejectedReceipt.receipt).reasonCode).toBe(
          invalidCommand.guard.expectedInterventionRevision !== intervention.revision
            ? "INTERVENTION_REVISION_CONFLICT"
            : "PLAN_REVISION_CONFLICT",
        );
      }
      expect(
        await business.getCommand(
          BoundExecutionScope.fromExecution(await execution(taskId)),
          invalidCommand.commandId,
        ),
      ).toBeUndefined();
      expect((await execution(taskId)).navigationReplacement).toBeUndefined();
      expect((await context(taskId)).effectivePlanRevision).toBe(current.effectivePlanRevision);
    }
    const receipt = await ok("io.sdar/taskBusiness/interventions/apply", command, taskId);
    expect(receipt.receipt).toMatchObject({ durablyAccepted: true, businessApplied: false });
    const duplicate = await ok("io.sdar/taskBusiness/interventions/apply", command, taskId);
    expect(duplicate.receipt).toMatchObject({ durablyAccepted: true });
    const conflict = await rpc(
      "io.sdar/taskBusiness/interventions/apply",
      { ...command, input: { waypoints: [gps(-130)] } },
      taskId,
    );
    expect(conflict.status).not.toBe(200);
    expect(JSON.stringify(conflict.body)).toContain("COMMAND_ID_CONFLICT");
    await until(async () => {
      const run = await execution(taskId);
      const reply = await ok("io.sdar/taskBusiness/interventions/apply", command, taskId);
      expect(record(reply.receipt).commandState, JSON.stringify(reply)).not.toBe("REJECTED");
      expect(run.navigationReplacement?.phase, run.reasonCode).not.toBe("failed");
      return run.navigationReplacement?.phase === "stopping";
    }, "adjustment stopping");
    await mission(original, 3);
    await mission(original, 3);
    await until(
      async () => Boolean((await execution(taskId)).navigationReplacement?.missionId),
      "replacement mission",
    );
    const replacement = Number((await execution(taskId)).navigationReplacement?.missionId);
    await mission(replacement, 1);
    await mission(replacement, 1);
    await until(
      async () =>
        (await context(taskId)).effectivePlanRevision === current.effectivePlanRevision + 1,
      "route adoption",
    );
    const scope = BoundExecutionScope.fromExecution(await execution(taskId));
    expect(await business.getCommand(scope, command.commandId)).toMatchObject({ state: "applied" });
    const audit = await runtime.pool.query<{ payload: unknown }>(
      "SELECT payload FROM task_command WHERE task_id=$1 AND command_type='INTERVENTION'",
      [taskId],
    );
    expect(JSON.stringify(audit.rows)).toContain("development_anonymous");
    expect(JSON.stringify(audit.rows)).toContain('"verified":false');
    await ok("tasks/cancel", { taskId }, taskId);
    await until(async () => (await execution(taskId)).state === "STOPPING", "navigation cancel");
    await mission(replacement, 3);
    await mission(replacement, 3);
    await until(
      async () => (await ok("tasks/get", { taskId }, taskId)).status === "cancelled",
      "Runtime cancelled projection",
    );
  }, 30000);
});
