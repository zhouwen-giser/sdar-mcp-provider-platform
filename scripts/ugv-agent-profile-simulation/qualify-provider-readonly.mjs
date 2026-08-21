#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundedInteger,
  canonical,
  coded,
  gitSha,
  isRecord,
  parseArguments,
  parseEndpoint,
  redactEndpoint,
  repositoryRoot,
  safeFailure,
  sha256,
} from "../ugv-simulation/lib.mjs";

const EXPECTED = Object.freeze({
  providerId: "isr.vehicle.ugv.ugv1",
  providerType: "isr.vehicle.ugv",
  providerVersion: "1.0.0",
  resourceId: "vehicle:ugv1",
});
const QUIESCENT_MISSION_STATES = new Set([-1, 0, 3, 4, 5]);
const PROTOCOL_VERSION = "2026-07-28";

export async function qualifyProviderReadOnly(options) {
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: "ugv-agent-profile.smpp-provider-qualification/v1",
    generatedAt: startedAt,
    startedAt,
    completedAt: null,
    runId: options.runId,
    taskId: "UAP-P1-B02",
    command: `UGV_SIMULATION_RUN_ID=${options.runId} deploy/ugv-agent-profile-simulation/qualify-provider-readonly.sh`,
    status: "BLOCKED_EXTERNAL_ENV",
    reasonCode: "SMPP_PROVIDER_QUALIFICATION_NOT_COMPLETED",
    exitCode: 2,
    evidenceClass: "external_simulation",
    productionEligible: false,
    physicalVehicleQualified: false,
    authorizationGranted: false,
    baseline: { gitSha: gitSha(options.root) },
    endpoint: redactEndpoint(options.runtimeUrl),
    lineage: {
      preflightEvidence: `attempts/deployment-preflight-${options.runId}.redacted.json`,
      registrySnapshotConsumption: "DEFERRED_TO_UAP_P2_B02",
      registrySnapshotId: null,
      registrySnapshotIdMissingReason: "DEFERRED_TO_UAP_P2_B02",
      nodeControlConsumption: "DEFERRED_TO_UAP_P2_B02",
      nodeControlBindingId: null,
      nodeControlBindingIdMissingReason: "DEFERRED_TO_UAP_P2_B02",
    },
    safety: initialSafetySummary(),
    health: null,
    providerCatalog: null,
    manifest: null,
    resource: null,
    operations: null,
    state: null,
    pointAvailability: null,
    southboundAudit: null,
    failure: null,
  };
  let auditBefore;
  let expectedSynchronousTaskId;
  try {
    assertPreflightLineage(options.preflightPath, options.runId);
    auditBefore = readAdapterAudit(options);
    assertNoActiveAdapterExecutions(auditBefore);
    report.health = runProfileHealth(options);

    report.safety.readinessProbeCount += 1;
    const readiness = await readReadiness(options.runtimeUrl, options.timeoutMs);
    report.safety.serverDiscoverCount += 1;
    const discovery = await rpc(options, "server/discover", {}, undefined, 1);
    report.safety.toolsListCount += 1;
    const toolsList = await rpc(options, "tools/list", {}, undefined, 2);
    const catalogQualification = validateCatalogAndManifest(discovery, toolsList);
    report.providerCatalog = catalogQualification.providerCatalog;
    report.manifest = catalogQualification.manifest;
    report.resource = catalogQualification.resource;
    report.operations = catalogQualification.operations;

    report.safety.northboundToolsCallCount += 1;
    const stateResponse = await rpc(
      options,
      "tools/call",
      { name: "vehicle_get_state", arguments: { resourceId: EXPECTED.resourceId } },
      "vehicle_get_state",
      3,
    );
    const synchronousTaskId = extractSynchronousTaskId(stateResponse);
    expectedSynchronousTaskId = synchronousTaskId;
    const state = completeStructuredContent(stateResponse, "UAP_VEHICLE_GET_STATE_FAILED");
    const stateQualification = validateState(state, options.maximumStateAgeMs, Date.now());
    report.state = { ...stateQualification, executionCorrelationHash: sha256(synchronousTaskId) };

    const pointArguments = pointAvailabilityArguments(stateQualification.position);
    report.safety.availabilityCheckCount += 1;
    const availabilityRequestedAt = new Date().toISOString();
    const availabilityResponse = await rpc(
      options,
      "io.sdar/taskExecution/checkAvailability",
      {
        profileVersion: "1.0",
        checks: [
          {
            requestId: `point-${options.runId}`,
            operationName: "vehicle_navigate",
            arguments: { state: "complete", value: pointArguments },
          },
        ],
      },
      undefined,
      4,
    );
    const availabilityRespondedAt = new Date().toISOString();
    report.pointAvailability = validatePointAvailability(
      availabilityResponse,
      pointArguments,
      `point-${options.runId}`,
      availabilityRequestedAt,
      availabilityRespondedAt,
    );

    const auditAfter = readAdapterAudit(options);
    report.southboundAudit = diffAdapterAudit(auditBefore, auditAfter, true, synchronousTaskId);
    report.safety = safetyWithVerifiedAudit(report.safety, report.southboundAudit);
    report.health = { ...report.health, runtimeReadiness: readiness };
    report.status = "PASS";
    report.reasonCode = "EXTERNAL_SIMULATION_PROVIDER_QUALIFIED_READ_ONLY";
    report.exitCode = 0;
  } catch (error) {
    report.failure = safeFailure(error, "SMPP_PROVIDER_QUALIFICATION_FAILED");
    report.reasonCode = report.failure.reasonCode;
    report.status = isExternalEnvironmentBlocker(report.reasonCode)
      ? "BLOCKED_EXTERNAL_ENV"
      : "FAILED_QUALIFICATION";
    report.exitCode = report.status === "FAILED_QUALIFICATION" ? 1 : 2;
    if (auditBefore !== undefined) {
      try {
        report.southboundAudit = diffAdapterAudit(
          auditBefore,
          readAdapterAudit(options),
          false,
          expectedSynchronousTaskId,
        );
        report.safety = safetyWithVerifiedAudit(report.safety, report.southboundAudit);
        if (
          report.safety.navigationDispatchCount !== 0 ||
          report.safety.mutatingToolCallCount !== 0 ||
          report.safety.forbiddenOperationCallCount !== 0
        ) {
          report.failure = {
            ...report.failure,
            initialReasonCode: report.failure.reasonCode,
            reasonCode: "UAP_READ_ONLY_SAFETY_VIOLATION",
          };
          report.reasonCode = "UAP_READ_ONLY_SAFETY_VIOLATION";
          report.status = "FAILED_QUALIFICATION";
          report.exitCode = 1;
        }
      } catch (auditError) {
        report.failure = {
          ...safeFailure(auditError, "UAP_POST_FAILURE_AUDIT_UNAVAILABLE"),
          initialReasonCode: report.reasonCode,
        };
        report.reasonCode = "UAP_POST_FAILURE_AUDIT_UNAVAILABLE";
        report.status = "BLOCKED_EXTERNAL_ENV";
        report.exitCode = 2;
      }
    }
  }
  report.completedAt = new Date().toISOString();
  report.generatedAt = report.completedAt;
  finalizeQualificationEvidence(options, report);
  return report;
}

export function finalizeQualificationEvidence(options, report) {
  const forbiddenValues = [options.runtimeUrl.href];
  if (report.status === "PASS") {
    try {
      // Canonical evidence is the exclusive PASS claim. Claim it before writing the attempt so a
      // concurrent loser records BLOCKED_EVIDENCE_LINEAGE rather than a false PASS attempt.
      writeExclusiveEvidence(options.canonicalOutputPath, report, forbiddenValues);
    } catch (error) {
      report.status = "BLOCKED_EVIDENCE_LINEAGE";
      report.reasonCode =
        error?.code === "EEXIST"
          ? "UAP_CANONICAL_QUALIFICATION_EVIDENCE_ALREADY_EXISTS"
          : "UAP_CANONICAL_QUALIFICATION_EVIDENCE_WRITE_FAILED";
      report.exitCode = 2;
      report.failure = {
        reasonCode: report.reasonCode,
        errorClass: "QualificationError",
      };
    }
  }
  writeExclusiveEvidence(options.outputPath, report, forbiddenValues);
}

export function validateCatalogAndManifest(discoveryResponse, toolsResponse) {
  const discovery = rpcResult(discoveryResponse, "UAP_RUNTIME_DISCOVERY_FAILED");
  if (
    discovery.resultType !== "complete" ||
    !Array.isArray(discovery.supportedVersions) ||
    !discovery.supportedVersions.includes(PROTOCOL_VERSION) ||
    discovery.cacheScope !== "public"
  )
    throw coded("UAP_RUNTIME_DISCOVERY_CONTRACT_INVALID");
  const capabilities = record(discovery.capabilities, "UAP_DISCOVERY_CAPABILITIES_INVALID");
  const extensions = record(capabilities.extensions, "UAP_DISCOVERY_EXTENSIONS_INVALID");
  const providerCatalog = exactProviderCatalog(extensions["io.sdar/providerCatalog"]);
  const toolsResult = rpcResult(toolsResponse, "UAP_RUNTIME_TOOLS_LIST_FAILED");
  if ("nextCursor" in toolsResult || toolsResult.resultType === "partial")
    throw coded("UAP_RUNTIME_TOOLS_LIST_INCOMPLETE");
  const tools = array(toolsResult.tools, "UAP_RUNTIME_TOOLS_LIST_INVALID");
  const toolsByName = new Map(
    tools.map((value) => {
      const tool = record(value, "UAP_RUNTIME_TOOL_INVALID");
      const name = string(tool.name, "UAP_RUNTIME_TOOL_NAME_INVALID");
      if (tools.filter((candidate) => isRecord(candidate) && candidate.name === name).length !== 1)
        throw coded("UAP_RUNTIME_TOOL_NAME_NOT_UNIQUE");
      return [name, tool];
    }),
  );
  if (
    providerCatalog.providerId !== EXPECTED.providerId ||
    providerCatalog.providerType !== EXPECTED.providerType ||
    providerCatalog.providerVersion !== EXPECTED.providerVersion
  )
    throw coded("UAP_PROVIDER_CATALOG_MANIFEST_IDENTITY_MISMATCH");
  const getState = operationQualification("vehicle_get_state", "synchronous_only", toolsByName);
  assertSynchronousStateContract(getState.profile);
  const navigate = operationQualification("vehicle_navigate", "task_required", toolsByName);
  assertNavigationContract(navigate.tool, navigate.profile);
  const resourceIds = new Set();
  for (const tool of toolsByName.values()) {
    const metadata = record(tool._meta, "UAP_RUNTIME_TOOL_METADATA_INVALID");
    const binding = metadata["io.sdar/resourceBinding"];
    if (binding === undefined) throw coded("UAP_RUNTIME_RESOURCE_BINDING_REQUIRED");
    const bindingRecord = record(binding, "UAP_RUNTIME_RESOURCE_BINDING_INVALID");
    if (
      bindingRecord.mode !== "ARGUMENT_REFERENCE" ||
      bindingRecord.resourceIdJsonPointer !== "/resourceId"
    )
      throw coded("UAP_RUNTIME_RESOURCE_BINDING_INVALID");
    const input = record(tool.inputSchema, "UAP_RUNTIME_INPUT_SCHEMA_INVALID");
    const properties = record(input.properties, "UAP_RUNTIME_INPUT_PROPERTIES_INVALID");
    const resource = record(properties.resourceId, "UAP_RUNTIME_RESOURCE_SCHEMA_INVALID");
    resourceIds.add(string(resource.const, "UAP_RUNTIME_RESOURCE_CONST_MISSING"));
  }
  if (resourceIds.size !== 1 || !resourceIds.has(EXPECTED.resourceId))
    throw coded("UAP_RUNTIME_RESOURCE_NOT_UNIQUE");
  return {
    providerCatalog: { ...providerCatalog, authority: "northbound_server_discover" },
    manifest: {
      authority: "northbound_server_discover_and_tools_list",
      providerId: providerCatalog.providerId,
      providerType: providerCatalog.providerType,
      providerVersion: providerCatalog.providerVersion,
      manifestHash: providerCatalog.manifestHash,
      operationCount: tools.length,
      operationsCanonicalSha256: sha256(canonical(tools)),
    },
    resource: {
      resourceId: EXPECTED.resourceId,
      resourceType: providerCatalog.providerType,
      uniqueResourceCount: resourceIds.size,
      authority: "northbound_catalog_resource_binding_and_provider_catalog",
    },
    operations: {
      vehicleGetState: summarizeOperation(getState),
      vehicleNavigate: summarizeOperation(navigate),
    },
  };
}

export function validateState(value, maximumAgeMs, nowMs) {
  const state = record(value, "UAP_VEHICLE_STATE_INVALID");
  const identity = record(state.identity, "UAP_VEHICLE_STATE_IDENTITY_INVALID");
  if (
    identity.providerId !== EXPECTED.providerId ||
    identity.resourceId !== EXPECTED.resourceId ||
    identity.vehicleType !== "ugv" ||
    identity.executionMode !== "simulation"
  )
    throw coded("UAP_VEHICLE_STATE_IDENTITY_MISMATCH");
  const connectivity = record(state.connectivity, "UAP_VEHICLE_CONNECTIVITY_INVALID");
  if (
    connectivity.mqttConnected !== true ||
    connectivity.deviceMcpConnected !== true ||
    connectivity.deviceAvailable !== true
  )
    throw coded("UAP_VEHICLE_EXTERNAL_CONNECTIVITY_NOT_READY");
  const freshness = record(state.freshness, "UAP_VEHICLE_FRESHNESS_INVALID");
  const chassisObservedAt = freshTimestamp(
    freshness.chassisObservedAt,
    maximumAgeMs,
    nowMs,
    "UAP_VEHICLE_CHASSIS_STATE_STALE",
  );
  const healthObservedAt = freshTimestamp(
    freshness.healthObservedAt,
    5_000,
    nowMs,
    "UAP_VEHICLE_HEALTH_STATE_STALE",
  );
  const missionObservedAt = freshTimestamp(
    freshness.missionObservedAt,
    maximumAgeMs,
    nowMs,
    "UAP_VEHICLE_MISSION_STATE_STALE",
  );
  const observedAt = freshTimestamp(
    state.observedAt,
    maximumAgeMs,
    nowMs,
    "UAP_VEHICLE_OBSERVATION_STALE",
  );
  const chassis = record(state.chassis, "UAP_VEHICLE_CHASSIS_INVALID");
  const position = record(chassis.position, "UAP_VEHICLE_POSITION_REQUIRED");
  const latitude = finiteRange(position.latitude, -90, 90, "UAP_VEHICLE_LATITUDE_INVALID");
  const longitude = finiteRange(position.longitude, -180, 180, "UAP_VEHICLE_LONGITUDE_INVALID");
  const altitude =
    position.altitude === undefined
      ? undefined
      : finiteRange(position.altitude, -20_000, 100_000, "UAP_VEHICLE_ALTITUDE_INVALID");
  const mission = record(chassis.mission, "UAP_VEHICLE_MISSION_STATE_REQUIRED");
  if (
    !QUIESCENT_MISSION_STATES.has(mission.state) ||
    mission.state === 1 ||
    mission.state === 2 ||
    (mission.state === 0 && typeof mission.id === "string" && mission.id.length > 0)
  )
    throw coded("UAP_VEHICLE_NOT_IDLE");
  const speedKmh = finiteRange(chassis.speedKmh, 0, 0.1, "UAP_VEHICLE_NOT_STATIONARY");
  if (typeof state.revision !== "string" || state.revision.length === 0)
    throw coded("UAP_VEHICLE_REVISION_REQUIRED");
  if (!Number.isSafeInteger(state.mqttIngressSequence) || state.mqttIngressSequence < 1)
    throw coded("UAP_VEHICLE_MQTT_INGRESS_UNCONFIRMED");
  return {
    identity,
    connectivity,
    freshness: { chassisObservedAt, healthObservedAt, missionObservedAt },
    position: {
      coordinateReferenceSystem: "WGS84",
      latitude,
      longitude,
      ...(altitude === undefined ? {} : { altitude }),
    },
    mission: {
      state: mission.state,
      idle: true,
      taskIdHash:
        typeof mission.id === "string" && mission.id.length > 0 ? sha256(mission.id) : null,
      taskIdMissingReason:
        typeof mission.id === "string" && mission.id.length > 0
          ? null
          : "NO_ACTIVE_DEVICE_MISSION_ID_FOR_QUIESCENT_STATE",
    },
    speedKmh,
    revision: state.revision,
    observedAt,
    mqttIngressSequence: state.mqttIngressSequence,
  };
}

export function pointAvailabilityArguments(position) {
  return {
    resourceId: EXPECTED.resourceId,
    mission: {
      type: "point",
      target: {
        latitude: position.latitude,
        longitude: position.longitude,
        ...(position.altitude === undefined ? {} : { altitude: position.altitude }),
      },
    },
    stopOnObstacle: true,
  };
}

export function diffAdapterAudit(
  beforeValue,
  afterValue,
  strict = true,
  expectedTaskId = undefined,
) {
  const before = auditRecord(beforeValue);
  const after = auditRecord(afterValue);
  const addedCalls = addedRows(before.deviceToolCalls, after.deviceToolCalls, "callId");
  const addedExecutions = addedRows(before.executions, after.executions, "taskId");
  const addedMutations = addedRows(before.mutationJournal, after.mutationJournal, "rowId");
  const addedAcks = addedRows(before.commandAcks, after.commandAcks, "rowId");
  const forbiddenNames = /navigate|fire|recon|track|gimbal|mission_control|path_follow/i;
  const forbiddenRows = [...addedCalls, ...addedExecutions, ...addedMutations, ...addedAcks].filter(
    (row) => forbiddenNames.test(canonical(row)),
  );
  const mutatingCalls = addedCalls.filter((row) => row.toolName !== "get_status");
  const navigationRows = [
    ...addedCalls,
    ...addedExecutions,
    ...addedMutations,
    ...addedAcks,
  ].filter((row) => /path_follow|mission_control|navigate/i.test(canonical(row)));
  const mutatingRowCount =
    mutatingCalls.length + addedExecutions.length + addedMutations.length + addedAcks.length;
  if (
    strict &&
    (addedCalls.length !== 1 ||
      addedCalls[0]?.toolName !== "get_status" ||
      addedCalls[0]?.outcome !== "accepted" ||
      addedCalls[0]?.taskId !== expectedTaskId ||
      addedExecutions.length !== 0 ||
      addedMutations.length !== 0 ||
      addedAcks.length !== 0 ||
      forbiddenRows.length !== 0)
  )
    throw coded("UAP_SOUTHBOUND_READ_ONLY_AUDIT_MISMATCH");
  return {
    comparison: "row_identity_set_difference",
    expectedTaskIdHash: expectedTaskId === undefined ? null : sha256(String(expectedTaskId)),
    correlationMatched:
      expectedTaskId !== undefined &&
      addedCalls.length === 1 &&
      addedCalls[0]?.taskId === expectedTaskId,
    addedDeviceToolCallCount: addedCalls.length,
    addedDeviceToolCalls: addedCalls.map((row) => ({
      callIdHash: sha256(String(row.callId)),
      taskIdCorrelationHash: sha256(String(row.taskId)),
      toolName: row.toolName,
      outcome: row.outcome,
      occurredAt: row.occurredAt,
    })),
    addedExecutionCount: addedExecutions.length,
    addedMutationJournalCount: addedMutations.length,
    addedCommandAckCount: addedAcks.length,
    navigationDispatchCount: navigationRows.length,
    mutatingToolCallCount: mutatingRowCount,
    forbiddenOperationCallCount: forbiddenRows.length,
    qualified: strict,
  };
}

export function initialSafetySummary() {
  return {
    readOnly: true,
    readinessProbeCount: 0,
    serverDiscoverCount: 0,
    toolsListCount: 0,
    availabilityCheckCount: 0,
    northboundToolsCallCount: 0,
    northboundNavigationAttemptCount: 0,
    directDeviceToolCallCount: 0,
    southboundAuditVerified: false,
    navigationDispatchCount: null,
    mutatingToolCallCount: null,
    forbiddenOperationCallCount: null,
    mqttPublishCount: 0,
  };
}

export function safetyWithVerifiedAudit(safety, audit) {
  return {
    ...safety,
    southboundAuditVerified: true,
    navigationDispatchCount: audit.navigationDispatchCount,
    mutatingToolCallCount: audit.mutatingToolCallCount,
    forbiddenOperationCallCount: audit.forbiddenOperationCallCount,
  };
}

function isExternalEnvironmentBlocker(reasonCode) {
  return new Set([
    "UAP_PROFILE_HEALTH_FAILED",
    "UAP_RUNTIME_NETWORK_REQUEST_FAILED",
    "UAP_RUNTIME_READINESS_FAILED",
    "UAP_ADAPTER_AUDIT_FAILED",
    "UAP_ADAPTER_AUDIT_FAILED_JSON_INVALID",
  ]).has(reasonCode);
}

function assertNoActiveAdapterExecutions(value) {
  const audit = auditRecord(value);
  const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
  if (audit.executions.some((row) => !terminal.has(String(row.state))))
    throw coded("UAP_ACTIVE_ADAPTER_EXECUTION_PRESENT");
}

function operationQualification(name, taskBehavior, toolsByName) {
  const tool = toolsByName.get(name);
  if (tool === undefined) throw coded("UAP_REQUIRED_OPERATION_MISSING");
  const metadata = record(tool._meta, "UAP_RUNTIME_TOOL_METADATA_INVALID");
  const profile = record(metadata["io.sdar/taskExecution"], "UAP_TASK_PROFILE_INVALID");
  if (profile.profileVersion !== "1.0" || profile.taskBehavior !== taskBehavior)
    throw coded("UAP_TASK_BEHAVIOR_MISMATCH");
  const toolInput = record(tool.inputSchema, "UAP_RUNTIME_INPUT_SCHEMA_INVALID");
  const toolOutput = record(tool.outputSchema, "UAP_RUNTIME_OUTPUT_SCHEMA_INVALID");
  array(toolOutput.anyOf, "UAP_RUNTIME_OUTPUT_WRAPPER_INVALID");
  return { tool, profile, toolInput, toolOutput };
}

function assertSynchronousStateContract(profile) {
  if (
    profile.supportsCancellation !== false ||
    profile.supportsPauseResume !== false ||
    profile.supportsScheduling !== false ||
    profile.supportsMaxElapsed !== false ||
    profile.supportsObservations !== false ||
    profile.supportsInputRequired !== false ||
    profile.idempotency !== "server_managed" ||
    profile.availability !== "dynamic"
  )
    throw coded("UAP_GET_STATE_NORTHBOUND_PROFILE_INVALID");
}

function assertNavigationContract(tool, profile) {
  if (
    profile.supportsCancellation !== true ||
    profile.supportsPauseResume !== true ||
    profile.supportsScheduling !== true ||
    profile.supportsMaxElapsed !== true ||
    profile.supportsObservations !== true ||
    profile.availability !== "dynamic"
  )
    throw coded("UAP_NAVIGATION_NORTHBOUND_PROFILE_INCOMPLETE");
  const input = record(tool.inputSchema, "UAP_NAVIGATION_SCHEMA_INVALID");
  const properties = record(input.properties, "UAP_NAVIGATION_SCHEMA_INVALID");
  const mission = record(properties.mission, "UAP_NAVIGATION_SCHEMA_INVALID");
  const variants = array(mission.oneOf, "UAP_NAVIGATION_SCHEMA_INVALID");
  const point = variants.find((value) => {
    if (!isRecord(value) || !isRecord(value.properties)) return false;
    return isRecord(value.properties.type) && value.properties.type.const === "point";
  });
  const pointRecord = record(point, "UAP_POINT_NAVIGATION_SCHEMA_MISSING");
  const pointProperties = record(pointRecord.properties, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  const target = record(pointProperties.target, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  const targetProperties = record(target.properties, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  const latitude = record(targetProperties.latitude, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  const longitude = record(targetProperties.longitude, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  const stopOnObstacle = record(properties.stopOnObstacle, "UAP_POINT_NAVIGATION_SCHEMA_INVALID");
  if (
    !array(input.required, "UAP_NAVIGATION_SCHEMA_INVALID").includes("resourceId") ||
    !array(input.required, "UAP_NAVIGATION_SCHEMA_INVALID").includes("mission") ||
    !array(pointRecord.required, "UAP_POINT_NAVIGATION_SCHEMA_INVALID").includes("target") ||
    !array(target.required, "UAP_POINT_NAVIGATION_SCHEMA_INVALID").includes("latitude") ||
    !array(target.required, "UAP_POINT_NAVIGATION_SCHEMA_INVALID").includes("longitude") ||
    latitude.minimum !== -90 ||
    latitude.maximum !== 90 ||
    longitude.minimum !== -180 ||
    longitude.maximum !== 180 ||
    stopOnObstacle.type !== "boolean"
  )
    throw coded("UAP_POINT_NAVIGATION_SCHEMA_INVALID");
}

function summarizeOperation(value) {
  return {
    execution:
      value.profile.taskBehavior === "synchronous_only"
        ? "SYNCHRONOUS"
        : value.profile.taskBehavior === "task_required"
          ? "TASK_REQUIRED"
          : "TASK_CAPABLE",
    taskBehavior: value.profile.taskBehavior,
    availability: value.profile.availability,
    lifecycle: {
      cancel: value.profile.supportsCancellation === true,
      pauseResume: value.profile.supportsPauseResume === true,
      observations: value.profile.supportsObservations === true,
      northboundObservations: value.profile.supportsObservations === true,
    },
    inputSchemaSha256: sha256(canonical(value.toolInput)),
    outputSchemaSha256: sha256(canonical(value.toolOutput)),
    fullSchemasObtainedFromNorthboundCatalog: true,
  };
}

function exactProviderCatalog(value) {
  const catalog = record(value, "UAP_PROVIDER_CATALOG_REQUIRED");
  const publicIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  const publicVersion = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
  if (
    Object.keys(catalog).sort().join(",") !==
      "manifestHash,providerId,providerType,providerVersion" ||
    typeof catalog.providerId !== "string" ||
    !publicIdentifier.test(catalog.providerId) ||
    typeof catalog.providerType !== "string" ||
    !publicIdentifier.test(catalog.providerType) ||
    typeof catalog.providerVersion !== "string" ||
    !publicVersion.test(catalog.providerVersion) ||
    typeof catalog.manifestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(catalog.manifestHash)
  )
    throw coded("UAP_PROVIDER_CATALOG_INVALID");
  return catalog;
}

export function validatePointAvailability(
  response,
  argumentsValue,
  expectedRequestId,
  requestedAt,
  respondedAt,
) {
  const result = rpcResult(response, "UAP_POINT_AVAILABILITY_FAILED");
  if (result.resultType !== "complete" || result.profileVersion !== "1.0")
    throw coded("UAP_POINT_AVAILABILITY_INVALID");
  const results = array(result.results, "UAP_POINT_AVAILABILITY_INVALID");
  if (results.length !== 1) throw coded("UAP_POINT_AVAILABILITY_INVALID");
  const check = record(results[0], "UAP_POINT_AVAILABILITY_INVALID");
  const validUntil = freshAvailabilityExpiry(check.validUntil, respondedAt);
  if (
    check.requestId !== expectedRequestId ||
    check.operationName !== "vehicle_navigate" ||
    check.availability !== "available" ||
    check.riskLevel !== "medium" ||
    check.reservationMode !== "none" ||
    check.reservationRef !== undefined
  )
    throw coded("UAP_POINT_NAVIGATION_NOT_READY");
  return {
    availability: check.availability,
    riskLevel: check.riskLevel,
    reasonCode: check.reasonCode ?? null,
    requestedAt,
    respondedAt,
    validUntil,
    argumentSha256: sha256(canonical(argumentsValue)),
    targetSource: "fresh_vehicle_get_state_position",
    stopOnObstacle: true,
    navigationDispatched: false,
  };
}

function freshAvailabilityExpiry(value, respondedAt) {
  if (typeof value !== "string") throw coded("UAP_POINT_AVAILABILITY_VALID_UNTIL_REQUIRED");
  const expiry = Date.parse(value);
  const response = Date.parse(respondedAt);
  if (!Number.isFinite(expiry) || expiry < response || expiry - response > 60_000)
    throw coded("UAP_POINT_AVAILABILITY_VALID_UNTIL_INVALID");
  return value;
}

function assertPreflightLineage(path, runId) {
  const report = readJson(path, "UAP_DEPLOYMENT_PREFLIGHT_EVIDENCE_REQUIRED");
  const safety = record(report.safety, "UAP_DEPLOYMENT_PREFLIGHT_SAFETY_INVALID");
  if (
    report.runId !== runId ||
    (report.status !== "PASS" && report.status !== "PASS_WITH_UPSTREAM_DRIFT") ||
    report.evidenceClass !== "external_simulation" ||
    report.productionEligible !== false ||
    report.physicalVehicleQualified !== false ||
    report.authorizationGranted !== false ||
    safety.mockFallbackEnabled !== false ||
    safety.toolsCallCount !== 0 ||
    safety.directDeviceToolCallCount !== 0 ||
    safety.mqttPublishCount !== 0 ||
    safety.controlInvocationCount !== 0 ||
    safety.navigationDispatchCount !== 0 ||
    safety.mutatingToolCallCount !== 0 ||
    safety.forbiddenOperationCallCount !== 0
  )
    throw coded("UAP_DEPLOYMENT_PREFLIGHT_LINEAGE_INVALID");
}

function runProfileHealth(options) {
  const result = spawnSync(
    "bash",
    [resolve(options.root, "deploy/ugv-agent-profile-simulation/health.sh")],
    {
      cwd: options.root,
      encoding: "utf8",
      maxBuffer: 1_048_576,
    },
  );
  if (result.status !== 0) throw coded("UAP_PROFILE_HEALTH_FAILED");
  return { profileHealth: "PASS", commandExitCode: 0 };
}

async function readReadiness(runtimeUrl, timeoutMs) {
  const response = await boundedFetch(
    new URL("/health/ready", runtimeUrl),
    { method: "GET" },
    timeoutMs,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || body.status !== "ready")
    throw coded("UAP_RUNTIME_READINESS_FAILED");
  return {
    httpStatus: response.status,
    status: body.status,
    dependenciesSha256: sha256(canonical(body.dependencies ?? {})),
  };
}

async function rpc(options, method, params, name, id) {
  const response = await boundedFetch(
    options.runtimeUrl,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": method,
        "x-sdar-subject": "uap-provider-qualification",
        "x-sdar-tenant": "ugv-external-simulation",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": options.runId,
        ...(name === undefined ? {} : { "mcp-name": name }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": {
              name: "uap-provider-readonly-qualification",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          },
        },
      }),
    },
    options.timeoutMs,
  );
  const body = await response.json().catch((error) => {
    throw coded("UAP_RUNTIME_NON_JSON_RESPONSE", error);
  });
  if (!isRecord(body)) throw coded("UAP_RUNTIME_RPC_RESPONSE_INVALID");
  return { status: response.status, body, expectedId: id };
}

async function boundedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw coded("UAP_RUNTIME_NETWORK_REQUEST_FAILED", error);
  } finally {
    clearTimeout(timer);
  }
}

function readAdapterAudit(options) {
  return dockerJson(
    options,
    "ugv-agent-profile-adapter-postgres",
    "ugv_profile_adapter",
    "ugv_profile_adapter",
    String.raw`SELECT json_build_object(
      'deviceToolCalls', coalesce((SELECT json_agg(json_build_object(
        'callId', call_id, 'taskId', task_id, 'toolName', tool_name, 'outcome', outcome,
        'occurredAt', occurred_at) ORDER BY occurred_at, call_id) FROM ugv_device_tool_call), '[]'::json),
      'executions', coalesce((SELECT json_agg(json_build_object(
        'taskId', task_id, 'operationName', operation_name, 'state', state) ORDER BY task_id) FROM ugv_execution), '[]'::json),
      'mutationJournal', coalesce((SELECT json_agg(json_build_object(
        'rowId', task_id || ':' || step_id, 'toolName', tool_name, 'state', state)
        ORDER BY task_id, step_id) FROM ugv_mutation_journal), '[]'::json),
      'commandAcks', coalesce((SELECT json_agg(json_build_object(
        'rowId', task_id || ':' || command || ':' || command_sequence::text,
        'command', command) ORDER BY task_id, command, command_sequence)
        FROM ugv_execution_command_ack), '[]'::json)
      )::text`,
    "UAP_ADAPTER_AUDIT_FAILED",
  );
}

function dockerJson(options, service, user, database, query, failureCode) {
  const compose = [
    "compose",
    "--project-name",
    "sdar-ugv-agent-profile-simulation",
    "-f",
    resolve(options.root, "compose.yaml"),
    "-f",
    resolve(options.root, "compose.ugv-agent-profile-simulation.yaml"),
    "--profile",
    "ugv-agent-profile-simulation",
    "exec",
    "-T",
    service,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    user,
    "-d",
    database,
    "-A",
    "-t",
    "-c",
    query,
  ];
  const result = spawnSync("docker", compose, {
    cwd: options.root,
    encoding: "utf8",
    maxBuffer: 16 * 1_048_576,
  });
  if (result.status !== 0) throw coded(failureCode);
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw coded(`${failureCode}_JSON_INVALID`, error);
  }
}

function completeStructuredContent(response, code) {
  const result = rpcResult(response, code);
  if (result.resultType !== "complete" || !isRecord(result.structuredContent)) throw coded(code);
  return result.structuredContent;
}

export function extractSynchronousTaskId(response) {
  const result = rpcResult(response, "UAP_VEHICLE_GET_STATE_FAILED");
  const metadata = record(result._meta, "UAP_SYNCHRONOUS_EVIDENCE_REQUIRED");
  const evidence = record(metadata["io.sdar/evidence"], "UAP_SYNCHRONOUS_EVIDENCE_REQUIRED");
  if (evidence.profileVersion !== "1.0") throw coded("UAP_SYNCHRONOUS_EVIDENCE_INVALID");
  const items = array(evidence.items, "UAP_SYNCHRONOUS_EVIDENCE_REQUIRED");
  const stateItems = items.filter(
    (value) => isRecord(value) && value.evidenceType === "vehicle.state.observation",
  );
  if (stateItems.length !== 1) throw coded("UAP_SYNCHRONOUS_EVIDENCE_INVALID");
  const subjectRef = stateItems[0]?.subjectRef;
  if (typeof subjectRef !== "string") throw coded("UAP_SYNCHRONOUS_EVIDENCE_INVALID");
  const match =
    /^execution:vehicle:ugv1:sync:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(
      subjectRef,
    );
  if (match?.[1] === undefined) throw coded("UAP_SYNCHRONOUS_EVIDENCE_INVALID");
  return match[1];
}

function rpcResult(response, code) {
  if (
    !isRecord(response) ||
    typeof response.status !== "number" ||
    response.status < 200 ||
    response.status >= 300 ||
    !isRecord(response.body) ||
    response.body.jsonrpc !== "2.0" ||
    response.body.id !== response.expectedId ||
    response.body.error !== undefined ||
    !isRecord(response.body.result)
  )
    throw coded(code);
  return response.body.result;
}

function auditRecord(value) {
  const audit = record(value, "UAP_ADAPTER_AUDIT_INVALID");
  return {
    deviceToolCalls: array(audit.deviceToolCalls, "UAP_ADAPTER_AUDIT_INVALID").map((x) =>
      record(x, "UAP_ADAPTER_AUDIT_INVALID"),
    ),
    executions: array(audit.executions, "UAP_ADAPTER_AUDIT_INVALID").map((x) =>
      record(x, "UAP_ADAPTER_AUDIT_INVALID"),
    ),
    mutationJournal: array(audit.mutationJournal, "UAP_ADAPTER_AUDIT_INVALID").map((x) =>
      record(x, "UAP_ADAPTER_AUDIT_INVALID"),
    ),
    commandAcks: array(audit.commandAcks, "UAP_ADAPTER_AUDIT_INVALID").map((x) =>
      record(x, "UAP_ADAPTER_AUDIT_INVALID"),
    ),
  };
}

function addedRows(before, after, key) {
  const old = new Map(before.map((row) => [String(row[key]), row]));
  const current = new Map(after.map((row) => [String(row[key]), row]));
  if (old.size !== before.length || current.size !== after.length)
    throw coded("UAP_ADAPTER_AUDIT_ROW_IDENTITY_INVALID");
  for (const [identity, oldRow] of old) {
    const currentRow = current.get(identity);
    if (currentRow === undefined || canonical(currentRow) !== canonical(oldRow))
      throw coded("UAP_ADAPTER_AUDIT_EXISTING_ROW_CHANGED");
  }
  return after.filter((row) => !old.has(String(row[key])));
}

function freshTimestamp(value, maximumAgeMs, nowMs, code) {
  if (typeof value !== "string") throw coded(code);
  const timestamp = Date.parse(value);
  const age = nowMs - timestamp;
  if (!Number.isFinite(timestamp) || age < -1_000 || age > maximumAgeMs) throw coded(code);
  return value;
}

function finiteRange(value, minimum, maximum, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw coded(code);
  return value;
}

function record(value, code) {
  if (!isRecord(value)) throw coded(code);
  return value;
}

function array(value, code) {
  if (!Array.isArray(value)) throw coded(code);
  return value;
}

function string(value, code) {
  if (typeof value !== "string" || value.length === 0) throw coded(code);
  return value;
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw coded(code, error);
  }
}

export function writeExclusiveEvidence(path, value, forbiddenValues = []) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (forbiddenValues.some((item) => item.length >= 4 && serialized.includes(item)))
    throw coded("UAP_EVIDENCE_REDACTION_CHECK_FAILED");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function buildOptions() {
  const argumentsValue = parseArguments(process.argv.slice(2));
  const root = repositoryRoot(import.meta.url);
  const runId = argumentsValue["run-id"] ?? process.env.UGV_SIMULATION_RUN_ID?.trim();
  if (runId === undefined || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(runId) || runId.includes(".."))
    throw coded("UAP_SIMULATION_RUN_ID_INVALID");
  const runtimeRaw =
    argumentsValue["runtime-url"] ??
    `http://127.0.0.1:${process.env.UGV_AGENT_PROFILE_RUNTIME_PORT ?? "19121"}/mcp`;
  const runtimeUrl = parseEndpoint(runtimeRaw, "UAP_RUNTIME_URL", ["http:"]);
  if (!["127.0.0.1", "localhost", "::1"].includes(runtimeUrl.hostname))
    throw coded("UAP_RUNTIME_URL_MUST_BE_LOOPBACK");
  const reportDirectory = resolve(root, "reports/ugv-agent-profile-simulation");
  const expectedOutputPath = resolve(
    reportDirectory,
    "attempts",
    `smpp-provider-qualification-${runId}.redacted.json`,
  );
  const outputPath = resolve(argumentsValue.output ?? expectedOutputPath);
  if (outputPath !== expectedOutputPath) throw coded("UAP_QUALIFICATION_OUTPUT_PATH_INVALID");
  return {
    root,
    runId,
    runtimeUrl,
    timeoutMs: boundedInteger(
      process.env.UAP_PROVIDER_QUALIFICATION_TIMEOUT_MS,
      "UAP_PROVIDER_QUALIFICATION_TIMEOUT_MS",
      10_000,
      500,
      60_000,
    ),
    maximumStateAgeMs: boundedInteger(
      process.env.UAP_PROVIDER_MAX_STATE_AGE_MS,
      "UAP_PROVIDER_MAX_STATE_AGE_MS",
      3_000,
      1_000,
      3_000,
    ),
    preflightPath: resolve(
      reportDirectory,
      "attempts",
      `deployment-preflight-${runId}.redacted.json`,
    ),
    outputPath,
    canonicalOutputPath: resolve(reportDirectory, "smpp-provider-qualification.redacted.json"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let report;
  try {
    report = await qualifyProviderReadOnly(buildOptions());
  } catch (error) {
    const failure = safeFailure(error, "UAP_PROVIDER_QUALIFICATION_BOOTSTRAP_FAILED");
    process.stderr.write(`${failure.reasonCode}\n`);
    process.exit(3);
  }
  process.stdout.write(`${report.status}: ${report.reasonCode}\n`);
  process.exitCode = report.exitCode;
}
