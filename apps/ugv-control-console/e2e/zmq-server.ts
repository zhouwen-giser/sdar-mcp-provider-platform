// Isolated test bridge only: native ZMQ simulators + PostgreSQL, no published Runtime catalog.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { installObservationArchive } from "../../../packages/vehicle-zmq-observer/src/index.js";
import {
  operationFromConsoleCandidate,
  resultIdentity,
  type Operation,
  type StartControl,
} from "../../../packages/vehicle-zmq-control/src/index.js";
import { boot, until } from "../../../tests/ugv-zmq-control-postgres/harness.js";
import {
  SimulatedZmqDevices,
  releaseSimulatorEndpoints,
} from "../../../tests/ugv-zmq-control-postgres/simulator.js";
import { area, request, TestClock, present } from "../../../tests/ugv-zmq-control/helpers.js";
import { Store } from "../server/store.js";
import { zmqOperation } from "../../../packages/vehicle-zmq-control/src/catalog.js";
import { Mcp } from "../server/mcp.js";
import { Service } from "../server/service.js";
import { createApp } from "../server/app.js";
import { makeCredentials } from "../server/security.js";
import { record, text, array, type Json } from "../shared/model.js";
import {
  ZMQ_INSPECT,
  EFFECT_APPLY,
  INSPECTION_RESULT,
  EFFECT_RESULT,
  zmqConsoleTool,
  nativeContract,
  NATIVE_CONTROL_TOOLS,
} from "../shared/zmq.js";
import { password } from "../test/fixture.js";

const { databaseUrl } = JSON.parse(
  readFileSync(present(process.env.SMPP_ZMQ_TEST_CONFIG_FILE), "utf8"),
) as { databaseUrl: string };
const schema = "zmq_browser_" + randomUUID().replaceAll("-", ""),
  owner = new Pool({ connectionString: databaseUrl });
await installObservationArchive(owner, schema);
const client = await owner.connect();
try {
  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path = "${schema}"`);
  for (const path of [
    "migrations/providers/ugv/024_ugv_provider.sql",
    "migrations/providers/ugv/027_mutation_journal.sql",
  ])
    await client.query(readFileSync(new URL("../../../" + path, import.meta.url), "utf8"));
  await client.query("COMMIT");
} finally {
  client.release();
}
const devices = new SimulatedZmqDevices();
devices.effectDelayMs = 1500;
// Geometry produces a miss: source reports 106.001 while this simulated entity is farther away.
present(devices.simulatedWorld.get("object-1")).longitude += 1;
const profile = await devices.start(),
  runtime = await boot(databaseUrl, schema, profile),
  context = {
    authorizationContextHash: "d".repeat(64),
    executionMode: "simulation" as const,
    simulationId: present(profile.executionDomain.simulationId),
    correlationId: "SIMULATED-browser",
  };
await runtime.ready();
const startRequests = new Map<string, StartControl>(),
  names = new Map<string, string>();
function input(operation: Operation, key: string = randomUUID(), timing?: Json) {
  const previous = startRequests.get(key);
  if (previous) return previous;
  const clock = new TestClock();
  clock.utc = Date.now();
  const start = record(timing?.start),
    req = request(clock, operation, {
      taskId: key,
      commandId: key,
      resourceId: present(profile.providerBinding.resourceId),
      executionContext: context,
      timing: {
        startAt: start.mode === "scheduled" ? text(start.scheduledAt) : new Date().toISOString(),
        startToleranceMs: Number(start.startToleranceMs ?? 60000),
        maxElapsedMs: Number(timing?.maxElapsedMs ?? 300000),
        parentDeadlineAt: null,
      },
    });
  startRequests.set(key, req);
  return req;
}
const source = await runtime.engine.start(input({ ...area, name: "inspection.area" }));
await until(async () => (await runtime.repository.get(source.taskId))?.state === "RUNNING");
const publishSource = async () => {
  const e = await runtime.repository.get(source.taskId);
  if (!e || e.zmqControl.stage === "terminal") return;
  await devices.publishReport("tracklist", {
    task_id: e.zmqControl.nativeTaskId,
    track_state: "tracking",
    track_id: "track-1",
    target_id: "object-1",
    observed_at_utc_ms: Date.now(),
    data_origin: "simulated",
    targets: [
      {
        image: { camera_id: "camera-1", frame_id: randomUUID(), width_px: 100, height_px: 100 },
        pixel: { x_px: 1, y_px: 1 },
        position: { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 },
        range_m: 20,
        range_source: "simulated_radial_depth",
        reason: null,
      },
    ],
  });
};
await publishSource();
const sourceTimer = setInterval(() => {
  void publishSource();
}, 500);
const resourceId = present(profile.providerBinding.resourceId),
  tools = [ZMQ_INSPECT, EFFECT_APPLY, INSPECTION_RESULT, EFFECT_RESULT].map((name) =>
    zmqConsoleTool(name, resourceId),
  );
for (const name of NATIVE_CONTROL_TOOLS) {
  const tool = nativeContract(name, resourceId);
  if (!tool) throw Error("TEST_NATIVE_CONTRACT_REQUIRED");
  tools.push(tool);
}
const adapt = (name: string, args: unknown) =>
  NATIVE_CONTROL_TOOLS.includes(name)
    ? zmqOperation(name, record(args))
    : operationFromConsoleCandidate(name, args);
for (const name of [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
])
  tools.push({
    name,
    inputSchema: {
      type: "object",
      properties: { resourceId: { const: resourceId } },
      required: ["resourceId"],
    },
  });
async function snapshot(taskId: string): Promise<Json> {
  const e = await runtime.engine.get(taskId, context);
  if (!e) throw Error("TEST_TASK_NOT_FOUND");
  return {
    taskId,
    status: e.terminalAt
      ? e.state === "CANCELLED"
        ? "cancelled"
        : e.state === "SUCCEEDED"
          ? "completed"
          : "failed"
      : "working",
    lastUpdatedAt: e.updatedAt,
    statusMessage: e.reasonCode,
    ...(e.result
      ? { result: { isError: e.state !== "SUCCEEDED", structuredContent: e.result } }
      : {}),
    _meta: {
      "io.sdar/taskExecution": {
        operationName: names.get(taskId) ?? ZMQ_INSPECT,
        executionId: e.externalExecutionId,
        substate: e.zmqControl.stage,
      },
    },
  };
}
const upstreamHeaders = {
  "x-sdar-execution-mode": "simulation",
  "x-sdar-simulation-id": context.simulationId,
};
const mcp = new Mcp(
  "http://isolated-native-zmq-test/mcp",
  upstreamHeaders,
  async (_url, options) => {
    if (typeof options?.body !== "string") throw Error("TEST_JSON_BODY_REQUIRED");
    const { method, params: p } = JSON.parse(options.body) as {
      method: string;
      params: Json;
    };
    let result: unknown = {};
    if (method === "server/discover")
      result = {
        supportedVersions: ["2026-07-28"],
        capabilities: {
          extensions: {
            "io.sdar/providerCatalog": {
              providerId: profile.providerBinding.providerId,
              manifestHash: "SIMULATED-zmq-browser-candidate",
            },
          },
        },
      };
    else if (method === "tools/list") result = { tools };
    else if (method === "io.sdar/taskExecution/checkAvailability") {
      const check = record(array(p.checks)[0]),
        adapted = adapt(text(check.operationName), record(check.arguments).value),
        available = await runtime.engine.checkAvailability(adapted.operation, context);
      result = {
        results: [
          {
            operationName: check.operationName,
            availability: available.available ? "available" : "unavailable",
            reasonCode: available.reasonCode,
            validUntil: new Date(Date.now() + 2000).toISOString(),
          },
        ],
      };
    } else if (method === "tools/call") {
      const name = text(p.name),
        args = record(p.arguments);
      let content: unknown;
      if (name === "vehicle_get_state")
        content = runtime.observer.state.snapshot(
          runtime.observer.sessionId,
          runtime.observer.health,
        );
      else if (name === "vehicle_get_capabilities")
        content = { readOnly: true, qualification: "isolated_simulator_only" };
      else if (name === "vehicle_get_payload_status")
        content = { eo: devices.eoDevice, simulationEffect: devices.effectDevice };
      else if (name === "vehicle_get_targets")
        content = {
          targets: [],
          effectCandidates: await runtime.engine.effectCandidates(resultIdentity(source), context),
        };
      else if ([INSPECTION_RESULT, EFFECT_RESULT].includes(name)) {
        const e = await runtime.engine.get(text(args.taskId), context);
        if (!e || e.externalExecutionId !== args.executionId)
          throw Error("TEST_EXECUTION_IDENTITY_MISMATCH");
        content =
          name === EFFECT_RESULT
            ? await runtime.engine.effectResults(
                resultIdentity(e),
                context,
                Number(args.afterRevision),
              )
            : await runtime.engine.inspectionResults(
                resultIdentity(e),
                context,
                Number(args.afterRevision),
              );
      } else {
        const adapted = adapt(name, args),
          meta = record(record(p._meta)["io.sdar/taskExecution"]),
          e = await runtime.engine.start(
            input(adapted.operation, text(meta.idempotencyKey), record(meta.timing)),
          );
        names.set(e.taskId, name);
        result = await snapshot(e.taskId);
      }
      if (content !== undefined) result = { isError: false, structuredContent: content };
    } else if (method === "tasks/get") result = await snapshot(text(p.taskId));
    else if (method === "io.sdar/taskBusiness/context/get") {
      const e = await runtime.engine.get(text(p.taskId), context);
      if (!e) throw Error("TEST_TASK_NOT_FOUND");
      result = {
        snapshot: {
          contextRevision: 1,
          context: {
            identity: {
              taskId: e.taskId,
              executionId: e.externalExecutionId,
              providerId: e.providerId,
              resourceId: e.resourceId,
              operationName: names.get(e.taskId) ?? ZMQ_INSPECT,
              simulationId: context.simulationId,
            },
            contextRevision: 1,
            effectivePlanRevision: 1,
            activeRefs: {},
          },
          objects: [],
          objectDescriptors: [],
        },
        resumeFrom: { streamId: "SIMULATED-stream", afterSequence: "1" },
      };
    } else if (method.endsWith("/listen"))
      return new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream" } });
    else throw Error("TEST_RPC_UNSUPPORTED");
    return new Response(JSON.stringify({ result }), {
      headers: { "content-type": "application/json" },
    });
  },
);
const consolePool = new Pool({ connectionString: databaseUrl }),
  store = new Store(consolePool, randomUUID());
await store.migrate();
const service = new Service(mcp, store, "operator"),
  config = {
    host: "127.0.0.1",
    port: 19106,
    origins: ["http://127.0.0.1:19106"],
    mcpUrl: mcp.url,
    databaseUrl,
    credentials: makeCredentials("operator", password),
    upstreamHeaders,
    domain: store.domain,
    webRoot: new URL("../dist", import.meta.url).pathname,
    secure: false,
  };
const app = createApp(config, service);
await app.listen({ host: "127.0.0.1", port: 19106 });
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void (async () => {
      if (closing) return;
      closing = true;
      clearInterval(sourceTimer);
      await app.close();
      await runtime.engine.close();
      await runtime.driver.stop();
      await runtime.observer.stop();
      if (process.env.SMPP_ZMQ_BROWSER_RAW_FILE) {
        const path = process.env.SMPP_ZMQ_BROWSER_RAW_FILE;
        writeFileSync(path, "");
        for (const session of await runtime.archive.sessions()) {
          appendFileSync(
            path,
            JSON.stringify({
              kind: "session",
              partitionHash: runtime.scope.settings.observerPartitionHash,
              session,
            }) + "\n",
          );
          let cursor = "0";
          for (let n = 0; n < 100; n++) {
            const page = await runtime.archive.page(session.sessionId, cursor, 200);
            for (const entry of page.entries)
              appendFileSync(
                path,
                JSON.stringify({
                  kind: "entry",
                  partitionHash: runtime.scope.settings.observerPartitionHash,
                  sessionId: session.sessionId,
                  entry,
                }) + "\n",
              );
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
            if (n === 99) throw Error("BROWSER_EVIDENCE_EXPORT_BOUND");
          }
        }
      }
      if (process.env.SMPP_ZMQ_BROWSER_EVIDENCE_FILE) {
        const tasks = await store.tasks(),
          commands = await store.commands(),
          records = await runtime.store.pool.query(
            "SELECT snapshot FROM ugv_state_snapshot WHERE snapshot->>'schemaVersion'='ugv.zmq-result-record/1'",
          );
        const evidence = [];
        for (const task of tasks) {
          const final = await runtime.repository.get(task.taskId);
          if (!final) throw Error("BROWSER_EVIDENCE_TASK_MISSING");
          const resultPages = [];
          let after = 0;
          for (let n = 0; n < 128; n++) {
            const page = await runtime.engine.results(resultIdentity(final), context, after);
            resultPages.push(page);
            if (!page.hasMore) break;
            after = page.nextRevision;
            if (n === 127) throw Error("BROWSER_RESULT_EXPORT_BOUND");
          }
          evidence.push({ case: "native-browser", final, resultPages });
        }
        writeFileSync(
          process.env.SMPP_ZMQ_BROWSER_EVIDENCE_FILE,
          JSON.stringify(
            {
              classification: "SIMULATED_ONLY",
              evidence,
              tasks,
              commands,
              records: records.rows,
              nativeCommands: devices.commands,
              simulatedWorld: [...devices.simulatedWorld],
            },
            null,
            2,
          ) + "\n",
        );
      }
      await runtime.close();
      await devices.close();
      releaseSimulatorEndpoints();
      for (const table of ["audit", "command", "session", "task"])
        await consolePool.query(`DELETE FROM ugv_control_console.${table} WHERE domain=$1`, [
          store.domain,
        ]);
      await consolePool.end();
      await owner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await owner.end();
    })().catch(() => (process.exitCode = 1));
  });
