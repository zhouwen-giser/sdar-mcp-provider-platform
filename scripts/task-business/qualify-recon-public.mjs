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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
    "node --import tsx scripts/task-business/qualify-recon-public.mjs --fixture /private/gowm-test.json --report /private/public-recon.json --allow-motion [--approach] [--map-full]\nRequires SMPP_UGV_SOURCE_QUALIFICATION_ALLOW_MOTION=true. Runs production Provider/Runtime entrypoints on loopback with a disposable selected GOWM app fixture and JWT authentication. Public MCP for task creation, business reads, two trusted input decisions and recon cancellation. Optional --approach navigates near the previously authorized area. Independent read-only device status confirms effects. Fire disabled. No production deployment.",
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
  const privateDir = await mkdtemp(join(tmpdir(), "smpp-public-recon-"));
  const report = {
    schema: "smpp.public-recon-qualification/v1",
    runId,
    startedAt: new Date().toISOString(),
    status: "NOT_RUN",
    fireEnabled: false,
    capturePublicPayloads: true,
    mapFull: args.includes("--map-full"),
    sceneInstanceId: fixture.dataScopeKey,
    steps: [],
    reads: [],
    streams: [],
    decisions: [],
    runs: [],
    observations: [],
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
    args.includes("--map-full")
      ? await readFile("deploy/development/server/profiles/ugv-business.json", "utf8")
      : JSON.stringify({
          ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
          enabled: true,
          visualLockOwner: "provider",
          decisionMode: "user_required",
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
      sub: "recon-qualification",
      tenant: "smpp-test",
      actor_type: "user",
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
            "io.modelcontextprotocol/clientInfo": { name: "smpp-public-recon", version: "1" },
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
  const observer = new Client(
    { name: "smpp-recon-read-only-observer", version: "1" },
    { capabilities: {} },
  );
  const observe = async (name) => {
    if (!["get_status", "ugv_area_recon_get_status", "ugv_area_recon_get_targets"].includes(name))
      throw Error("OBSERVER_READ_ONLY");
    const raw = await observer.callTool({ name, arguments: {} }, undefined, { timeout: 7000 });
    if (raw.isError) throw Error("DEVICE_OBSERVER_ERROR");
    const value =
      raw.structuredContent ?? JSON.parse(raw.content.find((c) => c.type === "text").text);
    report.observations.push({ at: new Date().toISOString(), name, value });
    return value;
  };
  let taskId;
  let streaming;
  const snapshot = async () => {
    let summary;
    const objects = [];
    await runReadOnlyTaskBusinessProbe({
      mcpUrl,
      taskId,
      snapshotOnly: true,
      maxPageBytes: 1048576,
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
    const durationMs = 45000;
    let timeout;
    return Promise.race([
      runReadOnlyTaskBusinessProbe({
        mcpUrl,
        taskId,
        bearerToken,
        fetchImpl: fetchWithAuth,
        durationMs,
        maxPageBytes: 1048576,
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
  const createTask = async (name, arguments_, key) => {
    const result = await rpc(
      "tools/call",
      {
        name,
        arguments: arguments_,
        _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: key } },
      },
      name,
    );
    if (result.resultType !== "task" || !result.taskId) throw Error("PUBLIC_TASK_CREATE_FAILED");
    taskId = result.taskId;
    note("public_task_created", { name, taskId });
    return taskId;
  };
  const cancelCurrent = async () => {
    await rpc("tasks/cancel", { taskId }, taskId);
    const stopped = await waitFor(
      "recon_task_cancelled",
      async () => {
        const task = await rpc("tasks/get", { taskId }, taskId);
        return ["completed", "failed", "cancelled"].includes(task.status) ? task : undefined;
      },
      35000,
    );
    const deviceStatus = await observe("ugv_area_recon_get_status");
    if (deviceStatus.status !== 9 || deviceStatus.lock?.stage !== 1)
      throw Error("RECON_STOP_NOT_OBSERVED");
    report.runs.at(-1).stopped = stopped;
    report.runs.at(-1).final = await snapshot();
    taskId = undefined;
  };
  try {
    await observer.connect(
      new StreamableHTTPClientTransport(new URL("http://192.168.2.63:19000/mcp")),
      { timeout: 5000 },
    );
    report.baseline = await observe("ugv_area_recon_get_status");
    if (![1, 8, 9, 10, 11].includes(report.baseline.status) || report.baseline.lock?.stage !== 1)
      throw Error("RECON_BASELINE_NOT_STOPPED");
    if (
      report.baseline.online !== true ||
      report.baseline.camera_fault ||
      ![1, 2].includes(report.baseline.load_status)
    )
      throw Error("RECON_LOAD_NOT_READY");
    launch("provider");
    await providerReady();
    launch("runtime");
    report.discovery = await ready();
    report.tools = await rpc("tools/list");
    const tool = report.tools.tools.find((t) => t.name === "vehicle_area_recon");
    if (!tool || !JSON.stringify(tool).includes("target.disposition_decision"))
      throw Error("PUBLIC_RECON_INPUT_PROFILE_MISSING");
    note("public_ready");
    if (args.includes("--approach")) {
      await createTask(
        "vehicle_navigate",
        {
          resourceId: fixture.resourceIds[0],
          mission: { type: "route", waypoints: [{ longitude: 106.81312856, latitude: 29.71895 }] },
          speedLimitKmh: 5,
          stopOnObstacle: true,
        },
        `${runId}:approach`,
      );
      report.approach = { taskId };
      const terminalTask = await waitFor(
        "approach_terminal",
        async () => {
          const task = await rpc("tasks/get", { taskId }, taskId);
          return ["completed", "failed", "cancelled"].includes(task.status) ? task : undefined;
        },
        240000,
      );
      report.approach.task = terminalTask;
      report.approach.execution = await store.getExecution(taskId);
      report.approach.position = await observe("get_status");
      if (terminalTask.status !== "completed") throw Error("APPROACH_NOT_COMPLETED");
      note("approach_completed", { taskId });
      taskId = undefined;
    }
    for (const decision of ["continue_observation", "decline"]) {
      await createTask(
        "vehicle_area_recon",
        {
          resourceId: fixture.resourceIds[0],
          scanMode: "area",
          scanCount: 0,
          area: {
            polygon: [
              { longitude: 106.81271124, latitude: 29.71821513 },
              { longitude: 106.81268055, latitude: 29.71864445 },
              { longitude: 106.81323289, latitude: 29.71869495 },
              { longitude: 106.81345382, latitude: 29.71816462 },
            ],
          },
          regionType: 5,
          lockDurationLimitSec: 0,
          reconType: "adaptive",
          scanSpeed: 30,
        },
        `${runId}:${decision}`,
      );
      const run = { taskId, decision };
      report.runs.push(run);
      streaming = stream(decision);
      run.locked = await waitFor(
        "public_policy_lock_and_input",
        async () => {
          const task = await rpc("tasks/get", { taskId }, taskId);
          if (["completed", "failed", "cancelled"].includes(task.status))
            throw Error(`RECON_TERMINAL_BEFORE_INPUT:${task.status}`);
          const s = await snapshot();
          const ref = s.summary.activeRefs["input:visualLock"];
          if (!ref) return undefined;
          const input = s.objects.find(
            (o) =>
              o.kind === "input_request" &&
              o.value.requestId === ref.id &&
              o.value.revision === ref.revision,
          )?.value;
          if (!input || input.state !== "pending") return undefined;
          const actionRef = input.subjectBinding.actionRef;
          const action = s.objects.find(
            (o) =>
              o.kind === "action" &&
              o.value.actionId === actionRef.id &&
              o.value.revision === actionRef.revision,
          )?.value;
          const targets = s.objects.filter(
            (o) => o.kind === "artifact" && o.value.artifactType === "target.object",
          );
          if (
            !action ||
            action.state !== "active" ||
            action.triggerOrigin !== "provider_policy" ||
            !targets.length
          )
            throw Error("INPUT_WITHOUT_QUALIFIED_POLICY_LOCK");
          if (
            !["STRICT_CORRELATED", "INFERRED_CURRENT_EXECUTION"].includes(
              action.properties.correlation,
            )
          )
            throw Error("LOCK_CORRELATION_MISSING");
          return { ...s, input, action };
        },
        120000,
      );
      run.execution = await store.getExecution(taskId);
      run.journal = await store.listMutationJournal(taskId);
      run.runtimeTask = await waitFor(
        "public_input_required",
        async () => {
          const task = await rpc("tasks/get", { taskId }, taskId);
          if (["completed", "failed", "cancelled"].includes(task.status))
            throw Error(`RECON_TERMINAL_BEFORE_PUBLIC_INPUT:${task.status}`);
          return task.status === "input_required" ? task : undefined;
        },
        15000,
      );
      run.deviceLock = await observe("ugv_area_recon_get_status");
      if (
        run.deviceLock.lock?.stage !== 3 ||
        String(run.deviceLock.lock.target_id) !== run.locked.input.subjectBinding.targetId
      )
        throw Error("DEVICE_ACTIVE_LOCK_MISMATCH");
      note("policy_lock_and_input", {
        taskId,
        correlation: run.locked.action.properties.correlation,
        targetId: run.locked.input.subjectBinding.targetId,
      });
      const pending = run.locked.input;
      await runUgvManualAcceptance({
        manifest: {
          schema: "sdar.ugv-manual-acceptance/v1",
          mcpUrl,
          taskId,
          sceneInstanceId: fixture.dataScopeKey,
          expectedTools: ["vehicle_area_recon"],
          snapshotOnly: true,
          maxPageBytes: 1048576,
          write: {
            kind: "input",
            manifest: {
              schema: "sdar.ugv-manual-input-probe/v1",
              mcpUrl,
              authorizationRef: "user-authorized-software-simulation-recon-supplement",
              sceneInstanceId: fixture.dataScopeKey,
              taskId,
              executionId: run.execution.externalExecutionId,
              providerId: fixture.providerId,
              resourceId: fixture.resourceIds[0],
              requestId: pending.requestId,
              requestKey: pending.requestKey,
              requestRevision: pending.revision,
              deadlineAt: pending.deadlineAt,
              lockSessionId: pending.subjectBinding.lockSessionId,
              targetId: pending.subjectBinding.targetId,
              decision,
              maxPolls: 30,
              maxPageBytes: 1048576,
              pollIntervalMs: 1000,
            },
          },
        },
        bearerToken,
        allowWrites: true,
        fetchImpl: fetchWithAuth,
        emit: (line) => report.decisions.push({ taskId, decision, ...line }),
      });
      run.afterDecision = await snapshot();
      run.deviceAfterDecision = await waitFor(
        "device_decision_effect",
        async () => {
          const value = await observe("ugv_area_recon_get_status");
          if (decision === "continue_observation")
            return value.lock?.stage === 3 &&
              String(value.lock.target_id) === pending.subjectBinding.targetId
              ? value
              : undefined;
          return value.status === 5 && value.lock?.stage === 1 ? value : undefined;
        },
        15000,
      );
      run.recoveredExecution = await waitFor(
        "provider_resume_confirmation",
        async () => {
          const execution = await store.getExecution(taskId);
          return execution.state === "RUNNING" && !execution.controlConfirmation
            ? execution
            : undefined;
        },
        15000,
      );
      if (report.mapFull) {
        run.mapSnapshot = await waitFor(
          "map_full_geometry",
          async () => {
            const s = await snapshot();
            const currentRef = s.summary.context.activeRefs.currentFootprint;
            const footprint = s.objects.find(
              (x) =>
                x.kind === "artifact" &&
                x.value.artifactType === "recon.current_footprint" &&
                x.value.artifactId === currentRef?.id &&
                x.value.revision === currentRef.revision &&
                x.value.availability === "available" &&
                x.value.properties.quality === "estimated" &&
                Date.parse(x.value.validUntil) > Date.now(),
            );
            const coverage = s.objects
              .filter((x) => x.kind === "artifact" && x.value.artifactType === "recon.covered_area")
              .sort((a, b) => b.value.revision - a.value.revision)[0];
            return footprint &&
              (decision !== "decline" || coverage?.value.availability === "available")
              ? s
              : undefined;
          },
          30000,
        );
        note("map_full_geometry_pass", { taskId, decision });
      }
      run.finalJournal = await store.listMutationJournal(taskId);
      await cancelCurrent();
      await streaming;
      note("decision_completed", { decision, taskId: run.taskId });
    }
    if (
      report.streams.some((x) => x.type === "error" || x.type === "streamFailure") ||
      !report.runs.every((run) =>
        report.streams.some((x) => x.type === "businessEvent" && x.window === run.decision),
      )
    )
      throw Error("PUBLIC_SSE_NOT_QUALIFIED");
    report.status = "PUBLIC_RECON_AND_INPUT_PASS";
    note("public_pass", { tasks: report.runs.map((r) => r.taskId) });
  } catch (error) {
    report.status = "FAILED";
    report.reason = error.message;
    process.exitCode = 1;
    note("failed", { reason: report.reason });
  } finally {
    if (taskId && report.status !== "PUBLIC_RECON_AND_INPUT_PASS") {
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
    try {
      report.finalDeviceStatus = await observe("ugv_area_recon_get_status");
      report.finalDeviceTargets = await observe("ugv_area_recon_get_targets");
    } catch (error) {
      report.observerError = error.message;
    }
    await observer.close();
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
