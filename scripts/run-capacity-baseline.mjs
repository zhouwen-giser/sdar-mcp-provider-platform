import { performance } from "node:perf_hooks";
import { cpus, totalmem } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../dist/examples/mock-adapter-typescript/src/server.js";
import { loadRuntimeConfig } from "../dist/apps/runtime/src/config.js";
import { createRuntime } from "../dist/apps/runtime/src/runtime.js";
import { OperationRegistry } from "../dist/packages/operation-registry/src/index.js";
import {
  OperationSnapshotRepository,
  TaskRepository,
} from "../dist/packages/persistence-postgres/src/index.js";
import {
  DurableCommandDispatcher,
  DurableScheduler,
  TaskEngine,
} from "../dist/packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

const runId = `${Date.now()}-${process.pid}`;
const resourcePrefix = `capacity-${runId}`;
const schema = `capacity_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
await adminPool.query(`CREATE SCHEMA "${schema}"`);
const isolatedDatabaseUrl = new URL(databaseUrl);
isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
let slowSideEffectResolve;
const slowSideEffect = new Promise((resolveSlowSideEffect) => {
  slowSideEffectResolve = resolveSlowSideEffect;
});
const commandSideEffects = new Map();
const adapter = createMockAdapterServer({
  providerId: "capacity-provider",
  startResponseDelayMs: 15_000,
  onStartSideEffect: () => slowSideEffectResolve?.(),
  onControlSideEffect: (taskId, command) => {
    const key = `${taskId}:${command}`;
    commandSideEffects.set(key, (commandSideEffects.get(key) ?? 0) + 1);
  },
});
const adapterPort = await bindMockAdapter(adapter, "127.0.0.1:0");
const runtimeEnvironment = {
  DATABASE_URL: isolatedDatabaseUrl.toString(),
  PROVIDER_ID: "capacity-provider",
  ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
  AUTH_MODE: "development",
  LOG_LEVEL: "warn",
  DATABASE_POOL_MAX: "1",
  ADAPTER_RPC_TIMEOUT_MS: "20000",
  IDEMPOTENCY_LEASE_MS: "60000",
  COMMAND_CLAIM_LEASE_MS: "60000",
  ADAPTER_HEALTH_POLL_MS: "300000",
  SCHEDULER_POLL_MS: "60000",
  RECOVERY_POLL_MS: "300000",
  TTL_CLEANER_POLL_MS: "3600000",
};
const runtime = createRuntime(loadRuntimeConfig(runtimeEnvironment));
const runtimeReplica2 = createRuntime(loadRuntimeConfig(runtimeEnvironment));
let client;

try {
  progress("initialize");
  const manifest = await runtime.initialize();
  await runtimeReplica2.initialize();
  const validatedManifest = new OperationRegistry().validate(manifest);
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (address === null || typeof address === "string") throw new Error("Runtime did not bind");
  client = createFrozenCapacityClient(new URL(`http://127.0.0.1:${String(address.port)}/mcp`));

  progress("slow-adapter-pool");
  const growthBefore = await relationGrowth(runtime.pool);
  const snapshotIds = await new OperationSnapshotRepository(runtime.pool).saveManifest(
    validatedManifest,
  );
  const capacityEngine = new TaskEngine(
    validatedManifest,
    snapshotIds,
    runtime.gateway,
    new TaskRepository(runtime.pool),
  );
  const durableOperation = validatedManifest.operations.find(
    (operation) => operation.name === "durable_task",
  );
  if (durableOperation === undefined) throw new Error("Capacity operation is not available");
  const slowStartRequest = capacityEngine.callOperation(
    durableOperation,
    { resourceId: `${resourcePrefix}-slow`, scenario: "slow_start" },
    { hash: "a".repeat(64), executionMode: "live", simulationId: null },
    60_000,
  );
  await slowSideEffect;
  progress("slow-adapter-side-effect-observed");
  const databaseWhileAdapterSlow = await timed(async () => runtime.pool.query("SELECT 1"));
  progress("slow-adapter-database-query-complete");
  const slowTask = await slowStartRequest;
  progress("slow-adapter-response-complete");
  if (slowTask.kind !== "task") throw new Error("Slow Adapter call did not publish a Task");
  if (databaseWhileAdapterSlow.durationMs >= 500) {
    throw new Error(
      `Pool max 1 query took ${databaseWhileAdapterSlow.durationMs.toFixed(1)}ms during slow Adapter RPC`,
    );
  }

  progress("workloads");
  const synchronous = await measure(100, async (index) => {
    const result = await client.callTool({
      name: "echo_sync",
      arguments: { message: `capacity-${index}` },
    });
    if (result.isError === true) throw new Error("Synchronous baseline call failed");
  });
  const concurrentTaskCount = 1000;
  const concurrentTasks = await timed(async () =>
    Promise.all(
      Array.from({ length: concurrentTaskCount }, (_, index) =>
        capacityEngine.callOperation(
          durableOperation,
          { resourceId: `${resourcePrefix}-task-${index}`, scenario: "queued_start" },
          { hash: "a".repeat(64), executionMode: "live", simulationId: null },
          60_000,
          undefined,
          {
            start: { mode: "immediate", startToleranceMs: 300_000 },
            maxElapsedMs: null,
          },
        ),
      ),
    ),
  );
  const concurrentTaskIds = concurrentTasks.value.map((outcome) => {
    if (outcome.kind !== "task") throw new Error("Concurrent admission did not publish a Task");
    return outcome.task.taskId;
  });

  progress("dispatcher");
  const repository = new TaskRepository(runtime.pool);
  const secondRepository = new TaskRepository(runtimeReplica2.pool);
  const dispatcherTaskCount = 500;
  const commandBurstTaskIds = concurrentTaskIds.slice(0, dispatcherTaskCount);
  await Promise.all(
    commandBurstTaskIds.map((taskId) =>
      capacityEngine.cancelTask(taskId, {
        hash: "a".repeat(64),
        executionMode: "live",
        simulationId: null,
      }),
    ),
  );
  const dispatchers = [
    new DurableCommandDispatcher(runtime.gateway, repository, undefined, "capacity-runtime-1"),
    new DurableCommandDispatcher(
      runtimeReplica2.gateway,
      secondRepository,
      undefined,
      "capacity-runtime-2",
    ),
  ];
  const dispatcherMeasurement = await timed(async () =>
    drainDispatchers(dispatchers, dispatcherTaskCount, async () => {
      const result = await runtime.pool.query(
        `SELECT count(*)::int AS count FROM task_command
         WHERE task_id=ANY($1::uuid[]) AND state='ACKNOWLEDGED'`,
        [commandBurstTaskIds],
      );
      return Number(result.rows[0]?.count ?? 0);
    }),
  );
  if (dispatcherMeasurement.value.durableAcknowledged !== dispatcherTaskCount) {
    throw new Error(
      `Dispatcher acknowledged ${dispatcherMeasurement.value.durableAcknowledged}/${dispatcherTaskCount}`,
    );
  }
  const commandBurstSideEffects = commandBurstTaskIds.map(
    (taskId) => commandSideEffects.get(`${taskId}:cancel`) ?? 0,
  );
  if (commandBurstSideEffects.some((count) => count !== 1)) {
    throw new Error("Two-replica command burst produced missing or duplicate Adapter side effects");
  }

  progress("scheduled-scan");
  const scheduledTaskCount = 32;
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
  for (let index = 0; index < scheduledTaskCount; index += 1) {
    await createScheduledTask(client, `${resourcePrefix}-scheduled-${index}`, scheduledAt);
  }
  const scheduler = new DurableScheduler(validatedManifest, runtime.gateway, repository);
  const secondScheduler = new DurableScheduler(
    validatedManifest,
    runtimeReplica2.gateway,
    secondRepository,
  );
  const scheduledScan = await timed(async () => scheduler.tick());
  if (scheduledScan.value.started !== 0 || scheduledScan.value.missed !== 0) {
    throw new Error("Future scheduled scan changed a Task before notBefore");
  }

  progress("watchdog-scan");
  const watchdogTaskCount = 16;
  for (let index = 0; index < watchdogTaskCount; index += 1) {
    await createImmediateWindowTask(client, `${resourcePrefix}-watchdog-${index}`);
  }
  await delay(150);
  const watchdogScan = await timed(async () => {
    const aggregate = { watchdogStops: 0, reconciled: 0 };
    let durableStopRequests = 0;
    for (let round = 0; durableStopRequests < watchdogTaskCount && round < 10; round += 1) {
      const results = await Promise.all([scheduler.tick(), secondScheduler.tick()]);
      for (const result of results) {
        aggregate.watchdogStops += result.watchdogStops;
        aggregate.reconciled += result.reconciled;
      }
      const confirmed = await runtime.pool.query(
        `SELECT count(*)::int AS count FROM provider_task
         WHERE arguments->>'resourceId' LIKE $1 AND stop_reason='START_WINDOW_MISSED'`,
        [`${resourcePrefix}-watchdog-%`],
      );
      durableStopRequests = Number(confirmed.rows[0]?.count ?? 0);
    }
    return { ...aggregate, durableStopRequests };
  });
  if (watchdogScan.value.durableStopRequests !== watchdogTaskCount) {
    throw new Error(
      `Watchdog persisted ${watchdogScan.value.durableStopRequests}/${watchdogTaskCount} safe stops`,
    );
  }

  progress("recovery-candidate-scans");
  const recoverySeedCount = 1000;
  await seedRecoveryCandidates(runtime.pool, resourcePrefix, recoverySeedCount);
  const recoveryCandidateScans = {};
  for (const limit of [100, 500, 1000]) {
    const scan = await timed(async () => repository.listTasksForRecovery(limit));
    if (scan.value.length !== limit) {
      throw new Error(`Recovery candidate scan returned ${scan.value.length}/${limit}`);
    }
    recoveryCandidateScans[String(limit)] = {
      requested: limit,
      returned: scan.value.length,
      durationMs: scan.durationMs,
      candidatesPerSecond: (scan.value.length * 1000) / scan.durationMs,
    };
  }

  progress("durable-growth-and-image");
  const growthAfter = await relationGrowth(runtime.pool);
  const observationOutboxGrowth = {
    observations: growthDelta(growthBefore.observations, growthAfter.observations),
    outbox: growthDelta(growthBefore.outbox, growthAfter.outbox),
  };
  if (observationOutboxGrowth.observations.rows <= 0 || observationOutboxGrowth.outbox.rows <= 0) {
    throw new Error("Capacity workload did not persist Observation and Outbox evidence");
  }

  const image = JSON.parse(readFileSync("reports/image/runtime-v2.json", "utf8"));
  if (image.sizeBytes > image.maximumBytes || image.user === "root") {
    throw new Error("Runtime image baseline violates the v2 image policy");
  }

  const report = {
    version: "2.0.0-rc.1",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpuLogicalCount: cpus().length,
      memoryBytes: totalmem(),
      database:
        process.env.GITHUB_ACTIONS === "true"
          ? "PostgreSQL 17 GitHub Actions service"
          : "TEST_DATABASE_URL target (credentials redacted)",
      topology: "two Runtime replicas, shared PostgreSQL, single TypeScript Adapter",
    },
    workloads: {
      synchronousTool: synchronous,
      concurrentTaskAdmission: {
        tasks: concurrentTaskCount,
        runtimeReplicas: 2,
        durationMs: concurrentTasks.durationMs,
        tasksPerSecond: (concurrentTaskCount * 1000) / concurrentTasks.durationMs,
      },
      slowAdapterDatabaseAvailability: {
        adapterResponseDelayMs: 15_000,
        databaseQueryDurationMs: databaseWhileAdapterSlow.durationMs,
        databaseQueryCompletedBeforeAdapterResponse: true,
        taskId: slowTask.task.taskId,
      },
      durableCommandDispatcher: {
        commands: dispatcherTaskCount,
        runtimeReplicas: 2,
        duplicateAdapterSideEffects: 0,
        durationMs: dispatcherMeasurement.durationMs,
        commandsPerSecond: (dispatcherTaskCount * 1000) / dispatcherMeasurement.durationMs,
        result: dispatcherMeasurement.value,
      },
      scheduledScan: {
        futureTasks: scheduledTaskCount,
        durationMs: scheduledScan.durationMs,
        result: scheduledScan.value,
      },
      watchdogScan: {
        overdueTasks: watchdogTaskCount,
        durationMs: watchdogScan.durationMs,
        result: watchdogScan.value,
      },
      recoveryCandidateScans,
      observationOutboxGrowth,
      runtimeImage: image,
    },
    interpretation: {
      productionSlo: false,
      recoveryScope:
        "Measures the real PostgreSQL candidate-selection/materialization path; Adapter reconciliation latency is resource-specific.",
      thresholds:
        "Only correctness/regression bounds are enforced: pool progress under 500ms, exact claims/counts, positive durable growth, and image policy.",
    },
  };
  const outputPath = resolve(
    process.env.CAPACITY_REPORT_PATH ?? "reports/capacity/capacity-v2.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  progress("complete");
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await client?.close();
  await cleanupCapacityRows(runtime.pool, resourcePrefix).catch(() => undefined);
  await runtime.app.close();
  await runtimeReplica2.app.close();
  await new Promise((resolveShutdown) => adapter.tryShutdown(resolveShutdown));
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminPool.end();
}

async function createScheduledTask(clientInstance, resourceId, scheduledAt) {
  return clientInstance.callTool(
    { name: "durable_task", arguments: { resourceId } },
    {
      timing: {
        start: { mode: "scheduled", scheduledAt, startToleranceMs: 30_000 },
        maxElapsedMs: null,
      },
    },
  );
}

async function createImmediateWindowTask(clientInstance, resourceId) {
  return clientInstance.callTool(
    {
      name: "durable_task",
      arguments: { resourceId, scenario: "queued_start" },
    },
    {
      timing: {
        start: { mode: "immediate", startToleranceMs: 100 },
        maxElapsedMs: null,
      },
    },
  );
}

function createFrozenCapacityClient(endpoint) {
  let requestId = 0;
  return {
    async callTool(call, taskExecution) {
      requestId += 1;
      const response = await globalThis.fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": call.name,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "tools/call",
          params: {
            name: call.name,
            arguments: call.arguments,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "runtime-capacity-baseline",
                version: "2.0.0-rc.1",
              },
              "io.modelcontextprotocol/clientCapabilities": {
                extensions: { "io.modelcontextprotocol/tasks": {} },
              },
              ...(taskExecution === undefined
                ? {}
                : {
                    "io.sdar/taskExecution": {
                      profileVersion: "1.0",
                      ...taskExecution,
                    },
                  }),
            },
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error !== undefined) {
        throw new Error(`Frozen capacity request failed: ${JSON.stringify(payload.error)}`);
      }
      return payload.result;
    },
    close: () => Promise.resolve(),
  };
}

async function seedRecoveryCandidates(pool, prefix, count) {
  const snapshot = await pool.query(
    `SELECT snapshot_id FROM operation_snapshot
     WHERE provider_id='capacity-provider' AND operation_name='durable_task'
     ORDER BY created_at DESC LIMIT 1`,
  );
  const snapshotId = snapshot.rows[0]?.snapshot_id;
  if (snapshotId === undefined) throw new Error("Capacity operation snapshot was not persisted");
  await pool.query(
    `INSERT INTO provider_task
      (task_id, provider_id, operation_name, operation_snapshot_id,
       authorization_context_hash, execution_mode, simulation_id, arguments, argument_hash,
       external_execution_id, internal_state, mcp_status, substate, status_message,
       adapter_revision, timing, accepted_at, actual_started_at, ttl_ms, observation_revision)
     SELECT gen_random_uuid(), 'capacity-provider', 'durable_task', $1,
            repeat('a',64), 'live', NULL,
            jsonb_build_object('resourceId', $2 || '-recovery-' || series), repeat('b',64),
            $2 || '-recovery-external-' || series, 'RUNNING', 'working', 'running',
            'Capacity recovery scan fixture.', 1, '{}'::jsonb, clock_timestamp(),
            clock_timestamp(), NULL, 1
     FROM generate_series(1,$3) AS series`,
    [snapshotId, prefix, count],
  );
}

async function relationGrowth(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*) FROM task_observation)::bigint AS observation_rows,
       pg_total_relation_size('task_observation')::bigint AS observation_bytes,
       (SELECT count(*) FROM outbox_event)::bigint AS outbox_rows,
       pg_total_relation_size('outbox_event')::bigint AS outbox_bytes`,
  );
  return {
    observations: {
      rows: Number(result.rows[0].observation_rows),
      bytes: Number(result.rows[0].observation_bytes),
    },
    outbox: {
      rows: Number(result.rows[0].outbox_rows),
      bytes: Number(result.rows[0].outbox_bytes),
    },
  };
}

function growthDelta(before, after) {
  return {
    before,
    after,
    rows: after.rows - before.rows,
    bytes: after.bytes - before.bytes,
  };
}

async function cleanupCapacityRows(pool, prefix) {
  await pool.query(
    `DELETE FROM outbox_event WHERE aggregate_id IN
       (SELECT task_id FROM provider_task WHERE arguments->>'resourceId' LIKE $1)`,
    [`${prefix}%`],
  );
  await pool.query(`DELETE FROM provider_task WHERE arguments->>'resourceId' LIKE $1`, [
    `${prefix}%`,
  ]);
  await pool.query(`DELETE FROM admission_intent WHERE arguments->>'resourceId' LIKE $1`, [
    `${prefix}%`,
  ]);
}

async function timed(operation) {
  const started = performance.now();
  const value = await operation();
  return { durationMs: performance.now() - started, value };
}

async function drainDispatchers(dispatchers, expected, completed) {
  const aggregate = {
    claimed: 0,
    acknowledged: 0,
    retried: 0,
    rejected: 0,
    exhausted: 0,
    terminal: 0,
  };
  let durableAcknowledged = 0;
  for (let round = 0; durableAcknowledged < expected && round < 1000; round += 1) {
    const results = await Promise.all(dispatchers.map((dispatcher) => dispatcher.tick()));
    for (const result of results) {
      for (const key of Object.keys(aggregate)) aggregate[key] += result[key];
    }
    durableAcknowledged = await completed();
    if (results.every((result) => result.claimed === 0)) await delay(10);
  }
  return { ...aggregate, durableAcknowledged };
}

async function measure(iterations, operation) {
  const latencies = [];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const requestStarted = performance.now();
    await operation(index);
    latencies.push(performance.now() - requestStarted);
  }
  const durationMs = performance.now() - started;
  latencies.sort((left, right) => left - right);
  return {
    iterations,
    durationMs,
    throughputPerSecond: (iterations * 1000) / durationMs,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.at(-1),
    },
  };
}

function percentile(values, fraction) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

function progress(stage) {
  process.stderr.write(`[capacity] ${stage}\n`);
}
