import { generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { connect, type MqttClient } from "mqtt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { HistoryPageSchema } from "../../packages/trajectory-history/src/contract.js";
import { RetainedHistoryVerifier } from "../../packages/trajectory-history/src/proof.js";

const file = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
const suffix = randomUUID().replaceAll("-", "");
const providerSchema = "history_crash_provider_" + suffix,
  runtimeSchema = "history_crash_runtime_" + suffix;
const providerId = "isr.vehicle.ugv.history-crash-simulated";
const keys = generateKeyPairSync("ed25519");
let admin: Pool, runtime: RuntimeApplication, worker: ChildProcess, publisher: MqttClient;
let privateDir: string,
  workerConfigFile: string,
  url: string,
  brokerContainer: string,
  brokerStopped = false;
let config: { databaseUrl: string; brokerUrl: string; brokerContainer: string };
let workerConfig: {
  databaseUrl: string;
  brokerUrl: string;
  providerId: string;
  port: number;
  keyFile: string;
};
async function startWorker(): Promise<{ port: number }> {
  writeFileSync(workerConfigFile, JSON.stringify(workerConfig), { mode: 0o600 });
  worker = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/trajectory-history-writer.ts"],
    {
      env: { ...process.env, SMPP_TRAJECTORY_WORKER_CONFIG_FILE: workerConfigFile },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((resolve, reject) => {
    let output = "",
      errors = "";
    const timer = setTimeout(
      () => reject(Error("SIMULATED_WORKER_START_TIMEOUT:" + errors)),
      10000,
    );
    worker.stderr?.on("data", (bytes: Buffer) => {
      errors += bytes.toString();
    });
    worker.stdout?.on("data", (bytes: Buffer) => {
      output += bytes.toString();
      if (output.includes("\n")) {
        clearTimeout(timer);
        resolve(JSON.parse(output.split("\n")[0] ?? "") as { port: number });
      }
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!output) reject(Error("SIMULATED_WORKER_START_FAILED:" + String(code) + ":" + errors));
    });
  });
}
async function stopWorker(signal: NodeJS.Signals) {
  if (worker?.exitCode !== null || worker.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
    worker.kill(signal);
  });
}
async function request(args: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "vehicle_get_trajectory_history",
      "x-sdar-subject": "history-crash-reader",
      "x-sdar-tenant": "history-crash-tenant",
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "SIMULATED-crash",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: {
        name: "vehicle_get_trajectory_history",
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "SIMULATED-crash-reader",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
        arguments: { resourceId: "vehicle:ugv1", historyVersion: "1.0", ...args },
      },
    }),
  });
  const json = (await response.json()) as {
    result?: { structuredContent?: unknown; isError?: boolean };
    error?: unknown;
  };
  if (json.error || json.result?.isError)
    throw Error("SIMULATED_PUBLIC_HISTORY_READ_FAILED:" + JSON.stringify(json));
  return HistoryPageSchema.parse(json.result?.structuredContent);
}
async function waitHistory(
  predicate: (page: ReturnType<typeof HistoryPageSchema.parse>) => boolean,
) {
  const deadline = Date.now() + 12000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const page = await request();
      if (predicate(page)) return page;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("SIMULATED_HISTORY_RECOVERY_TIMEOUT:" + String(last));
}
async function publish(longitude: number, retained = false) {
  await publisher.publishAsync(
    "/ugv/gnss",
    JSON.stringify({ entity_id: "ugv1", longitude, latitude: 30 }),
    { qos: 1, retain: retained },
  );
}

describe.skipIf(!file)(
  "SIMULATED actual process crash, persistent proof cursor and MQTT disconnect / public MCP",
  () => {
    beforeAll(async () => {
      if (!file) throw Error("ISOLATED_HISTORY_CONFIG_REQUIRED");
      config = JSON.parse(readFileSync(file, "utf8")) as typeof config;
      if (
        !new URL(config.databaseUrl).pathname.includes("test") ||
        !config.brokerUrl.startsWith("mqtt://127.0.0.1:")
      )
        throw Error("ISOLATED_CRASH_INFRASTRUCTURE_REQUIRED");
      brokerContainer = config.brokerContainer;
      const inspected = (
        JSON.parse(execFileSync("docker", ["inspect", brokerContainer], { encoding: "utf8" })) as {
          Config: { Labels: Record<string, string> };
        }[]
      )[0];
      if (!inspected) throw Error("TASK_OWNED_TEST_BROKER_MISSING");
      if (inspected.Config.Labels["codex.owner"] !== "trajectory-history-authority")
        throw Error("TASK_OWNED_TEST_BROKER_REQUIRED");
      admin = new Pool({ connectionString: config.databaseUrl });
      await admin.query(`CREATE SCHEMA ${providerSchema};CREATE SCHEMA ${runtimeSchema}`);
      const providerUrl = new URL(config.databaseUrl);
      providerUrl.searchParams.set("options", "-c search_path=" + providerSchema);
      const native = new Pool({ connectionString: providerUrl.toString() });
      await runUgvProviderMigrations(native);
      await native.end();
      const runtimeUrl = new URL(config.databaseUrl);
      runtimeUrl.searchParams.set("options", "-c search_path=" + runtimeSchema);
      const db = new Pool({ connectionString: runtimeUrl.toString() });
      await runMigrations(db);
      await db.end();
      privateDir = mkdtempSync(join(tmpdir(), "history-crash-private-"));
      workerConfigFile = join(privateDir, "config.json");
      const keyFile = join(privateDir, "signing.pem");
      writeFileSync(keyFile, keys.privateKey.export({ format: "pem", type: "pkcs8" }), {
        mode: 0o600,
      });
      workerConfig = {
        databaseUrl: providerUrl.toString(),
        brokerUrl: config.brokerUrl,
        providerId,
        port: 0,
        keyFile,
      };
      const ready = await startWorker();
      workerConfig.port = ready.port;
      runtime = createRuntime(
        loadRuntimeConfig({
          RUNTIME_ENV: "test",
          PROVIDER_ID: providerId,
          DATABASE_URL: runtimeUrl.toString(),
          ADAPTER_ENDPOINT: "127.0.0.1:" + String(ready.port),
          ADAPTER_TLS_MODE: "disabled",
          AUTH_MODE: "trusted_headers",
          LOG_LEVEL: "error",
          OTEL_ENABLED: "false",
          PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
          BUSINESS_EVENTS_ENABLED: "false",
          SCHEDULER_POLL_MS: "60000",
        }),
      );
      await runtime.initialize();
      await runtime.app.listen({ host: "127.0.0.1", port: 0 });
      const address = runtime.app.server.address();
      if (!address || typeof address === "string") throw Error("SIMULATED_CRASH_HTTP_BIND_FAILED");
      url = "http://127.0.0.1:" + String(address.port) + "/mcp";
      publisher = connect(config.brokerUrl, { reconnectPeriod: 100 });
      await new Promise<void>((resolve, reject) => {
        publisher.once("connect", () => resolve());
        publisher.once("error", reject);
      });
      await publish(114, true);
      await waitHistory((page) => page.entries.length >= 1);
      await publish(114.01);
      await publish(114.02);
      await waitHistory((page) => page.entries.length >= 3);
    }, 30000);
    afterAll(async () => {
      if (brokerStopped) execFileSync("docker", ["start", brokerContainer]);
      if (publisher) {
        await publisher.publishAsync("/ugv/gnss", "", { retain: true });
        await publisher.endAsync();
      }
      await runtime?.app.close();
      await stopWorker("SIGTERM");
      if (admin) {
        await admin.query(
          `DROP SCHEMA IF EXISTS ${providerSchema} CASCADE;DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`,
        );
        await admin.end();
      }
      if (privateDir) rmSync(privateDir, { recursive: true, force: true });
    }, 30000);
    it("resumes the exact signed finite snapshot after SIGKILL and reports the unclean capture window", async () => {
      const first = await request({ limit: 1 });
      expect(first.nextCursor).not.toBeNull();
      const verifier = new RetainedHistoryVerifier(
        first.snapshot,
        keys.publicKey,
        first.snapshot.manifest.scope,
      );
      first.entries.forEach((entry) => verifier.accept(entry));
      await stopWorker("SIGKILL");
      await startWorker();
      await waitHistory((page) => page.snapshot.manifest.recovery.uncleanSessionCount === 1);
      let next = await request({ pageCursor: first.nextCursor });
      for (;;) {
        expect(next.snapshot).toEqual(first.snapshot);
        next.entries.forEach((entry) => verifier.accept(entry));
        if (!next.nextCursor) break;
        next = await request({ pageCursor: next.nextCursor });
      }
      expect(verifier.finish(next.rangeReadFinished)).toEqual({
        retainedSetVerified: true,
        deviceHistoryComplete: false,
      });
      const current = await request();
      expect(current.snapshot.manifest.providerCaptureCoverage.reasons).toContain(
        "UNCLEAN_PROCESS_RECOVERY_WINDOW",
      );
      expect(current.snapshot.manifest.providerCaptureCoverage.status).toBe("unknown");
    }, 30000);
    it("records one transport outage and continues the same stream after the task-owned broker restarts", async () => {
      const before = await request();
      execFileSync("docker", ["stop", "--time", "1", brokerContainer]);
      brokerStopped = true;
      await waitHistory((page) => page.snapshot.manifest.recovery.disconnectCount >= 1);
      execFileSync("docker", ["start", brokerContainer]);
      brokerStopped = false;
      if (!publisher.connected)
        await new Promise<void>((resolve) => publisher.once("connect", () => resolve()));
      await publish(114.03, true);
      const recovered = await waitHistory(
        (page) =>
          BigInt(page.snapshot.manifest.highWatermark) >
          BigInt(before.snapshot.manifest.highWatermark),
      );
      expect(recovered.snapshot.manifest.scope).toEqual(before.snapshot.manifest.scope);
      expect(recovered.snapshot.manifest.providerCaptureCoverage.reasons).toContain(
        "SOURCE_TRANSPORT_DISCONNECTION_OBSERVED",
      );
      expect(recovered.snapshot.manifest.deviceGenerationHistory.status).toBe("unknown");
    }, 30000);
  },
);
