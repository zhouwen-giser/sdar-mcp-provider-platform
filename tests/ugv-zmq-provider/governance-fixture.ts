import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { z } from "zod";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { openZmqProvider } from "../../apps/ugv-zmq-provider-adapter/src/bootstrap.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import { isZmqExecution } from "../../packages/vehicle-zmq-control/src/index.js";
import { settings, emptyReport } from "../ugv-zmq-observer/helpers.js";
import { testScope, present } from "../ugv-zmq-control/helpers.js";
import {
  SimulatedZmqDevices,
  releaseSimulatorEndpoints,
} from "../ugv-zmq-control-postgres/simulator.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";

const file = process.env.SMPP_ZMQ_GOVERNANCE_FIXTURE_CONFIG;
if (!file || !process.send) throw Error("OWNED_IPC_FIXTURE_CONFIGURATION_REQUIRED");
const config = z
  .object({
    owner: z.literal("zmq-phase5-governance"),
    databaseUrl: z.url(),
    simulationId: z.string().min(1),
    evidenceFile: z.string().min(1),
  })
  .strict()
  .parse(JSON.parse(readFileSync(file, "utf8")));
const url = new URL(config.databaseUrl);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/zmq_governance")
  throw Error("OWNED_LOOPBACK_DATABASE_REQUIRED");
const suffix = randomUUID().replaceAll("-", ""),
  schemas = ["zmqgov_provider_", "zmqgov_runtime_", "zmqgov_archive_"].map((s) => s + suffix);
const admin = new Pool({ connectionString: config.databaseUrl, max: 2 });
let provider: Awaited<ReturnType<typeof openZmqProvider>> | undefined,
  runtime: ReturnType<typeof createRuntime> | undefined,
  device: SimulatedZmqDevices | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (provider && runtime && device) {
      await provider.engine.close();
      await provider.driver.stop();
      await provider.observer.stop();
      const executions = (await provider.store.pool.query("SELECT payload FROM ugv_execution"))
        .rows;
      const journal = (await provider.store.pool.query("SELECT payload FROM ugv_mutation_journal"))
        .rows;
      const commandOutbox = (
        await runtime.pool.query(
          "SELECT task_id,command_type,state,adapter_ack,last_error_code,last_error_message,attempt_count FROM task_command",
        )
      ).rows;
      const runtimeTasks = (
        await runtime.pool.query(
          "SELECT task_id,external_execution_id,internal_state,mcp_status,status_message,adapter_revision,schedule_claim_owner,schedule_claim_until FROM provider_task",
        )
      ).rows;
      const sessions = await provider.archive.sessions();
      const reception = [];
      for (const session of sessions) {
        let cursor = "0";
        for (let n = 0; n < 1000; n++) {
          const page = await provider.archive.page(session.sessionId, cursor, 200);
          reception.push(page);
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
          if (n === 999) throw Error("OWNED_EVIDENCE_EXPORT_BOUND");
        }
      }
      writeFileSync(
        config.evidenceFile,
        JSON.stringify(
          {
            classification: "ISOLATED_NATIVE_GOVERNANCE_FIXTURE",
            commands: device.commands,
            errors: device.errors,
            executions,
            journal,
            commandOutbox,
            runtimeTasks,
            sessions,
            reception,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
  } finally {
    await runtime?.app.close();
    await provider?.close();
    await device?.close();
    releaseSimulatorEndpoints();
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
try {
  for (const schema of schemas) await admin.query(`CREATE SCHEMA ${schema}`);
  const database = (schema: string) => {
    const target = new URL(config.databaseUrl);
    target.searchParams.set("options", "-c search_path=" + schema);
    return target.toString();
  };
  const migration = new Pool({ connectionString: database(present(schemas[0])), max: 1 });
  try {
    await runUgvProviderMigrations(migration);
  } finally {
    await migration.end();
  }
  await installObservationArchive(admin, present(schemas[2]));
  device = new SimulatedZmqDevices();
  const profile = await device.start();
  profile.executionDomain.simulationId = config.simulationId;
  provider = await openZmqProvider({
    databaseUrl: database(present(schemas[0])),
    observationDatabaseUrl: config.databaseUrl,
    profile,
    observerSettings: settings({
      schema: present(schemas[2]),
      diagnosticPartition: "SIMULATED-governance:" + suffix,
      flushIntervalMs: 5,
    }),
    controlSettings: testScope().settings,
  });
  await until(
    () =>
      present(provider).engine.availability({
        name: "camera.zoom",
        params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
      }).available,
  );
  runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      PROVIDER_ID: present(profile.providerBinding.providerId),
      DATABASE_URL: database(present(schemas[1])),
      ADAPTER_ENDPOINT: `127.0.0.1:${provider.port}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "development",
      LOG_LEVEL: "error",
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      BUSINESS_EVENTS_ENABLED: "true",
      SCHEDULER_POLL_MS: "100",
      BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
      RATE_LIMIT_MAX: "100000",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (!address || typeof address === "string") throw Error("OWNED_HTTP_FIXTURE_REQUIRED");
  process.send({
    ready: true,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    resourceId: profile.providerBinding.resourceId,
    providerId: profile.providerBinding.providerId,
    simulationId: config.simulationId,
  });
  let tail = Promise.resolve();
  process.on("message", (input: unknown) => {
    tail = tail
      .then(async () => {
        const message = z
          .object({
            id: z.string(),
            action: z.enum(["inspect", "complete", "finish", "fail", "stop", "status"]),
            report: z.enum(["empty", "missing"]).optional(),
          })
          .strict()
          .parse(input);
        try {
          const d = present(device),
            p = present(provider);
          if (message.action === "stop") {
            await stop();
            process.send?.({ id: message.id, result: "stopped" });
            process.disconnect?.();
            return;
          }
          if (message.action === "inspect") {
            await until(async () =>
              (await p.repository.pending()).some(
                (e) => e.state === "RUNNING" && e.operationName === "vehicle_zmq_inspect_area",
              ),
            );
            const e = (await p.repository.pending()).find(
              (v) => v.operationName === "vehicle_zmq_inspect_area",
            );
            if (!e || !isZmqExecution(e)) throw Error("OWNED_NATIVE_INSPECTION_REQUIRED");
            if (message.report !== "missing") {
              await d.publishReport(
                "targetlist",
                emptyReport({ task_id: e.zmqControl.nativeTaskId, observed_at_utc_ms: Date.now() }),
              );
              await until(
                async () =>
                  (await p.repository.get(e.taskId))?.zmqInspection?.targetReportCount === 1,
              );
            }
            d.completeRecon();
          }
          if (message.action === "finish") d.completeNavigation();
          if (message.action === "complete") d.completeRecon();
          if (message.action === "fail") {
            d.taskState = "failed";
            d.eoDevice = { ...d.eoDevice, mode: "idle", ready: true, active_task_id: null };
            await d.publish();
          }
          process.send?.({
            id: message.id,
            result: {
              commands: d.commands.length,
              runtimeTasks: (
                await present(runtime).pool.query(
                  "SELECT task_id,external_execution_id,internal_state,mcp_status,status_message FROM provider_task",
                )
              ).rows,
              active: (await p.repository.pending()).map((e) => ({
                taskId: e.taskId,
                state: e.state,
                operationName: e.operationName,
              })),
            },
          });
        } catch (error) {
          process.send?.({
            id: message.id,
            error: error instanceof Error ? error.message : "OWNED_FIXTURE_FAILED",
          });
        }
      })
      .catch((error: unknown) => {
        process.stderr.write(String(error) + "\n");
        process.exitCode = 1;
      });
  });
  process.on("disconnect", () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  });
} catch (error) {
  await stop();
  throw error;
}
