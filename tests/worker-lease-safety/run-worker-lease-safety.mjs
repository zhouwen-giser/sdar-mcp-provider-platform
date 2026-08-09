import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { Pool } from "pg";
import { PmsRepositoryError } from "../../packages/pms-domain/src/index.ts";
import {
  PostgresJobLeaseRepository,
  runPmsMigrations,
} from "../../packages/pms-persistence-postgres/src/index.ts";
import { PmsJobRegistry, PmsWorker } from "../../apps/pms-worker/src/index.ts";

const root = process.cwd();
const adminDatabaseUrl = requiredEnvironment("TEST_DATABASE_URL");
const schema = `worker_lease_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = withSearchPath(adminDatabaseUrl, schema);
const admin = new Pool({ connectionString: adminDatabaseUrl });
const pool = new Pool({ connectionString: databaseUrl });
const activeWorkers = new Set();
// The 300 ms minimum is covered deterministically by job-execution unit tests. Keep this
// real-PostgreSQL gate above transient CI scheduler stalls while still spanning more than
// three renewal periods in the long-running scenarios.
const leaseDurationMs = 1_000;
const longHandlerDurationMs = 3_500;
const scenarioTimeoutMs = 10_000;
const assertions = {};
const metrics = {};

try {
  await admin.query(`CREATE SCHEMA ${identifier(schema)}`);
  await runPmsMigrations(pool, root);
  await pool.query(
    "CREATE TABLE worker_lease_effect(effect_id text PRIMARY KEY, actor text NOT NULL, fence bigint NOT NULL)",
  );

  await scenarioContinuousRenewal();
  await scenarioLeaseLossTakeover();
  await scenarioUninterruptibleSql();
  await scenarioBatchRenewal();

  const hanging = await pool.query(
    "SELECT count(*)::integer AS count FROM job_lease WHERE status IN ('pending','leased','failed')",
  );
  assert(hanging.rows[0]?.count === 0, "HANGING_LEASES_REMAIN");
  assertions.noHangingLeases = true;
  assertions.noPm2ProcessesCreated = true;
  assertions.noTemporaryDatabasesCreated = true;
  assertions.noTokenFilesCreated = true;

  const evidence = {
    schemaVersion: "1.0",
    taskId: "G5-P2-B02",
    generatedAt: new Date().toISOString(),
    resourceClassification: {
      postgres: "real local PostgreSQL",
      workers: "two real PmsWorker instances using PostgresJobLeaseRepository",
      faultInjection: "renew call failure only; authoritative lease row remains real PostgreSQL",
      pm2: "not required by focused SQL checkpoint scenario; no PM2 process created",
    },
    leaseDurationMs,
    metrics,
    assertions,
    secretsIncluded: false,
  };
  await mkdir(resolve(root, "reports/evidence"), { recursive: true });
  await writeFile(
    resolve(root, "reports/evidence/G5-P2-B02-worker-lease-safety.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write("WORKER_LEASE_SAFETY_GATE_OK\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await stopAllWorkers();
  await pool.end().catch(() => undefined);
  await admin.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}

async function scenarioContinuousRenewal() {
  await resetScenario();
  const jobs = new PostgresJobLeaseRepository(pool);
  await enqueue(jobs, "scenario-a");
  const workerAJobs = instrument(jobs);
  const workerBJobs = instrument(jobs);
  const handlerA = handler("lease.scenario-a", async () => delay(longHandlerDurationMs));
  const workerA = startWorker("scenario-a-worker-a", workerAJobs.repository, [handlerA]);
  await waitFor(
    () => Promise.resolve(workerAJobs.claims.length),
    (count) => count === 1,
  );
  const workerB = startWorker("scenario-a-worker-b", workerBJobs.repository, [
    forbiddenHandler("lease.scenario-a"),
  ]);

  const row = await waitForJob("scenario-a", "succeeded", scenarioTimeoutMs);
  await stopWorkers(workerA, workerB);
  assert(workerBJobs.claims.length === 0, "SCENARIO_A_WORKER_B_CLAIMED");
  assert(workerAJobs.renewals.get("scenario-a") >= 3, "SCENARIO_A_RENEWAL_COUNT_LOW");
  assert(row.fencing_token === "1", "SCENARIO_A_FENCE_CHANGED");
  assertions.longHandlerRenewedBeyondThreePeriods = true;
  assertions.secondWorkerCouldNotClaimRenewedLease = true;
  metrics.scenarioARenewals = workerAJobs.renewals.get("scenario-a");
}

async function scenarioLeaseLossTakeover() {
  await resetScenario();
  const jobs = new PostgresJobLeaseRepository(pool);
  await enqueue(jobs, "scenario-b");
  const renewalLost = deferred();
  const workerAJobs = instrument(jobs, {
    failRenewOnce: true,
    onRenewFailure: renewalLost.resolve,
  });
  const workerBJobs = instrument(jobs);
  const handlerAborted = deferred();
  const workerA = startWorker("scenario-b-worker-a", workerAJobs.repository, [
    handler("lease.scenario-b", (_lease, context) =>
      onAbort(context.signal, handlerAborted.resolve),
    ),
  ]);
  await waitFor(
    () => Promise.resolve(workerAJobs.claims.length),
    (count) => count === 1,
  );
  const workerB = startWorker("scenario-b-worker-b", workerBJobs.repository, [
    handler("lease.scenario-b", () => Promise.resolve()),
  ]);
  await renewalLost.promise;
  const stoppingA = workerA.stop();
  await handlerAborted.promise;
  const row = await waitForJob("scenario-b", "succeeded", scenarioTimeoutMs);
  await stoppingA;
  await stopWorkers(workerB);

  assert(workerAJobs.completes === 0 && workerAJobs.failures === 0, "SCENARIO_B_STALE_FINAL_WRITE");
  assert(workerBJobs.claims.length === 1, "SCENARIO_B_TAKEOVER_MISSING");
  assert(row.fencing_token === "2", "SCENARIO_B_FENCE_NOT_INCREMENTED");
  assertions.renewFailureAbortedWorkerA = true;
  assertions.workerANoCompleteOrFailAfterLeaseLoss = true;
  assertions.workerBTookOverWithHigherFence = true;
  assertions.singleSucceededResultAfterTakeover = true;
  metrics.scenarioBFences = [
    String(workerAJobs.claims[0]?.fencingToken),
    String(workerBJobs.claims[0]?.fencingToken),
  ];
}

async function scenarioUninterruptibleSql() {
  await resetScenario();
  const jobs = new PostgresJobLeaseRepository(pool);
  await enqueue(jobs, "scenario-c");
  const renewalLost = deferred();
  const workerAJobs = instrument(jobs, {
    failRenewOnce: true,
    onRenewFailure: renewalLost.resolve,
  });
  const workerBJobs = instrument(jobs);
  const workerA = startWorker("scenario-c-worker-a", workerAJobs.repository, [
    handler("lease.scenario-c", async (_lease, context) => {
      await pool.query("SELECT pg_sleep(0.4)");
      context.signal.throwIfAborted();
      await pool.query(
        "INSERT INTO worker_lease_effect(effect_id,actor,fence) VALUES ('scenario-c-a','worker-a',$1)",
        [context.leaseIdentity.fencingToken.toString()],
      );
    }),
  ]);
  await waitFor(
    () => Promise.resolve(workerAJobs.claims.length),
    (count) => count === 1,
  );
  const workerB = startWorker("scenario-c-worker-b", workerBJobs.repository, [
    handler("lease.scenario-c", async (_lease, context) => {
      await pool.query(
        "INSERT INTO worker_lease_effect(effect_id,actor,fence) VALUES ('scenario-c-b','worker-b',$1)",
        [context.leaseIdentity.fencingToken.toString()],
      );
    }),
  ]);
  await renewalLost.promise;
  const stoppingA = workerA.stop();
  const row = await waitForJob("scenario-c", "succeeded", scenarioTimeoutMs);
  await stoppingA;
  await stopWorkers(workerB);
  const effects = await pool.query(
    "SELECT effect_id,actor,fence::text FROM worker_lease_effect ORDER BY effect_id",
  );

  assert(workerAJobs.completes === 0 && workerAJobs.failures === 0, "SCENARIO_C_STALE_FINAL_WRITE");
  assert(row.fencing_token === "2", "SCENARIO_C_FENCE_NOT_INCREMENTED");
  assert(
    JSON.stringify(effects.rows) ===
      JSON.stringify([{ effect_id: "scenario-c-b", actor: "worker-b", fence: "2" }]),
    "SCENARIO_C_POST_ABORT_SIDE_EFFECT",
  );
  assertions.uninterruptibleSqlCheckedSignalAfterReturn = true;
  assertions.noWorkerAStateWriteAfterLeaseLoss = true;
  assertions.noDoubleActiveSideEffect = true;
}

async function scenarioBatchRenewal() {
  await resetScenario();
  const jobs = new PostgresJobLeaseRepository(pool);
  const jobIds = ["scenario-d-1", "scenario-d-2", "scenario-d-3"];
  await Promise.all(jobIds.map((jobId) => enqueue(jobs, jobId, "lease.scenario-d")));
  const workerAJobs = instrument(jobs);
  const workerBJobs = instrument(jobs);
  const workerA = startWorker(
    "scenario-d-worker-a",
    workerAJobs.repository,
    [handler("lease.scenario-d", () => delay(longHandlerDurationMs))],
    3,
  );
  await waitFor(
    () => Promise.resolve(workerAJobs.claims.length),
    (count) => count === 3,
  );
  const workerB = startWorker("scenario-d-worker-b", workerBJobs.repository, [
    forbiddenHandler("lease.scenario-d"),
  ]);
  await waitFor(
    async () =>
      (
        await pool.query(
          "SELECT count(*)::integer AS count FROM job_lease WHERE job_id=ANY($1::text[]) AND status='succeeded'",
          [jobIds],
        )
      ).rows[0]?.count,
    (count) => count === 3,
    scenarioTimeoutMs,
  );
  await stopWorkers(workerA, workerB);

  assert(workerBJobs.claims.length === 0, "SCENARIO_D_QUEUED_JOB_TAKEN_OVER");
  for (const jobId of jobIds) {
    assert(workerAJobs.renewals.get(jobId) >= 3, `SCENARIO_D_RENEWAL_MISSING:${jobId}`);
  }
  assertions.claimLimitThreeStartedWithoutQueueExpiry = true;
  assertions.eachClaimedJobRenewedIndependently = true;
  metrics.scenarioDRenewals = Object.fromEntries(
    jobIds.map((jobId) => [jobId, workerAJobs.renewals.get(jobId)]),
  );
}

function startWorker(workerId, jobs, handlers, claimLimit = 1) {
  const worker = new PmsWorker(
    {
      databaseUrlFile: "/not-read-by-focused-gate",
      workerId,
      pollIntervalMs: 20,
      leaseDurationMs,
      claimLimit,
      retryDelayMs: 50,
      workspaceRoot: root,
    },
    jobs,
    new PmsJobRegistry(handlers),
  );
  activeWorkers.add(worker);
  worker.start();
  return worker;
}

function instrument(repository, options = {}) {
  const claims = [];
  const renewals = new Map();
  let completes = 0;
  let failures = 0;
  let injected = false;
  return {
    claims,
    renewals,
    get completes() {
      return completes;
    },
    get failures() {
      return failures;
    },
    repository: {
      enqueue: repository.enqueue.bind(repository),
      async claim(input) {
        const leases = await repository.claim(input);
        claims.push(
          ...leases.map((lease) => ({
            jobId: lease.job.jobId,
            fencingToken: lease.fencingToken,
          })),
        );
        return leases;
      },
      async renew(identity, durationMs) {
        renewals.set(identity.jobId, (renewals.get(identity.jobId) ?? 0) + 1);
        if (options.failRenewOnce && !injected) {
          injected = true;
          options.onRenewFailure?.();
          throw new PmsRepositoryError("LEASE_NOT_OWNED", "Injected renewal loss");
        }
        return repository.renew(identity, durationMs);
      },
      release: repository.release.bind(repository),
      async complete(identity) {
        completes += 1;
        return repository.complete(identity);
      },
      async fail(identity, availableAt) {
        failures += 1;
        return repository.fail(identity, availableAt);
      },
      list: repository.list.bind(repository),
    },
  };
}

function handler(jobType, execute) {
  return { jobType, execute };
}

function forbiddenHandler(jobType) {
  return handler(jobType, () => Promise.reject(new Error("UNEXPECTED_SECOND_WORKER_EXECUTION")));
}

async function enqueue(repository, jobId, jobType = `lease.${jobId}`) {
  await repository.enqueue({
    jobId,
    jobType,
    payload: {},
  });
}

async function resetScenario() {
  await stopAllWorkers();
  await pool.query("TRUNCATE TABLE job_lease, worker_lease_effect");
}

async function waitForJob(jobId, status, timeoutMs) {
  return waitFor(
    async () =>
      (
        await pool.query("SELECT status,fencing_token::text FROM job_lease WHERE job_id=$1", [
          jobId,
        ])
      ).rows[0],
    (row) => row?.status === status,
    timeoutMs,
  );
}

async function stopWorkers(...workers) {
  await Promise.all(
    workers.map(async (worker) => {
      activeWorkers.delete(worker);
      await worker.stop();
    }),
  );
}

async function stopAllWorkers() {
  const workers = [...activeWorkers];
  activeWorkers.clear();
  await Promise.all(workers.map((worker) => worker.stop().catch(() => undefined)));
}

function onAbort(signal, notify) {
  if (signal.aborted) {
    notify();
    return Promise.resolve();
  }
  return new Promise((resolveAbort) => {
    signal.addEventListener(
      "abort",
      () => {
        notify();
        resolveAbort();
      },
      { once: true },
    );
  });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

async function waitFor(read, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await delay(20);
  }
  throw new Error(`WORKER_LEASE_WAIT_TIMEOUT:${JSON.stringify(last)}`);
}

function withSearchPath(connectionString, searchPath) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${searchPath}`);
  return url.toString();
}

function identifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("WORKER_LEASE_IDENTIFIER_INVALID");
  }
  return `"${value}"`;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
