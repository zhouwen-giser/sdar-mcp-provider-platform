import { createRequire } from "node:module";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  boundedInteger,
  canonical,
  coded,
  isRecord,
  loadEnvironment,
  optional,
  parseArguments,
  parseEndpoint,
  redactEndpoint,
  repositoryRoot,
  required,
  safeFailure,
  sha256,
  writeEvidence,
} from "../ugv-simulation/lib.mjs";

const TARGET = Object.freeze({
  longitude: 106.8134463,
  latitude: 29.72034353,
  altitude: 500,
});
// The real simulator retains a successfully completed mission until the next
// mission is accepted. These states are quiescent when the independently
// observed chassis speed is stationary; active, paused, cancelled, and failed
// states remain blocked by this one-shot validation runner.
const QUIESCENT_MISSION_STATES = new Set([-1, 0, 4]);
const FORBIDDEN_IDEMPOTENCY_KEY = "ugv-nav-20260818-10681344630";
const argumentsValue = parseArguments(process.argv.slice(2));
const environment = loadEnvironment(argumentsValue["env-file"]);
const root = repositoryRoot(import.meta.url);
const output =
  argumentsValue.output ??
  optional(environment, "UGV_LIVE_EVIDENCE_PATH") ??
  resolve(root, "reports/ugv-provider-template-stabilization/LIVE_POINT_NAVIGATION_EVIDENCE.json");
const markdownOutput = output.endsWith(".json") ? output.slice(0, -5) + ".md" : `${output}.md`;
const startedAt = new Date().toISOString();
const report = {
  schemaVersion: "1.0",
  authorized: false,
  runId: null,
  endpoint: null,
  resourceId: null,
  target: TARGET,
  previousRejectedIdempotencyKeyReused: false,
  readOnlyPreflight: {},
  operationQualification: {},
  mutatingCallCount: 0,
  idempotencyKey: null,
  downstreamMissionId: null,
  mutationJournal: [],
  taskStates: [],
  physicalConfirmation: {},
  result: "NOT_EXECUTED",
  startedAt,
  completedAt: null,
  failure: null,
};
const forbiddenEvidenceValues = [];
let runtimePool;
let adapterPool;
let runtimeUrl;
let requestTimeoutMs;
let taskId;

try {
  const authorization = authorize(environment);
  runtimeUrl = authorization.runtimeUrl;
  requestTimeoutMs = authorization.requestTimeoutMs;
  forbiddenEvidenceValues.push(
    authorization.runtimeRaw,
    authorization.runtimeDatabaseUrl,
    authorization.adapterDatabaseUrl,
  );
  report.authorized = true;
  report.runId = authorization.runId;
  report.endpoint = redactEndpoint(runtimeUrl);
  report.resourceId = authorization.resourceId;
  report.idempotencyKey = authorization.idempotencyKey;
  report.previousRejectedIdempotencyKeyReused =
    authorization.idempotencyKey === FORBIDDEN_IDEMPOTENCY_KEY;

  const { Pool } = loadPg(root);
  runtimePool = new Pool({ connectionString: authorization.runtimeDatabaseUrl, max: 1 });
  adapterPool = new Pool({ connectionString: authorization.adapterDatabaseUrl, max: 1 });

  const taskCounts = await runtimeTaskCounts(runtimePool);
  if (taskCounts.active !== 0) throw coded("UGV_LIVE_ACTIVE_RUNTIME_TASKS_PRESENT");
  if (taskCounts.uncertain !== 0) throw coded("UGV_LIVE_UNCERTAIN_RUNTIME_TASKS_PRESENT");

  const readiness = await readReadiness(runtimeUrl, requestTimeoutMs);
  const discovery = await request(
    runtimeUrl,
    "server/discover",
    {},
    undefined,
    1,
    requestTimeoutMs,
  );
  assertRpcSuccess(discovery, "UGV_LIVE_SERVER_DISCOVERY_FAILED");
  const tools = await request(runtimeUrl, "tools/list", {}, undefined, 2, requestTimeoutMs);
  assertRpcSuccess(tools, "UGV_LIVE_TOOLS_LIST_FAILED");
  const toolNames = extractToolNames(tools.body);
  for (const requiredTool of ["vehicle_get_state", "vehicle_get_capabilities", "vehicle_navigate"])
    if (!toolNames.includes(requiredTool)) throw coded("UGV_LIVE_REQUIRED_RUNTIME_TOOL_MISSING");

  const stateBefore = await readTool(
    runtimeUrl,
    "vehicle_get_state",
    authorization.resourceId,
    3,
    requestTimeoutMs,
  );
  const capabilities = await readTool(
    runtimeUrl,
    "vehicle_get_capabilities",
    authorization.resourceId,
    4,
    requestTimeoutMs,
  );
  const stateFacts = assertPredispatchState(
    stateBefore,
    authorization.stationaryThresholdKmh,
    authorization.maximumStateAgeMs,
    authorization.maximumFutureSkewMs,
  );

  const navigationArguments = {
    resourceId: authorization.resourceId,
    mission: { type: "point", target: TARGET },
  };
  const availability = await request(
    runtimeUrl,
    "io.sdar/taskExecution/checkAvailability",
    {
      profileVersion: "1.0",
      checks: [
        {
          requestId: `point-${authorization.runId}`,
          operationName: "vehicle_navigate",
          arguments: { state: "complete", value: navigationArguments },
        },
      ],
    },
    undefined,
    5,
    requestTimeoutMs,
  );
  assertRpcSuccess(availability, "UGV_LIVE_AVAILABILITY_CHECK_FAILED");
  const availabilityFact = firstAvailability(availability.body);
  if (String(availabilityFact.availability).toLowerCase() !== "available")
    throw coded(`UGV_LIVE_NAVIGATION_${safeReason(availabilityFact.reasonCode, "UNAVAILABLE")}`);

  report.readOnlyPreflight = {
    readiness,
    runtimeTaskCounts: taskCounts,
    state: stateFacts,
    toolsList: {
      toolCount: toolNames.length,
      toolNames,
      sha256: sha256(canonical(tools.body.result)),
    },
    protocol: {
      version: "2026-07-28",
      serverDiscoverSha256: sha256(canonical(discovery.body.result)),
    },
  };
  report.operationQualification = {
    operationName: "vehicle_navigate",
    variant: "point",
    availability: availabilityFact.availability,
    reasonCode: availabilityFact.reasonCode ?? null,
    riskLevel: availabilityFact.riskLevel ?? null,
    capabilitiesSha256: sha256(canonical(capabilities)),
  };
  report.result = "AUTHORIZED_PREDISPATCH_READY";
  persistEvidence(output, markdownOutput, report, forbiddenEvidenceValues);

  // This is the only mutating request in this process. It is deliberately not wrapped in a retry.
  report.mutatingCallCount = 1;
  let dispatch;
  try {
    dispatch = await request(
      runtimeUrl,
      "tools/call",
      { name: "vehicle_navigate", arguments: navigationArguments },
      "vehicle_navigate",
      10,
      requestTimeoutMs,
      authorization.idempotencyKey,
    );
  } catch (error) {
    taskId = await recoverTaskIdentity(runtimePool, authorization.idempotencyKey);
    if (taskId === undefined) {
      report.result = "UNCERTAIN_DISPATCH_NO_TASK_ID";
      throw coded("UGV_LIVE_DISPATCH_UNCERTAIN_NO_REPLAY", error);
    }
  }

  if (dispatch !== undefined) {
    if (dispatch.status < 200 || dispatch.status >= 300 || dispatch.body.error !== undefined) {
      report.result = "REJECTED_BEFORE_TASK";
      throw coded(`UGV_LIVE_DISPATCH_${responseReason(dispatch.body)}`);
    }
    const result = isRecord(dispatch.body.result) ? dispatch.body.result : undefined;
    if (result?.resultType !== "task" || typeof result.taskId !== "string") {
      report.result = "REJECTED_BEFORE_TASK";
      throw coded("UGV_LIVE_DISPATCH_TASK_RESULT_REQUIRED");
    }
    taskId = result.taskId;
  }

  const finalTask = await pollTask(
    runtimeUrl,
    taskId,
    requestTimeoutMs,
    authorization.pollIntervalMs,
    authorization.pollTimeoutMs,
    report.taskStates,
  );
  const adapterEvidence = await adapterExecutionEvidence(adapterPool, taskId);
  report.downstreamMissionId = adapterEvidence.downstreamMissionId;
  report.mutationJournal = adapterEvidence.mutationJournal;
  assertMutationJournal(adapterEvidence);

  const firstTerminalState = await readTool(
    runtimeUrl,
    "vehicle_get_state",
    authorization.resourceId,
    20_001,
    requestTimeoutMs,
  );
  await delay(authorization.stationaryStabilityMs);
  const secondTerminalState = await readTool(
    runtimeUrl,
    "vehicle_get_state",
    authorization.resourceId,
    20_002,
    requestTimeoutMs,
  );
  const physical = assertTerminalPhysicalEvidence(
    firstTerminalState,
    secondTerminalState,
    authorization.stationaryThresholdKmh,
    authorization.maximumStateAgeMs,
    authorization.maximumFutureSkewMs,
    authorization.targetToleranceMeters,
  );
  report.physicalConfirmation = physical;
  if (finalTask.status !== "completed")
    throw coded(`UGV_LIVE_TASK_TERMINAL_${safeReason(finalTask.status, "INVALID")}`);
  report.result = "PASS";
} catch (error) {
  report.failure = safeFailure(error, "UGV_LIVE_POINT_VALIDATION_FAILED");
  if (report.result === "NOT_EXECUTED" || report.result === "AUTHORIZED_PREDISPATCH_READY") {
    report.result = report.mutatingCallCount === 0 ? "BLOCKED_BEFORE_DISPATCH" : "FAILED_NO_REPLAY";
  }
} finally {
  if (taskId !== undefined && adapterPool !== undefined) {
    try {
      const evidence = await adapterExecutionEvidence(adapterPool, taskId);
      report.downstreamMissionId ??= evidence.downstreamMissionId;
      if (report.mutationJournal.length === 0) report.mutationJournal = evidence.mutationJournal;
    } catch {
      // Preserve the primary failure. Evidence collection must never trigger a replay.
    }
  }
  await Promise.allSettled([runtimePool?.end(), adapterPool?.end()].filter(Boolean));
  report.completedAt = new Date().toISOString();
  persistEvidence(output, markdownOutput, report, forbiddenEvidenceValues);
}

process.stdout.write(
  `${report.result}: ${report.failure?.reasonCode ?? "UGV_LIVE_POINT_VALIDATION_PASS"}; evidence=${output}\n`,
);
process.exitCode = report.result === "PASS" ? 0 : 2;

function authorize(env) {
  if (required(env, "ALLOW_REAL_UGV_SIDE_EFFECTS") !== "YES")
    throw coded("UGV_LIVE_SIDE_EFFECT_AUTHORIZATION_REQUIRED");
  const runId = required(env, "LIVE_TEST_RUN_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(runId)) throw coded("LIVE_TEST_RUN_ID_INVALID");
  if (runId.includes(FORBIDDEN_IDEMPOTENCY_KEY)) throw coded("UGV_LIVE_PREVIOUS_RUN_ID_FORBIDDEN");
  const resourceId = required(env, "UGV_TEST_RESOURCE_ID");
  if (resourceId !== "vehicle:ugv1") throw coded("UGV_LIVE_RESOURCE_ID_MISMATCH");
  const runtimeRaw = required(env, "UGV_RUNTIME_MCP_URL");
  const runtimeUrl = parseEndpoint(runtimeRaw, "UGV_RUNTIME_MCP_URL", ["http:", "https:"]);
  if (runtimeUrl.pathname !== "/mcp" || runtimeUrl.search || runtimeUrl.hash)
    throw coded("UGV_RUNTIME_MCP_URL_CANONICAL_PATH_REQUIRED");
  const runtimeDatabaseUrl = databaseUrl(env, "UGV_LIVE_RUNTIME_DATABASE_URL");
  const adapterDatabaseUrl = databaseUrl(env, "UGV_LIVE_ADAPTER_DATABASE_URL");
  const idempotencyKey = `ugv-template-live:${runId}:vehicle_navigate.point`;
  if (idempotencyKey === FORBIDDEN_IDEMPOTENCY_KEY)
    throw coded("UGV_LIVE_PREVIOUS_IDEMPOTENCY_KEY_FORBIDDEN");
  return {
    runId,
    resourceId,
    runtimeRaw,
    runtimeUrl,
    runtimeDatabaseUrl,
    adapterDatabaseUrl,
    idempotencyKey,
    requestTimeoutMs: boundedInteger(
      env.UGV_LIVE_REQUEST_TIMEOUT_MS,
      "UGV_LIVE_REQUEST_TIMEOUT_MS",
      10_000,
      500,
      60_000,
    ),
    pollIntervalMs: boundedInteger(
      env.UGV_LIVE_POLL_INTERVAL_MS,
      "UGV_LIVE_POLL_INTERVAL_MS",
      1_000,
      250,
      10_000,
    ),
    pollTimeoutMs: boundedInteger(
      env.UGV_LIVE_POLL_TIMEOUT_MS,
      "UGV_LIVE_POLL_TIMEOUT_MS",
      600_000,
      10_000,
      1_800_000,
    ),
    maximumStateAgeMs: boundedInteger(
      env.UGV_LIVE_MAX_STATE_AGE_MS,
      "UGV_LIVE_MAX_STATE_AGE_MS",
      10_000,
      1_000,
      60_000,
    ),
    maximumFutureSkewMs: boundedInteger(
      env.UGV_OBSERVATION_MAX_FUTURE_SKEW_MS,
      "UGV_OBSERVATION_MAX_FUTURE_SKEW_MS",
      1_000,
      0,
      5_000,
    ),
    stationaryStabilityMs: boundedInteger(
      env.UGV_LIVE_STATIONARY_STABILITY_MS,
      "UGV_LIVE_STATIONARY_STABILITY_MS",
      2_000,
      500,
      60_000,
    ),
    stationaryThresholdKmh: boundedNumber(
      env.UGV_LIVE_STATIONARY_SPEED_THRESHOLD_KMH,
      "UGV_LIVE_STATIONARY_SPEED_THRESHOLD_KMH",
      0.1,
      0,
      5,
    ),
    targetToleranceMeters: boundedNumber(
      env.UGV_LIVE_TARGET_TOLERANCE_METERS,
      "UGV_LIVE_TARGET_TOLERANCE_METERS",
      10,
      0.1,
      100,
    ),
  };
}

function databaseUrl(env, name) {
  const raw = required(env, name);
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw coded(`${name}_URL_INVALID`, error);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw coded(`${name}_SCHEME_INVALID`);
  if (!url.username || !url.password || url.pathname.length < 2)
    throw coded(`${name}_CREDENTIALS_REQUIRED`);
  return raw;
}

function loadPg(repository) {
  const require = createRequire(resolve(repository, "package.json"));
  return require("pg");
}

async function runtimeTaskCounts(pool) {
  const result = await pool.query(`
    SELECT
      count(*) FILTER (WHERE task.internal_state NOT LIKE 'TERMINAL_%')::int AS active_tasks,
      count(*) FILTER (WHERE task.internal_state = 'WAITING_START_CONFIRMATION')::int AS uncertain_tasks,
      (SELECT count(*)::int FROM admission_intent intent
        WHERE intent.state IN ('PENDING','ACCEPTED','UNCERTAIN')
          AND NOT EXISTS (SELECT 1 FROM provider_task linked WHERE linked.task_id=intent.task_id))
        AS unsettled_admissions,
      (SELECT count(*)::int FROM admission_intent intent
        WHERE intent.state = 'UNCERTAIN'
          AND NOT EXISTS (SELECT 1 FROM provider_task linked WHERE linked.task_id=intent.task_id))
        AS uncertain_admissions
    FROM provider_task task
  `);
  const row = result.rows[0];
  if (!isRecord(row)) throw coded("UGV_LIVE_RUNTIME_TASK_COUNTS_INVALID");
  const active = Number(row.active_tasks) + Number(row.unsettled_admissions);
  const uncertain = Number(row.uncertain_tasks) + Number(row.uncertain_admissions);
  if (!Number.isSafeInteger(active) || !Number.isSafeInteger(uncertain))
    throw coded("UGV_LIVE_RUNTIME_TASK_COUNTS_INVALID");
  return { active, uncertain };
}

async function recoverTaskIdentity(pool, idempotencyKey) {
  const result = await pool.query(
    `SELECT task_id::text FROM idempotency_record
     WHERE operation_name='vehicle_navigate' AND idempotency_key=$1 AND execution_mode='live'
     ORDER BY created_at DESC LIMIT 2`,
    [idempotencyKey],
  );
  return result.rows.length === 1 && typeof result.rows[0]?.task_id === "string"
    ? result.rows[0].task_id
    : undefined;
}

async function adapterExecutionEvidence(pool, runtimeTaskId) {
  const executionResult = await pool.query(
    `SELECT task_id, external_execution_id, state, reason_code, downstream_mission_ids, revision
     FROM ugv_execution WHERE task_id=$1`,
    [runtimeTaskId],
  );
  if (executionResult.rows.length !== 1) throw coded("UGV_LIVE_ADAPTER_EXECUTION_MISSING");
  const execution = executionResult.rows[0];
  const journalResult = await pool.query(
    `SELECT step_id, phase, tool_name, argument_hash, state, external_mission_id,
            result_hash, intent_persisted_at, dispatched_at, completed_at
     FROM ugv_mutation_journal WHERE task_id=$1 ORDER BY intent_persisted_at, step_id`,
    [runtimeTaskId],
  );
  const missionIds = Array.isArray(execution.downstream_mission_ids)
    ? execution.downstream_mission_ids.map(String)
    : [];
  return {
    taskId: String(execution.task_id),
    externalExecutionId: String(execution.external_execution_id),
    state: String(execution.state),
    reasonCode: String(execution.reason_code),
    revision: Number(execution.revision),
    downstreamMissionId: missionIds.length === 1 ? missionIds[0] : null,
    downstreamMissionIds: missionIds,
    mutationJournal: journalResult.rows.map((row) => ({
      stepId: String(row.step_id),
      phase: String(row.phase),
      toolName: String(row.tool_name),
      argumentHash: String(row.argument_hash),
      state: String(row.state),
      externalMissionId: row.external_mission_id === null ? null : String(row.external_mission_id),
      resultHash: row.result_hash === null ? null : String(row.result_hash),
      intentPersistedAt: new Date(row.intent_persisted_at).toISOString(),
      dispatchedAt: row.dispatched_at === null ? null : new Date(row.dispatched_at).toISOString(),
      completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
    })),
  };
}

function assertMutationJournal(evidence) {
  if (evidence.downstreamMissionIds.length !== 1 || evidence.downstreamMissionId === null)
    throw coded("UGV_LIVE_SINGLE_DOWNSTREAM_MISSION_REQUIRED");
  const primary = evidence.mutationJournal.filter((entry) => entry.phase === "PRIMARY");
  const followup = evidence.mutationJournal.filter((entry) => entry.phase === "FOLLOWUP");
  if (primary.length !== 1 || primary[0]?.state !== "ACCEPTED")
    throw coded("UGV_LIVE_SINGLE_ACCEPTED_PRIMARY_REQUIRED");
  if (followup.length !== 1 || followup[0]?.state !== "ACCEPTED")
    throw coded("UGV_LIVE_SINGLE_ACCEPTED_FOLLOWUP_REQUIRED");
  if (
    primary[0]?.externalMissionId !== evidence.downstreamMissionId ||
    followup[0]?.externalMissionId !== evidence.downstreamMissionId
  )
    throw coded("UGV_LIVE_JOURNAL_MISSION_ID_MISMATCH");
}

async function readReadiness(url, timeoutMs) {
  const response = await boundedFetch(new URL("/health/ready", url), { method: "GET" }, timeoutMs);
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(body) || body.status !== "ready")
    throw coded("UGV_LIVE_RUNTIME_NOT_READY");
  return { httpStatus: response.status, status: body.status };
}

async function readTool(url, operation, resourceId, id, timeoutMs) {
  const response = await request(
    url,
    "tools/call",
    { name: operation, arguments: { resourceId } },
    operation,
    id,
    timeoutMs,
  );
  if (response.status < 200 || response.status >= 300 || response.body.error !== undefined)
    throw coded(`UGV_LIVE_${operation.toUpperCase()}_FAILED`);
  const result = response.body.result;
  if (!isRecord(result) || result.resultType !== "complete" || !isRecord(result.structuredContent))
    throw coded(`UGV_LIVE_${operation.toUpperCase()}_RESULT_INVALID`);
  return result.structuredContent;
}

function assertPredispatchState(content, threshold, maximumAgeMs, maximumFutureSkewMs) {
  const connectivity = record(content.connectivity, "UGV_LIVE_CONNECTIVITY_MISSING");
  if (
    connectivity.mqttConnected !== true ||
    connectivity.deviceMcpConnected !== true ||
    connectivity.deviceAvailable !== true
  )
    throw coded("UGV_LIVE_REAL_CONNECTIVITY_UNCONFIRMED");
  const chassis = record(content.chassis, "UGV_LIVE_CHASSIS_STATE_MISSING");
  const mission = record(chassis.mission, "UGV_LIVE_MISSION_STATE_MISSING");
  if (typeof chassis.speedKmh !== "number" || Math.abs(chassis.speedKmh) > threshold)
    throw coded("UGV_LIVE_VEHICLE_NOT_STATIONARY");
  if (!QUIESCENT_MISSION_STATES.has(mission.state))
    throw coded("UGV_LIVE_CHASSIS_MISSION_NOT_QUIESCENT");
  const freshness = record(content.freshness, "UGV_LIVE_FRESHNESS_MISSING");
  assertFresh(
    freshness.chassisObservedAt,
    maximumAgeMs,
    maximumFutureSkewMs,
    "UGV_LIVE_CHASSIS_STATE_STALE",
  );
  return {
    mqttConnected: true,
    deviceMcpConnected: true,
    deviceAvailable: true,
    speedKmh: chassis.speedKmh,
    missionState: mission.state,
    missionId: mission.id ?? null,
    chassisObservedAt: freshness.chassisObservedAt,
    revision: content.revision ?? null,
  };
}

function assertTerminalPhysicalEvidence(
  first,
  second,
  threshold,
  maximumAgeMs,
  maximumFutureSkewMs,
  toleranceMeters,
) {
  const one = terminalFacts(first, threshold, maximumAgeMs, maximumFutureSkewMs);
  const two = terminalFacts(second, threshold, maximumAgeMs, maximumFutureSkewMs);
  if (one.observationCursor === two.observationCursor)
    throw coded("UGV_LIVE_STATIONARY_OBSERVATIONS_NOT_DISTINCT");
  if (two.distanceToTargetMeters > toleranceMeters)
    throw coded("UGV_LIVE_TERMINAL_POSITION_OUTSIDE_TOLERANCE");
  return {
    stableStationaryWindow: true,
    first: one,
    terminal: two,
    targetToleranceMeters: toleranceMeters,
  };
}

function terminalFacts(content, threshold, maximumAgeMs, maximumFutureSkewMs) {
  const chassis = record(content.chassis, "UGV_LIVE_TERMINAL_CHASSIS_MISSING");
  const mission = record(chassis.mission, "UGV_LIVE_TERMINAL_MISSION_MISSING");
  const position = record(chassis.position, "UGV_LIVE_TERMINAL_POSITION_MISSING");
  const freshness = record(content.freshness, "UGV_LIVE_TERMINAL_FRESHNESS_MISSING");
  if (typeof chassis.speedKmh !== "number" || Math.abs(chassis.speedKmh) > threshold)
    throw coded("UGV_LIVE_TERMINAL_SPEED_NOT_STATIONARY");
  assertFresh(
    freshness.chassisObservedAt,
    maximumAgeMs,
    maximumFutureSkewMs,
    "UGV_LIVE_TERMINAL_STATE_STALE",
  );
  if (typeof position.longitude !== "number" || typeof position.latitude !== "number")
    throw coded("UGV_LIVE_TERMINAL_GEODETIC_POSITION_REQUIRED");
  return {
    speedKmh: chassis.speedKmh,
    missionState: mission.state,
    missionId: mission.id ?? null,
    position: {
      longitude: position.longitude,
      latitude: position.latitude,
      altitude: typeof position.altitude === "number" ? position.altitude : null,
    },
    distanceToTargetMeters: haversineMeters(position, TARGET),
    observedAt: freshness.chassisObservedAt,
    observationCursor: String(content.revision ?? freshness.chassisObservedAt),
  };
}

async function pollTask(url, id, timeoutMs, intervalMs, totalMs, snapshots) {
  const deadline = Date.now() + totalMs;
  let requestId = 100;
  while (Date.now() < deadline) {
    const response = await request(url, "tasks/get", { taskId: id }, id, requestId++, timeoutMs);
    if (response.status < 200 || response.status >= 300 || response.body.error !== undefined)
      throw coded("UGV_LIVE_TASK_GET_FAILED");
    const task = record(response.body.result, "UGV_LIVE_TASK_GET_RESULT_INVALID");
    snapshots.push({
      status: task.status ?? null,
      revision: task.revision ?? null,
      reasonCode: task.reasonCode ?? null,
      observedAt: new Date().toISOString(),
    });
    if (["completed", "failed", "cancelled"].includes(String(task.status))) return task;
    await delay(intervalMs);
  }
  throw coded("UGV_LIVE_TASK_POLL_TIMEOUT_NO_REPLAY");
}

async function request(url, method, params, name, id, timeoutMs, idempotencyKey = undefined) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "sdar-ugv-controlled-live-point-validator",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(idempotencyKey === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey } }),
  };
  const response = await boundedFetch(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-sdar-subject": "ugv-controlled-live-validator",
        "x-sdar-tenant": "ugv-live-validation",
        "x-sdar-execution-mode": "live",
        ...(name === undefined ? {} : { "mcp-name": name }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }),
    },
    timeoutMs,
  );
  const body = await response.json().catch((error) => {
    throw coded("UGV_LIVE_MCP_NON_JSON_RESPONSE", error);
  });
  if (!isRecord(body)) throw coded("UGV_LIVE_MCP_RESPONSE_INVALID");
  return { status: response.status, body };
}

async function boundedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function assertRpcSuccess(response, code) {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.body.error !== undefined ||
    !isRecord(response.body.result)
  )
    throw coded(code);
}

function extractToolNames(body) {
  const result = isRecord(body.result) ? body.result : undefined;
  const tools = isRecord(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) throw coded("UGV_LIVE_TOOLS_LIST_INVALID");
  return tools
    .flatMap((tool) => (isRecord(tool) && typeof tool.name === "string" ? [tool.name] : []))
    .sort();
}

function firstAvailability(body) {
  const result = record(body.result, "UGV_LIVE_AVAILABILITY_RESULT_INVALID");
  const results = result.results;
  if (!Array.isArray(results) || results.length !== 1 || !isRecord(results[0]))
    throw coded("UGV_LIVE_AVAILABILITY_RESULT_INVALID");
  return results[0];
}

function record(value, code) {
  if (!isRecord(value)) throw coded(code);
  return value;
}

function assertFresh(value, maximumAgeMs, maximumFutureSkewMs, code) {
  if (typeof value !== "string") throw coded(code);
  const age = Date.now() - Date.parse(value);
  if (!Number.isFinite(age) || age < -maximumFutureSkewMs || age > maximumAgeMs) throw coded(code);
}

function boundedNumber(value, name, fallback, minimum, maximum) {
  const parsed = Number(value?.trim() || String(fallback));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum)
    throw coded(`${name}_OUT_OF_RANGE`);
  return parsed;
}

function responseReason(body) {
  const error = isRecord(body.error) ? body.error : undefined;
  const data = isRecord(error?.data) ? error.data : undefined;
  return safeReason(data?.reasonCode ?? error?.code, "REJECTED");
}

function safeReason(value, fallback) {
  const normalized = String(value ?? fallback)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_]/g, "_");
  return normalized.length > 0 && normalized.length <= 96 ? normalized : fallback;
}

function haversineMeters(left, right) {
  const radius = 6_371_008.8;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLatitude = radians(right.latitude - left.latitude);
  const dLongitude = radians(right.longitude - left.longitude);
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(dLongitude / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function persistEvidence(jsonPath, markdownPath, value, forbidden) {
  writeEvidence(jsonPath, value, forbidden);
  const markdown = [
    "# Controlled LIVE point-navigation evidence",
    "",
    `- Result: **${value.result}**`,
    `- Run ID: \`${value.runId ?? "not-authorized"}\``,
    `- Resource: \`${value.resourceId ?? "not-authorized"}\``,
    `- Mutating calls: \`${String(value.mutatingCallCount)}\``,
    `- Runtime task states captured: \`${String(value.taskStates.length)}\``,
    `- Downstream mission ID: \`${value.downstreamMissionId ?? "none"}\``,
    `- Failure: \`${value.failure?.reasonCode ?? "none"}\``,
    "",
    "The runner never retries the mutating call and never changes its idempotency key after an uncertain response.",
    "",
  ].join("\n");
  for (const secret of forbidden)
    if (secret && markdown.includes(secret)) throw coded("UGV_LIVE_EVIDENCE_REDACTION_FAILED");
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, markdown, { encoding: "utf8", mode: 0o600 });
  chmodSync(markdownPath, 0o600);
}
