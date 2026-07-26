import { createServer } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { ClimateExecutionEngine } from "../../apps/home-assistant-climate-provider/src/execution.js";
import {
  HomeAssistantClimateClient,
  HomeAssistantClimateWebSocket,
  normalizeClimateState,
} from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { ClimateProviderServer } from "../../apps/home-assistant-climate-provider/src/server.js";
import { MemoryClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { ProviderClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import { FakeHomeAssistantClimate } from "../fixtures/fake-home-assistant-climate.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for climate E2E");
let fake: FakeHomeAssistantClimate;
let provider: ClimateProviderServer;
let ws: HomeAssistantClimateWebSocket;
let telemetry: ProviderClimateTelemetry;
let runtime: RuntimeApplication;
let runtimeUrl: URL;
let pool: Pool;
beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `DROP TABLE IF EXISTS provider_ops_delivery,runtime_lease,outbox_event,idempotency_record,task_command,task_input_request,task_observation,provider_task,admission_intent,operation_snapshot,runtime_schema_migration CASCADE`,
  );
  fake = new FakeHomeAssistantClimate();
  fake.setState("climate.e2e", "off", {
    current_temperature: 28,
    temperature: 24,
    min_temp: 16,
    max_temp: 30,
    hvac_modes: ["cool", "heat"],
    temperature_unit: "°C",
  });
  await fake.start();
  const telemetryPort = await freePort();
  const registry = new ClimateResourceRegistry([
    {
      resourceId: "e2e-climate",
      entityId: "climate.e2e",
      displayName: "E2E AC",
      enabled: true,
      temperatureRange: { minimum: 16, maximum: 30 },
      allowedHvacModes: ["cool", "heat"],
    },
  ]);
  const rest = new HomeAssistantClimateClient({
    baseUrl: fake.url,
    token: fake.token,
    timeoutMs: 1000,
  });
  const store = new MemoryClimateStore();
  telemetry = new ProviderClimateTelemetry(
    {
      providerId: "home-assistant-climate",
      endpoint: `127.0.0.1:${String(telemetryPort)}`,
      enabled: true,
      tlsMode: "disabled",
    },
    registry,
    store,
  );
  const engine = new ClimateExecutionEngine(store, registry, rest, telemetry, 3000);
  ws = new HomeAssistantClimateWebSocket({
    baseUrl: fake.url,
    token: fake.token,
    entityIds: registry.entityIds(),
    reconnectMinMs: 20,
    reconnectMaxMs: 100,
  });
  ws.onState((state) => void engine.observe(normalizeClimateState("e2e-climate", state)));
  provider = new ClimateProviderServer(
    {
      providerId: "home-assistant-climate",
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
  const providerPort = await provider.start();
  runtime = createRuntime(
    loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      PROVIDER_ID: "home-assistant-climate",
      ADAPTER_ENDPOINT: `127.0.0.1:${String(providerPort)}`,
      AUTH_MODE: "trusted_headers",
      LOG_LEVEL: "warn",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
      PROVIDER_TELEMETRY_HOST: "127.0.0.1",
      PROVIDER_TELEMETRY_PORT: String(telemetryPort),
      PROVIDER_TELEMETRY_TLS_MODE: "disabled",
      SCHEDULER_POLL_MS: "5000",
      RECOVERY_POLL_MS: "5000",
      ADAPTER_HEALTH_POLL_MS: "100",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (address === null || typeof address === "string") throw new Error("RUNTIME_BIND_FAILED");
  runtimeUrl = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  telemetry.start();
  ws.start();
});
afterAll(async () => {
  ws.stop();
  telemetry.stop();
  await runtime.app.close();
  await provider.close();
  await fake.close();
  await pool.end();
});
describe("Home Assistant climate Runtime E2E", () => {
  it("uses frozen flat Tasks, Ack-first notifications and observed climate Evidence", async () => {
    const discovery = await frozenRequest("server/discover", {}, 1);
    expect(discovery.json<{ result: Record<string, unknown> }>().result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
    });
    const toolsResponse = await frozenRequest("tools/list", {}, 2);
    const tools = toolsResponse.json<{ result: { tools: Record<string, unknown>[] } }>().result
      .tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "climate_get_state",
      "climate_set_power",
      "climate_set_hvac_mode",
      "climate_set_temperature",
    ]);
    expect(tools.map(taskBehavior)).toEqual([
      "synchronous_only",
      "task_required",
      "task_required",
      "task_required",
    ]);
    const state = await frozenRequest(
      "tools/call",
      { name: "climate_get_state", arguments: { resourceId: "e2e-climate" } },
      3,
      "climate_get_state",
    );
    expect(state.json<{ result: Record<string, unknown> }>().result).toMatchObject({
      resultType: "complete",
      isError: false,
      structuredContent: { resourceId: "e2e-climate", power: "off" },
      _meta: {
        "io.sdar/evidence": {
          items: [
            expect.objectContaining({
              evidenceType: "climate.state.observation",
              payloadRef: { kind: "structured_content", jsonPointer: "/hvacMode" },
            }),
          ],
        },
      },
    });

    fake.applyDelayMs = 300;
    const taskMeta = {
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        idempotencyKey: "climate-e2e-temperature",
      },
    };
    const createResponse = await frozenRequest(
      "tools/call",
      {
        name: "climate_set_temperature",
        arguments: { resourceId: "e2e-climate", targetTemperature: 22 },
      },
      4,
      "climate_set_temperature",
      taskMeta,
    );
    const created = createResponse.json<{ result: Record<string, unknown> }>().result;
    expect(created).toMatchObject({ resultType: "task", status: "working" });
    expect(created).not.toHaveProperty("task");
    const taskId = String(created.taskId);
    const subscription = await openFrozenSubscription(
      runtimeUrl,
      taskId,
      "ha-climate-subscription",
    );
    expect(await subscription.next()).toMatchObject({
      method: "notifications/subscriptions/acknowledged",
      params: { notifications: { taskIds: [taskId] } },
    });
    await subscription.nextUntil(
      (message) =>
        message.method === "notifications/tasks" &&
        (message.params as Record<string, unknown>).status === "working",
    );
    const completedMessage = await subscription.nextUntil(
      (message) =>
        message.method === "notifications/tasks" &&
        (message.params as Record<string, unknown>).status === "completed",
    );
    const completedTask = completedMessage.params as Record<string, unknown>;
    const getResponse = await frozenRequest("tasks/get", { taskId }, 5, taskId);
    const authoritative = getResponse.json<{ result: Record<string, unknown> }>().result;
    expect(normalizeNotificationTask(completedTask)).toEqual(normalizeGetTask(authoritative));
    expect(completedTask).toMatchObject({
      result: {
        resultType: "complete",
        structuredContent: { targetTemperature: 22, confirmed: true },
        _meta: {
          "io.sdar/evidence": {
            items: [
              expect.objectContaining({
                evidenceType: "climate.target_temperature.observation",
                payloadRef: {
                  kind: "structured_content",
                  jsonPointer: "/targetTemperature",
                },
              }),
            ],
          },
        },
      },
    });
    expect(JSON.stringify(completedTask)).not.toContain("requirementId");
    await subscription.close();

    const duplicate = await frozenRequest(
      "tools/call",
      {
        name: "climate_set_temperature",
        arguments: { resourceId: "e2e-climate", targetTemperature: 22 },
      },
      6,
      "climate_set_temperature",
      taskMeta,
    );
    expect(duplicate.json<{ result: Record<string, unknown> }>().result).toMatchObject({ taskId });
    expect(fake.serviceCalls).toHaveLength(1);
    await wait(async () => {
      const result = await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM provider_ops_delivery",
      );
      return Number(result.rows[0]?.count ?? 0) >= 4;
    });
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
    "x-sdar-subject": "e2e-user",
    "x-sdar-tenant": "e2e-tenant",
  };
}

function frozenMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "ha-climate-e2e", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };
}

async function openFrozenSubscription(url: URL, taskId: string, requestId: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    method: "POST",
    signal: controller.signal,
    headers: frozenHeaders("subscriptions/listen"),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "subscriptions/listen",
      params: { notifications: { taskIds: [taskId] }, _meta: frozenMeta() },
    }),
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE_RESPONSE_BODY_MISSING");
  const decoder = new TextDecoder();
  let buffer = "";
  const messages: Record<string, unknown>[] = [];
  const next = async (): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const queued = messages.shift();
      if (queued !== undefined) return queued;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`SSE_MESSAGE_TIMEOUT:${requestId}`);
      const read = await withTimeout(reader.read(), remaining);
      if (read.done) throw new Error(`SSE_STREAM_CLOSED:${requestId}`);
      const chunk: unknown = read.value;
      if (!(chunk instanceof Uint8Array)) throw new Error(`SSE_BYTES_INVALID:${requestId}`);
      buffer += decoder.decode(chunk, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data.length === 0) continue;
        messages.push(JSON.parse(data) as Record<string, unknown>);
      }
    }
  };
  return {
    next,
    async nextUntil(predicate: (message: Record<string, unknown>) => boolean) {
      for (;;) {
        const message = await next();
        if (predicate(message)) return message;
      }
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

function normalizeNotificationTask(task: Record<string, unknown>): Record<string, unknown> {
  const value = structuredClone(task);
  const meta = value._meta as Record<string, Record<string, unknown>>;
  delete meta["io.modelcontextprotocol/subscriptionId"];
  const execution = meta["io.sdar/taskExecution"];
  if (execution !== undefined) {
    delete execution.eventId;
    delete execution.observedAt;
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SSE_READ_TIMEOUT")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const a = s.address();
  if (a === null || typeof a === "string") throw new Error("PORT_FAILED");
  const p = a.port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return p;
}
async function wait(fn: () => Promise<boolean>, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("WAIT_TIMEOUT");
}
