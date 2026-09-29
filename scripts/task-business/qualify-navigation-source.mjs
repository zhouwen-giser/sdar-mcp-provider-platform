import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { canonicalJson } from "../../packages/adapter-protocol/src/index.ts";
import {
  PostgresProviderStore,
  BoundExecutionScope,
  openGowmTaskBusinessStore,
} from "../../packages/provider-adapter-kit/src/index.ts";
import { StreamableHttpUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.ts";
import {
  VehicleMqttIngress,
  UgvMqttClient,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.ts";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.ts";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.ts";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.ts";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.ts";
import { AirportRoadPlanner } from "../../apps/ugv-provider-adapter/src/navigation-planner.ts";
import { NavigationBusinessProcessor } from "../../apps/ugv-provider-adapter/src/navigation-business-processor.ts";

const args = process.argv.slice(2);
const arg = (key) => {
  const n = args.indexOf(key);
  if (n < 0 || !args[n + 1]) throw Error(`REQUIRED_ARGUMENT:${key}`);
  return args[n + 1];
};
if (args.includes("--help")) {
  console.log(
    "node --import tsx scripts/task-business/qualify-navigation-source.mjs --fixture /private/gowm-test.json --report /private/result.json [--allow-motion]\nDefault is read-only. Motion additionally requires SMPP_UGV_SOURCE_QUALIFICATION_ALLOW_MOTION=true. Uses existing planner and navigation tools on the software simulator, with fire disabled. Qualifies the Provider source layer, not public Runtime/SDAR end-to-end acceptance.",
  );
  process.exit(0);
}
const allowMotion = args.includes("--allow-motion");
if (allowMotion && process.env.SMPP_UGV_SOURCE_QUALIFICATION_ALLOW_MOTION !== "true")
  throw Error("EXPLICIT_MOTION_AUTHORIZATION_REQUIRED");
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
const taskId = `source-nav-${runId}`;
const config = {
  mode: "gowm-shared",
  databaseUrl: fixture.databaseUrl,
  contractDir: fixture.contractDir,
  serviceKey: fixture.serviceKey,
  sourceSessionKey: fixture.sourceSessionKey,
  allowedDeviceIds: [fixture.deviceIds[0]],
  bindingId: fixture.bindingIds[0],
};
const identity = {
  providerId: fixture.providerId,
  resourceId: fixture.resourceIds[0],
  entityId: "ugv1",
  executionMode: "simulation",
  vehicleType: "ugv",
};
const report = {
  schema: "smpp.navigation-source-qualification/v1",
  runId,
  startedAt: new Date().toISOString(),
  status: "NOT_RUN",
  layer: "PROVIDER_REAL_SOURCE_ON_SELECTED_GOWM",
  publicRuntimeQualified: false,
  fireEnabled: false,
  steps: [],
  calls: [],
  transitions: [],
  adoptions: [],
  sourceObservations: [],
  projectionChecks: [],
};
const note = (stage, details = {}) => {
  const entry = { stage, at: new Date().toISOString(), ...details };
  report.steps.push(entry);
  console.log(JSON.stringify(entry));
};
const store = new PostgresProviderStore(fixture.databaseUrl, 3, "ugv", config);
const ingress = new VehicleMqttIngress(
  "auto",
  { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
  ugvMqttProfile(identity),
);
const mqtt = new UgvMqttClient(
  {
    url: "mqtt://192.168.2.63:1883",
    clientId: `smpp-source-${runId}`,
    tlsMode: "disabled",
    sessionMode: "clean",
    reconnectMinMs: 500,
    reconnectMaxMs: 3000,
  },
  ingress,
);
class NavigationOnlyClient extends StreamableHttpUgvDeviceMcpClient {
  async call(name, input, id) {
    if (
      ![
        "get_status",
        "get_capabilities",
        "ugv_area_recon_get_status",
        "ugv_area_recon_get_targets",
        "ugv_path_follow_mission",
        "ugv_mission_control",
        "ugv_motion_stop",
      ].includes(name)
    )
      throw Error("QUALIFICATION_TOOL_FORBIDDEN");
    report.calls.push({
      name,
      at: new Date().toISOString(),
      argumentHash: createHash("sha256").update(canonicalJson(input)).digest("hex"),
      ...(name === "ugv_mission_control"
        ? { action: input.action, missionId: input.mission_id }
        : {}),
    });
    return super.call(name, input, id);
  }
}
const device = new NavigationOnlyClient(
  {
    url: "http://192.168.2.63:19000/mcp",
    timeoutMs: 5000,
    maxResponseBytes: 65536,
    contractReportPath: "reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json",
    useMockContractWhenUnavailable: false,
    useCapturedContractWhenUnavailable: false,
    readRetryAttempts: 1,
    circuitBreakerThreshold: 3,
    circuitBreakerResetMs: 5000,
  },
  store,
);
let runtime;
let business;
let ownExecution;
const projectNavigation = NavigationBusinessProcessor.prototype.apply;
NavigationBusinessProcessor.prototype.apply = async function (
  execution,
  fact,
  mayCommit,
  adoption,
) {
  const startedAt = Date.now();
  try {
    const result = await projectNavigation.call(this, execution, fact, mayCommit, adoption);
    if (fact.adoption === "adopted" && report.projectionChecks.length < 40)
      report.projectionChecks.push({
        missionId: fact.missionId,
        result,
        elapsedMs: Date.now() - startedAt,
        at: new Date().toISOString(),
        observedAt: fact.observedAt,
        latestMission: ingress.snapshot().chassis.mission,
      });
    return result;
  } catch (error) {
    note("projection_failed", { reason: error.message });
    throw error;
  }
};
let lastMission;
let lastPositionAt = 0;
const unsubscribeEvidence = ingress.onSnapshot((snapshot, topic, applied) => {
  if (!applied) return;
  const payload = applied.observation.canonicalPayload;
  if (topic === "/ugv/mission_state" && canonicalJson(payload) !== lastMission) {
    lastMission = canonicalJson(payload);
    report.sourceObservations.push({
      topic,
      receivedAt: new Date().toISOString(),
      retained: applied.retained,
      cursor: applied.cursor,
      payload,
    });
  } else if (topic === "/ugv/gnss" && Date.now() - lastPositionAt >= 1000) {
    lastPositionAt = Date.now();
    report.sourceObservations.push({
      topic,
      receivedAt: new Date().toISOString(),
      retained: applied.retained,
      cursor: applied.cursor,
      position: snapshot.chassis.position,
      speedKmh: snapshot.chassis.speedKmh,
    });
  }
});
const recordTransition = (execution) => {
  if (execution && report.transitions.at(-1)?.state !== execution.state)
    report.transitions.push({
      state: execution.state,
      at: new Date().toISOString(),
      reasonCode: execution.reasonCode,
    });
};
const terminal = (e) =>
  ["SUCCEEDED", "CANCELLED", "BUSINESS_FAILED", "TECHNICAL_FAILED"].includes(e?.state);
const waitFor = async (stage, action, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await action();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`QUALIFICATION_TIMEOUT:${stage}`);
};
const commandIdentity = (execution, sequence) => ({
  taskId: execution.taskId,
  externalExecutionId: execution.externalExecutionId,
  operationName: execution.operationName,
  argumentHash: execution.argumentHash,
  executionContext: execution.executionContext,
  commandSequence: sequence,
});
try {
  await store.initialize();
  business = await openGowmTaskBusinessStore(store.pool, config);
  store.enableTaskBusinessSource(business);
  note("shared_store_verified");
  if ((await store.listActiveExecutions()).length)
    throw Error("QUALIFICATION_ACTIVE_EXECUTION_PRESENT");
  await device.connect();
  note("device_connected");
  mqtt.start();
  await waitFor(
    "observations",
    () =>
      ingress.snapshot().connectivity.mqttConnected &&
      ingress.fieldFreshnessState("chassis.position.geodetic", 3000) === "fresh" &&
      ingress.fieldFreshnessState("chassis.speed", 3000) === "fresh" &&
      ingress.fieldFreshnessState("chassis.mission", 3000) === "fresh" &&
      ingress.snapshot().chassis.mission.state !== "unknown",
  );
  const snapshot = ingress.snapshot();
  report.preflight = {
    mission: snapshot.chassis.mission,
    position: snapshot.chassis.position,
    speedKmh: snapshot.chassis.speedKmh,
    reconMotionStatus: snapshot.payload.reconnaissance.motionStatus,
  };
  note("read_only_preflight", report.preflight);
  if (!allowMotion) {
    report.status = "READ_ONLY_PASS";
  } else {
    if (
      ![-1, 0, 3, 4, 5].includes(snapshot.chassis.mission.state) ||
      Math.abs(snapshot.chassis.speedKmh ?? Infinity) > 0.1
    )
      throw Error("QUALIFICATION_REQUIRES_QUIESCENT_SIMULATOR");
    const events = new UgvBusinessEventHub(store, identity.resourceId);
    const telemetry = new UgvTelemetry({
      providerId: identity.providerId,
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    });
    const service = new UgvTaskBusinessContextService(
      store,
      business,
      identity.providerId,
      identity.resourceId,
      (e) => events.notifyCommittedTaskBusinessEvent(e),
    );
    runtime = new UgvProviderRuntime(
      {
        ...identity,
        freshness: {
          chassis: 3000,
          mission: 3000,
          health: 5000,
          target: 3000,
          payload: 3000,
          maximumFutureSkewMs: 1000,
        },
        allowNavigationWithRecon: true,
        fireEnabled: false,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 250,
        stationaryStabilityMs: 500,
        stationaryMinimumSamples: 2,
        initialObservationWaitMs: 10000,
        navigationPlanner: new AirportRoadPlanner("http://192.168.2.63:7879"),
        navigationAdjustments: true,
      },
      store,
      ingress,
      device,
      events,
      telemetry,
      service,
    );
    await runtime.initialize();
    const destination = { longitude: 106.81312856, latitude: 29.72041222 };
    const navigationArgs = {
      resourceId: identity.resourceId,
      mission: { type: "point", target: destination },
      speedLimitKmh: 5,
      stopOnObstacle: true,
    };
    const input = {
      taskId,
      operationName: "vehicle_navigate",
      arguments: navigationArgs,
      argumentHash: createHash("sha256").update(canonicalJson(navigationArgs)).digest("hex"),
      executionContext: {
        authorizationContextHash: createHash("sha256").update(runId).digest("hex"),
        executionMode: "SIMULATION",
        simulationId: fixture.dataScopeKey,
        correlationId: runId,
      },
    };
    await runtime.start(input);
    ownExecution = await store.getExecution(taskId);
    if (!ownExecution) throw Error("QUALIFICATION_START_MISSING");
    const scope = BoundExecutionScope.fromExecution(ownExecution);
    const effective = async (revision) => {
      const execution = await runtime.get(taskId);
      recordTransition(execution);
      if (terminal(execution))
        throw Error(`QUALIFICATION_EARLY_TERMINAL:${execution.state}:${execution.reasonCode}`);
      const context = await business.getContext(scope);
      return context?.effectivePlanRevision === revision &&
        execution?.effectiveNavigation?.planRevision === revision
        ? { execution, context }
        : undefined;
    };
    const adopted = await waitFor("initial_adoption", () => effective(1));
    report.adoptions.push({
      revision: 1,
      effective: adopted.execution.effectiveNavigation,
      contextRevision: adopted.context.contextRevision,
    });
    note("initial_adopted", { missionId: adopted.execution.effectiveNavigation.missionId });
    // The previously observed parking point is on the same inspected airport
    // road. Use it for the first edit, then restore the user's destination;
    // repeat runs remain useful even when already near that destination.
    const intermediate = { longitude: 106.81179412264343, latitude: 29.720490136182608 };
    for (const [index, target] of [intermediate, destination].entries()) {
      const before = await business.getContext(scope);
      const entry = before.activeRefs.navigationAdjustment;
      if (!entry) throw Error("QUALIFICATION_ADJUSTMENT_ENTRY_MISSING");
      const command = {
        schemaVersion: "sdar.runtime-intervention-command/1.0-rc2",
        commandId: `adjust-${index + 1}-${runId}`,
        taskId,
        executionId: ownExecution.externalExecutionId,
        interventionId: entry.id,
        guard: {
          mode: "semantic",
          expectedInterventionRevision: entry.revision,
          expectedEffectivePlanRevision: before.effectivePlanRevision,
        },
        input: { waypoints: [target], density: "adaptive" },
      };
      const payload = {
        command,
        responder: {
          source: "runtime_authorization_context",
          actorType: "operator",
          verified: true,
        },
      };
      const ack = await runtime.applyIntervention(
        commandIdentity(ownExecution, String(index + 10)),
        payload,
      );
      if (!ack.accepted) throw Error(`QUALIFICATION_ADJUSTMENT_REJECTED:${ack.reasonCode}`);
      note("adjustment_accepted", { number: index + 1, target });
      const adopted = await waitFor(
        `adjustment_${index + 1}_adoption`,
        () => effective(index + 2),
        60000,
      );
      if (
        canonicalJson(adopted.execution.arguments) !== canonicalJson(navigationArgs) ||
        adopted.execution.argumentHash !== input.argumentHash
      )
        throw Error("QUALIFICATION_ORIGINAL_ARGUMENTS_CHANGED");
      const result = await business.getCommand(scope, command.commandId);
      if (result?.state !== "applied") throw Error("QUALIFICATION_APPLIED_RESULT_MISSING");
      report.adoptions.push({
        revision: index + 2,
        effective: adopted.execution.effectiveNavigation,
        contextRevision: adopted.context.contextRevision,
        command: result,
      });
      const calls = report.calls.length;
      const replay = await runtime.applyIntervention(
        commandIdentity(ownExecution, String(index + 10)),
        payload,
      );
      if (!replay.accepted || report.calls.length !== calls)
        throw Error("QUALIFICATION_REPLAY_NOT_IDEMPOTENT");
      note("adjustment_adopted", {
        number: index + 1,
        missionId: adopted.execution.effectiveNavigation.missionId,
      });
    }
    const completed = await waitFor(
      "terminal",
      async () => {
        const e = await runtime.get(taskId);
        recordTransition(e);
        return terminal(e) ? e : undefined;
      },
      240000,
    );
    report.execution = completed;
    report.context = await business.getContext(scope);
    report.objects = await Promise.all(
      report.context.artifactRefs.map((ref) => business.getObjectVersion(scope, ref)),
    );
    report.mutationJournal = await store.listMutationJournal(taskId);
    if (completed.state !== "SUCCEEDED")
      throw Error(`QUALIFICATION_TERMINAL_FAILED:${completed.reasonCode}`);
    report.status = "PROVIDER_SOURCE_PASS";
    note("provider_source_pass", {
      missionIds: completed.downstreamMissionIds,
      effectivePlanRevision: completed.effectiveNavigation.planRevision,
    });
  }
} catch (error) {
  report.status = "FAILED";
  report.reason = error instanceof Error ? error.message : "UNKNOWN";
  report.failedObservation = {
    snapshot: ingress.snapshot(),
    authorities: ingress.fieldObservationAuthorities(),
  };
  process.exitCode = 1;
  note("failed", { reason: report.reason });
} finally {
  if (runtime) {
    const last = await store.getExecution(taskId).catch(() => undefined);
    if (last && !terminal(last)) {
      try {
        await runtime.command("cancel", commandIdentity(last, "999"));
        const stopped = await waitFor(
          "cleanup",
          async () => {
            const e = await runtime.get(taskId);
            return terminal(e) ? e : undefined;
          },
          35000,
        );
        report.cleanup = { state: stopped.state, reasonCode: stopped.reasonCode };
      } catch {
        report.cleanup = { state: "UNCONFIRMED" };
      }
    }
    // A failed Task is not evidence of physical stationarity. A global stop is
    // confined to this authorized software-simulator run after its own dispatch.
    if (
      last &&
      report.status !== "PROVIDER_SOURCE_PASS" &&
      report.calls.some((call) => call.name === "ugv_path_follow_mission")
    ) {
      const stopAt = Date.now();
      try {
        await device.call("ugv_motion_stop", {}, taskId);
        await waitFor(
          "physical_cleanup",
          () =>
            Date.now() - stopAt > 1000 &&
            ingress.fieldFreshnessState("chassis.speed", 500) === "fresh" &&
            Math.abs(ingress.snapshot().chassis.speedKmh ?? Infinity) <= 0.1,
          10000,
        );
        report.cleanup = { ...report.cleanup, physicalStop: "FRESH_STATIONARY_OBSERVED" };
      } catch {
        report.cleanup = { ...report.cleanup, physicalStop: "UNCONFIRMED" };
      }
    }
    report.execution ??= await store.getExecution(taskId).catch(() => undefined);
    report.mutationJournal ??= await store.listMutationJournal(taskId).catch(() => []);
  }
  report.completedAt = new Date().toISOString();
  unsubscribeEvidence();
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await mqtt.stop();
  if (runtime) await runtime.close();
  else {
    await device.close();
    await store.close();
  }
}
