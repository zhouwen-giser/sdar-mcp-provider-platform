import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import WebSocket from "ws";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultResourcesPath = resolve(workspace, ".local/ha-real-device/resources.local.json");
const defaultTokenPath = resolve(workspace, ".local/ha-real-device/token.txt");
const reportJsonPath = resolve(workspace, "reports/real-device-preparation/ha-preflight.json");
const reportMarkdownPath = resolve(workspace, "reports/real-device-preparation/ha-preflight.md");
const timeoutMs = 8_000;

const main = async () => {
  const resourcesPath =
    argument("--resources") ?? process.env.HA_REAL_RESOURCES_FILE ?? defaultResourcesPath;
  const tokenPath = argument("--token-file") ?? defaultTokenPath;
  const startedAt = new Date().toISOString();
  const report = {
    evidenceClass: "real",
    phase: "P1_HA_READ_ONLY_PREFLIGHT",
    startedAt,
    completedAt: null,
    status: "failed",
    readOnly: true,
    sideEffectsAttempted: false,
    environment: null,
    homeAssistantUrl: null,
    token: { source: "file", path: "<redacted>", present: false },
    checks: [],
    resources: [],
    error: null,
  };

  try {
    const configuration = loadConfiguration(resourcesPath, tokenPath);
    report.environment = configuration.environment;
    report.homeAssistantUrl = configuration.url;
    report.token.present = true;

    await request(configuration.url, configuration.token, "/api/");
    report.checks.push({
      name: "home_assistant_url_reachable",
      status: "passed",
      detail: "GET /api/ returned HTTP 2xx.",
    });
    report.checks.push({
      name: "token_valid",
      status: "passed",
      detail: "Home Assistant accepted the file token.",
    });

    const restStates = [];
    for (const resource of configuration.resources) {
      const raw = await request(
        configuration.url,
        configuration.token,
        `/api/states/${encodeURIComponent(resource.entityId)}`,
      );
      const normalized = normalize(resource, raw);
      restStates.push({ resource, raw, normalized });
      report.resources.push(normalized);
    }
    report.checks.push({
      name: "configured_entities_exist",
      status: "passed",
      detail: "All configured resources returned a state.",
    });
    report.checks.push({
      name: "entity_domains_match",
      status: "passed",
      detail: "Configured resource domains match climate/light.",
    });

    for (const item of restStates) {
      if (!item.normalized.reachable) throw coded("ENTITY_UNAVAILABLE", item.resource.resourceId);
    }
    report.checks.push({
      name: "entities_reachable",
      status: "passed",
      detail: "No configured entity is unknown or unavailable.",
    });

    const climate = restStates.find((item) => item.resource.domain === "climate");
    if (!climate) throw coded("CLIMATE_RESOURCE_MISSING");
    const supportedModes = climate.normalized.supportedHvacModes.filter((mode) =>
      climate.resource.allowedHvacModes.includes(mode),
    );
    if (supportedModes.length === 0) throw coded("CLIMATE_HVAC_MODE_INTERSECTION_EMPTY");
    if (climate.normalized.minTemperature === null || climate.normalized.maxTemperature === null)
      throw coded("CLIMATE_TEMPERATURE_LIMITS_MISSING");
    if (climate.normalized.minTemperature > climate.normalized.maxTemperature)
      throw coded("CLIMATE_TEMPERATURE_LIMITS_INVALID");
    report.checks.push({
      name: "climate_capabilities",
      status: "passed",
      detail: "A configured HVAC mode and Home Assistant temperature limits are readable.",
    });
    report.checks.push({
      name: "light_brightness_capabilities",
      status: "passed",
      detail:
        "Brightness capability was inspected for both configured lights; unsupported values remain null.",
    });

    const websocket = await websocketPreflight(
      configuration.url,
      configuration.token,
      configuration.resources,
      restStates,
    );
    report.checks.push({
      name: "websocket_connected",
      status: "passed",
      detail: "Home Assistant WebSocket authenticated.",
    });
    report.checks.push({
      name: "websocket_state_changed_subscription",
      status: "passed",
      detail: "state_changed subscription acknowledged.",
    });
    report.checks.push({
      name: "rest_websocket_initial_state_consistent",
      status: websocket.consistent ? "passed" : "failed",
      detail: websocket.consistent
        ? "Configured resource state snapshots matched REST reads."
        : "At least one configured resource differed between REST and WebSocket get_states.",
    });
    report.websocket = websocket.redacted;
    report.status = report.checks.every((check) => check.status === "passed") ? "passed" : "failed";
  } catch (error) {
    report.error = { code: error?.code ?? "PREFLIGHT_FAILED" };
    if (error?.code === "TOKEN_FILE_EMPTY" || error?.code === "TOKEN_FILE_READ_FAILED")
      report.token.present = false;
  }
  report.completedAt = new Date().toISOString();
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMarkdownPath, markdown(report), "utf8");
  process.stdout.write(
    `${report.status === "passed" ? "PASS" : "FAIL"} Home Assistant read-only preflight\n`,
  );
  process.exitCode = report.status === "passed" ? 0 : 1;
};

function loadConfiguration(resourcesPath, tokenPath) {
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(resourcesPath), "utf8"));
  } catch {
    throw coded("RESOURCES_FILE_INVALID");
  }
  if (
    !record(value) ||
    typeof value.homeAssistantUrl !== "string" ||
    typeof value.environment !== "string" ||
    !record(value.climate) ||
    !Array.isArray(value.lights) ||
    value.lights.length !== 2
  )
    throw coded("RESOURCES_FILE_INVALID");
  const url = new URL(value.homeAssistantUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw coded("HOME_ASSISTANT_URL_INVALID");
  const resources = [
    parseResource(value.climate, "climate"),
    ...value.lights.map((item) => parseResource(item, "light")),
  ];
  if (new Set(resources.map((item) => item.resourceId)).size !== resources.length)
    throw coded("RESOURCE_ID_DUPLICATE");
  if (new Set(resources.map((item) => item.entityId)).size !== resources.length)
    throw coded("ENTITY_ID_DUPLICATE");
  let token;
  try {
    token = readFileSync(resolve(tokenPath), "utf8").trim();
  } catch {
    throw coded("TOKEN_FILE_READ_FAILED");
  }
  if (!token) throw coded("TOKEN_FILE_EMPTY");
  return {
    url: url.toString().replace(/\/$/, ""),
    environment: value.environment,
    token,
    resources,
  };
}

function parseResource(value, domain) {
  if (
    !record(value) ||
    typeof value.resourceId !== "string" ||
    typeof value.entityId !== "string" ||
    typeof value.displayName !== "string"
  )
    throw coded("RESOURCE_CONFIG_INVALID");
  if (
    !value.entityId.startsWith(`${domain}.`) ||
    !/^[a-z0-9_]+$/.test(value.entityId.slice(domain.length + 1))
  )
    throw coded("ENTITY_DOMAIN_INVALID");
  if (
    domain === "climate" &&
    (!record(value.temperatureRange) ||
      typeof value.temperatureRange.minimum !== "number" ||
      typeof value.temperatureRange.maximum !== "number" ||
      !Array.isArray(value.allowedHvacModes))
  )
    throw coded("CLIMATE_CONFIG_INVALID");
  return {
    domain,
    resourceId: value.resourceId,
    entityId: value.entityId,
    displayName: value.displayName,
    ...(domain === "climate"
      ? { allowedHvacModes: value.allowedHvacModes.filter((item) => typeof item === "string") }
      : {}),
  };
}

async function request(baseUrl, token, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok)
      throw coded(
        response.status === 401
          ? "HOME_ASSISTANT_UNAUTHORIZED"
          : `HOME_ASSISTANT_HTTP_${response.status}`,
      );
    return await response.json();
  } catch (error) {
    if (error?.code) throw error;
    throw coded(
      controller.signal.aborted ? "HOME_ASSISTANT_TIMEOUT" : "HOME_ASSISTANT_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
  }
}

function normalize(resource, raw) {
  if (
    !record(raw) ||
    raw.entity_id !== resource.entityId ||
    typeof raw.state !== "string" ||
    !record(raw.attributes)
  )
    throw coded("HOME_ASSISTANT_STATE_INVALID");
  const attributes = raw.attributes;
  const reachable = raw.state !== "unknown" && raw.state !== "unavailable";
  const result = {
    resourceId: resource.resourceId,
    entityHash: hash(resource.entityId),
    domain: resource.domain,
    displayName: resource.displayName,
    state: raw.state,
    reachable,
    observedAt: typeof raw.last_updated === "string" ? raw.last_updated : null,
  };
  if (resource.domain === "climate") {
    result.supportedHvacModes = strings(attributes.hvac_modes);
    result.minTemperature = number(attributes.min_temp);
    result.maxTemperature = number(attributes.max_temp);
    result.currentTemperature = number(attributes.current_temperature);
    result.targetTemperature = number(attributes.temperature);
    result.temperatureUnit =
      typeof attributes.temperature_unit === "string" ? attributes.temperature_unit : null;
  } else {
    const supportedColorModes = strings(attributes.supported_color_modes);
    result.supportsBrightness =
      supportedColorModes.includes("brightness") ||
      supportedColorModes.includes("color_temp") ||
      typeof attributes.brightness === "number";
    result.brightnessPercent =
      typeof attributes.brightness === "number" && Number.isFinite(attributes.brightness)
        ? Math.round((attributes.brightness / 255) * 100)
        : null;
  }
  return result;
}

async function websocketPreflight(baseUrl, token, resources, restStates) {
  const wsUrl = new URL(baseUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = `${wsUrl.pathname.replace(/\/$/, "")}/api/websocket`;
  const socket = new WebSocket(wsUrl);
  const states = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      socket.terminate();
      rejectPromise(coded("HOME_ASSISTANT_WS_TIMEOUT"));
    }, timeoutMs);
    let authed = false;
    let statesResult;
    let subscriptionResult = false;
    const finish = () => {
      if (statesResult === undefined || !subscriptionResult) return;
      clearTimeout(timer);
      socket.close();
      resolvePromise(statesResult);
    };
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "auth_required") {
        socket.send(JSON.stringify({ type: "auth", access_token: token }));
        return;
      }
      if (message.type === "auth_invalid") {
        clearTimeout(timer);
        socket.terminate();
        rejectPromise(coded("HOME_ASSISTANT_WS_UNAUTHORIZED"));
        return;
      }
      if (message.type === "auth_ok" && !authed) {
        authed = true;
        socket.send(JSON.stringify({ id: 2, type: "get_states" }));
        socket.send(
          JSON.stringify({ id: 3, type: "subscribe_events", event_type: "state_changed" }),
        );
        return;
      }
      if (
        message.type === "result" &&
        message.id === 2 &&
        message.success === true &&
        Array.isArray(message.result)
      )
        statesResult = message.result;
      if (message.type === "result" && message.id === 3 && message.success === true)
        subscriptionResult = true;
      finish();
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (statesResult === undefined || !subscriptionResult) {
        clearTimeout(timer);
        rejectPromise(coded("HOME_ASSISTANT_WS_CLOSED"));
      }
    });
  });
  const byEntity = new Map(
    states
      .filter((state) => record(state) && typeof state.entity_id === "string")
      .map((state) => [state.entity_id, state]),
  );
  const comparisons = resources.map((resource, index) => {
    const wsState = byEntity.get(resource.entityId);
    const rest = restStates[index];
    const same =
      record(wsState) &&
      wsState.state === rest.raw.state &&
      JSON.stringify(wsState.attributes) === JSON.stringify(rest.raw.attributes);
    return {
      resourceId: resource.resourceId,
      entityHash: hash(resource.entityId),
      consistent: same,
    };
  });
  return {
    consistent: comparisons.every((item) => item.consistent),
    redacted: { initialStateComparisons: comparisons, subscribedEventType: "state_changed" },
  };
}

function markdown(report) {
  const lines = [
    "# Home Assistant real-device read-only preflight",
    "",
    `- Evidence class: \`${report.evidenceClass}\` (read-only real HA observation)`,
    `- Status: **${report.status.toUpperCase()}**`,
    `- Environment: \`${report.environment ?? "unknown"}\``,
    `- Side effects attempted: \`${String(report.sideEffectsAttempted)}\``,
    "",
    "## Checks",
    "",
    ...report.checks.map(
      (check) =>
        `- ${check.status === "passed" ? "PASS" : "FAIL"} \`${check.name}\`: ${check.detail}`,
    ),
    "",
    "## Configured resources (redacted)",
    "",
    "| resourceId | domain | entity hash | state | reachable | observedAt |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.resources.map(
      (resource) =>
        `| ${resource.resourceId} | ${resource.domain} | ${resource.entityHash} | ${resource.state} | ${String(resource.reachable)} | ${resource.observedAt ?? "n/a"} |`,
    ),
    "",
    "No token, Authorization header, internal entity identifier, or unrelated Home Assistant entity is included in this report.",
  ];
  if (report.error) lines.push("", `Error code: \`${report.error.code}\``);
  return `${lines.join("\n")}\n`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function coded(code, detail = undefined) {
  const error = new Error(code);
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  return error;
}

await main();
