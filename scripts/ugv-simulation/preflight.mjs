import { randomUUID } from "node:crypto";
import {
  boundedInteger,
  canonical,
  coded,
  explicitBoolean,
  gitSha,
  isRecord,
  loadEnvironment,
  loadHeaderFile,
  optional,
  parseArguments,
  parseEndpoint,
  readBoundedFile,
  redactEndpoint,
  repositoryRoot,
  required,
  safeFailure,
  sha256,
  topLevelKeys,
  validateExactMqttSubscriptionGrants,
  writeEvidence,
} from "./lib.mjs";

const PROTOCOL_TOPICS = [
  "/ugv/eo/pose",
  "/ugv/detected_objects",
  "/ugv/target_detected",
  "/ugv/target/gnss",
  "/ugv/area_recon/targets",
  "/ugv/area_recon/status",
  "/ugv/area_recon/exception",
  "/ugv/area_recon/coverage",
  "status/ugv",
  "/ugv/status",
  "/ugv/gnss",
  "/ugv/imu",
  "/ugv/speed",
  "/ugv/battery_range_km",
  "/ugv/mission_state",
  "/ugv/nav_state",
  "/ugv/system_state",
  "/ugv/component_status",
];
const argumentsValue = parseArguments(process.argv.slice(2));
const environment = loadEnvironment(argumentsValue["env-file"]);
const root = repositoryRoot(import.meta.url);
const output =
  argumentsValue.output ??
  optional(environment, "UGV_PREFLIGHT_EVIDENCE_PATH") ??
  "/var/lib/sdar/preflight/REAL_EXTERNAL_PREFLIGHT.json";
const startedAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  evidenceClass: "real_external_read_only",
  phase: "G10_REAL_EXTERNAL_PREFLIGHT",
  status: "BLOCKED_EXTERNAL_ENV",
  reasonCode: "PREFLIGHT_NOT_COMPLETED",
  command: "node scripts/ugv-simulation/preflight.mjs",
  exitCode: 2,
  startedAt,
  completedAt: null,
  gitSha: optional(environment, "UGV_QUALIFICATION_GIT_SHA") ?? gitSha(root),
  sourceStatus: optional(environment, "UGV_QUALIFICATION_SOURCE_STATUS") ?? "UNVERIFIED",
  endpoints: {},
  safety: {
    mockFallbackEnabled: false,
    controlAttempted: false,
    mqttPublishAttempted: false,
    rawPayloadStored: false,
  },
  configuration: {},
  deviceMcp: { status: "NOT_RUN" },
  mqtt: { status: "NOT_RUN" },
  failure: null,
};
const forbiddenEvidenceValues = [];

try {
  const config = loadConfiguration(environment, forbiddenEvidenceValues);
  report.endpoints = {
    deviceMcp: redactEndpoint(config.deviceMcpUrl),
    mqtt: redactEndpoint(config.mqttUrl),
  };
  report.configuration = {
    mqttWireMode: config.wireMode,
    mqttUsernameConfigured: config.mqttUsername !== undefined,
    mqttPasswordFileConfigured: config.mqttPassword !== undefined,
    mqttTlsMode: config.mqttTlsMode,
    deviceMcpHeadersFileConfigured: Object.keys(config.deviceMcpHeaders).length > 0,
    deviceMcpTlsMode: config.deviceMcpTlsMode,
    localDatabasePasswordsConfigured: true,
    safetySwitches: config.safetySwitches,
  };

  report.deviceMcp = await probeDeviceMcp(config);
  if (report.deviceMcp.status !== "PASS")
    throw coded(report.deviceMcp.reasonCode ?? "DEVICE_MCP_OPERATION_QUALIFICATION_FAILED");
  report.mqtt = await probeMqtt(config);
  if (report.mqtt.status === "PARTIAL") {
    report.status = "BLOCKED_EXTERNAL_ENV";
    report.reasonCode = report.mqtt.reasonCode;
  } else {
    const upstreamDrift =
      report.mqtt.publisherQosDrift.length > 0 || !report.mqtt.requiredStatusTopicObserved;
    report.status = upstreamDrift ? "PASS_WITH_UPSTREAM_DRIFT" : "PASS";
    report.reasonCode = upstreamDrift
      ? "REAL_EXTERNAL_PREREQUISITES_READY_WITH_UPSTREAM_DRIFT"
      : "REAL_EXTERNAL_PREREQUISITES_READY";
    report.exitCode = 0;
  }
} catch (error) {
  report.failure = safeFailure(error, "REAL_EXTERNAL_PREFLIGHT_FAILED");
  report.reasonCode = report.failure.reasonCode;
} finally {
  report.completedAt = new Date().toISOString();
  try {
    writeEvidence(output, report, forbiddenEvidenceValues);
  } catch (error) {
    const failure = safeFailure(error, "PREFLIGHT_EVIDENCE_WRITE_FAILED");
    process.stderr.write(`UGV real preflight evidence failure: ${failure.reasonCode}\n`);
    process.exitCode = 3;
  }
}

if (process.exitCode !== 3) {
  process.exitCode = report.exitCode;
  process.stdout.write(`${report.status}: ${report.reasonCode}; evidence=${output}\n`);
}

function loadConfiguration(env, forbidden) {
  const deviceMcpRaw = required(env, "UGV_SIM_DEVICE_MCP_URL");
  const mqttRaw = required(env, "UGV_SIM_MQTT_URL");
  forbidden.push(deviceMcpRaw, mqttRaw);
  const deviceMcpUrl = parseEndpoint(deviceMcpRaw, "UGV_SIM_DEVICE_MCP_URL", ["http:", "https:"]);
  const mqttUrl = parseEndpoint(mqttRaw, "UGV_SIM_MQTT_URL", ["mqtt:", "mqtts:", "ws:", "wss:"]);
  if (deviceMcpUrl.search || deviceMcpUrl.hash)
    throw coded("UGV_SIM_DEVICE_MCP_URL_QUERY_OR_FRAGMENT_FORBIDDEN");
  if (mqttUrl.search || mqttUrl.hash) throw coded("UGV_SIM_MQTT_URL_QUERY_OR_FRAGMENT_FORBIDDEN");
  if (deviceMcpUrl.hostname === "mock-ugv-device-mcp")
    throw coded("KNOWN_MOCK_DEVICE_MCP_ENDPOINT_FORBIDDEN");

  const wireMode = required(env, "UGV_MQTT_WIRE_MODE");
  if (
    wireMode !== "ros_message_json" &&
    wireMode !== "direct_domain_json" &&
    wireMode !== "ros_bridge_json"
  )
    throw coded("UGV_MQTT_WIRE_MODE_MUST_BE_EXPLICIT");
  if (
    explicitBoolean(
      env.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
      "UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT",
      false,
    )
  )
    throw coded("UGV_DEVICE_MCP_MOCK_FALLBACK_MUST_BE_FALSE");
  validateLocalDatabasePassword(env, "UGV_ADAPTER_DB_PASSWORD", forbidden);
  validateLocalDatabasePassword(env, "UGV_RUNTIME_DB_PASSWORD", forbidden);

  const deviceMcpTlsMode = optional(env, "UGV_SIM_DEVICE_MCP_TLS_MODE") ?? "disabled";
  if (!new Set(["disabled", "required"]).has(deviceMcpTlsMode))
    throw coded("UGV_SIM_DEVICE_MCP_TLS_MODE_INVALID");
  if ((deviceMcpUrl.protocol === "https:") !== (deviceMcpTlsMode === "required"))
    throw coded("UGV_SIM_DEVICE_MCP_TLS_MODE_SCHEME_MISMATCH");

  const mqttTlsMode = optional(env, "UGV_SIM_MQTT_TLS_MODE") ?? "disabled";
  if (!new Set(["disabled", "required"]).has(mqttTlsMode))
    throw coded("UGV_SIM_MQTT_TLS_MODE_INVALID");
  const secureMqtt = mqttUrl.protocol === "mqtts:" || mqttUrl.protocol === "wss:";
  if (secureMqtt !== (mqttTlsMode === "required"))
    throw coded("UGV_SIM_MQTT_TLS_MODE_SCHEME_MISMATCH");

  const headersPath = optional(env, "UGV_SIM_DEVICE_MCP_HEADERS_FILE");
  const loadedHeaders =
    headersPath === undefined ? { headers: {}, raw: "" } : loadHeaderFile(headersPath);
  if (loadedHeaders.raw) {
    forbidden.push(loadedHeaders.raw, ...Object.values(loadedHeaders.headers));
  }
  const passwordPath = optional(env, "UGV_SIM_MQTT_PASSWORD_FILE");
  const mqttPassword =
    passwordPath === undefined
      ? undefined
      : readBoundedFile(passwordPath, "UGV_SIM_MQTT_PASSWORD_FILE", 8_192, "utf8").trim();
  if (passwordPath !== undefined && !mqttPassword) throw coded("UGV_SIM_MQTT_PASSWORD_FILE_EMPTY");
  if (mqttPassword) forbidden.push(mqttPassword);

  const mqttTls = loadMqttTls(env, mqttTlsMode, forbidden);
  return {
    deviceMcpUrl,
    deviceMcpHeaders: loadedHeaders.headers,
    deviceMcpTimeoutMs: boundedInteger(
      env.UGV_SIM_DEVICE_MCP_TIMEOUT_MS,
      "UGV_SIM_DEVICE_MCP_TIMEOUT_MS",
      10_000,
      500,
      60_000,
    ),
    deviceMcpTlsMode,
    mqttUrl,
    mqttUsername: optional(env, "UGV_SIM_MQTT_USERNAME"),
    mqttPassword,
    mqttTlsMode,
    mqttTls,
    mqttConnectTimeoutMs: boundedInteger(
      env.UGV_PREFLIGHT_MQTT_CONNECT_TIMEOUT_MS,
      "UGV_PREFLIGHT_MQTT_CONNECT_TIMEOUT_MS",
      10_000,
      500,
      60_000,
    ),
    mqttSampleTimeoutMs: boundedInteger(
      env.UGV_PREFLIGHT_MQTT_SAMPLE_TIMEOUT_MS,
      "UGV_PREFLIGHT_MQTT_SAMPLE_TIMEOUT_MS",
      20_000,
      1_000,
      120_000,
    ),
    wireMode,
    safetySwitches: {
      realControlEnabled: explicitBoolean(
        env.UGV_ENABLE_REAL_CONTROL,
        "UGV_ENABLE_REAL_CONTROL",
        false,
      ),
      distanceM: safeDistance(env.UGV_TEST_DISTANCE_M),
      safePointConfigured: optional(env, "UGV_TEST_SAFE_POINT_JSON") !== undefined,
      safeWaypointsConfigured: optional(env, "UGV_TEST_SAFE_WAYPOINTS_JSON") !== undefined,
      reconEnabled: explicitBoolean(env.UGV_ENABLE_RECON_TESTS, "UGV_ENABLE_RECON_TESTS", false),
      reconRegionConfigured: optional(env, "UGV_TEST_RECON_REGION_JSON") !== undefined,
      effectorEnabled: explicitBoolean(
        env.UGV_ENABLE_EFFECTOR_TESTS,
        "UGV_ENABLE_EFFECTOR_TESTS",
        false,
      ),
    },
  };
}

function safeDistance(value) {
  const parsed = Number(value?.trim() || "1");
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000)
    throw coded("UGV_TEST_DISTANCE_M_INVALID");
  return parsed;
}

function validateLocalDatabasePassword(env, name, forbidden) {
  const value = required(env, name);
  forbidden.push(value);
  if (
    value.length < 16 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(value) ||
    /^(replace|change)[-_]/i.test(value)
  )
    throw coded(`${name}_URL_SAFE_NON_PLACEHOLDER_REQUIRED`);
}

function loadMqttTls(env, mode, forbidden) {
  const paths = {
    ca: optional(env, "UGV_SIM_MQTT_TLS_CA_FILE"),
    cert: optional(env, "UGV_SIM_MQTT_TLS_CERT_FILE"),
    key: optional(env, "UGV_SIM_MQTT_TLS_KEY_FILE"),
  };
  if (mode === "disabled") {
    if (Object.values(paths).some((value) => value !== undefined))
      throw coded("UGV_SIM_MQTT_TLS_FILES_WITH_DISABLED_MODE");
    return {};
  }
  if (!paths.ca || !paths.cert || !paths.key) throw coded("UGV_SIM_MQTT_MTLS_FILES_REQUIRED");
  const result = {
    ca: readBoundedFile(paths.ca, "UGV_SIM_MQTT_TLS_CA_FILE", 1_048_576),
    cert: readBoundedFile(paths.cert, "UGV_SIM_MQTT_TLS_CERT_FILE", 1_048_576),
    key: readBoundedFile(paths.key, "UGV_SIM_MQTT_TLS_KEY_FILE", 1_048_576),
  };
  forbidden.push(result.key.toString("utf8"));
  return result;
}

async function probeDeviceMcp(config) {
  const [
    { Client },
    { StreamableHTTPClientTransport },
    { UGV_DEVICE_TOOL_ALLOWLIST, UgvOperationQualificationService },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("../../dist/packages/vehicle-device-mcp-client/src/index.js"),
  ]);
  const client = new Client({ name: "sdar-ugv-real-preflight", version: "1.0.0" });
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
    const capturedAt = new Date().toISOString();
    const contracts = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      capturedAt,
      schemaHash: sha256(
        canonical({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null }),
      ),
    }));
    const operationQualifications = new UgvOperationQualificationService().matrix({
      contracts,
      externallyVerified: true,
      executionMode: "simulation",
    });
    const requiredFailures = operationQualifications.filter(
      (qualification) => qualification.deviceRequirement === "required" && !qualification.qualified,
    );
    const serverInfo = client.getServerVersion() ?? null;
    if (isRecord(serverInfo) && /mock/i.test(String(serverInfo.name ?? "")))
      throw coded("DEVICE_MCP_SERVER_IDENTIFIES_AS_MOCK");
    return {
      status: requiredFailures.length === 0 ? "PASS" : "BLOCKED",
      ...(requiredFailures.length === 0
        ? {}
        : { reasonCode: "DEVICE_MCP_REQUIRED_OPERATION_QUALIFICATION_FAILED" }),
      connected: true,
      mockFallbackEnabled: false,
      serverInfo,
      protocolVersion: transport.protocolVersion ?? "unknown",
      toolCount: tools.length,
      contractHash: sha256(canonical(tools)),
      missingKnownSimulatorTools: UGV_DEVICE_TOOL_ALLOWLIST.filter((name) => !names.has(name)),
      requiredOperationFailures: requiredFailures.map((qualification) => ({
        operationName: qualification.operationName,
        phase: qualification.phase,
        ...(qualification.variant === undefined ? {} : { variant: qualification.variant }),
        reasonCodes: qualification.reasonCodes,
        tools: qualification.tools
          .filter(({ usable }) => !usable)
          .map(({ toolName, reasonCodes }) => ({ toolName, reasonCodes })),
      })),
      operationQualifications,
      tools,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "QualificationError") throw error;
    throw coded("DEVICE_MCP_PROBE_FAILED", error);
  } finally {
    if (connected) await client.close().catch(() => undefined);
    else await transport.close().catch(() => undefined);
  }
}

async function probeMqtt(config) {
  const { connect } = await import("mqtt");
  const options = {
    clientId: `sdar-ugv-real-preflight-${randomUUID().slice(0, 8)}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: config.mqttConnectTimeoutMs,
    resubscribe: false,
    ...(config.mqttUsername === undefined ? {} : { username: config.mqttUsername }),
    ...(config.mqttPassword === undefined ? {} : { password: config.mqttPassword }),
    ...config.mqttTls,
    rejectUnauthorized: config.mqttTlsMode === "required",
  };
  const client = connect(config.mqttUrl.toString(), options);
  const started = Date.now();
  const samples = new Map();
  let sessionPresent = false;
  let subscriptionGrants = [];
  let connected = false;
  let observationFailure;
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
          (!samples.has("status/ugv") && !samples.has("/ugv/status")) ||
          graceTimer !== undefined
        )
          return;
        graceTimer = setTimeout(() => finish(), 750);
      };
      const timeout = setTimeout(() => {
        if (connected && subscribed) {
          observationFailure =
            samples.size === 0 ? "MQTT_SAMPLE_TIMEOUT" : "MQTT_STATUS_TOPIC_SAMPLE_TIMEOUT";
          finish();
        } else {
          finish(coded("MQTT_CONNECTION_OR_SUBSCRIPTION_TIMEOUT"));
        }
      }, config.mqttConnectTimeoutMs + config.mqttSampleTimeoutMs);
      client.once("connect", (packet) => {
        connected = true;
        sessionPresent = packet.sessionPresent === true;
        const subscriptions = Object.fromEntries(
          PROTOCOL_TOPICS.map((topic) => [topic, { qos: topic.endsWith("/coverage") ? 0 : 1 }]),
        );
        client.subscribe(subscriptions, (error, granted = []) => {
          if (error !== null && error !== undefined)
            return finish(coded("MQTT_SUBSCRIBE_FAILED", error));
          try {
            subscriptionGrants = validateExactMqttSubscriptionGrants(
              granted.map(({ topic, qos }) => ({ topic, qos })),
              PROTOCOL_TOPICS.map((topic) => ({
                topic,
                qos: topic.endsWith("/coverage") ? 0 : 1,
              })),
            );
          } catch (validationError) {
            return finish(validationError);
          }
          subscribed = true;
          maybeFinish();
        });
      });
      client.on("message", (topic, payload, packet) => {
        if (!PROTOCOL_TOPICS.includes(topic) || samples.has(topic)) return;
        try {
          const expectedQos = topic.endsWith("/coverage") ? 0 : 1;
          const decoded = decodeWirePayload(payload, config.wireMode);
          samples.set(topic, {
            topic,
            qos: packet.qos,
            expectedProtocolQos: expectedQos,
            publisherQosMatchesProtocol: packet.qos === expectedQos,
            retained: packet.retain === true,
            receivedAt: new Date().toISOString(),
            byteLength: payload.byteLength,
            payloadSha256: sha256(payload),
            decodedType: Array.isArray(decoded)
              ? "array"
              : decoded === null
                ? "null"
                : typeof decoded,
            decodedTopLevelKeys: topLevelKeys(decoded),
          });
          maybeFinish();
        } catch (error) {
          finish(error);
        }
      });
      client.once("error", (error) => finish(coded("MQTT_CONNECTION_OR_PROTOCOL_FAILED", error)));
      client.once("offline", () => {
        if (!connected) finish(coded("MQTT_CONNECTION_OFFLINE"));
      });
    });
    return {
      status: samples.has("status/ugv") || samples.has("/ugv/status") ? "PASS" : "PARTIAL",
      ...(observationFailure === undefined ? {} : { reasonCode: observationFailure }),
      connected: true,
      passiveSubscribeOnly: true,
      publishAttempted: false,
      explicitWireMode: config.wireMode,
      sessionPresent,
      elapsedMs: Date.now() - started,
      requiredStatusTopicObserved: samples.has("status/ugv"),
      legacyStatusTopicObserved: samples.has("/ugv/status"),
      compositeStatusObserved: samples.has("status/ugv") || samples.has("/ugv/status"),
      subscriptionGrants: subscriptionGrants.sort((left, right) =>
        left.topic.localeCompare(right.topic),
      ),
      samples: [...samples.values()].sort((left, right) => left.topic.localeCompare(right.topic)),
      publisherQosDrift: [...samples.values()]
        .filter((sample) => !sample.publisherQosMatchesProtocol)
        .map((sample) => ({
          topic: sample.topic,
          observedQos: sample.qos,
          expectedProtocolQos: sample.expectedProtocolQos,
        }))
        .sort((left, right) => left.topic.localeCompare(right.topic)),
      rawPayloadStored: false,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "QualificationError") throw error;
    throw coded("MQTT_PROBE_FAILED", error);
  } finally {
    await new Promise((resolvePromise) => client.end(true, {}, () => resolvePromise())).catch(
      () => undefined,
    );
  }
}

function decodeWirePayload(payload, mode) {
  if (payload.byteLength > 65_536) throw coded("MQTT_SAMPLE_PAYLOAD_TOO_LARGE");
  let outer;
  try {
    outer = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw coded("MQTT_SAMPLE_MALFORMED_JSON", error);
  }
  if (mode === "direct_domain_json") {
    if (
      !isRecord(outer) ||
      !Object.keys(outer).some((key) => key !== "data" && key !== "layout" && key !== "header")
    )
      throw coded("MQTT_SAMPLE_DIRECT_WIRE_SHAPE_MISMATCH");
    return outer;
  }
  if (mode === "ros_bridge_json") {
    if (!isRecord(outer)) throw coded("MQTT_SAMPLE_ROS_BRIDGE_WIRE_SHAPE_MISMATCH");
    const keys = Object.keys(outer);
    const isEnvelope =
      Object.hasOwn(outer, "data") &&
      keys.every((key) => key === "data" || key === "layout" || key === "header");
    if (!isEnvelope) return outer;
    if (typeof outer.data !== "string") return outer.data;
    const trimmed = outer.data.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return outer.data;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw coded("MQTT_SAMPLE_ROS_INNER_JSON_INVALID", error);
    }
  }
  if (!isRecord(outer) || !Object.hasOwn(outer, "data"))
    throw coded("MQTT_SAMPLE_ROS_WIRE_SHAPE_MISMATCH");
  if (typeof outer.data !== "string") return outer.data;
  const trimmed = outer.data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return outer.data;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw coded("MQTT_SAMPLE_ROS_INNER_JSON_INVALID", error);
  }
}
