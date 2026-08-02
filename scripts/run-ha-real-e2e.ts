import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(root, "reports/real-device-preparation/three-device-e2e.json");
const markdownPath = resolve(root, "reports/real-device-preparation/three-device-e2e.md");
const preflightPath = resolve(root, "reports/real-device-preparation/ha-preflight.json");
const climatePath = resolve(
  root,
  "reports/real-device-preparation/climate-real-qualification.json",
);
const lightPath = resolve(root, "reports/real-device-preparation/light-real-qualification.json");

type JsonObject = Record<string, unknown>;

const report: JsonObject = {
  evidenceClass: "real",
  phase: "P6_MCP_REAL_DEVICE_E2E",
  integrationRunId: process.env.REAL_DEVICE_TEST_RUN_ID ?? null,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  executionModel: "sequential calls to two isolated MCP Tasks Runtime instances",
  sequence: [
    "read initial state for climate and both lights",
    "control the real climate through ha-climate-lab Runtime",
    "control each real light through ha-light-lab Runtime",
    "compare Runtime task result, Provider observation, and Home Assistant preflight",
    "confirm restoration and no active or uncertain tasks",
  ],
  devices: [],
  finalReadOnlyPreflight: null,
  activeTasks: null,
  uncertainTasks: null,
  blockers: [],
};

try {
  const climate = readJson(climatePath);
  const light = readJson(lightPath);
  const preflight = readJson(preflightPath);
  const climateTaskResult = isObject(climate.taskResultCompatibility)
    ? climate.taskResultCompatibility
    : {};
  const lightTaskResult = isObject(light.taskResultCompatibility)
    ? light.taskResultCompatibility
    : {};
  report.finalReadOnlyPreflight = summarizePreflight(preflight);
  report.devices = [summarizeClimate(climate), ...summarizeLights(light)];
  report.activeTasks = sumNumber(climate.activeTasks, light.activeTasks);
  report.uncertainTasks = sumNumber(climate.uncertainTasks, light.uncertainTasks);
  const blockers = report.blockers as unknown[];
  for (const item of [climate, light]) {
    if (item.status !== "passed") blockers.push(...stringArray(item.errors));
    const taskResult = item === climate ? climateTaskResult : lightTaskResult;
    if (taskResult.status !== 200) blockers.push("FROZEN_MCP_TASKS_RESULT_UNSUPPORTED");
  }
  if (report.activeTasks !== 0) blockers.push("ACTIVE_RUNTIME_TASKS_REMAIN");
  if (report.uncertainTasks !== 0) blockers.push("UNCERTAIN_RUNTIME_TASKS_REMAIN");
  const blockerList = [...new Set(blockers)];
  report.blockers = blockerList;
  report.status =
    blockerList.length === 0 && report.activeTasks === 0 && report.uncertainTasks === 0
      ? "passed"
      : "blocked";
} catch (error) {
  report.blockers = [error instanceof Error ? error.name : "THREE_DEVICE_REPORT_INPUT_INVALID"];
  report.status = "blocked";
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(report), "utf8");
}

process.stdout.write(`${report.status === "passed" ? "PASS" : "BLOCKED"} Three-device real E2E\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

function readJson(path: string): JsonObject {
  if (!existsSync(path)) throw new Error(`REPORT_MISSING:${path}`);
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isObject(value)) throw new Error(`REPORT_INVALID:${path}`);
  return value;
}

function summarizeClimate(value: JsonObject): JsonObject {
  const resource =
    Array.isArray(value.resources) && isObject(value.resources[0]) ? value.resources[0] : {};
  return {
    providerId: "ha-climate-lab",
    resourceId: resource.resourceId ?? "living-room-air-conditioner",
    originalState: resource.original ?? null,
    finalState: value.finalState ?? null,
    restorationStatus: isObject(value.stateRestoration) ? value.stateRestoration.status : null,
    tasks: scenarioSummaries(value.scenarios),
    taskResultStatus: isObject(value.taskResultCompatibility)
      ? value.taskResultCompatibility.status
      : null,
  };
}

function summarizeLights(value: JsonObject): JsonObject[] {
  const resources = Array.isArray(value.resources) ? value.resources : [];
  const restorations = Array.isArray(value.stateRestoration) ? value.stateRestoration : [];
  const scenarios = Array.isArray(value.scenarios) ? value.scenarios : [];
  return resources.filter(isObject).map((resource) => {
    const resourceId = typeof resource.resourceId === "string" ? resource.resourceId : "";
    const restoration = restorations.find(
      (item): item is JsonObject => isObject(item) && item.resourceId === resourceId,
    );
    return {
      providerId: "ha-light-lab",
      resourceId,
      originalState: resource.original ?? null,
      finalState: restoration?.currentAfterRestore ?? null,
      restorationStatus: restoration?.status ?? null,
      tasks: scenarioSummaries(scenarios.filter((item) => scenarioResourceId(item) === resourceId)),
      taskResultStatus: isObject(value.taskResultCompatibility)
        ? value.taskResultCompatibility.status
        : null,
    };
  });
}

function scenarioSummaries(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []).filter(isObject).map((item) => ({
    operation: item.operation ?? null,
    resourceId: scenarioResourceId(item),
    status: item.status ?? null,
    runtimeTaskId: item.runtimeTaskId ?? null,
    adapterExternalExecutionId: item.adapterExternalExecutionId ?? null,
    homeAssistantObservationId: item.homeAssistantObservationId ?? null,
    idempotency: item.idempotency ?? null,
    before: item.before ?? null,
    desired: item.desired ?? null,
    after: item.after ?? null,
  }));
}

function scenarioResourceId(value: unknown): string | null {
  if (!isObject(value)) return null;
  if (typeof value.resourceId === "string") return value.resourceId;
  for (const candidate of [value.before, value.after]) {
    if (isObject(candidate) && typeof candidate.resourceId === "string")
      return candidate.resourceId;
  }
  return null;
}

function summarizePreflight(value: JsonObject): JsonObject {
  return {
    evidenceClass: value.evidenceClass ?? null,
    status: value.status ?? null,
    checkedAt: value.checkedAt ?? null,
    websocket: value.websocket ?? null,
    resources: Array.isArray(value.resources)
      ? value.resources.filter(isObject).map((resource) => ({
          resourceId: resource.resourceId ?? null,
          entityHash: resource.entityHash ?? null,
          domain: resource.domain ?? null,
          state: resource.state ?? null,
          reachable: resource.reachable ?? null,
          supportedHvacModes: resource.supportedHvacModes ?? undefined,
          brightnessSupported: resource.brightnessSupported ?? undefined,
        }))
      : [],
  };
}

function sumNumber(a: unknown, b: unknown): number {
  return (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function markdown(value: JsonObject): string {
  const devices = Array.isArray(value.devices) ? value.devices : [];
  const blockers = Array.isArray(value.blockers) ? value.blockers : [];
  return (
    [
      "# Three-device real MCP E2E",
      "",
      `- Evidence class: \`${String(value.evidenceClass)}\``,
      `- Status: **${String(value.status).toUpperCase()}**`,
      `- Execution model: ${String(value.executionModel)}`,
      `- Active tasks: ${String(value.activeTasks)}`,
      `- Uncertain tasks: ${String(value.uncertainTasks)}`,
      "",
      "## Device results",
      "",
      ...devices.map((device) => {
        const item = isObject(device) ? device : {};
        return `- \`${String(item.providerId)}\` / \`${String(item.resourceId)}\`: restoration=${String(item.restorationStatus)}, tasks=${Array.isArray(item.tasks) ? item.tasks.length : 0}`;
      }),
      "",
      "## Blockers",
      "",
      ...(blockers.length === 0
        ? ["- None recorded."]
        : blockers.map((item) => `- \`${String(item)}\``)),
      "",
      "This aggregate report is derived from the two real Runtime/Adapter qualification reports and a final read-only Home Assistant preflight. It contains no credentials or Home Assistant entity identifiers.",
    ].join("\n") + "\n"
  );
}
