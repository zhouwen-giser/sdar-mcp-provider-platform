import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { DISABLED_UGV_TASK_BUSINESS_SETTINGS } from "../../packages/runtime-configuration-contract/src/providers/ugv-business.ts";
import { runUgvManualAcceptance } from "./manual-acceptance.ts";
import { runReadOnlyTaskBusinessProbe } from "./read-only-probe.ts";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.ts";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.ts";

const args = process.argv.slice(2);
const arg = (key) => {
  const i = args.indexOf(key);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--"))
    throw Error(`REQUIRED_ARGUMENT:${key}`);
  return args[i + 1];
};
if (args.includes("--worker")) {
  const mode = arg("--worker");
  if (!["runtime", "provider"].includes(mode)) throw Error("INVALID_WORKER");
  const env = JSON.parse(await readFile(arg("--environment"), "utf8"));
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  await import(
    pathToFileURL(
      resolve(
        mode === "provider" ? "apps/ugv-provider-adapter/src/main.ts" : "apps/runtime/src/main.ts",
      ),
    ).href
  );
} else if (args.includes("--help") || args.length === 0) {
  console.log(
    "node --import tsx scripts/task-business/qualify-navigation-public.mjs --fixture /private/gowm-test.json --report /private/public-navigation.json --allow-motion\nRequires SMPP_UGV_SOURCE_QUALIFICATION_ALLOW_MOTION=true. Runs production Provider/Runtime entrypoints on loopback with a disposable selected GOWM app fixture and JWT authentication. Public MCP only for task creation, business reads, edits and cancellation. Fire disabled. Restarts both processes between edits. No production deployment.",
  );
} else {
  if (
    !args.includes("--allow-motion") ||
    process.env.SMPP_UGV_SOURCE_QUALIFICATION_ALLOW_MOTION !== "true"
  )
    throw Error("EXPLICIT_MOTION_AUTHORIZATION_REQUIRED");
  await qualify();
}
async function qualify() {
  const fixture = JSON.parse(await readFile(arg("--fixture"), "utf8"));
  const output = arg("--report");
  const url = new URL(fixture.databaseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.pathname.includes("test") ||
    url.username !== "ugv_smpp_app"
  )
    throw Error("ISOLATED_GOWM_APP_FIXTURE_REQUIRED");
  const runId = randomUUID();
  const config = {
    mode: "gowm-shared",
    databaseUrl: fixture.databaseUrl,
    contractDir: fixture.contractDir,
    serviceKey: fixture.serviceKey,
    sourceSessionKey: fixture.sourceSessionKey,
    allowedDeviceIds: [fixture.deviceIds[0]],
    bindingId: fixture.bindingIds[0],
  };
  const store = new PostgresProviderStore(fixture.databaseUrl, 2, "ugv", config);
  await store.initialize();
  if ((await store.listActiveExecutions()).length) {
    await store.close();
    throw Error("ACTIVE_EXECUTION_PRESENT");
  }
  const privateDir = await mkdtemp(join(tmpdir(), "smpp-public-navigation-"));
  const report = {
    schema: "smpp.public-navigation-qualification/v1",
    runId,
    startedAt: new Date().toISOString(),
    status: "NOT_RUN",
    fireEnabled: false,
    capturePublicPayloads: true,
    sceneInstanceId: fixture.dataScopeKey,
    steps: [],
    reads: [],
    streams: [],
    adjustments: [],
    processes: [],
    privateLogs: privateDir,
  };
  const note = (stage, details = {}) => {
    const event = { stage, at: new Date().toISOString(), ...details };
    report.steps.push(event);
    console.log(JSON.stringify(event));
  };
  const common = {
    SMPP_STORAGE_MODE: "gowm-shared",
    GOWM_DATABASE_URL: fixture.databaseUrl,
    SMPP_GOWM_CONTRACT_DIR: fixture.contractDir,
    SMPP_SERVICE_KEY: fixture.serviceKey,
    SMPP_SOURCE_SESSION_KEY: config.sourceSessionKey,
    SMPP_ALLOWED_DEVICE_IDS: JSON.stringify([fixture.deviceIds[0]]),
    SMPP_GOWM_BINDING_ID: fixture.bindingIds[0],
    PROVIDER_ID: fixture.providerId,
    PROVIDER_TELEMETRY_ENABLED: "false",
    LOG_LEVEL: "error",
  };
  const profilePath = join(privateDir, "profile.json");
  await writeFile(
    profilePath,
    JSON.stringify({
      ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
      enabled: true,
      coverage: { mode: "device_reported" },
      adjustments: { navigation: true, reconnaissance: false },
    }),
    { mode: 0o600 },
  );
  const adapterPort = await unusedPort();
  const runtimePort = await unusedPort();
  const secret = randomBytes(32).toString("hex");
  const jwtParts = [
    { alg: "HS256", typ: "JWT" },
    {
      sub: "navigation-qualification",
      tenant: "smpp-test",
      actor_type: "operator",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  ]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  const bearerToken =
    jwtParts + "." + createHmac("sha256", secret).update(jwtParts).digest("base64url");
  const authHeaders = {
    authorization: `Bearer ${bearerToken}`,
    "x-sdar-execution-mode": "simulation",
    "x-sdar-simulation-id": fixture.dataScopeKey,
  };
  const envs = {
    provider: {
      ...common,
      RUNTIME_ENV: "test",
      UGV_DELIVERY_STAGE: "integration_candidate",
      UGV_EXECUTION_MODE: "simulation",
      UGV_RESOURCE_ID: fixture.resourceIds[0],
      UGV_ENTITY_ID: "ugv1",
      UGV_FIRE_ENABLED: "false",
      UGV_TASK_BUSINESS_PROFILE_PATH: profilePath,
      UGV_NAVIGATION_PLANNER_MODE: "isr_airport",
      UGV_NAVIGATION_PLANNER_URL: "http://192.168.2.63:7879",
      UGV_ADAPTER_DATABASE_POOL_MAX: "3",
      UGV_MQTT_URL: "mqtt://192.168.2.63:1883",
      UGV_MQTT_CLIENT_ID: `smpp-public-${runId}`,
      UGV_MQTT_SESSION_MODE: "clean",
      UGV_MQTT_WIRE_MODE: "auto",
      UGV_DEVICE_MCP_URL: "http://192.168.2.63:19000/mcp",
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(adapterPort),
      ADAPTER_TLS_MODE: "disabled",
    },
    runtime: {
      ...common,
      RUNTIME_ENV: "test",
      DATABASE_POOL_MAX: "5",
      HOST: "127.0.0.1",
      PORT: String(runtimePort),
      ADAPTER_ENDPOINT: `127.0.0.1:${adapterPort}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "jwt_hs256",
      JWT_HS256_SECRET: secret,
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      BUSINESS_EVENTS_ENABLED: "true",
      BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
      SCHEDULER_POLL_MS: "1000",
    },
  };
  for (const [mode, env] of Object.entries(envs))
    await writeFile(join(privateDir, `${mode}.json`), JSON.stringify(env), { mode: 0o600 });
  const mcpUrl = `http://127.0.0.1:${runtimePort}/mcp`;
  const fetchWithAuth = (url, init = {}) => {
    const headers = new globalThis.Headers(init.headers);
    for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
    return fetch(url, { ...init, headers });
  };
  const processes = new Map();
  const launch = (mode) => {
    const fd = openSync(join(privateDir, `${mode}.log`), "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--worker",
        mode,
        "--environment",
        join(privateDir, `${mode}.json`),
      ],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH, LANG: process.env.LANG ?? "C.UTF-8" },
        stdio: ["ignore", fd, fd],
      },
    );
    closeSync(fd);
    processes.set(mode, child);
    report.processes.push({ mode, pid: child.pid, startedAt: new Date().toISOString() });
    return child;
  };
  const stop = async (mode) => {
    const child = processes.get(mode);
    if (!child) return;
    processes.delete(mode);
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const killed = setTimeout(() => child.kill("SIGKILL"), 10000);
    await exited;
    clearTimeout(killed);
  };
  const providerReady = async () => {
    const gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${adapterPort}`,
      providerId: fixture.providerId,
    });
    try {
      await waitFor(
        "provider_manifest",
        async () => {
          try {
            const manifest = await gateway.describeProvider();
            return manifest.operations.some((operation) => operation.name === "vehicle_navigate")
              ? manifest
              : undefined;
          } catch {
            return undefined;
          }
        },
        30000,
      );
    } finally {
      gateway.close();
    }
  };
  const rpc = async (method, params = {}, name) => {
    const response = await fetchWithAuth(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(name ? { "mcp-name": name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "smpp-public-navigation", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: {
                "io.modelcontextprotocol/tasks": {},
                "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
                "io.sdar/businessEvents": { profileVersion: "1.0" },
              },
            },
            ...params._meta,
          },
        },
      }),
      signal: globalThis.AbortSignal.timeout(15000),
    });
    const envelope = await response.json();
    if (!response.ok || envelope.error)
      throw Error(`PUBLIC_RPC_FAILED:${method}:${JSON.stringify(envelope.error ?? envelope)}`);
    return envelope.result;
  };
  const ready = async () =>
    waitFor(
      "public_ready",
      async () => {
        try {
          const health = await fetchWithAuth(`http://127.0.0.1:${runtimePort}/health/ready`, {
            signal: globalThis.AbortSignal.timeout(1000),
          });
          if (!health.ok) return undefined;
          return await rpc("server/discover");
        } catch {
          for (const child of processes.values())
            if (child.exitCode !== null || child.signalCode !== null)
              throw Error("PUBLIC_WORKER_EXITED");
          return undefined;
        }
      },
      45000,
    );
  let taskId;
  let streaming;
  const snapshot = async () => {
    let summary;
    const objects = [];
    await runReadOnlyTaskBusinessProbe({
      mcpUrl,
      taskId,
      snapshotOnly: true,
      capturePublicPayloads: true,
      bearerToken,
      fetchImpl: fetchWithAuth,
      durationMs: 15000,
      emit: (line) => {
        if (line.type === "snapshot") summary = line;
        if (line.type === "businessObject") objects.push(line.object);
      },
    });
    if (!summary) throw Error("PUBLIC_SNAPSHOT_MISSING");
    return { summary, objects };
  };
  const stream = (window = "initial") => {
    const durationMs = window === "initial" ? 6000 : 45000;
    let timeout;
    return Promise.race([
      runReadOnlyTaskBusinessProbe({
        mcpUrl,
        taskId,
        bearerToken,
        fetchImpl: fetchWithAuth,
        durationMs,
        maxEvents: 1000,
        capturePublicPayloads: true,
        emit: (line) => {
          report.streams.push({ ...line, window });
          if (["refresh", "businessEvent", "stopped", "error"].includes(line.type))
            note("public_stream", { type: line.type, reason: line.reasonCode ?? line.reason });
        },
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error("PUBLIC_STREAM_TIMEOUT")), durationMs + 10000);
      }),
    ])
      .catch((error) => {
        report.streams.push({ type: "streamFailure", reason: error.message, window });
        note("public_stream_failure", { reason: error.message });
      })
      .finally(() => clearTimeout(timeout));
  };
  const adopted = async (revision) =>
    waitFor(
      `public_adoption_${revision}`,
      async () => {
        const s = await snapshot();
        return s.summary.effectivePlanRevision === revision ? s : undefined;
      },
      45000,
    );
  try {
    launch("provider");
    await providerReady();
    launch("runtime");
    report.discovery = await ready();
    note("public_ready");
    report.tools = await rpc("tools/list");
    const tool = report.tools.tools.find((t) => t.name === "vehicle_navigate");
    if (!tool || !JSON.stringify(tool).includes("navigation.adjust_plan"))
      throw Error("PUBLIC_NAVIGATION_PROFILE_MISSING");
    const parking = { longitude: 106.81179412264343, latitude: 29.720490136182608 };
    const destination = { longitude: 106.81312856, latitude: 29.72041222 };
    const navigationArgs = {
      resourceId: fixture.resourceIds[0],
      mission: { type: "route", waypoints: [parking, destination] },
      speedLimitKmh: 5,
      stopOnObstacle: true,
    };
    const created = await rpc(
      "tools/call",
      {
        name: "vehicle_navigate",
        arguments: navigationArgs,
        _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: runId } },
      },
      "vehicle_navigate",
    );
    if (created.resultType !== "task" || !created.taskId)
      throw Error(`PUBLIC_TASK_CREATE_FAILED:${JSON.stringify(created)}`);
    taskId = created.taskId;
    report.taskId = taskId;
    note("public_task_created", { taskId });
    const initial = await adopted(1);
    report.reads.push(initial);
    streaming = stream();
    const original = await store.getExecution(taskId);
    for (const [index, target] of [parking, destination].entries()) {
      await waitFor(
        "public_task_running",
        async () => {
          const task = await rpc("tasks/get", { taskId }, taskId);
          return task.status === "working" &&
            task._meta?.["io.sdar/taskExecution"]?.substate === "running"
            ? task
            : undefined;
        },
        20000,
      );
      const before = await snapshot();
      const ref = before.summary.activeRefs.navigationAdjustment;
      if (!ref) throw Error("PUBLIC_ADJUSTMENT_ENTRY_MISSING");
      const lines = [];
      await runUgvManualAcceptance({
        bearerToken,
        allowWrites: true,
        fetchImpl: fetchWithAuth,
        manifest: {
          schema: "sdar.ugv-manual-acceptance/v1",
          mcpUrl,
          taskId,
          snapshotOnly: true,
          expectedTools: ["vehicle_navigate"],
          write: {
            kind: "intervention",
            manifest: {
              schema: "sdar.ugv-intervention-probe/v1",
              mcpUrl,
              authorizationRef: "user-authorized-software-simulator-navigation",
              sceneInstanceId: fixture.dataScopeKey,
              taskId,
              executionId: before.summary.identity.executionId,
              providerId: fixture.providerId,
              resourceId: fixture.resourceIds[0],
              ...(before.summary.identity.correlationId
                ? { correlationId: before.summary.identity.correlationId }
                : {}),
              interventionId: ref.id,
              interventionRevision: ref.revision,
              effectivePlanRevision: before.summary.effectivePlanRevision,
              commandId: `public-edit-${index + 1}-${runId}`,
              input: { waypoints: [target], density: "adaptive" },
              submitBefore: new Date(Date.now() + 30000).toISOString(),
              maxPolls: 30,
              pollIntervalMs: 500,
            },
          },
        },
        emit: (line) => lines.push(line),
      });
      report.adjustments.push(lines);
      report.reads.push(await adopted(index + 2));
      note("public_adjustment_applied", { number: index + 1 });
      if (index === 0) {
        await streaming;
        const beforeRestart = await store.listMutationJournal(taskId);
        await stop("runtime");
        await stop("provider");
        note("processes_stopped");
        launch("provider");
        await providerReady();
        launch("runtime");
        await ready();
        const afterRestart = await store.listMutationJournal(taskId);
        if (JSON.stringify(beforeRestart) !== JSON.stringify(afterRestart))
          throw Error("RECOVERY_MUTATION_JOURNAL_CHANGED");
        report.restart = {
          beforePids: report.processes.slice(0, 2).map((x) => x.pid),
          afterPids: report.processes.slice(2).map((x) => x.pid),
          journalUnchanged: true,
        };
        const recovered = await adopted(2);
        report.reads.push(recovered);
        note("process_restart_recovered");
        streaming = stream("recovered");
      }
    }
    const final = await waitFor(
      "public_terminal",
      async () => {
        const task = await rpc("tasks/get", { taskId }, taskId);
        return ["completed", "failed", "cancelled"].includes(task.status) ? task : undefined;
      },
      180000,
    );
    report.task = final;
    if (final.status !== "completed") throw Error(`PUBLIC_TASK_TERMINAL:${final.status}`);
    report.finalSnapshot = await snapshot();
    report.execution = await store.getExecution(taskId);
    report.mutationJournal = await store.listMutationJournal(taskId);
    if (
      JSON.stringify(original.arguments) !== JSON.stringify(report.execution.arguments) ||
      original.argumentHash !== report.execution.argumentHash
    )
      throw Error("ORIGINAL_ARGUMENTS_CHANGED");
    if (
      report.execution.state !== "SUCCEEDED" ||
      report.finalSnapshot.summary.effectivePlanRevision !== 3
    )
      throw Error("FINAL_EXECUTION_INVALID");
    await streaming;
    if (
      !["initial", "recovered"].every((window) =>
        report.streams.some((x) => x.window === window && x.type === "businessEvent"),
      ) ||
      report.streams.some((x) => x.type === "error" || x.type === "streamFailure")
    )
      throw Error("PUBLIC_SSE_NOT_QUALIFIED");
    report.status = "PUBLIC_NAVIGATION_AND_PROCESS_RESTART_PASS";
    note("public_pass", { taskId });
  } catch (error) {
    report.status = "FAILED";
    report.reason = error.message;
    process.exitCode = 1;
    note("failed", { reason: report.reason });
  } finally {
    if (taskId && report.status !== "PUBLIC_NAVIGATION_AND_PROCESS_RESTART_PASS") {
      try {
        await rpc("tasks/cancel", { taskId }, taskId);
        report.cleanup = await waitFor(
          "cancel",
          async () => {
            const task = await rpc("tasks/get", { taskId }, taskId);
            return ["completed", "failed", "cancelled"].includes(task.status) ? task : undefined;
          },
          35000,
        );
      } catch (error) {
        report.cleanup = { status: "UNCONFIRMED", reason: error.message };
      }
    }
    // Close the producer of an outstanding SSE body before awaiting a failed probe.
    if (report.status === "FAILED") await stop("runtime");
    await streaming;
    await stop("runtime");
    await stop("provider");
    await store.close();
    report.completedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  }
}
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function waitFor(stage, action, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await action();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Error(`QUALIFICATION_TIMEOUT:${stage}`);
}
