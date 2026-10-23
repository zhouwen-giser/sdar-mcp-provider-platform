import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { record, text, CONTROL_TOOLS, READ_TOOLS, type Json, type Tool } from "../shared/model.js";
import { Store } from "../server/store.js";
import { Mcp } from "../server/mcp.js";
import { Service } from "../server/service.js";
import { makeCredentials } from "../server/security.js";
import { createApp } from "../server/app.js";
import type { Config } from "../server/config.js";
export const password = "fixture-only-password-123";
export function testDb() {
  const file = process.env.SMPP_INSPECTION_TEST_CONFIG_FILE;
  if (!file) throw Error("ISOLATED_TEST_CONFIG_REQUIRED");
  const c = JSON.parse(readFileSync(file, "utf8")) as { owner: string; databaseUrl: string };
  if (c.owner !== "inspection-area-v1" || new URL(c.databaseUrl).hostname !== "127.0.0.1")
    throw Error("ISOLATED_TEST_CONFIG_REQUIRED");
  return c.databaseUrl;
}
export function fakeMcp() {
  const tasks = new Map<string, Json>();
  const businessObjects: Json[] = [];
  const requests: { method: string; params: Json }[] = [];
  let calls = 0,
    unavailable = false,
    uncertain = false,
    delay = 0;
  const profile = {
    profileVersion: "1.0",
    taskBehavior: "task_required",
    supportsPauseResume: true,
    supportsCancellation: true,
    supportsScheduling: true,
    supportsMaxElapsed: true,
    idempotency: "server_managed",
  };
  const tools: Tool[] = [...CONTROL_TOOLS, ...READ_TOOLS].map((name) => ({
    name,
    inputSchema: {
      type: "object",
      properties: { resourceId: { const: "vehicle:ugv" } },
      required: ["resourceId"],
    },
    _meta: {
      "io.sdar/taskExecution": name.startsWith("vehicle_get_")
        ? { ...profile, taskBehavior: "synchronous_only" }
        : profile,
    },
  }));
  const mcp = new Mcp("http://isolated-fixture/mcp", {}, async (_url, options) => {
    const input = JSON.parse(typeof options?.body === "string" ? options.body : "{}") as {
      method: string;
      params: Json;
    };
    requests.push({ method: input.method, params: input.params });
    const p = input.params,
      method = input.method;
    const headers = record(options?.headers);
    if (headers["mcp-protocol-version"] !== "2026-07-28" || headers["mcp-method"] !== method)
      throw Error("header mismatch");
    if (method === "tools/call" && headers["mcp-name"] !== p.name) throw Error("name mismatch");
    let result: Json = { resultType: "complete" };
    if (method === "server/discover")
      result = {
        supportedVersions: ["2026-07-28"],
        capabilities: {
          extensions: {
            "io.sdar/providerCatalog": {
              manifestHash: "fixture-manifest",
              providerId: "fixture-ugv",
            },
          },
        },
      };
    else if (method === "tools/list") result = { tools };
    else if (method === "io.sdar/taskExecution/checkAvailability")
      result = {
        results: [
          {
            operationName: record((p.checks as Json[])[0]).operationName,
            availability: unavailable ? "unknown" : "available",
            reasonCode: unavailable ? "UGV_STATE_STALE" : "UGV_READY",
            validUntil: new Date(Date.now() + 5000).toISOString(),
          },
        ],
      };
    else if (method === "tools/call") {
      const name = String(p.name);
      if (name === "vehicle_get_state")
        result = {
          isError: false,
          structuredContent: {
            connectivity: { mqttConnected: true, deviceMcpConnected: true, deviceAvailable: true },
            chassis: { position: { longitude: 106.813, latitude: 29.7197 }, speedKmh: 0 },
            freshness: { chassisObservedAt: new Date().toISOString() },
            payload: { reconnaissance: { loadStatusLabel: "空闲" } },
          },
        };
      else if (name.startsWith("vehicle_get_"))
        result = {
          isError: false,
          structuredContent:
            name === "vehicle_get_targets"
              ? { targets: [{ targetId: "target-1", type: "车辆" }] }
              : { online: true },
        };
      else {
        calls++;
        if (uncertain) throw Error("lost receipt");
        if (delay && name !== "vehicle_emergency_stop")
          await new Promise((r) => setTimeout(r, delay));
        const taskId = randomUUID();
        result = {
          resultType: "task",
          taskId,
          status: "working",
          lastUpdatedAt: new Date().toISOString(),
          _meta: { "io.sdar/taskExecution": { operationName: name, substate: "running" } },
        };
        tasks.set(taskId, result);
      }
    } else if (method === "tasks/get")
      result = tasks.get(String(p.taskId)) ?? { taskId: p.taskId, status: "working" };
    else if (
      method === "io.sdar/taskExecution/tasks/pause" ||
      method === "io.sdar/taskExecution/tasks/resume" ||
      method === "tasks/cancel"
    ) {
      const task = tasks.get(String(p.taskId));
      if (task) {
        if (method === "tasks/cancel") task.status = "cancelled";
        else
          task._meta = {
            "io.sdar/taskExecution": {
              ...record(record(task._meta)["io.sdar/taskExecution"]),
              substate: method.endsWith("/pause") ? "paused" : "running",
            },
          };
      }
    } else if (method === "io.sdar/taskBusiness/context/get")
      result = {
        snapshot: {
          contextRevision: 1,
          context: {
            identity: {
              taskId: p.taskId,
              executionId: "fixture-execution",
              resourceId: "vehicle:ugv",
              operationName: record(
                record(tasks.get(String(p.taskId))?._meta)["io.sdar/taskExecution"],
              ).operationName,
              providerId: "fixture-ugv",
              simulationId: null,
            },
            contextRevision: 1,
            effectivePlanRevision: 1,
            activeRefs: {},
          },
          objects: businessObjects,
          objectDescriptors: [],
        },
        resumeFrom: { streamId: "fixture-stream", afterSequence: "1" },
      };
    else if (method === "subscriptions/listen" || method === "io.sdar/businessEvents/listen")
      return new Response(
        'data: {"jsonrpc":"2.0","params":{"taskId":"' + text(p.taskId) + '"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    return new Response(JSON.stringify({ result }), {
      headers: { "content-type": "application/json" },
    });
  });
  return {
    mcp,
    tasks,
    businessObjects,
    requests,
    tools,
    get calls() {
      return calls;
    },
    set unavailable(v: boolean) {
      unavailable = v;
    },
    set uncertain(v: boolean) {
      uncertain = v;
    },
    set delay(v: number) {
      delay = v;
    },
  };
}
export async function makeFixture(port = 0) {
  const fake = fakeMcp(),
    pool = new Pool({ connectionString: testDb(), max: 8 }),
    store = new Store(pool, randomUUID());
  await store.migrate();
  const credentials = makeCredentials("operator", password);
  const config: Config = {
    host: "127.0.0.1",
    port,
    origins: [`http://127.0.0.1:${port}`],
    mcpUrl: fake.mcp.url,
    databaseUrl: testDb(),
    credentials,
    upstreamHeaders: {},
    domain: store.domain,
    webRoot: new URL("../dist", import.meta.url).pathname,
    secure: false,
  };
  const service = new Service(fake.mcp, store, "operator"),
    app = createApp(config, service);
  return {
    fake,
    pool,
    store,
    config,
    service,
    app,
    async close() {
      await app.close();
      await pool.query("DELETE FROM ugv_control_console.audit WHERE domain=$1", [store.domain]);
      await pool.query("DELETE FROM ugv_control_console.command WHERE domain=$1", [store.domain]);
      await pool.query("DELETE FROM ugv_control_console.session WHERE domain=$1", [store.domain]);
      await pool.query("DELETE FROM ugv_control_console.task WHERE domain=$1", [store.domain]);
      await pool.end();
    },
  };
}
