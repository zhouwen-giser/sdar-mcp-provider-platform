import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CreateTaskResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import type { RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for E2E tests");

let adapter: grpc.Server;
let adapterPort: number;
let runtime: RuntimeApplication;
let runtimeReplica: RuntimeApplication;
let client: Client;
let transport: StreamableHTTPClientTransport;
let runtimeUrl: URL;
let runtimeReplicaUrl: URL;

beforeAll(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
  await pool.end();

  adapter = createMockAdapterServer({ providerId: "e2e-provider" });
  adapterPort = await bindMockAdapter(adapter, "127.0.0.1:0");
  runtime = createRuntime(runtimeConfig(true));
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (address === null || typeof address === "string") throw new Error("Runtime did not bind");
  runtimeUrl = new URL(`http://127.0.0.1:${String(address.port)}/mcp/legacy`);

  runtimeReplica = createRuntime(runtimeConfig(false));
  await runtimeReplica.initialize();
  await runtimeReplica.app.listen({ host: "127.0.0.1", port: 0 });
  const replicaAddress = runtimeReplica.app.server.address();
  if (replicaAddress === null || typeof replicaAddress === "string") {
    throw new Error("Runtime replica did not bind");
  }
  runtimeReplicaUrl = new URL(`http://127.0.0.1:${String(replicaAddress.port)}/mcp`);
  client = new Client({ name: "runtime-e2e", version: "1.0.0" });
  transport = clientTransport();
  await client.connect(transport as unknown as Transport);
});

afterAll(async () => {
  await client.close();
  await runtimeReplica.app.close();
  await runtime.app.close();
  await new Promise<void>((resolve) => adapter.tryShutdown(() => resolve()));
});

describe("independently deployed Runtime stack", () => {
  it("serves the frozen protocol on the primary endpoint", async () => {
    const discovery = await frozenRequest("server/discover", {}, 1);
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      result: {
        supportedVersions: ["2026-07-28"],
        _meta: { "io.modelcontextprotocol/serverInfo": { version: "2.0.0-rc.1" } },
      },
    });

    const tools = await frozenRequest("tools/list", {}, 2);
    const toolsBody = tools.json<{ result: { tools: { name: string }[] } }>();
    expect(toolsBody.result).not.toHaveProperty("resultType");
    expect(toolsBody.result.tools.map((tool) => tool.name)).toEqual([
      "echo_sync",
      "durable_task",
      "flex_task",
    ]);

    const synchronous = await frozenRequest(
      "tools/call",
      { name: "echo_sync", arguments: { message: "frozen-primary" } },
      3,
      "echo_sync",
    );
    expect(synchronous.json()).toMatchObject({
      result: { resultType: "complete", structuredContent: { message: "frozen-primary" } },
    });

    const created = await frozenRequest(
      "tools/call",
      { name: "durable_task", arguments: { resourceId: "frozen-e2e-resource" } },
      4,
      "durable_task",
      { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: "frozen-e2e" } },
    );
    const createdBody = created.json<{ result: { taskId: string; resultType: string } }>();
    expect(createdBody.result).toMatchObject({ resultType: "task" });
    const queried = await frozenRequest(
      "tasks/get",
      { taskId: createdBody.result.taskId },
      5,
      createdBody.result.taskId,
    );
    expect(queried.json()).toMatchObject({
      result: { resultType: "complete", taskId: createdBody.result.taskId, status: "working" },
    });

    const controller = new AbortController();
    try {
      const response = await fetch(new URL("/mcp", runtimeUrl), {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "subscriptions/listen",
          "x-sdar-subject": "e2e-user",
          "x-sdar-tenant": "e2e-tenant",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "frozen-subscription",
          method: "subscriptions/listen",
          params: {
            notifications: { taskIds: [createdBody.result.taskId] },
            _meta: frozenMeta(),
          },
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("Frozen SSE response body is unavailable");
      const first = await reader.read();
      const chunk: unknown = first.value;
      if (!(chunk instanceof Uint8Array)) throw new Error("Frozen SSE frame is unavailable");
      const frames = new TextDecoder().decode(chunk);
      expect(frames).toContain("notifications/subscriptions/acknowledged");
      expect(frames).toContain(createdBody.result.taskId);
    } finally {
      controller.abort();
    }
  });

  it("C-055 publishes one PostgreSQL task revision through two Runtime SSE replicas", async () => {
    const created = await frozenRequest(
      "tools/call",
      {
        name: "durable_task",
        arguments: { resourceId: "multi-replica-notification", scenario: "queued_start" },
      },
      40,
      "durable_task",
      {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: "multi-replica-notification",
        },
      },
    );
    const taskId = created.json<{ result: { taskId: string } }>().result.taskId;
    const streams = await Promise.all([
      openFrozenSubscription(new URL("/mcp", runtimeUrl), taskId, "runtime-a-subscription"),
      openFrozenSubscription(runtimeReplicaUrl, taskId, "runtime-b-subscription"),
    ]);
    try {
      for (const stream of streams) {
        await expect(stream.next()).resolves.toMatchObject({
          method: "notifications/subscriptions/acknowledged",
          params: { notifications: { taskIds: [taskId] } },
        });
        await expect(stream.next()).resolves.toMatchObject({
          method: "notifications/tasks",
          params: { taskId, status: "working" },
        });
      }

      const cancelled = await frozenRequest("tasks/cancel", { taskId }, 41, taskId);
      expect(cancelled.json()).toMatchObject({ result: { resultType: "complete" } });
      const terminal = await Promise.all(
        streams.map((stream) =>
          stream.nextUntil(
            (message) =>
              message.method === "notifications/tasks" &&
              (message.params as Record<string, unknown>).status === "cancelled",
          ),
        ),
      );
      const queried = await frozenRequest("tasks/get", { taskId }, 42, taskId);
      const authoritative = queried.json<{ result: Record<string, unknown> }>().result;
      for (const message of terminal) {
        expect(normalizeNotificationTask(message.params as Record<string, unknown>)).toEqual(
          normalizeGetTask(authoritative),
        );
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.close()));
    }
  }, 20_000);

  it("becomes ready and publishes the bounded Adapter catalog", async () => {
    const ready = await runtime.app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready" });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "echo_sync",
      "durable_task",
      "flex_task",
    ]);
  });

  it("executes synchronous and durable task lifecycles over Streamable HTTP", async () => {
    const synchronous = await client.callTool({
      name: "echo_sync",
      arguments: { message: "release-candidate" },
    });
    expect(synchronous).toMatchObject({
      isError: false,
      structuredContent: { message: "release-candidate" },
    });

    const created = await client.request(
      {
        method: "tools/call",
        params: {
          name: "durable_task",
          arguments: { resourceId: "e2e-resource" },
          _meta: { "io.sdar/taskExecution": { idempotencyKey: "e2e-release-key" } },
        },
      },
      CreateTaskResultSchema,
      { task: { ttl: 60_000 } },
    );
    expect(created.task.status).toBe("working");
    const completed = await client.experimental.tasks.getTask(created.task.taskId);
    expect(completed).toMatchObject({ status: "completed" });
  });

  it("T-046 serves repeated requests and multiple clients in explicit stateless mode", async () => {
    expect(transport.sessionId).toBeUndefined();
    await expect(client.listTools()).resolves.toHaveProperty("tools.length", 3);
    await expect(client.listTools()).resolves.toHaveProperty("tools.length", 3);

    const secondTransport = clientTransport();
    const secondClient = new Client({ name: "runtime-e2e-second", version: "1.0.0" });
    try {
      await secondClient.connect(secondTransport as unknown as Transport);
      expect(secondTransport.sessionId).toBeUndefined();
      await expect(secondClient.listTools()).resolves.toHaveProperty("tools.length", 3);
    } finally {
      await secondClient.close();
    }
  });

  it("T-041/T-042 attributes Adapter loss and automatically restores readiness", async () => {
    await shutdown(adapter);
    const unavailable = await waitForReadiness("failed");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      status: "not_ready",
      dependencies: { database: "ready", adapter: "failed" },
    });
    expect((await runtime.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);

    adapter = createMockAdapterServer({ providerId: "e2e-provider" });
    expect(await bindMockAdapter(adapter, `127.0.0.1:${String(adapterPort)}`)).toBe(adapterPort);
    const recovered = await waitForReadiness("ready");
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      status: "ready",
      dependencies: { database: "ready", adapter: "ready" },
    });
  });
});

function clientTransport(): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(runtimeUrl, {
    requestInit: {
      headers: { "x-sdar-subject": "e2e-user", "x-sdar-tenant": "e2e-tenant" },
    },
  });
}

function runtimeConfig(legacyEndpoint: boolean) {
  return loadRuntimeConfig({
    DATABASE_URL: databaseUrl,
    PROVIDER_ID: "e2e-provider",
    ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
    AUTH_MODE: "trusted_headers",
    MCP_LEGACY_ENDPOINT_ENABLED: String(legacyEndpoint),
    LOG_LEVEL: "warn",
    SCHEDULER_POLL_MS: "1000",
    COMMAND_DISPATCH_CONCURRENCY: "2",
    RECOVERY_POLL_MS: "5000",
    ADAPTER_RPC_TIMEOUT_MS: "250",
    ADAPTER_HEALTH_POLL_MS: "100",
    ADAPTER_HEALTH_FAILURE_THRESHOLD: "1",
  });
}

async function openFrozenSubscription(url: URL, taskId: string, requestId: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    method: "POST",
    signal: controller.signal,
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "subscriptions/listen",
      "x-sdar-subject": "e2e-user",
      "x-sdar-tenant": "e2e-tenant",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "subscriptions/listen",
      params: { notifications: { taskIds: [taskId] }, _meta: frozenMeta() },
    }),
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Frozen SSE response body is unavailable");
  const decoder = new TextDecoder();
  let buffer = "";
  const messages: Record<string, unknown>[] = [];

  const next = async (): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const queued = messages.shift();
      if (queued !== undefined) return queued;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out waiting for SSE message ${requestId}`);
      const read = await withTimeout(
        reader.read(),
        remaining,
        `Timed out waiting for SSE bytes ${requestId}`,
      );
      if (read.done) throw new Error(`SSE stream ${requestId} closed before the expected message`);
      const chunk: unknown = read.value;
      if (!(chunk instanceof Uint8Array)) throw new Error(`Invalid SSE bytes ${requestId}`);
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
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("Invalid SSE JSON-RPC message");
        }
        messages.push(parsed as Record<string, unknown>);
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
  return value;
}

function normalizeGetTask(task: Record<string, unknown>): Record<string, unknown> {
  const value = structuredClone(task);
  delete value.resultType;
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name === undefined ? {} : { "mcp-name": name }),
      "x-sdar-subject": "e2e-user",
      "x-sdar-tenant": "e2e-tenant",
    },
    payload: {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          ...frozenMeta(),
          ...extraMeta,
        },
      },
    },
  });
}

function frozenMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "frozen-e2e", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };
}

async function waitForReadiness(adapterStatus: "ready" | "failed") {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await runtime.app.inject({ method: "GET", url: "/health/ready" });
    const body = response.json<{ dependencies?: { adapter?: unknown } }>();
    if (body.dependencies?.adapter === adapterStatus) return response;
    if (Date.now() >= deadline) throw new Error(`Adapter did not become ${adapterStatus}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function shutdown(server: grpc.Server): Promise<void> {
  return new Promise((resolve) => server.tryShutdown(() => resolve()));
}
