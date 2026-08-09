import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { Pool } from "pg";
import {
  BootstrapConfigRenderer,
  createPm2JavascriptApi,
  Pm2ProcessManager,
  RuntimeLifecycleManager,
} from "../../dist/packages/pm2-runtime-adapter/src/index.js";
import { runMigrations } from "../../dist/packages/persistence-postgres/src/index.js";

class MemoryLifecycleStore {
  completed = new Map();
  states = [];
  audits = [];

  async findCompleted(idempotencyKey) {
    return this.completed.get(idempotencyKey) ?? null;
  }

  async appendState(event) {
    this.states.push(event);
  }

  async complete(idempotencyKey, result) {
    this.completed.set(idempotencyKey, result);
  }

  async appendAudit(event) {
    this.audits.push(event);
  }
}

const root = process.cwd();
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("TEST_DATABASE_URL is required for real PM2 E2E");
}
const databaseSchema = `pm2_product_${randomUUID().replaceAll("-", "")}`;
const runtimeDatabaseUrl = withSearchPath(databaseUrl, databaseSchema);
const databaseAdmin = new Pool({ connectionString: databaseUrl });

const runtimeVersion = "2.0.0-rc.1";
const processName = "sdar-runtime-e2e-product-0";
const sentinelName = "unrelated-e2e-sentinel";
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "sdar-pm2-product-e2e-"));
const pm2Home = resolve(temporaryRoot, "pm2");
const releaseRoot = resolve(temporaryRoot, "runtime-releases");
const releaseDirectory = resolve(releaseRoot, runtimeVersion);
const runtimeEntry = resolve(releaseDirectory, "dist/apps/runtime/src/main.js");
const secretFile = resolve(temporaryRoot, "runtime-database-url");
const runtimePort = await freePort();
const adapterPort = await freePort();
const isolatedPm2Module = createIsolatedPm2Module(temporaryRoot);
const api = createPm2JavascriptApi({ pm2Home }, isolatedPm2Module);
const retainPm2Connection = process.platform === "win32";
const processes = new Pm2ProcessManager(api, releaseRoot, {
  restartDelayMs: 1_000,
  maxRestarts: 3,
  maxMemoryBytes: 512 * 1024 * 1024,
  minUptimeMs: 1_000,
});
const store = new MemoryLifecycleStore();
const cleanedSecrets = [];
const lifecycle = new RuntimeLifecycleManager(
  processes,
  {
    resolve: async (version) => {
      if (version !== runtimeVersion) throw new Error("RUNTIME_RELEASE_VERSION_UNKNOWN");
      return {
        version,
        releaseDirectory,
        runtimeEntry,
        manifestDigest: "d".repeat(64),
      };
    },
  },
  new BootstrapConfigRenderer(),
  {
    cleanup: async (ref) => {
      cleanedSecrets.push(ref.secretRef);
      return { secretRef: ref.secretRef, outcome: "deleted" };
    },
  },
  store,
);

const target = {
  providerId: "mock-provider",
  deploymentId: "deployment-pm2-e2e",
  environment: "test",
  runtimeVersion,
  instanceId: "instance-pm2-e2e",
  ordinal: 0,
  processName,
};
const startRequest = (configRevision, configChecksum) => ({
  target,
  configRevision,
  configChecksum,
  httpPort: runtimePort,
  databaseUrlFile: secretFile,
  effectiveConfig: {
    RUNTIME_ENV: "test",
    HOST: "127.0.0.1",
    ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
    ADAPTER_TLS_MODE: "disabled",
    LOG_LEVEL: "error",
    OTEL_ENABLED: false,
  },
});

let adapter;
let adapterDiagnostics = "";
let pm2Connected = false;
let migrationCount;

try {
  await mkdir(releaseDirectory, { recursive: true });
  await mkdir(pm2Home, { recursive: true });
  // Materialize the built release so PM2 launches an actual file rather than a
  // Windows junction. The installed dependency tree is mounted at the release
  // root because pnpm's workspace links are not release artifacts.
  await cp(resolve(root, "dist"), resolve(releaseDirectory, "dist"), { recursive: true });
  await cp(resolve(root, "proto"), resolve(releaseDirectory, "proto"), { recursive: true });
  await cp(resolve(root, "migrations"), resolve(releaseDirectory, "migrations"), {
    recursive: true,
  });
  await copyFile(resolve(root, "package.json"), resolve(releaseDirectory, "package.json"));
  await createDirectoryLink(
    resolve(root, "node_modules"),
    resolve(releaseDirectory, "node_modules"),
  );
  await databaseAdmin.query(`CREATE SCHEMA ${quoteIdentifier(databaseSchema)}`);
  const migrationPool = new Pool({ connectionString: runtimeDatabaseUrl });
  try {
    const result = await runMigrations(migrationPool, undefined, {
      workspaceRoot: releaseDirectory,
    });
    migrationCount = result.migrations.length;
  } finally {
    await migrationPool.end();
  }
  await writeFile(secretFile, `${runtimeDatabaseUrl}\n`, { mode: 0o600 });
  await chmod(secretFile, 0o600);

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

  await connectApi(api);
  pm2Connected = true;
  await startApi(api, sentinelOptions());
  if (!retainPm2Connection) {
    api.disconnect();
    pm2Connected = false;
  }

  const initialResult = await lifecycle.start(
    startRequest(1, "a".repeat(64)),
    operationContext("initial"),
  );
  const initialHealth = await waitForReady(runtimePort);
  const initial = await waitForProcess(
    () => processes.describe(processName),
    (value) => value.state === "online",
    "PM2_INITIAL_START_TIMEOUT",
  );
  const initialPid = requiredPid(initial);

  const unchangedResult = await lifecycle.start(
    startRequest(1, "a".repeat(64)),
    operationContext("no-op"),
  );
  const unchanged = await processes.describe(processName);
  if (unchangedResult.outcome !== "unchanged" || requiredPid(unchanged) !== initialPid) {
    throw new Error("PM2_NO_OP_RESTARTED");
  }

  const driftResult = await lifecycle.start(
    startRequest(2, "b".repeat(64)),
    operationContext("drift"),
  );
  const drifted = await waitForProcess(
    () => processes.describe(processName),
    (value) =>
      value.state === "online" &&
      value.fingerprints?.configRevision === "2" &&
      value.fingerprints?.bootstrapChecksum === "b".repeat(64),
    "PM2_DRIFT_RESTART_TIMEOUT",
  );
  if (driftResult.outcome !== "changed") throw new Error("PM2_DRIFT_WAS_NOT_APPLIED");
  const driftPid = requiredPid(drifted);
  const driftRestartCount = safeCount(drifted.restartCount);

  process.kill(driftPid, "SIGKILL");
  const recovered = await waitForProcess(
    () => processes.describe(processName),
    (value) =>
      value.state === "online" &&
      value.pid !== driftPid &&
      safeCount(value.restartCount) > driftRestartCount,
    "PM2_CRASH_RECOVERY_TIMEOUT",
  );
  const recoveredHealth = await waitForReady(runtimePort);

  const visibleProcesses = await processes.list();
  if (visibleProcesses.some(({ target: value }) => value.processName === sentinelName)) {
    throw new Error("NON_PLATFORM_SENTINEL_WAS_LISTED");
  }
  let sentinelRejected = false;
  try {
    await processes.delete(sentinelName);
  } catch (error) {
    sentinelRejected = error?.code === "PM2_PROCESS_NAME_FORBIDDEN";
  }
  if (!sentinelRejected) throw new Error("NON_PLATFORM_SENTINEL_WAS_MANAGED");

  const stopResult = await lifecycle.stop({ target }, operationContext("stop"));
  const stopped = await processes.describe(processName);
  const deleteResult = await lifecycle.delete(
    {
      target,
      secretFiles: [
        {
          name: "database-url",
          ref: { secretRef: "file/v1/deployment-pm2-e2e/instance-pm2-e2e/database-url" },
        },
      ],
    },
    operationContext("delete"),
  );
  const deleted = await processes.describe(processName);

  if (!retainPm2Connection) {
    await connectApi(api);
    pm2Connected = true;
  }
  const sentinelAfter = requiredDescription(await describeApi(api, sentinelName), sentinelName);
  await deleteApi(api, sentinelName);
  if (!retainPm2Connection) {
    api.disconnect();
    pm2Connected = false;
  }
  if (sentinelAfter.pm2_env?.status !== "online") {
    throw new Error("NON_PLATFORM_SENTINEL_WAS_NOT_PRESERVED");
  }

  const packageManifest = JSON.parse(
    await readFile(resolve(root, "node_modules/pm2/package.json"), "utf8"),
  );
  const evidence = {
    schemaVersion: "1.0",
    taskId: "G4-P1-B02",
    generatedAt: new Date().toISOString(),
    resourceClassification: {
      pm2: "real pinned JavaScript API",
      runtime: "built SDAR Runtime",
      adapter: "built mock Adapter",
      database: "real local PostgreSQL",
      certificationClaim: "product-path component E2E; not provider Interop Certified",
    },
    productPath: [
      "createPm2JavascriptApi",
      "Pm2ProcessManager",
      "RuntimeLifecycleManager",
      "built Runtime",
    ],
    pm2: {
      version: packageManifest.version,
      isolatedHome: true,
      processName,
      initialStatus: initial.state,
      initialPid,
      initialOutcome: initialResult.outcome,
      noOpOutcome: unchangedResult.outcome,
      driftOutcome: driftResult.outcome,
      driftedPid: driftPid,
      driftRestartCount,
      crashRecoveryStatus: recovered.state,
      recoveredPid: requiredPid(recovered),
      recoveredRestartCount: recovered.restartCount,
      stopOutcome: stopResult.outcome,
      stoppedStatus: stopped.state,
      deleteOutcome: deleteResult.outcome,
      deleted: deleted.state === "missing",
      nonPlatformSentinel: {
        name: sentinelName,
        excludedFromProductList: true,
        rejectedByProductManager: true,
        statusAfterPlatformDelete: sentinelAfter.pm2_env?.status,
      },
    },
    driftPolicy: {
      allowlistedPm2EnvironmentKeys: [
        "PMS_BOOTSTRAP_CHECKSUM",
        "PMS_CONFIG_REVISION",
        "PMS_RUNTIME_VERSION",
      ],
      noOpFingerprintMatch: true,
      configRevisionChangedFrom: 1,
      configRevisionChangedTo: 2,
      bootstrapChecksumChanged: true,
      runtimeVersionUnitCoverage: true,
    },
    health: {
      initial: initialHealth,
      afterCrashRecovery: recoveredHealth,
    },
    lifecycle: {
      stateEvents: store.states.map(({ action, state }) => ({ action, state })),
      auditEvents: store.audits.map(({ action }) => action),
      secretCleanup: cleanedSecrets.length === 1,
    },
    security: {
      databaseCredentialTransport: "DATABASE_URL_FILE",
      plaintextDatabaseUrlInEvidence: false,
      pm2HomeIsolated: true,
      directPm2CliUsed: false,
      configurationFileBypassUsed: false,
    },
    databaseIsolation: {
      isolatedSchema: true,
      releaseArtifactMigrationsApplied: migrationCount,
    },
  };
  const evidenceDirectory = resolve(root, "reports/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, "G4-P1-B02-real-pm2-product-path.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  await processes.delete(processName).catch(() => undefined);
  const processObservation = await processes.describe(processName).catch((observationError) => ({
    state: "diagnostic-error",
    error: observationError instanceof Error ? observationError.message : "DESCRIBE_FAILED",
  }));
  const daemonDiagnostics = await readFile(resolve(pm2Home, "pm2.log"), "utf8").catch(() => "");
  const runtimeDiagnostics = await readPm2ApplicationLogs(pm2Home, processName);
  process.stderr.write(
    `${sanitizeDiagnostics(
      JSON.stringify({
        error: error instanceof Error ? error.message : "PM2_PRODUCT_E2E_FAILED",
        processObservation,
        adapter: adapterDiagnostics,
        daemon: daemonDiagnostics.slice(-8_000),
        runtime: runtimeDiagnostics,
      }),
      databaseUrl,
    )}\n`,
  );
  throw error;
} finally {
  if (pm2Connected) {
    try {
      api.disconnect();
    } catch {
      // The primary test result remains authoritative.
    }
  }
  if (adapter !== undefined) {
    adapter.kill("SIGTERM");
    await waitForExit(adapter, 5_000).catch(() => adapter.kill("SIGKILL"));
  }
  if (process.env.KEEP_PM2_E2E_TEMP !== "YES") {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(`PM2_E2E_TEMP_RETAINED:${temporaryRoot}\n`);
  }
  await databaseAdmin
    .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(databaseSchema)} CASCADE`)
    .catch(() => undefined);
  await databaseAdmin.end().catch(() => undefined);
}
process.exit(0);

function operationContext(suffix) {
  return {
    operationId: `operation-${suffix}`,
    correlationId: `correlation-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    timeoutMs: 45_000,
    signal: new globalThis.AbortController().signal,
  };
}

function sentinelOptions() {
  return {
    name: sentinelName,
    script: resolve(root, "tests/pm2-adapter-e2e/fixtures/sentinel.mjs"),
    cwd: root,
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    restart_delay: 1_000,
    max_restarts: 3,
    max_memory_restart: 128 * 1024 * 1024,
    min_uptime: 1_000,
    kill_timeout: 5_000,
    env: { SENTINEL: "true" },
  };
}

function connectApi(value) {
  return new Promise((resolveConnect, rejectConnect) => {
    value.connect((error) => (error === undefined ? resolveConnect() : rejectConnect(error)));
  });
}

function startApi(value, options) {
  return new Promise((resolveStart, rejectStart) => {
    value.start(options, (error, descriptions) =>
      error === null ? resolveStart(descriptions ?? []) : rejectStart(error),
    );
  });
}

function describeApi(value, name) {
  return new Promise((resolveDescribe, rejectDescribe) => {
    value.describe(name, (error, descriptions) =>
      error === null ? resolveDescribe(descriptions ?? []) : rejectDescribe(error),
    );
  });
}

function deleteApi(value, name) {
  return new Promise((resolveDelete, rejectDelete) => {
    value.delete(name, (error) => (error === undefined ? resolveDelete() : rejectDelete(error)));
  });
}

function createIsolatedPm2Module(home) {
  const require = createRequire(import.meta.url);
  const Pm2Api = require("pm2/lib/API.js");
  if (process.platform !== "win32") return { custom: Pm2Api };

  // PM2 currently hard-codes Windows RPC/PUB pipes, so pm2_home alone can
  // attach to an unrelated daemon. Use unique pipes and an in-process daemon
  // for this isolated product-path fixture.
  const identity = home.slice(-32).replace(/[^A-Za-z0-9_-]/g, "-");
  const pipePrefix = `${String.fromCharCode(92, 92, 46, 92, 112, 105, 112, 101, 92)}sdar-pm2-${identity}`;
  return {
    custom: class IsolatedWindowsPm2Api extends Pm2Api {
      constructor(options) {
        super({ ...options, daemon_mode: false });
        const rpc = `${pipePrefix}-rpc`;
        const pub = `${pipePrefix}-pub`;
        this._conf.DAEMON_RPC_PORT = rpc;
        this._conf.DAEMON_PUB_PORT = pub;
        this.Client.rpc_socket_file = rpc;
        this.Client.pub_socket_file = pub;
      }
    },
  };
}

async function readPm2ApplicationLogs(home, name) {
  const logDirectory = resolve(home, "logs");
  const names = await readdir(logDirectory).catch(() => []);
  const values = await Promise.all(
    names
      .filter((value) => value.startsWith(name))
      .map((value) => readFile(resolve(logDirectory, value), "utf8").catch(() => "")),
  );
  return values.join("\n").slice(-8_000);
}

function waitForProcess(observe, predicate, code) {
  return waitFor(
    async () => {
      const value = await observe();
      return predicate(value) ? value : null;
    },
    45_000,
    code,
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

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name}_IS_REQUIRED`);
  return value;
}

async function createDirectoryLink(target, link) {
  try {
    await symlink(target, link, "dir");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (process.platform !== "win32" || !["EACCES", "EPERM", "EPROTO"].includes(code ?? "")) {
      throw error;
    }
    await symlink(target, link, "junction");
  }
}

function requiredDescription(values, name) {
  const value = values.find((candidate) => candidate.name === name);
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

function withSearchPath(connectionString, searchPath) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${searchPath}`);
  return url.toString();
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("TEST_IDENTIFIER_INVALID");
  return `"${value}"`;
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
