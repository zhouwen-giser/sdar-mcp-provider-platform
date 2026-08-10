/* global process */

import { randomUUID } from "node:crypto";
import {
  canonical,
  coded,
  isRecord,
  loadEnvironment,
  loadHeaderFile,
  optional,
  parseArguments,
  parseEndpoint,
  readBoundedFile,
  redactEndpoint,
  required,
  safeFailure,
  sha256,
  validateExactMqttSubscriptionGrants,
  writeEvidence,
} from "../ugv-simulation/lib.mjs";

const TOPICS = [
  "status/npc_tank1",
  "/npc_tank1/status",
  "/npc_tank1/gnss",
  "/npc_tank1/imu",
  "/npc_tank1/speed",
  "/npc_tank1/battery_range_km",
  "/npc_tank1/mission_state",
  "/npc_tank1/nav_state",
  "/npc_tank1/system_state",
  "/npc_tank1/component_status",
  "/npc_tank1/eo/pose",
  "/npc_tank1/detected_objects",
  "/npc_tank1/target_detected",
  "/npc_tank1/target/gnss",
  "/npc_tank1/area_recon/status",
  "/npc_tank1/area_recon/targets",
  "/npc_tank1/area_recon/exception",
  "/npc_tank1/area_recon/coverage",
];

const AUTHORITATIVE_TOOLS = [
  "npc_tank_path_follow_mission",
  "npc_tank_return_home",
  "npc_tank_move_distance",
  "npc_tank_mission_control",
  "npc_tank_motion_stop",
  "get_status",
  "npc_tank_get_capabilities",
  "npc_tank_area_recon_configure",
  "npc_tank_area_recon_control",
  "npc_tank_area_recon_lock",
  "npc_tank_area_recon_get_status",
  "npc_tank_area_recon_get_targets",
  "npc_tank_area_recon_reset",
  "npc_tank_area_recon_attack_confirm",
  "npc_tank_gimbal_move",
];

const argumentsValue = parseArguments(process.argv.slice(2));
const environment = loadEnvironment(argumentsValue["env-file"]);
const outputs = {
  mcp: argumentsValue["mcp-output"] ?? "reports/npc-tank-simulation/MCP_CONTRACT_CAPTURE.json",
  topics: argumentsValue["topic-output"] ?? "reports/npc-tank-simulation/MQTT_TOPIC_MATRIX.json",
  payloads:
    argumentsValue["payload-output"] ?? "reports/npc-tank-simulation/MQTT_PAYLOAD_EVIDENCE.json",
  rawIndex:
    argumentsValue["raw-index-output"] ?? "reports/npc-tank-simulation/MQTT_RAW_SAMPLE_INDEX.json",
};
const forbidden = [];
const startedAt = new Date().toISOString();

try {
  const config = loadConfiguration(environment, forbidden);
  const mcp = await captureMcp(config);
  writeEvidence(
    outputs.mcp,
    {
      schemaVersion: 1,
      evidenceClass: "real_npc_tank_device_mcp_contract",
      phase: "G11_REAL_MCP_CAPTURE",
      status:
        mcp.missingAuthoritativeTools.length === 0 && mcp.unknownTools.length === 0
          ? "PASS"
          : "PASS_WITH_CONTRACT_DRIFT",
      startedAt,
      completedAt: new Date().toISOString(),
      endpoint: redactEndpoint(config.deviceMcpUrl),
      safety: {
        toolsListOnly: true,
        toolCallAttempted: false,
        mockFallbackEnabled: false,
        realControlAttempted: false,
      },
      ...mcp,
    },
    forbidden,
  );

  const mqtt = await captureMqtt(config);
  writeEvidence(
    outputs.topics,
    {
      schemaVersion: 1,
      evidenceClass: "real_npc_tank_mqtt_topic_matrix",
      phase: "G11_REAL_MQTT_CAPTURE",
      status: mqtt.compositeStatusObserved
        ? mqtt.publisherQosDrift.length === 0 && inferWireMode(mqtt.samples) !== "ros_bridge_json"
          ? "PASS"
          : "PASS_WITH_UPSTREAM_DRIFT"
        : "PARTIAL",
      startedAt: mqtt.startedAt,
      completedAt: mqtt.completedAt,
      endpoint: redactEndpoint(config.mqttUrl),
      passiveSubscribeOnly: true,
      publishAttempted: false,
      requestedTopicCount: TOPICS.length,
      observedTopicCount: mqtt.samples.length,
      canonicalStatusObserved: mqtt.canonicalStatusObserved,
      compatibilityStatusObserved: mqtt.compatibilityStatusObserved,
      compositeStatusObserved: mqtt.compositeStatusObserved,
      subscriptionGrants: mqtt.subscriptionGrants,
      topics: TOPICS.map((topic) => {
        const sample = mqtt.samples.find((candidate) => candidate.topic === topic);
        return {
          topic,
          expectedQos: qos(topic),
          observed: sample !== undefined,
          ...(sample === undefined
            ? {}
            : {
                observedQos: sample.qos,
                publisherQosMatchesExpected: sample.qos === qos(topic),
                retained: sample.retained,
                sampleCount: sample.sampleCount,
              }),
        };
      }),
      publisherQosDrift: mqtt.publisherQosDrift,
      requiredCompatibilityWireMode: inferWireMode(mqtt.samples),
      simulatorInterfaceDefect:
        inferWireMode(mqtt.samples) === "ros_bridge_json"
          ? "SIMULATOR_INTERFACE_DEFECT_MIXED_MQTT_WIRE_SHAPES"
          : null,
      rawPayloadStored: false,
    },
    forbidden,
  );
  writeEvidence(
    outputs.payloads,
    {
      schemaVersion: 1,
      evidenceClass: "real_npc_tank_mqtt_redacted_payload_shapes",
      phase: "G11_REAL_MQTT_CAPTURE",
      status: mqtt.samples.length > 0 ? "PASS" : "PARTIAL",
      startedAt: mqtt.startedAt,
      completedAt: mqtt.completedAt,
      inferredExplicitWireMode: inferWireMode(mqtt.samples),
      goal11RequestedWireModesSatisfied: inferWireMode(mqtt.samples) !== "ros_bridge_json",
      inferenceScope: "observed samples only",
      samples: mqtt.samples.map(({ payloadSha256, ...sample }) => ({
        ...sample,
        payloadHash: payloadSha256,
      })),
      coordinateValuesStored: false,
      rawPayloadStored: false,
      base64Stored: false,
    },
    forbidden,
  );
  writeEvidence(
    outputs.rawIndex,
    {
      schemaVersion: 1,
      evidenceClass: "real_npc_tank_mqtt_raw_sample_redaction_index",
      phase: "G11_REAL_MQTT_CAPTURE",
      status: mqtt.samples.length > 0 ? "PASS_REDACTED_INDEX_ONLY" : "PARTIAL_NO_SAMPLES",
      samples: mqtt.samples.map((sample) => ({
        topic: sample.topic,
        receivedAt: sample.receivedAt,
        byteLength: sample.byteLength,
        sha256: sample.payloadSha256,
        rawStored: false,
        redaction: "STRUCTURE_ONLY",
      })),
      rawPayloadStored: false,
      reason:
        "Real payload bytes are represented only by bounded metadata, hashes, and key/type structure.",
    },
    forbidden,
  );

  process.stdout.write(
    `PASS: tools=${mcp.toolCount}; mqttSamples=${mqtt.samples.length}; statusObserved=${mqtt.compositeStatusObserved}; wire=${inferWireMode(mqtt.samples)}\n`,
  );
  if (!mqtt.compositeStatusObserved) process.exitCode = 2;
} catch (error) {
  const failure = safeFailure(error, "NPC_TANK_REAL_CONTRACT_CAPTURE_FAILED");
  process.stderr.write(`NPC Tank real contract capture failed: ${failure.reasonCode}\n`);
  process.exitCode = 2;
}

function loadConfiguration(env, forbiddenValues) {
  const deviceMcpRaw = required(env, "NPC_TANK_SIM_DEVICE_MCP_URL");
  const mqttRaw = required(env, "NPC_TANK_SIM_MQTT_URL");
  forbiddenValues.push(deviceMcpRaw, mqttRaw);
  const deviceMcpUrl = parseEndpoint(deviceMcpRaw, "NPC_TANK_SIM_DEVICE_MCP_URL", [
    "http:",
    "https:",
  ]);
  const mqttUrl = parseEndpoint(mqttRaw, "NPC_TANK_SIM_MQTT_URL", [
    "mqtt:",
    "mqtts:",
    "ws:",
    "wss:",
  ]);
  if (/mock/i.test(deviceMcpUrl.hostname)) throw coded("NPC_TANK_KNOWN_MOCK_ENDPOINT_FORBIDDEN");
  const headersPath = optional(env, "NPC_TANK_SIM_DEVICE_MCP_HEADERS_FILE");
  const loadedHeaders =
    headersPath === undefined ? { headers: {}, raw: "" } : loadHeaderFile(headersPath);
  if (loadedHeaders.raw)
    forbiddenValues.push(loadedHeaders.raw, ...Object.values(loadedHeaders.headers));
  const passwordPath = optional(env, "NPC_TANK_SIM_MQTT_PASSWORD_FILE");
  const mqttPassword =
    passwordPath === undefined
      ? undefined
      : readBoundedFile(passwordPath, "NPC_TANK_SIM_MQTT_PASSWORD_FILE", 8_192, "utf8").trim();
  if (mqttPassword) forbiddenValues.push(mqttPassword);
  return {
    deviceMcpUrl,
    deviceMcpHeaders: loadedHeaders.headers,
    deviceMcpTimeoutMs: numberInRange(env.NPC_TANK_SIM_DEVICE_MCP_TIMEOUT_MS, 10_000, 500, 60_000),
    mqttUrl,
    mqttUsername: optional(env, "NPC_TANK_SIM_MQTT_USERNAME"),
    mqttPassword,
    mqttConnectTimeoutMs: numberInRange(
      env.NPC_TANK_PREFLIGHT_MQTT_CONNECT_TIMEOUT_MS,
      10_000,
      500,
      60_000,
    ),
    mqttSampleTimeoutMs: numberInRange(
      env.NPC_TANK_PREFLIGHT_MQTT_SAMPLE_TIMEOUT_MS,
      20_000,
      1_000,
      120_000,
    ),
  };
}

async function captureMcp(config) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client = new Client({ name: "sdar-npc-tank-real-capture", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(config.deviceMcpUrl, {
    requestInit: { headers: config.deviceMcpHeaders },
  });
  let connected = false;
  try {
    await client.connect(transport, { timeout: config.deviceMcpTimeoutMs });
    connected = true;
    const response = await client.listTools({}, { timeout: config.deviceMcpTimeoutMs });
    const tools = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      inputSchemaHash: sha256(canonical(tool.inputSchema)),
      outputSchemaHash:
        tool.outputSchema === undefined ? null : sha256(canonical(tool.outputSchema)),
    }));
    const names = new Set(tools.map((tool) => tool.name));
    const serverInfo = client.getServerVersion() ?? null;
    if (isRecord(serverInfo) && /mock/i.test(String(serverInfo.name ?? "")))
      throw coded("NPC_TANK_DEVICE_MCP_SERVER_IDENTIFIES_AS_MOCK");
    return {
      serverInfo,
      protocolVersion: transport.protocolVersion ?? "unknown",
      toolCount: tools.length,
      capturedToolNames: tools.map((tool) => tool.name),
      expectedToolCount: AUTHORITATIVE_TOOLS.length,
      missingAuthoritativeTools: AUTHORITATIVE_TOOLS.filter((name) => !names.has(name)),
      unknownTools: tools
        .map((tool) => tool.name)
        .filter((name) => !AUTHORITATIVE_TOOLS.includes(name)),
      humanPredictionDrift: {
        missingPredictedTools: names.has("get_capabilities") ? [] : ["get_capabilities"],
        actualReplacementTools: names.has("npc_tank_get_capabilities")
          ? ["npc_tank_get_capabilities"]
          : [],
      },
      inputSchemaCount: tools.filter((tool) => tool.inputSchema !== undefined).length,
      outputSchemaCount: tools.filter((tool) => tool.outputSchema !== undefined).length,
      annotationCount: tools.filter((tool) => tool.annotations !== undefined).length,
      contractHash: sha256(canonical(tools)),
      tools,
    };
  } finally {
    if (connected) await client.close().catch(() => undefined);
    else await transport.close().catch(() => undefined);
  }
}

async function captureMqtt(config) {
  const { connect } = await import("mqtt");
  const client = connect(config.mqttUrl.toString(), {
    clientId: `sdar-npc-tank-capture-${randomUUID().slice(0, 8)}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: config.mqttConnectTimeoutMs,
    resubscribe: false,
    ...(config.mqttUsername === undefined ? {} : { username: config.mqttUsername }),
    ...(config.mqttPassword === undefined ? {} : { password: config.mqttPassword }),
  });
  const startedAt = new Date().toISOString();
  const samples = new Map();
  let subscriptionGrants = [];
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let subscribed = false;
      let graceTimer;
      const finish = (error = undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (graceTimer !== undefined) clearTimeout(graceTimer);
        if (error === undefined) resolvePromise();
        else rejectPromise(error);
      };
      const maybeFinish = () => {
        if (
          !subscribed ||
          (!samples.has("status/npc_tank1") && !samples.has("/npc_tank1/status")) ||
          graceTimer !== undefined
        )
          return;
        graceTimer = setTimeout(() => finish(), 1_000);
      };
      const timeout = setTimeout(
        () => finish(),
        config.mqttConnectTimeoutMs + config.mqttSampleTimeoutMs,
      );
      client.once("connect", () => {
        const subscriptions = Object.fromEntries(
          TOPICS.map((topic) => [topic, { qos: qos(topic) }]),
        );
        client.subscribe(subscriptions, (error, granted = []) => {
          if (error !== null && error !== undefined)
            return finish(coded("NPC_TANK_MQTT_SUBSCRIBE_FAILED", error));
          try {
            subscriptionGrants = validateExactMqttSubscriptionGrants(
              granted.map(({ topic, qos: grantedQos }) => ({ topic, qos: grantedQos })),
              TOPICS.map((topic) => ({ topic, qos: qos(topic) })),
            );
          } catch (validationError) {
            return finish(validationError);
          }
          subscribed = true;
          maybeFinish();
        });
      });
      client.on("message", (topic, payload, packet) => {
        if (!TOPICS.includes(topic)) return;
        const prior = samples.get(topic);
        if (prior !== undefined) {
          prior.sampleCount += 1;
          return;
        }
        try {
          samples.set(topic, structuralSample(topic, payload, packet));
          maybeFinish();
        } catch (error) {
          finish(error);
        }
      });
      client.once("error", (error) =>
        finish(coded("NPC_TANK_MQTT_CONNECTION_OR_PROTOCOL_FAILED", error)),
      );
    });
  } finally {
    await new Promise((resolvePromise) => client.end(true, {}, () => resolvePromise())).catch(
      () => undefined,
    );
  }
  const orderedSamples = [...samples.values()].sort((left, right) =>
    left.topic.localeCompare(right.topic),
  );
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    subscriptionGrants: subscriptionGrants.sort((left, right) =>
      left.topic.localeCompare(right.topic),
    ),
    samples: orderedSamples,
    canonicalStatusObserved: samples.has("status/npc_tank1"),
    compatibilityStatusObserved: samples.has("/npc_tank1/status"),
    compositeStatusObserved: samples.has("status/npc_tank1") || samples.has("/npc_tank1/status"),
    publisherQosDrift: orderedSamples
      .filter((sample) => sample.qos !== qos(sample.topic))
      .map((sample) => ({
        topic: sample.topic,
        expectedQos: qos(sample.topic),
        observedQos: sample.qos,
      })),
  };
}

function structuralSample(topic, payload, packet) {
  if (payload.byteLength > 65_536) throw coded("NPC_TANK_MQTT_SAMPLE_TOO_LARGE");
  let outer;
  try {
    outer = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw coded("NPC_TANK_MQTT_SAMPLE_MALFORMED_JSON", error);
  }
  const rosCompatible = isRecord(outer) && Object.hasOwn(outer, "data");
  const directCompatible =
    isRecord(outer) &&
    Object.keys(outer).some((key) => key !== "data" && key !== "layout" && key !== "header");
  let inner;
  if (rosCompatible) {
    const data = outer.data;
    if (typeof data === "string" && (data.trim().startsWith("{") || data.trim().startsWith("["))) {
      try {
        inner = JSON.parse(data);
      } catch {
        inner = undefined;
      }
    } else inner = data;
  }
  return {
    topic,
    qos: packet.qos,
    retained: packet.retain === true,
    receivedAt: new Date().toISOString(),
    byteLength: payload.byteLength,
    payloadSha256: sha256(payload),
    sampleCount: 1,
    outerType: valueType(outer),
    outerTopLevelKeys: topLevelKeys(outer),
    rosMessageJsonCompatible: rosCompatible,
    directDomainJsonCompatible: directCompatible,
    ...(inner === undefined
      ? {}
      : {
          innerType: valueType(inner),
          innerTopLevelKeys: topLevelKeys(inner),
        }),
  };
}

function inferWireMode(samples) {
  if (samples.length === 0) return "UNDETERMINED_NO_SAMPLES";
  if (samples.every((sample) => sample.rosMessageJsonCompatible)) return "ros_message_json";
  if (samples.every((sample) => sample.directDomainJsonCompatible)) return "direct_domain_json";
  return "ros_bridge_json";
}

function qos(topic) {
  return topic.endsWith("/coverage") ? 0 : 1;
}

function numberInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value?.trim() || fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw coded("NPC_TANK_CAPTURE_TIMEOUT_INVALID");
  return parsed;
}

function valueType(value) {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

function topLevelKeys(value) {
  return isRecord(value) ? Object.keys(value).sort() : [];
}
