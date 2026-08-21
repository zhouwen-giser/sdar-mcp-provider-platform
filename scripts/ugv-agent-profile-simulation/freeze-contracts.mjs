#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  UGV_DEVICE_TOOL_ALLOWLIST,
  UgvOperationQualificationService,
  requiredUgvDeviceTools,
} from "../../packages/vehicle-device-mcp-client/src/index.ts";
import {
  UGV_MQTT_PROFILE,
  UGV_MQTT_SUBSCRIPTIONS,
  VEHICLE_OBSERVATION_FIELDS,
  normalizeMqttObservation,
} from "../../packages/vehicle-mqtt-ingress/src/index.ts";
import { loadUgvProviderConfiguration } from "../../packages/runtime-configuration-contract/src/providers/ugv.ts";
import { canonical, isRecord, repositoryRoot, sha256 } from "../ugv-simulation/lib.mjs";

const ROOT = repositoryRoot(import.meta.url);
const DEFAULT_INPUT = join(
  ROOT,
  "reports/ugv-agent-profile-simulation/external-preflight.redacted.json",
);
const DEFAULT_OUTPUT_DIRECTORY = join(ROOT, "reports/ugv-agent-profile-simulation");
const DEVICE_REPORT_NAME = "device-mcp-contract.redacted.json";
const MQTT_REPORT_NAME = "mqtt-contract.redacted.json";
const REQUIRED_TOOL_NAMES = ["get_status", "ugv_path_follow_mission", "ugv_mission_control"];
const ZERO_SIDE_EFFECTS = {
  toolsCallCount: 0,
  mqttPublishCount: 0,
  controlInvocationCount: 0,
};

export class ExternalContractFreezeError extends Error {
  constructor(reasonCode, options = undefined) {
    super(reasonCode, options);
    this.name = "ExternalContractFreezeError";
    this.reasonCode = reasonCode;
  }
}

export function buildExternalContractReports(preflight) {
  assertPreflightEnvelope(preflight);
  const deviceContract = buildDeviceContract(preflight);
  const mqttContract = buildMqttContract(preflight);
  return {
    device: envelope(
      "ugv-agent-profile.device-mcp-contract/v1",
      preflight.generatedAt,
      deviceContract,
    ),
    mqtt: envelope("ugv-agent-profile.mqtt-contract/v1", preflight.generatedAt, mqttContract),
  };
}

export async function freezeExternalContracts({
  inputPath = DEFAULT_INPUT,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  mode,
} = {}) {
  if (mode !== "write" && mode !== "check") fail("UGV_EXTERNAL_CONTRACT_MODE_REQUIRED");
  const preflight = parseJsonFile(inputPath, "UGV_EXTERNAL_PREFLIGHT");
  const reports = buildExternalContractReports(preflight);
  const paths = {
    device: join(outputDirectory, DEVICE_REPORT_NAME),
    mqtt: join(outputDirectory, MQTT_REPORT_NAME),
  };
  for (const kind of ["device", "mqtt"]) {
    const outputPath = paths[kind];
    const serialized = await serialize(reports[kind]);
    if (existsSync(outputPath)) {
      if (readFileSync(outputPath, "utf8") !== serialized)
        fail(`UGV_EXTERNAL_${kind.toUpperCase()}_CONTRACT_ARTIFACT_DRIFT`);
      continue;
    }
    if (mode === "check") fail(`UGV_EXTERNAL_${kind.toUpperCase()}_CONTRACT_ARTIFACT_MISSING`);
    writeSerializedEvidence(outputPath, serialized);
  }
  return { paths, reports };
}

function buildDeviceContract(preflight) {
  const device = record(preflight.deviceMcp, "UGV_DEVICE_MCP_EVIDENCE_MISSING");
  if (device.status !== "PASS" || device.connected !== true)
    fail("UGV_DEVICE_MCP_PREFLIGHT_NOT_QUALIFIED");
  if (device.mockFallbackEnabled !== false) fail("UGV_DEVICE_MCP_MOCK_CONTRACT_NOT_DISABLED");
  if (device.toolsCallCount !== 0) fail("UGV_DEVICE_MCP_TOOLS_CALL_COUNT_NOT_ZERO");
  if (
    typeof device.protocolVersion !== "string" ||
    device.protocolVersion.length === 0 ||
    device.protocolVersion === "unknown"
  )
    fail("UGV_DEVICE_MCP_PROTOCOL_VERSION_MISSING");

  const discoveredTools = array(device.tools, "UGV_DEVICE_MCP_TOOLS_MISSING");
  if (discoveredTools.length !== device.toolCount) fail("UGV_DEVICE_MCP_TOOL_COUNT_DRIFT");
  const discoveredNames = discoveredTools.map((tool) =>
    string(record(tool, "UGV_DEVICE_MCP_TOOL_INVALID").name, "UGV_DEVICE_MCP_TOOL_NAME_INVALID"),
  );
  if (new Set(discoveredNames).size !== discoveredNames.length)
    fail("UGV_DEVICE_MCP_DUPLICATE_TOOL_NAME");
  if (sha256(canonical(discoveredTools)) !== device.contractHash)
    fail("UGV_DEVICE_MCP_DISCOVERY_HASH_DRIFT");

  const allowlist = [...UGV_DEVICE_TOOL_ALLOWLIST];
  const allowlistSet = new Set(allowlist);
  const intersection = discoveredNames.filter((name) => allowlistSet.has(name)).sort();
  const unknownObservedToolNames = discoveredNames.filter((name) => !allowlistSet.has(name)).sort();
  if (unknownObservedToolNames.length > 0) fail("UGV_DEVICE_MCP_OBSERVED_TOOL_OUTSIDE_ALLOWLIST");
  for (const name of REQUIRED_TOOL_NAMES) {
    if (!allowlistSet.has(name)) fail("UGV_DEVICE_MCP_REQUIRED_TOOL_NOT_ALLOWLISTED");
    if (!discoveredNames.includes(name)) fail("UGV_DEVICE_MCP_REQUIRED_TOOL_MISSING");
  }

  const contracts = discoveredTools.map((value) => {
    const tool = record(value, "UGV_DEVICE_MCP_TOOL_INVALID");
    const inputSchema = record(tool.inputSchema, "UGV_DEVICE_MCP_INPUT_SCHEMA_MISSING");
    const outputSchema = tool.outputSchema;
    if (outputSchema !== undefined && !isRecord(outputSchema))
      fail("UGV_DEVICE_MCP_OUTPUT_SCHEMA_INVALID");
    return {
      name: string(tool.name, "UGV_DEVICE_MCP_TOOL_NAME_INVALID"),
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      capturedAt: preflight.generatedAt,
      schemaHash: sha256(canonical({ inputSchema, outputSchema: outputSchema ?? null })),
    };
  });
  const qualificationService = new UgvOperationQualificationService();
  const recomputedQualifications = [
    qualificationService.qualify({
      operationName: "vehicle_get_state",
      arguments: {},
      phase: "read",
      contracts,
      externallyVerified: true,
      executionMode: "simulation",
    }),
    qualificationService.qualify({
      operationName: "vehicle_navigate",
      arguments: { mission: { type: "point" } },
      phase: "start",
      contracts,
      externallyVerified: true,
      executionMode: "simulation",
    }),
  ];
  const capturedQualifications = array(
    device.operationQualifications,
    "UGV_DEVICE_MCP_OPERATION_QUALIFICATIONS_MISSING",
  );
  const goalQualifications = [
    uniqueQualification(capturedQualifications, "vehicle_get_state", "read"),
    uniqueQualification(capturedQualifications, "vehicle_navigate", "start", "point"),
  ];
  if (canonical(goalQualifications) !== canonical(recomputedQualifications))
    fail("UGV_DEVICE_MCP_OPERATION_QUALIFICATION_DRIFT");
  if (goalQualifications.some((qualification) => qualification.qualified !== true))
    fail("UGV_DEVICE_MCP_REQUIRED_OPERATION_NOT_QUALIFIED");

  const requiredByPublicProfile = {
    vehicleGetState: requiredUgvDeviceTools("vehicle_get_state", {}, "read"),
    vehicleNavigatePoint: requiredUgvDeviceTools(
      "vehicle_navigate",
      { mission: { type: "point" } },
      "start",
    ),
  };
  assertCanonicalEqual(
    requiredByPublicProfile.vehicleGetState,
    ["get_status"],
    "UGV_DEVICE_MCP_GET_STATE_PROFILE_DRIFT",
  );
  assertCanonicalEqual(
    requiredByPublicProfile.vehicleNavigatePoint,
    ["ugv_path_follow_mission", "ugv_mission_control"],
    "UGV_DEVICE_MCP_POINT_NAVIGATION_PROFILE_DRIFT",
  );

  const toolsByName = new Map(
    discoveredTools.map((value) => {
      const tool = record(value, "UGV_DEVICE_MCP_TOOL_INVALID");
      return [string(tool.name, "UGV_DEVICE_MCP_TOOL_NAME_INVALID"), tool];
    }),
  );
  const frozenTools = REQUIRED_TOOL_NAMES.map((name) =>
    freezeTool(name, toolsByName.get(name), goalQualifications),
  );

  const resolved = resolveSimulationConfiguration("ros_bridge_json");
  const serverInfo =
    device.serverInfo === null
      ? null
      : record(device.serverInfo, "UGV_DEVICE_MCP_SERVER_INFO_INVALID");
  return {
    hashContract: hashContractDescription(),
    sourceEvidence: {
      path: "reports/ugv-agent-profile-simulation/external-preflight.redacted.json",
      status: preflight.status,
      capturedAt: preflight.generatedAt,
      discoveredToolCount: discoveredTools.length,
      discoveredToolsCanonicalHash: device.contractHash,
    },
    deviceProtocol: {
      transport: "mcp_streamable_http",
      negotiatedProtocolVersion: device.protocolVersion,
      serverInfo,
    },
    scope: {
      goal: "UGV Agent Profile external simulation",
      executionMode: "simulation",
      requiredToolNames: [...REQUIRED_TOOL_NAMES],
      nonGoalToolSchemasFrozen: false,
      authorizationGrantedByThisArtifact: false,
    },
    allowlistVerification: {
      adapterAllowlistCount: allowlist.length,
      adapterAllowlistCanonicalHash: sha256(canonical(allowlist)),
      observedIntersectionCount: intersection.length,
      observedIntersectionCanonicalHash: sha256(canonical(intersection)),
      unknownObservedToolNames,
      allGoalToolsAllowlisted: true,
      allGoalToolsObserved: true,
    },
    operations: goalQualifications,
    tools: frozenTools,
    mockContractDecision: {
      configurationKey: "UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT",
      resolvedValue: resolved.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
      goalPolicy: "forbidden",
      reasonCode: "UGV_EXTERNAL_SIMULATION_REAL_TOOLS_LIST_REQUIRED",
    },
    profileContract: {
      skill: { id: "embodied.move_to", version: 1, reference: "embodied.move_to@1" },
      taskType: "embodied.move",
      resource: { resourceId: "vehicle:ugv1", resourceType: "vehicle" },
      provider: {
        providerId: resolved.PROVIDER_ID,
        providerVersion: resolved.PROVIDER_VERSION,
      },
      northboundOperation: {
        operationName: "vehicle_navigate",
        missionType: "point",
        executionMode: "simulation",
        taskSemantics: "remote_task",
        stopOnObstacle: true,
      },
      coordinateMapping: {
        acceptedFrames: ["EPSG:4326", "WGS84"],
        x: { mapsTo: "longitude", minimum: -180, maximum: 180 },
        y: { mapsTo: "latitude", minimum: -90, maximum: 90 },
        axisSwapAllowed: false,
        undeclaredTransformationAllowed: false,
      },
      southboundSequence: [
        { toolName: "ugv_path_follow_mission", purpose: "allocate_point_mission" },
        { toolName: "ugv_mission_control", action: "start", purpose: "start_mission" },
      ],
      finalPositionEvidence: {
        field: "chassis.position.geodetic",
        resourceId: "vehicle:ugv1",
        coordinateFrame: "WGS84",
        postDispatchRequired: true,
        freshRequired: true,
        revisionRequired: true,
        cursorRequired: true,
        correlationMustMatch: true,
        providerCompletedNecessaryButNotSufficient: true,
      },
    },
    safety: {
      ...ZERO_SIDE_EFFECTS,
      toolsListReadOnlyCount: device.toolsListCount,
      authorizationGranted: false,
    },
  };
}

function buildMqttContract(preflight) {
  const mqtt = record(preflight.mqtt, "UGV_MQTT_EVIDENCE_MISSING");
  if (mqtt.status !== "PASS" || mqtt.connected !== true) fail("UGV_MQTT_PREFLIGHT_NOT_QUALIFIED");
  if (mqtt.passiveSubscribeOnly !== true || mqtt.publishAttempted !== false)
    fail("UGV_MQTT_PREFLIGHT_NOT_PASSIVE_ONLY");
  if (mqtt.wildcardSubscriptionCount !== 0) fail("UGV_MQTT_WILDCARD_SUBSCRIPTION_PRESENT");
  if (mqtt.explicitWireMode !== "ros_bridge_json") fail("UGV_MQTT_WIRE_MODE_DRIFT");

  const subscriptions = UGV_MQTT_SUBSCRIPTIONS.map(({ topic, qos }) => ({ topic, qos }));
  if (subscriptions.length !== 18) fail("UGV_MQTT_EXACT_TOPIC_COUNT_DRIFT");
  if (
    new Set(subscriptions.map(({ topic }) => topic)).size !== subscriptions.length ||
    subscriptions.some(({ topic }) => topic.includes("#") || topic.includes("+"))
  )
    fail("UGV_MQTT_PUBLIC_SUBSCRIPTION_PROFILE_INVALID");
  const subscriptionsCanonicalHash = sha256(canonical(subscriptions));
  if (mqtt.lockedProfileHash !== subscriptionsCanonicalHash)
    fail("UGV_MQTT_LOCKED_PROFILE_HASH_DRIFT");
  assertSubscriptionGrants(mqtt.subscriptionGrants, subscriptions);

  const authority = record(
    UGV_MQTT_PROFILE.compositeStatusAuthority,
    "UGV_MQTT_COMPOSITE_STATUS_AUTHORITY_MISSING",
  );
  assertCanonicalEqual(
    {
      canonicalTopic: authority.canonicalTopic,
      aliasTopics: authority.aliasTopics,
      aliasFallbackAfterMs: authority.aliasFallbackAfterMs,
    },
    {
      canonicalTopic: "status/ugv",
      aliasTopics: ["/ugv/status"],
      aliasFallbackAfterMs: 3_000,
    },
    "UGV_MQTT_COMPOSITE_STATUS_AUTHORITY_DRIFT",
  );
  assertTimestampSemantics();
  if (!VEHICLE_OBSERVATION_FIELDS.includes("chassis.position.geodetic"))
    fail("UGV_MQTT_FINAL_POSITION_FIELD_MISSING");

  const resolved = resolveSimulationConfiguration(mqtt.explicitWireMode);
  const publisherQosDrift = array(mqtt.publisherQosDrift, "UGV_MQTT_QOS_DRIFT_INVALID");
  for (const value of publisherQosDrift) {
    const drift = record(value, "UGV_MQTT_QOS_DRIFT_INVALID");
    if (!subscriptions.some(({ topic }) => topic === drift.topic))
      fail("UGV_MQTT_QOS_DRIFT_TOPIC_NOT_LOCKED");
  }
  return {
    hashContract: hashContractDescription(),
    sourceEvidence: {
      path: "reports/ugv-agent-profile-simulation/external-preflight.redacted.json",
      status: preflight.status,
      capturedAt: preflight.generatedAt,
      lockedProfile: mqtt.lockedProfile,
      lockedProfileCanonicalHash: mqtt.lockedProfileHash,
    },
    scope: {
      goal: "UGV Agent Profile external simulation",
      executionMode: "simulation",
      exactTopicCount: subscriptions.length,
      wildcardSubscriptionsAllowed: false,
      publishAllowedByThisArtifact: false,
    },
    wire: {
      mode: resolved.UGV_MQTT_WIRE_MODE,
      modeSource: "external_read_only_preflight",
      automaticDetectionAllowed: false,
    },
    subscriptions,
    subscriptionsCanonicalHash,
    authority: {
      compositeStatus: {
        canonicalTopic: authority.canonicalTopic,
        compatibilityAliasTopics: authority.aliasTopics,
        aliasFallbackAfterMs: authority.aliasFallbackAfterMs,
      },
      missionState: {
        primaryTopic: UGV_MQTT_PROFILE.taskStateAuthority?.missionStateTopic,
        secondaryTopics: UGV_MQTT_PROFILE.taskStateAuthority?.compositeStatusTopics,
      },
      finalPosition: {
        field: "chassis.position.geodetic",
        topic: "/ugv/gnss",
        coordinateFrame: "WGS84",
      },
    },
    fieldTimeSemantics: {
      observedAtPrecedence: [
        "valid_header.stamp",
        "valid_top_level_stamp_for_/ugv/status",
        "mqtt_receivedAt",
      ],
      rosStampFields: { seconds: ["sec", "secs"], nanoseconds: ["nanosec", "nsecs"] },
      zeroEpochAcceptedAsSourceTime: false,
      missingSourceTimestampAuthority: "ingest",
      presentSourceTimestampAuthority: "source",
      olderSameAuthorityObservation: "ignored",
      finalPositionMustBePostDispatch: true,
    },
    thresholds: {
      freshnessMs: {
        chassis: resolved.UGV_CHASSIS_FRESHNESS_MS,
        mission: resolved.UGV_MISSION_FRESHNESS_MS,
        health: resolved.UGV_HEALTH_FRESHNESS_MS,
        target: resolved.UGV_TARGET_FRESHNESS_MS,
        payload: resolved.UGV_PAYLOAD_FRESHNESS_MS,
      },
      maximumFutureSkewMs: resolved.UGV_OBSERVATION_MAX_FUTURE_SKEW_MS,
      stationary: {
        speedThresholdKmh: resolved.UGV_STATIONARY_SPEED_THRESHOLD_KMH,
        stabilityMs: resolved.UGV_STATIONARY_STABILITY_MS,
        minimumSamples: resolved.UGV_STATIONARY_MIN_SAMPLES,
      },
    },
    mockContractDecision: {
      configurationKey: "UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT",
      resolvedValue: resolved.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
      goalPolicy: "forbidden",
    },
    observedUpstreamDrift: {
      canonicalStatusTopicObserved: mqtt.requiredStatusTopicObserved,
      compatibilityStatusAliasObserved: mqtt.legacyStatusTopicObserved,
      publisherQos: publisherQosDrift,
      acceptedAsProtocolConformance: false,
    },
    safety: {
      ...ZERO_SIDE_EFFECTS,
      passiveSubscribeOnly: true,
      authorizationGranted: false,
    },
  };
}

function freezeTool(name, value, qualifications) {
  const tool = record(value, "UGV_DEVICE_MCP_REQUIRED_TOOL_MISSING");
  const inputSchema = record(tool.inputSchema, "UGV_DEVICE_MCP_INPUT_SCHEMA_MISSING");
  const outputSchema = tool.outputSchema ?? null;
  const inputSchemaCanonicalHash = sha256(canonical(inputSchema));
  const outputSchemaCanonicalHash = outputSchema === null ? null : sha256(canonical(outputSchema));
  if (tool.inputSchemaHash !== inputSchemaCanonicalHash)
    fail("UGV_DEVICE_MCP_INPUT_SCHEMA_HASH_DRIFT");
  if (tool.outputSchemaHash !== outputSchemaCanonicalHash)
    fail("UGV_DEVICE_MCP_OUTPUT_SCHEMA_HASH_DRIFT");
  const schemaCanonicalHash = sha256(canonical({ inputSchema, outputSchema }));
  const qualificationTool = qualifications
    .flatMap((qualification) => qualification.tools)
    .find((candidate) => candidate.toolName === name);
  if (
    !isRecord(qualificationTool) ||
    qualificationTool.contract?.schemaHash !== schemaCanonicalHash
  )
    fail("UGV_DEVICE_MCP_QUALIFIED_SCHEMA_HASH_DRIFT");
  return {
    name,
    inputSchema,
    outputSchema,
    inputSchemaCanonicalHash,
    outputSchemaCanonicalHash,
    schemaCanonicalHash,
    toolCanonicalHash: sha256(canonical({ name, inputSchema, outputSchema })),
  };
}

function resolveSimulationConfiguration(wireMode) {
  const resolved = loadUgvProviderConfiguration({
    UGV_EXECUTION_MODE: "simulation",
    UGV_MQTT_WIRE_MODE: wireMode,
    UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
    UGV_ADAPTER_STORE_MODE: "postgres",
  });
  if (
    resolved.UGV_EXECUTION_MODE !== "simulation" ||
    resolved.UGV_MQTT_WIRE_MODE !== "ros_bridge_json" ||
    resolved.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT !== false
  )
    fail("UGV_EXTERNAL_SIMULATION_CONFIGURATION_DRIFT");
  return resolved;
}

function assertTimestampSemantics() {
  const stamp = { sec: 1_700_000_000, nanosec: 123_000_000 };
  const expected = "2023-11-14T22:13:20.123Z";
  const source = normalizeMqttObservation("/ugv/gnss", {
    latitude: 28,
    longitude: 112,
    header: { stamp },
  });
  if (source.timeAuthority !== "source" || source.sourceObservedAt !== expected)
    fail("UGV_MQTT_SOURCE_TIMESTAMP_SEMANTICS_DRIFT");
  const ingest = normalizeMqttObservation("/ugv/gnss", {
    latitude: 28,
    longitude: 112,
  });
  if (ingest.timeAuthority !== "ingest" || ingest.sourceObservedAt !== undefined)
    fail("UGV_MQTT_INGEST_TIMESTAMP_SEMANTICS_DRIFT");
  const topLevel = normalizeMqttObservation("/ugv/status", { available: false, stamp });
  if (topLevel.timeAuthority !== "source" || topLevel.sourceObservedAt !== expected)
    fail("UGV_MQTT_STATUS_TIMESTAMP_SEMANTICS_DRIFT");
}

function assertSubscriptionGrants(value, expected) {
  const grants = array(value, "UGV_MQTT_SUBSCRIPTION_GRANTS_MISSING").map((candidate) => {
    const grant = record(candidate, "UGV_MQTT_SUBSCRIPTION_GRANT_INVALID");
    return { topic: grant.topic, qos: grant.qos };
  });
  const sorted = (items) =>
    [...items].sort((left, right) => String(left.topic).localeCompare(String(right.topic)));
  if (canonical(sorted(grants)) !== canonical(sorted(expected)))
    fail("UGV_MQTT_SUBSCRIPTION_GRANT_DRIFT");
}

function uniqueQualification(qualifications, operationName, phase, variant = undefined) {
  const matches = qualifications.filter((value) => {
    if (!isRecord(value)) return false;
    return (
      value.operationName === operationName &&
      value.phase === phase &&
      (variant === undefined ? value.variant === undefined : value.variant === variant)
    );
  });
  if (matches.length !== 1) fail("UGV_DEVICE_MCP_GOAL_QUALIFICATION_MISSING_OR_DUPLICATE");
  return matches[0];
}

function assertPreflightEnvelope(value) {
  const preflight = record(value, "UGV_EXTERNAL_PREFLIGHT_INVALID");
  if (preflight.schemaVersion !== 1) fail("UGV_EXTERNAL_PREFLIGHT_SCHEMA_VERSION_DRIFT");
  if (!validIsoTimestamp(preflight.generatedAt))
    fail("UGV_EXTERNAL_PREFLIGHT_GENERATED_AT_INVALID");
  if (preflight.evidenceClass !== "external_simulation")
    fail("UGV_EXTERNAL_PREFLIGHT_EVIDENCE_CLASS_INVALID");
  if (preflight.productionEligible !== false || preflight.physicalVehicleQualified !== false)
    fail("UGV_EXTERNAL_PREFLIGHT_ELIGIBILITY_INVALID");
  if (preflight.status !== "PASS" && preflight.status !== "PASS_WITH_UPSTREAM_DRIFT")
    fail("UGV_EXTERNAL_PREFLIGHT_STATUS_NOT_QUALIFIED");
  const safety = record(preflight.safety, "UGV_EXTERNAL_PREFLIGHT_SAFETY_MISSING");
  if (
    safety.controlAttempted !== false ||
    safety.mqttPublishAttempted !== false ||
    safety.toolsCallCount !== 0 ||
    safety.mqttPublishCount !== 0 ||
    safety.controlInvocationCount !== 0
  )
    fail("UGV_EXTERNAL_PREFLIGHT_SIDE_EFFECT_DETECTED");
  const configuration = record(
    preflight.configuration,
    "UGV_EXTERNAL_PREFLIGHT_CONFIGURATION_MISSING",
  );
  if (configuration.mqttWireMode !== "ros_bridge_json") fail("UGV_MQTT_WIRE_MODE_DRIFT");
}

function envelope(schemaVersion, generatedAt, contract) {
  return {
    schemaVersion,
    generatedAt,
    status: "FROZEN",
    evidenceClass: "external_simulation",
    productionEligible: false,
    physicalVehicleQualified: false,
    contractCanonicalHash: sha256(canonical(contract)),
    contract,
  };
}

function hashContractDescription() {
  return {
    algorithm: "sha256",
    canonicalization: "recursive_object_key_sort_json_scalars_v1",
    nullOutputSchemaIsSignificant: true,
  };
}

function parseJsonFile(path, prefix) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new ExternalContractFreezeError(`${prefix}_READ_FAILED`, { cause: error });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ExternalContractFreezeError(`${prefix}_JSON_INVALID`, { cause: error });
  }
}

function parseCli(argv) {
  const options = {};
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write" || argument === "--check") {
      if (mode !== undefined) fail("UGV_EXTERNAL_CONTRACT_MODE_DUPLICATE");
      mode = argument.slice(2);
      continue;
    }
    if (argument !== "--input" && argument !== "--output-dir")
      fail("UGV_EXTERNAL_CONTRACT_CLI_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      fail("UGV_EXTERNAL_CONTRACT_CLI_ARGUMENT_VALUE_REQUIRED");
    options[argument === "--input" ? "inputPath" : "outputDirectory"] = resolve(value);
    index += 1;
  }
  return { ...options, mode };
}

async function serialize(value) {
  return format(JSON.stringify(value, null, 2), {
    parser: "json",
    printWidth: 100,
    proseWrap: "preserve",
    endOfLine: "lf",
  });
}

function writeSerializedEvidence(path, serialized) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function record(value, code) {
  if (!isRecord(value)) fail(code);
  return value;
}

function array(value, code) {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function string(value, code) {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function validIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function assertCanonicalEqual(actual, expected, code) {
  if (canonical(actual) !== canonical(expected)) fail(code);
}

function fail(reasonCode) {
  throw new ExternalContractFreezeError(reasonCode);
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isMainModule()) {
  try {
    const cli = parseCli(process.argv.slice(2));
    const result = await freezeExternalContracts(cli);
    const paths = Object.values(result.paths).map((path) => relative(ROOT, path));
    process.stdout.write(`UGV_EXTERNAL_CONTRACTS_${cli.mode.toUpperCase()} ${paths.join(" ")}\n`);
  } catch (error) {
    const reasonCode =
      error instanceof ExternalContractFreezeError
        ? error.reasonCode
        : "UGV_EXTERNAL_CONTRACT_FREEZE_UNEXPECTED_FAILURE";
    process.stderr.write(`${reasonCode}\n`);
    process.exitCode = 2;
  }
}
