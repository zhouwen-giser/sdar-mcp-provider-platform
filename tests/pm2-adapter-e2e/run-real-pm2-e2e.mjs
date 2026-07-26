import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

const root = process.cwd();
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("TEST_DATABASE_URL is required for real PM2 E2E");
}

const processName = "sdar-runtime-e2e-baseline-0";
const sentinelName = "unrelated-e2e-sentinel";
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "sdar-pm2-e2e-"));
const pm2Home = resolve(temporaryRoot, "pm2");
const secretFile = resolve(temporaryRoot, "runtime-database-url");
const ecosystemFile = resolve(temporaryRoot, "ecosystem.config.js");
const runtimePort = await freePort();
const adapterPort = await freePort();
const pm2Environment = sanitizedPm2Environment(pm2Home);
let adapter;
let pm2Started = false;
let adapterDiagnostics = "";

try {
  await mkdir(pm2Home, { recursive: true });
  await writeFile(secretFile, `${databaseUrl}\n`, { mode: 0o600 });
  await chmod(secretFile, 0o600);
  await writeFile(ecosystemFile, ecosystem(runtimePort, adapterPort, secretFile), {
    mode: 0o600,
  });

  adapter = spawn("node", ["dist/examples/mock-adapter-typescript/src/main.js"], {
    cwd: root,
    env: {
      PATH: requiredEnvironment("PATH"),
      LOG_LEVEL: "error",
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(adapterPort),
      PROVIDER_ID: "mock-provider",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  adapter.stdout.on("data", (chunk) => {
    adapterDiagnostics += String(chunk);
  });
  adapter.stderr.on("data", (chunk) => {
    adapterDiagnostics += String(chunk);
  });
  await waitForTcp(adapterPort, adapter);

  pm2Started = true;
  const pm2Version = (await pm2(["--version"])).trim().split("\n").at(-1) ?? "unknown";
  await pm2([
    "start",
    resolve(root, "tests/pm2-adapter-e2e/fixtures/sentinel.mjs"),
    "--name",
    sentinelName,
  ]);
  await pm2(["start", ecosystemFile, "--only", processName]);

  const initialHealth = await waitForReady(runtimePort);
  const initial = requiredProcess(await jlist(), processName);
  const sentinelBefore = requiredProcess(await jlist(), sentinelName);
  const initialPid = requiredPid(initial);

  process.kill(initialPid, "SIGKILL");
  const restarted = await waitForRestart(initialPid);
  const recoveredHealth = await waitForReady(runtimePort);

  await pm2(["stop", processName]);
  const stopped = await waitForStatus(processName, "stopped");
  await pm2(["delete", processName]);
  await waitForMissing(processName);
  const sentinelAfter = requiredProcess(await jlist(), sentinelName);
  if (sentinelAfter.pm2_env?.status !== "online") {
    throw new Error("NON_PLATFORM_SENTINEL_WAS_MANAGED");
  }
  await pm2(["delete", sentinelName]);

  const evidence = {
    schemaVersion: "1.0",
    taskId: "G2-P3-B12",
    generatedAt: new Date().toISOString(),
    resourceClassification: {
      pm2: "real",
      runtime: "built SDAR Runtime",
      adapter: "mock Adapter",
      database: "real local PostgreSQL",
      certificationClaim: "component E2E; not provider Interop Certified",
    },
    pm2: {
      version: pm2Version,
      isolatedHome: true,
      processName,
      mode: initial.pm2_env?.exec_mode,
      initialStatus: initial.pm2_env?.status,
      initialPid,
      restartStatus: restarted.pm2_env?.status,
      restartedPid: requiredPid(restarted),
      restartCount: safeCount(restarted.pm2_env?.restart_time),
      stoppedStatus: stopped.pm2_env?.status,
      deleted: true,
      nonPlatformSentinel: {
        name: sentinelName,
        statusBefore: sentinelBefore.pm2_env?.status,
        statusAfterPlatformDelete: sentinelAfter.pm2_env?.status,
      },
    },
    health: {
      initial: initialHealth,
      afterCrashRecovery: recoveredHealth,
    },
    security: {
      databaseCredentialTransport: "DATABASE_URL_FILE",
      plaintextDatabaseUrlInEvidence: false,
      pm2HomeIsolated: true,
    },
  };
  const evidenceDirectory = resolve(root, "reports/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, "G2-P3-B12-real-pm2-e2e.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  const processSnapshot = pm2Started ? await jlist().catch(() => []) : [];
  const logs = pm2Started
    ? await pm2(["logs", processName, "--nostream", "--lines", "100"]).catch(() => "")
    : "";
  process.stderr.write(
    `${sanitizeDiagnostics(
      JSON.stringify({
        error: error instanceof Error ? error.message : "PM2_E2E_FAILED",
        processes: processSnapshot.map((value) => ({
          name: value.name,
          pid: value.pid,
          status: value.pm2_env?.status,
          restartCount: value.pm2_env?.restart_time,
          exitCode: value.pm2_env?.exit_code,
        })),
        runtimeLogs: logs,
        adapterLogs: adapterDiagnostics,
      }),
      databaseUrl,
    )}\n`,
  );
  throw error;
} finally {
  if (pm2Started) {
    await pm2(["delete", processName]).catch(() => undefined);
    await pm2(["delete", sentinelName]).catch(() => undefined);
    await pm2(["kill"]).catch(() => undefined);
  }
  if (adapter !== undefined) {
    adapter.kill("SIGTERM");
    await waitForExit(adapter, 5_000).catch(() => adapter.kill("SIGKILL"));
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function ecosystem(httpPort, grpcPort, databaseUrlFile) {
  return `module.exports = ${JSON.stringify(
    {
      apps: [
        {
          name: processName,
          script: resolve(root, "dist/apps/runtime/src/main.js"),
          cwd: root,
          exec_mode: "fork",
          instances: 1,
          autorestart: true,
          restart_delay: 1_000,
          max_restarts: 3,
          min_uptime: 1_000,
          max_memory_restart: 512 * 1024 * 1024,
          kill_timeout: 5_000,
          env: {
            NODE_ENV: "test",
            RUNTIME_ENV: "test",
            HOST: "127.0.0.1",
            PORT: String(httpPort),
            PROVIDER_ID: "mock-provider",
            DATABASE_URL_FILE: databaseUrlFile,
            ADAPTER_ENDPOINT: `127.0.0.1:${String(grpcPort)}`,
            ADAPTER_TLS_MODE: "disabled",
            LOG_LEVEL: "error",
            OTEL_ENABLED: "false",
            PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
            BUSINESS_EVENTS_ENABLED: "false",
            PMS_DEPLOYMENT_ID: "deployment-pm2-e2e",
            PMS_INSTANCE_ID: "instance-pm2-e2e",
          },
        },
      ],
    },
    null,
    2,
  )};\n`;
}

async function pm2(args) {
  return run(
    "pnpm",
    ["dlx", "pm2", ...args],
    pm2Environment,
    args.includes("jlist") ? 20_000 : 40_000,
  );
}

async function jlist() {
  const output = await pm2(["jlist"]);
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("PM2_JLIST_INVALID");
  return JSON.parse(output.slice(start, end + 1));
}

async function waitForRestart(previousPid) {
  return waitFor(
    async () => {
      const value = (await jlist()).find(({ name }) => name === processName);
      return value !== undefined &&
        value.pm2_env?.status === "online" &&
        safeCount(value.pm2_env?.restart_time) >= 1 &&
        value.pid !== previousPid
        ? value
        : null;
    },
    30_000,
    "PM2_RESTART_TIMEOUT",
  );
}

async function waitForStatus(name, status) {
  return waitFor(
    async () => {
      const value = (await jlist()).find((candidate) => candidate.name === name);
      return value?.pm2_env?.status === status ? value : null;
    },
    20_000,
    `PM2_${status.toUpperCase()}_TIMEOUT`,
  );
}

async function waitForMissing(name) {
  await waitFor(
    async () => ((await jlist()).some((candidate) => candidate.name === name) ? null : true),
    20_000,
    "PM2_DELETE_TIMEOUT",
  );
}

async function waitForReady(port) {
  return waitFor(
    async () => {
      try {
        const live = await globalThis.fetch(`http://127.0.0.1:${String(port)}/health/live`);
        const ready = await globalThis.fetch(`http://127.0.0.1:${String(port)}/health/ready`);
        const liveBody = await live.json();
        const readyBody = await ready.json();
        return live.status === 200 &&
          ready.status === 200 &&
          liveBody.status === "live" &&
          readyBody.status === "ready"
          ? { live: true, ready: true }
          : null;
      } catch {
        return null;
      }
    },
    45_000,
    "RUNTIME_READY_TIMEOUT",
  );
}

async function waitForTcp(port, child) {
  await waitFor(
    () =>
      new Promise((resolveProbe, rejectProbe) => {
        if (child.exitCode !== null) {
          rejectProbe(new Error("MOCK_ADAPTER_EXITED"));
          return;
        }
        const socket = connect({ host: "127.0.0.1", port });
        socket.once("error", () => resolveProbe(null));
        socket.once("connect", () => {
          socket.end();
          resolveProbe(true);
        });
      }),
    15_000,
    "MOCK_ADAPTER_START_TIMEOUT",
  );
}

async function waitFor(operation, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result !== null && result !== false) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(code);
}

function run(command, args, env, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`COMMAND_FAILED:${command}:${args.at(-1) ?? ""}:${stderr.trim()}`));
    });
  });
}

function sanitizedPm2Environment(home) {
  return {
    PATH: requiredEnvironment("PATH"),
    HOME: requiredEnvironment("HOME"),
    LANG: process.env.LANG ?? "C.UTF-8",
    PM2_HOME: home,
    ...(process.env.PNPM_CONFIG_STORE_DIR === undefined
      ? {}
      : { PNPM_CONFIG_STORE_DIR: process.env.PNPM_CONFIG_STORE_DIR }),
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name}_IS_REQUIRED`);
  return value;
}

function requiredProcess(processes, name) {
  const value = processes.find((candidate) => candidate.name === name);
  if (value === undefined) throw new Error(`PM2_PROCESS_MISSING:${name}`);
  return value;
}

function requiredPid(value) {
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error("PM2_PID_INVALID");
  return value.pid;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sanitizeDiagnostics(value, secret) {
  return value
    .replaceAll(secret, "<redacted-database-url>")
    .replace(/postgres(?:ql)?:\/\/[^\s"'\\]+/gi, "<redacted-database-url>")
    .slice(0, 32_000);
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPort(new Error("FREE_PORT_ALLOCATION_FAILED"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => rejectExit(new Error("PROCESS_EXIT_TIMEOUT")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}
