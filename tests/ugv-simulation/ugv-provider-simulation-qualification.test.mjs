import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  diffAdapterAudit,
  extractSynchronousTaskId,
  finalizeQualificationEvidence,
  initialSafetySummary,
  pointAvailabilityArguments,
  safetyWithVerifiedAudit,
  validateCatalogAndManifest,
  validatePointAvailability,
  validateState,
  writeExclusiveEvidence,
} from "../../scripts/ugv-agent-profile-simulation/qualify-provider-readonly.mjs";

const root = resolve(import.meta.dirname, "../..");
const synchronousTaskId = "11111111-1111-4111-8111-111111111111";

describe("UAP-P1-B02 read-only SMPP provider qualification", () => {
  it("qualifies the exact northbound provider, resource, schemas, and execution semantics", () => {
    const result = validateCatalogAndManifest(discovery(), tools());

    assert.deepEqual(result.providerCatalog, {
      providerId: "isr.vehicle.ugv.ugv1",
      providerType: "isr.vehicle.ugv",
      providerVersion: "1.0.0",
      manifestHash: "a".repeat(64),
      authority: "northbound_server_discover",
    });
    assert.deepEqual(result.resource, {
      resourceId: "vehicle:ugv1",
      resourceType: "isr.vehicle.ugv",
      uniqueResourceCount: 1,
      authority: "northbound_catalog_resource_binding_and_provider_catalog",
    });
    assert.equal(result.operations.vehicleGetState.execution, "SYNCHRONOUS");
    assert.deepEqual(result.operations.vehicleGetState.lifecycle, {
      cancel: false,
      pauseResume: false,
      observations: false,
      northboundObservations: false,
    });
    assert.equal(result.operations.vehicleNavigate.execution, "TASK_REQUIRED");
    assert.deepEqual(result.operations.vehicleNavigate.lifecycle, {
      cancel: true,
      pauseResume: true,
      observations: true,
      northboundObservations: true,
    });
  });

  it("fails closed for missing lifecycle metadata, an unbound tool, or a second resource", () => {
    const missingLifecycle = clone(tools());
    delete missingLifecycle.body.result.tools[1]._meta["io.sdar/taskExecution"].supportsPauseResume;
    assert.throws(() => validateCatalogAndManifest(discovery(), missingLifecycle), {
      code: "UAP_NAVIGATION_NORTHBOUND_PROFILE_INCOMPLETE",
    });

    const unbound = clone(tools());
    delete unbound.body.result.tools[0]._meta["io.sdar/resourceBinding"];
    assert.throws(() => validateCatalogAndManifest(discovery(), unbound), {
      code: "UAP_RUNTIME_RESOURCE_BINDING_REQUIRED",
    });

    const secondResource = clone(tools());
    secondResource.body.result.tools[1].inputSchema.properties.resourceId.const = "vehicle:ugv2";
    assert.throws(() => validateCatalogAndManifest(discovery(), secondResource), {
      code: "UAP_RUNTIME_RESOURCE_NOT_UNIQUE",
    });
  });

  it("rejects mismatched JSON-RPC identity and incomplete pagination", () => {
    const wrongId = discovery();
    wrongId.body.id = 99;
    assert.throws(() => validateCatalogAndManifest(wrongId, tools()), {
      code: "UAP_RUNTIME_DISCOVERY_FAILED",
    });

    const partial = tools();
    partial.body.result.nextCursor = "page-2";
    assert.throws(() => validateCatalogAndManifest(discovery(), partial), {
      code: "UAP_RUNTIME_TOOLS_LIST_INCOMPLETE",
    });
  });

  it("accepts only fresh, connected, stationary, quiescent external-simulation state", () => {
    const now = 1_800_000_000_000;
    const state = vehicleState(now);
    const qualified = validateState(state, 3_000, now);

    assert.equal(qualified.identity.resourceId, "vehicle:ugv1");
    assert.equal(qualified.mission.idle, true);
    assert.equal(qualified.mission.taskIdHash, null);
    assert.equal(
      qualified.mission.taskIdMissingReason,
      "NO_ACTIVE_DEVICE_MISSION_ID_FOR_QUIESCENT_STATE",
    );
    assert.deepEqual(pointAvailabilityArguments(qualified.position), {
      resourceId: "vehicle:ugv1",
      mission: {
        type: "point",
        target: { latitude: 31.2304, longitude: 121.4737, altitude: 4.5 },
      },
      stopOnObstacle: true,
    });

    const busy = clone(state);
    busy.chassis.mission = { state: 0, id: "device-mission-active" };
    assert.throws(() => validateState(busy, 3_000, now), { code: "UAP_VEHICLE_NOT_IDLE" });

    const stale = clone(state);
    stale.freshness.missionObservedAt = new Date(now - 3_001).toISOString();
    assert.throws(() => validateState(stale, 3_000, now), {
      code: "UAP_VEHICLE_MISSION_STATE_STALE",
    });

    const future = clone(state);
    future.observedAt = new Date(now + 1_001).toISOString();
    assert.throws(() => validateState(future, 3_000, now), {
      code: "UAP_VEHICLE_OBSERVATION_STALE",
    });
  });

  it("validates point availability without dispatching navigation", () => {
    const requestedAt = "2026-08-21T03:00:00.000Z";
    const respondedAt = "2026-08-21T03:00:00.100Z";
    const argumentsValue = pointAvailabilityArguments({
      latitude: 31.2304,
      longitude: 121.4737,
      altitude: 4.5,
    });
    const result = validatePointAvailability(
      rpc(4, {
        resultType: "complete",
        profileVersion: "1.0",
        results: [
          {
            requestId: "point-run-1",
            operationName: "vehicle_navigate",
            availability: "available",
            riskLevel: "medium",
            reservationMode: "none",
            validUntil: "2026-08-21T03:00:30.000Z",
          },
        ],
      }),
      argumentsValue,
      "point-run-1",
      requestedAt,
      respondedAt,
    );

    assert.equal(result.targetSource, "fresh_vehicle_get_state_position");
    assert.equal(result.stopOnObstacle, true);
    assert.equal(result.navigationDispatched, false);
  });

  it("correlates the one synchronous get_status row and rejects all audit ambiguity", () => {
    const before = audit();
    const after = clone(before);
    after.deviceToolCalls.push(deviceCall("call-1", synchronousTaskId, "get_status"));
    const result = diffAdapterAudit(before, after, true, synchronousTaskId);
    assert.equal(result.addedDeviceToolCallCount, 1);
    assert.equal(result.addedExecutionCount, 0);
    assert.equal(result.navigationDispatchCount, 0);
    assert.equal(result.mutatingToolCallCount, 0);

    assert.throws(() => diffAdapterAudit(before, after, true, randomUUID()), {
      code: "UAP_SOUTHBOUND_READ_ONLY_AUDIT_MISMATCH",
    });

    const extra = clone(after);
    extra.deviceToolCalls.push(deviceCall("call-2", randomUUID(), "get_status"));
    assert.throws(() => diffAdapterAudit(before, extra, true, synchronousTaskId), {
      code: "UAP_SOUTHBOUND_READ_ONLY_AUDIT_MISMATCH",
    });

    const navigation = clone(before);
    navigation.deviceToolCalls.push(
      deviceCall("call-nav", synchronousTaskId, "ugv_path_follow_mission"),
    );
    const unsafe = diffAdapterAudit(before, navigation, false);
    assert.equal(unsafe.navigationDispatchCount, 1);
    assert.equal(unsafe.mutatingToolCallCount, 1);
    assert.equal(unsafe.forbiddenOperationCallCount, 1);

    const mutation = clone(after);
    mutation.mutationJournal.push({
      rowId: "task-1:step-1",
      toolName: "ugv_mission_control",
      state: "PENDING",
    });
    assert.throws(() => diffAdapterAudit(before, mutation, true, synchronousTaskId), {
      code: "UAP_SOUTHBOUND_READ_ONLY_AUDIT_MISMATCH",
    });

    const changed = clone(after);
    changed.executions[0].state = "RUNNING";
    assert.throws(() => diffAdapterAudit(before, changed, false), {
      code: "UAP_ADAPTER_AUDIT_EXISTING_ROW_CHANGED",
    });
  });

  it("never reports unknown southbound observations as zero", () => {
    const pending = initialSafetySummary();
    assert.equal(pending.northboundNavigationAttemptCount, 0);
    assert.equal(pending.southboundAuditVerified, false);
    assert.equal(pending.navigationDispatchCount, null);
    assert.equal(pending.mutatingToolCallCount, null);
    assert.equal(pending.forbiddenOperationCallCount, null);

    const verified = safetyWithVerifiedAudit(pending, {
      navigationDispatchCount: 0,
      mutatingToolCallCount: 0,
      forbiddenOperationCallCount: 0,
    });
    assert.equal(verified.southboundAuditVerified, true);
    assert.equal(verified.navigationDispatchCount, 0);
    assert.equal(verified.mutatingToolCallCount, 0);
    assert.equal(verified.forbiddenOperationCallCount, 0);
  });

  it("extracts the evidence UUID and rejects another subject correlation", () => {
    const response = rpc(3, {
      resultType: "complete",
      structuredContent: vehicleState(Date.now()),
      _meta: {
        "io.sdar/evidence": {
          profileVersion: "1.0",
          items: [
            {
              evidenceType: "vehicle.state.observation",
              subjectRef: `execution:vehicle:ugv1:sync:${synchronousTaskId}`,
            },
          ],
        },
      },
    });
    assert.equal(extractSynchronousTaskId(response), synchronousTaskId);
    response.body.result._meta["io.sdar/evidence"].items[0].subjectRef =
      "execution:vehicle:ugv2:sync:11111111-1111-4111-8111-111111111111";
    assert.throws(() => extractSynchronousTaskId(response), {
      code: "UAP_SYNCHRONOUS_EVIDENCE_INVALID",
    });
  });

  it("writes immutable redacted evidence and permanently consumes reservation IDs", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "uap-provider-qualification-"));
    const output = resolve(directory, "qualification.json");
    const value = { status: "BLOCKED_EXTERNAL_ENV", authorizationGranted: false };
    writeExclusiveEvidence(output, value);
    const first = readFileSync(output, "utf8");
    assert.throws(() => writeExclusiveEvidence(output, { status: "PASS" }), { code: "EEXIST" });
    assert.equal(readFileSync(output, "utf8"), first);

    const reservation = resolve(
      root,
      "scripts/ugv-agent-profile-simulation/reserve-provider-qualification-run.mjs",
    );
    const args = [reservation, "--attempts-dir", directory, "--run-id", "uap-provider-test-01"];
    assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
    const reused = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(reused.status, 2);
    assert.match(
      readFileSync(reservation, "utf8"),
      /UAP_PROVIDER_QUALIFICATION_RUN_ID_ALREADY_USED/u,
    );
  });

  it("atomically assigns the first canonical PASS and records a concurrent loser as blocked", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "uap-provider-canonical-"));
    const runtimeUrl = new URL("http://127.0.0.1:19121/mcp");
    const canonicalOutputPath = resolve(directory, "canonical.json");
    const first = {
      status: "PASS",
      reasonCode: "EXTERNAL_SIMULATION_PROVIDER_QUALIFIED_READ_ONLY",
      exitCode: 0,
      failure: null,
    };
    finalizeQualificationEvidence(
      {
        runtimeUrl,
        canonicalOutputPath,
        outputPath: resolve(directory, "attempt-first.json"),
      },
      first,
    );
    assert.equal(first.status, "PASS");
    const canonical = readFileSync(canonicalOutputPath, "utf8");

    const second = {
      status: "PASS",
      reasonCode: "EXTERNAL_SIMULATION_PROVIDER_QUALIFIED_READ_ONLY",
      exitCode: 0,
      failure: null,
    };
    const secondPath = resolve(directory, "attempt-second.json");
    finalizeQualificationEvidence(
      { runtimeUrl, canonicalOutputPath, outputPath: secondPath },
      second,
    );
    assert.equal(second.status, "BLOCKED_EVIDENCE_LINEAGE");
    assert.equal(second.exitCode, 2);
    assert.equal(second.reasonCode, "UAP_CANONICAL_QUALIFICATION_EVIDENCE_ALREADY_EXISTS");
    assert.equal(JSON.parse(readFileSync(secondPath, "utf8")).status, "BLOCKED_EVIDENCE_LINEAGE");
    assert.equal(readFileSync(canonicalOutputPath, "utf8"), canonical);
  });

  it("contains no direct Device MCP or mutating northbound call path", () => {
    const source = readFileSync(
      resolve(root, "scripts/ugv-agent-profile-simulation/qualify-provider-readonly.mjs"),
      "utf8",
    );
    assert.doesNotMatch(source, /UGV_SIM_DEVICE_MCP_URL|192\.168\.2\.63:19000/u);
    assert.doesNotMatch(source, /"tools\/call"[\s\S]{0,160}name:\s*"vehicle_navigate"/u);
    assert.match(source, /"io\.sdar\/taskExecution\/checkAvailability"/u);
  });
});

function discovery() {
  return rpc(1, {
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    cacheScope: "public",
    capabilities: {
      extensions: {
        "io.sdar/providerCatalog": {
          providerId: "isr.vehicle.ugv.ugv1",
          providerType: "isr.vehicle.ugv",
          providerVersion: "1.0.0",
          manifestHash: "a".repeat(64),
        },
      },
    },
  });
}

function tools() {
  return rpc(2, { tools: [getStateTool(), navigateTool()] });
}

function getStateTool() {
  return tool("vehicle_get_state", {
    profileVersion: "1.0",
    taskBehavior: "synchronous_only",
    availability: "dynamic",
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsCancellation: false,
    supportsPauseResume: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: "server_managed",
  });
}

function navigateTool() {
  const value = tool("vehicle_navigate", {
    profileVersion: "1.0",
    taskBehavior: "task_required",
    availability: "dynamic",
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsCancellation: true,
    supportsPauseResume: true,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: "server_managed",
  });
  value.inputSchema = {
    type: "object",
    required: ["resourceId", "mission"],
    properties: {
      resourceId: { type: "string", const: "vehicle:ugv1" },
      mission: {
        oneOf: [
          {
            type: "object",
            required: ["type", "target"],
            properties: {
              type: { const: "point" },
              target: {
                type: "object",
                required: ["latitude", "longitude"],
                properties: {
                  latitude: { type: "number", minimum: -90, maximum: 90 },
                  longitude: { type: "number", minimum: -180, maximum: 180 },
                },
              },
            },
          },
        ],
      },
      stopOnObstacle: { type: "boolean" },
    },
  };
  return value;
}

function tool(name, profile) {
  return {
    name,
    inputSchema: {
      type: "object",
      required: ["resourceId"],
      properties: { resourceId: { type: "string", const: "vehicle:ugv1" } },
    },
    outputSchema: { type: "object", anyOf: [{ type: "object" }, { type: "object" }] },
    _meta: {
      "io.sdar/taskExecution": profile,
      "io.sdar/resourceBinding": {
        mode: "ARGUMENT_REFERENCE",
        resourceIdJsonPointer: "/resourceId",
      },
    },
  };
}

function rpc(id, result) {
  return { status: 200, expectedId: id, body: { jsonrpc: "2.0", id, result } };
}

function vehicleState(now) {
  const observedAt = new Date(now).toISOString();
  return {
    identity: {
      providerId: "isr.vehicle.ugv.ugv1",
      resourceId: "vehicle:ugv1",
      vehicleType: "ugv",
      executionMode: "simulation",
    },
    connectivity: {
      mqttConnected: true,
      deviceMcpConnected: true,
      deviceAvailable: true,
    },
    freshness: {
      chassisObservedAt: observedAt,
      missionObservedAt: observedAt,
      healthObservedAt: observedAt,
    },
    chassis: {
      position: { latitude: 31.2304, longitude: 121.4737, altitude: 4.5 },
      mission: { state: 0, id: null },
      speedKmh: 0,
    },
    revision: "mqtt:42",
    mqttIngressSequence: 42,
    observedAt,
  };
}

function audit() {
  return {
    deviceToolCalls: [],
    executions: [{ taskId: "old-task", operationName: "vehicle_navigate", state: "SUCCEEDED" }],
    mutationJournal: [],
    commandAcks: [],
  };
}

function deviceCall(callId, taskId, toolName) {
  return {
    callId,
    taskId,
    toolName,
    outcome: "accepted",
    occurredAt: "2026-08-21T03:00:00.000Z",
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
