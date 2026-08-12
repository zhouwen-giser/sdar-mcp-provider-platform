import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import {
  createPmsApiComposition,
  type PmsApiComposition,
} from "../../../apps/pms-api/src/composition.js";
import { loadPmsApiBootstrapConfig } from "../../../apps/pms-api/src/config.js";
import {
  assertNoRuntimeJobs,
  createIsolatedPmsDatabase,
  PMS_CONSOLE_REAL_E2E,
  seedSyntheticConsoleData,
  type IsolatedPmsDatabase,
} from "./support.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const databaseUrl = requiredEnvironment("TEST_DATABASE_URL");
const fixture = PMS_CONSOLE_REAL_E2E;

let database: IsolatedPmsDatabase | undefined;
let composition: PmsApiComposition | undefined;
let web: ChildProcess | undefined;
let stopping = false;

try {
  database = await createIsolatedPmsDatabase(databaseUrl);
  const config = await loadPmsApiBootstrapConfig({
    PMS_API_HOST: fixture.apiHost,
    PMS_API_PORT: String(fixture.apiPort),
    PMS_API_RUNTIME_HEARTBEAT_TTL_MS: "30000",
    PMS_DATABASE_URL_FILE: database.credentials.databaseUrlFile,
    PMS_MANAGEMENT_CREDENTIAL_FILE: database.credentials.managementDescriptor,
    PMS_RUNTIME_CREDENTIAL_FILE: database.credentials.runtimeDescriptor,
  });
  composition = await createPmsApiComposition(config);
  await seedSyntheticConsoleData(database.pool, composition.app);
  await composition.app.listen({ host: fixture.apiHost, port: fixture.apiPort });

  web = spawn(process.execPath, ["scripts/serve-pms-web.mjs"], {
    cwd: workspaceRoot,
    env: webEnvironment(),
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitForWebReady();
  process.stdout.write(
    `PMS_WEB_REAL_E2E_READY web=http://${fixture.webHost}:${String(fixture.webPort)} schema=${database.schema}\n`,
  );
  await waitForShutdown(web);
} finally {
  stopping = true;
  await stopChild(web);
  if (database !== undefined) {
    await assertNoRuntimeJobs(database.pool).catch((error: unknown) => {
      process.stderr.write(`${safeErrorCode(error)}\n`);
      process.exitCode = 1;
    });
  }
  await composition?.close().catch(() => {
    process.exitCode = 1;
  });
  await database?.cleanup().catch(() => {
    process.exitCode = 1;
  });
}

function webEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(?:UGV_|ALLOW_REAL_DEVICE_|REAL_DEVICE_)/u.test(name),
    ),
  );
  return {
    ...environment,
    NODE_ENV: "production",
    PMS_WEB_DATA_MODE: "api",
    PMS_WEB_API_BASE: "/api/console/v1",
    PMS_WEB_API_UPSTREAM: `http://${fixture.apiHost}:${String(fixture.apiPort)}`,
    PMS_WEB_ROOT: resolve(workspaceRoot, "apps/pms-web/dist"),
    PMS_WEB_HOST: fixture.webHost,
    PMS_WEB_PORT: String(fixture.webPort),
    PMS_WEB_PROXY_MAX_BODY_BYTES: "1048576",
    PMS_WEB_PROXY_TIMEOUT_MS: "10000",
  };
}

async function waitForWebReady(): Promise<void> {
  const readyUrl = `http://${fixture.webHost}:${String(fixture.webPort)}/health/ready`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(1_000) }).catch(
      () => undefined,
    );
    if (response?.status === 200) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("PMS_WEB_REAL_E2E_READY_TIMEOUT");
}

async function waitForShutdown(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onSignal = () => resolvePromise();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (!stopping) {
        rejectPromise(
          new Error(`PMS_WEB_REAL_E2E_WEB_EXITED:${String(code ?? "none")}:${signal ?? "none"}`),
        );
      }
    });
  });
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child?.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name}_REQUIRED`);
  return value;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)
    ? error.message
    : "PMS_WEB_REAL_E2E_CLEANUP_FAILED";
}
