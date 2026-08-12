import { createHash, randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import {
  CatalogDiscoveryClient,
  HttpCatalogDiscoveryTransport,
  canonicalize,
  catalogChecksum,
  catalogDocument,
  type CatalogSnapshot,
} from "../../packages/catalog-manager/src/index.js";
import {
  buildRegistrySnapshot,
  type RegistrySnapshot,
} from "../../packages/registry-snapshot/src/index.js";

const providerId = "controlled.sdar.interop";
const connectionString = requiredDatabaseUrl();

describe("controlled SDAR Registry and frozen MCP interop", () => {
  const admin = new Pool({ connectionString });
  const schema = `sdar_interop_${randomUUID().replaceAll("-", "")}`;
  let adapter: grpc.Server | null = null;
  let runtime: RuntimeApplication | null = null;
  let runtimeAddress: string;
  let imported: ImportedProvider;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    adapter = createMockAdapterServer({ providerId });
    const adapterPort = await bindMockAdapter(adapter, "127.0.0.1:0");
    runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "production",
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
        AUTH_MODE: "anonymous",
        HOST: "127.0.0.1",
        PORT: "18080",
        PROVIDER_ID: providerId,
        DATABASE_URL: scopedDatabaseUrl(connectionString, schema),
        ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
        LOG_LEVEL: "error",
        OTEL_ENABLED: "false",
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
        BUSINESS_EVENTS_ENABLED: "false",
      }),
    );
    await runtime.initialize();
    runtimeAddress = await runtime.app.listen({ host: "127.0.0.1", port: 0 });

    const discovered = await new CatalogDiscoveryClient(
      new HttpCatalogDiscoveryTransport({ endpoint: `${runtimeAddress}/mcp` }),
    ).discover();
    const document = catalogDocument(discovered);
    const catalog: CatalogSnapshot = {
      providerId,
      revision: 1,
      checksum: catalogChecksum(document),
      document,
      discoveredAt: new Date("2026-07-27T00:00:00.000Z"),
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
    };
    const candidate = buildRegistrySnapshot("test", [
      {
        providerId,
        serverId: "runtime-controlled-sdar-interop",
        protocolMode: "frozen_v1",
        effectiveEndpoint: `${runtimeAddress}/mcp`,
        catalog,
      },
    ]);
    imported = importRegistry({
      environment: "test",
      revision: 1,
      checksum: candidate.checksum,
      document: candidate.document,
      publishedAt: new Date("2026-07-27T00:00:00.000Z"),
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await runtime?.app.close();
    if (adapter !== null) {
      await new Promise<void>((resolve) => adapter?.tryShutdown(() => resolve()));
    }
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("imports Registry, discovers tools, and completes Tool/Task/notification/get flow", async () => {
    expect(imported.providerId).toBe(providerId);
    expect(imported.endpoint).toBe(`${runtimeAddress}/mcp`);
    expect(imported.tools.map(({ name }) => name)).toEqual([
      "durable_task",
      "echo_sync",
      "flex_task",
    ]);

    const discovery = await request("server/discover", {}, "discover");
    expect(discovery.result).toMatchObject({ supportedVersions: ["2026-07-28"] });
    const tools = await request("tools/list", {}, "tools");
    expect(
      (tools.result as { tools: { name: string }[] }).tools.map(({ name }) => name).sort(),
    ).toEqual(imported.tools.map(({ name }) => name));
    const synchronous = await request(
      "tools/call",
      { name: "echo_sync", arguments: { message: "controlled-interop-result" } },
      "sync-call",
      "echo_sync",
    );
    expect(synchronous.result).toMatchObject({
      resultType: "complete",
      structuredContent: { message: "controlled-interop-result" },
    });

    const created = await request(
      "tools/call",
      { name: "durable_task", arguments: { resourceId: "controlled-interop-resource" } },
      "call",
      "durable_task",
      {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: `controlled-${randomUUID()}`,
        },
      },
    );
    const taskId = (created.result as { taskId: string }).taskId;
    expect(created.result).toMatchObject({ resultType: "task", status: "working" });

    const subscription = await subscribe(taskId);
    try {
      await expect(subscription.next()).resolves.toMatchObject({
        method: "notifications/subscriptions/acknowledged",
      });
      await expect(request("tasks/cancel", { taskId }, "cancel", taskId)).resolves.toMatchObject({
        result: { resultType: "complete" },
      });
      const notification = await subscription.nextUntil(
        (message) =>
          message.method === "notifications/tasks" &&
          (message.params as { status?: unknown }).status === "cancelled",
      );
      expect(notification.params).toMatchObject({ taskId, status: "cancelled" });
      const terminal = await request("tasks/get", { taskId }, "get-terminal", taskId);
      expect(terminal.result).toMatchObject({
        resultType: "complete",
        taskId,
        status: "cancelled",
      });
    } finally {
      await subscription.close();
    }
  }, 20_000);

  async function request(
    method: string,
    params: Record<string, unknown>,
    id: string,
    name?: string,
    extraMeta: Record<string, unknown> = {},
  ): Promise<{ result: unknown }> {
    if (runtime === null) throw new Error("SDAR_INTEROP_RUNTIME_NOT_STARTED");
    const response = await runtime.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(name === undefined ? {} : { "mcp-name": name }),
      },
      payload: {
        jsonrpc: "2.0",
        id,
        method,
        params: { ...params, _meta: { ...clientMeta(), ...extraMeta } },
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ result: unknown }>();
  }

  async function subscribe(taskId: string) {
    const controller = new AbortController();
    const response = await fetch(`${runtimeAddress}/mcp`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "subscription",
        method: "subscriptions/listen",
        params: { notifications: { taskIds: [taskId] }, _meta: clientMeta() },
      }),
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SDAR_INTEROP_SSE_BODY_MISSING");
    const decoder = new TextDecoder();
    let buffer = "";
    const queue: Record<string, unknown>[] = [];
    const next = async (): Promise<Record<string, unknown>> => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const queued = queue.shift();
        if (queued !== undefined) return queued;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("SDAR_INTEROP_SSE_TIMEOUT");
        const chunk = await withTimeout(reader.read(), remaining);
        if (chunk.done || !(chunk.value instanceof Uint8Array)) {
          throw new Error("SDAR_INTEROP_SSE_CLOSED");
        }
        buffer += decoder.decode(chunk.value, { stream: true });
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
            throw new Error("SDAR_INTEROP_SSE_INVALID");
          }
          queue.push(parsed as Record<string, unknown>);
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
});

interface ImportedProvider {
  readonly providerId: string;
  readonly endpoint: string;
  readonly tools: readonly { readonly name: string }[];
}

function importRegistry(snapshot: RegistrySnapshot): ImportedProvider {
  const checksum = createHash("sha256").update(canonicalize(snapshot.document)).digest("hex");
  if (checksum !== snapshot.checksum || snapshot.environment !== snapshot.document.environment) {
    throw new Error("SDAR_REGISTRY_INTEGRITY_INVALID");
  }
  if (snapshot.document.providers.length !== 1) throw new Error("SDAR_REGISTRY_SCOPE_INVALID");
  const provider = snapshot.document.providers[0];
  if (provider === undefined) throw new Error("SDAR_REGISTRY_PROTOCOL_INVALID");
  const endpoint = new URL(provider.effectiveEndpoint);
  if (
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0 ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["127.0.0.1", "::1"].includes(endpoint.hostname)))
  ) {
    throw new Error("SDAR_REGISTRY_ENDPOINT_INVALID");
  }
  return {
    providerId: provider.providerId,
    endpoint: endpoint.toString(),
    tools: provider.tools
      .map(({ name }) => ({ name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function clientMeta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "controlled-sdar", version: "0.1.0" },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SDAR_INTEROP_SSE_TIMEOUT")), timeoutMs);
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

function scopedDatabaseUrl(source: string, schema: string): string {
  const url = new URL(source);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
