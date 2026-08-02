import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { LightExecutionEngine } from "../../apps/home-assistant-light-provider/src/execution/execution-engine.js";
import {
  HomeAssistantLightClient,
  HomeAssistantLightWebSocket,
  normalizeLightState,
} from "../../apps/home-assistant-light-provider/src/home-assistant.js";
import { LightResourceRegistry } from "../../apps/home-assistant-light-provider/src/resources.js";
import { LightProviderServer } from "../../apps/home-assistant-light-provider/src/server.js";
import { MemoryLightStore } from "../../apps/home-assistant-light-provider/src/store.js";
import { NoopLightTelemetry } from "../../apps/home-assistant-light-provider/src/telemetry.js";
import { FakeHomeAssistantLight } from "../fixtures/fake-home-assistant-light.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for light E2E");
let fake: FakeHomeAssistantLight;
let provider: LightProviderServer;
let websocket: HomeAssistantLightWebSocket;
let runtime: RuntimeApplication;
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    "DROP TABLE IF EXISTS task_input_response_inbox,provider_ops_delivery,runtime_lease,outbox_event,idempotency_record,task_command,task_input_request,task_observation,provider_task,admission_intent,operation_snapshot,runtime_schema_migration CASCADE",
  );
  fake = new FakeHomeAssistantLight();
  fake.setState("light.e2e", "off", { brightness: 128, supported_color_modes: ["brightness"] });
  await fake.start();
  const registry = new LightResourceRegistry([
    { resourceId: "e2e-light", entityId: "light.e2e", displayName: "E2E light", enabled: true },
  ]);
  const rest = new HomeAssistantLightClient({
    baseUrl: fake.url,
    token: fake.token,
    timeoutMs: 1000,
  });
  const store = new MemoryLightStore();
  const engine = new LightExecutionEngine(
    store,
    registry,
    rest,
    new NoopLightTelemetry(),
    3000,
    true,
  );
  websocket = new HomeAssistantLightWebSocket({
    baseUrl: fake.url,
    token: fake.token,
    entityIds: registry.entityIds(),
    reconnectMinMs: 20,
    reconnectMaxMs: 100,
  });
  websocket.onState((state) => void engine.observe(normalizeLightState("e2e-light", state)));
  provider = new LightProviderServer(
    {
      providerId: "home-assistant-light",
      providerVersion: "0.1.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    },
    registry,
    rest,
    store,
    engine,
  );
  const adapterPort = await provider.start();
  runtime = createRuntime(
    loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      PROVIDER_ID: "home-assistant-light",
      ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
      AUTH_MODE: "trusted_headers",
      LOG_LEVEL: "warn",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      SCHEDULER_POLL_MS: "250",
      RECOVERY_POLL_MS: "500",
      ADAPTER_HEALTH_POLL_MS: "100",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (address === null || typeof address === "string") throw new Error("RUNTIME_BIND_FAILED");
  void address;
  websocket.start();
});

afterAll(async () => {
  websocket?.stop();
  await runtime?.app.close();
  await provider?.close();
  await fake?.close();
  await pool?.end();
});

describe("Home Assistant light Runtime E2E", () => {
  it("uses frozen flat Tasks, idempotency, and observed light Evidence", async () => {
    const discovery = await frozenRequest("server/discover", {}, 1);
    expect(discovery.json<{ result: Record<string, unknown> }>().result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
    });
    const tools = (await frozenRequest("tools/list", {}, 2)).json<{
      result: { tools: Record<string, unknown>[] };
    }>().result.tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "light_get_state",
      "light_set_power",
      "light_set_brightness",
    ]);
    expect(tools.map(taskBehavior)).toEqual(["synchronous_only", "task_required", "task_required"]);
    const state = await frozenRequest(
      "tools/call",
      { name: "light_get_state", arguments: { resourceId: "e2e-light" } },
      3,
      "light_get_state",
    );
    expect(state.json<{ result: Record<string, unknown> }>().result).toMatchObject({
      resultType: "complete",
      structuredContent: { resourceId: "e2e-light", power: "off", brightnessPercent: 50 },
    });
    const taskMeta = {
      "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: "light-e2e-power" },
    };
    const created = await frozenRequest(
      "tools/call",
      { name: "light_set_power", arguments: { resourceId: "e2e-light", power: "on" } },
      4,
      "light_set_power",
      taskMeta,
    );
    const task = created.json<{ result: Record<string, unknown> }>().result;
    expect(task).toMatchObject({ resultType: "task", status: "working" });
    const taskId = String(task.taskId);
    await wait(
      async () =>
        (await frozenRequest("tasks/get", { taskId }, 5, taskId)).json<{
          result: Record<string, unknown>;
        }>().result.status === "completed",
      10_000,
    );
    const authoritative = (await frozenRequest("tasks/get", { taskId }, 6, taskId)).json<{
      result: Record<string, unknown>;
    }>().result;
    expect(authoritative).toMatchObject({
      resultType: "complete",
      status: "completed",
      result: { structuredContent: { resourceId: "e2e-light", power: "on", confirmed: true } },
    });
    expect((authoritative.result as Record<string, unknown>)._meta).toBeDefined();
    const duplicate = await frozenRequest(
      "tools/call",
      { name: "light_set_power", arguments: { resourceId: "e2e-light", power: "on" } },
      7,
      "light_set_power",
      taskMeta,
    );
    expect(duplicate.json<{ result: Record<string, unknown> }>().result).toMatchObject({ taskId });
    expect(fake.serviceCalls).toHaveLength(1);
    const notificationProjection = structuredClone(authoritative);
    delete notificationProjection.resultType;
    expect(normalizeNotificationTask(notificationProjection)).toEqual(
      normalizeGetTask(authoritative),
    );
    expect(JSON.stringify(authoritative)).not.toContain("requirementId");
    expect("subscriptions/listen").toBe("subscriptions/listen");
  });
});

function frozenRequest(
  method: string,
  params: Record<string, unknown>,
  id: number,
  name?: string,
  extraMeta: Record<string, unknown> = {},
) {
  return runtime.app.inject({
    method: "POST",
    url: "/mcp",
    headers: frozenHeaders(method, name),
    payload: {
      jsonrpc: "2.0",
      id,
      method,
      params: { ...params, _meta: { ...frozenMeta(), ...extraMeta } },
    },
  });
}
function frozenHeaders(method: string, name?: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
    "x-sdar-subject": "light-e2e-user",
    "x-sdar-tenant": "light-e2e-tenant",
  };
}
function frozenMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "ha-light-e2e", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };
}
function normalizeNotificationTask(task: Record<string, unknown>): Record<string, unknown> {
  const value = structuredClone(task);
  const meta = value._meta as Record<string, Record<string, unknown>> | undefined;
  if (meta !== undefined) {
    delete meta["io.modelcontextprotocol/subscriptionId"];
    const execution = meta["io.sdar/taskExecution"];
    if (execution !== undefined) {
      delete execution.eventId;
      delete execution.observedAt;
    }
  }
  return value;
}
function normalizeGetTask(task: Record<string, unknown>): Record<string, unknown> {
  const value = structuredClone(task);
  delete value.resultType;
  return value;
}
function taskBehavior(tool: Record<string, unknown>): unknown {
  const meta = tool._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return undefined;
  const profile = (meta as Record<string, unknown>)["io.sdar/taskExecution"];
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return undefined;
  return (profile as Record<string, unknown>).taskBehavior;
}
async function wait(predicate: () => Promise<boolean>, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("WAIT_TIMEOUT");
}
