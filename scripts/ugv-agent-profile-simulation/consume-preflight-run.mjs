import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const { attemptsDir, runId } = parseArguments(process.argv.slice(2));
if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(runId) || runId.includes(".."))
  fail("UAP_SIMULATION_RUN_ID_INVALID");

const evidenceName = `deployment-preflight-${runId}.redacted.json`;
const markerPath = resolve(attemptsDir, `deployment-start-${runId}.used.json`);
let descriptor;
try {
  const generatedAt = new Date().toISOString();
  descriptor = openSync(markerPath, "wx", 0o600);
  writeFileSync(
    descriptor,
    `${JSON.stringify(
      {
        schemaVersion: "ugv-agent-profile.deployment-start-reservation/v1",
        runId,
        generatedAt,
        reservedAt: generatedAt,
        status: "RESERVED_IMMUTABLY",
        evidenceClass: "external_simulation",
        consumedPreflightEvidence: evidenceName,
        productionEligible: false,
        physicalVehicleQualified: false,
        authorizationGranted: false,
        safety: {
          toolsCallCount: 0,
          directDeviceToolCallCount: 0,
          navigationDispatchCount: 0,
          mutatingToolCallCount: 0,
          forbiddenOperationCallCount: 0,
          mqttPublishCount: 0,
          controlInvocationCount: 0,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (error?.code === "EEXIST") fail("UAP_DEPLOYMENT_RUN_ID_ALREADY_USED");
  fail("UAP_DEPLOYMENT_RUN_ID_RESERVATION_FAILED");
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}

let report;
try {
  report = JSON.parse(readFileSync(resolve(attemptsDir, evidenceName), "utf8"));
} catch {
  fail("UAP_DEPLOYMENT_PREFLIGHT_EVIDENCE_REQUIRED");
}
const safety = object(report.safety);
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
  safety.navigationDispatchCount !== 0 ||
  safety.mutatingToolCallCount !== 0 ||
  safety.forbiddenOperationCallCount !== 0 ||
  safety.mqttPublishCount !== 0 ||
  safety.controlInvocationCount !== 0
)
  fail("UAP_DEPLOYMENT_PREFLIGHT_LINEAGE_INVALID");

process.stdout.write(`UAP_DEPLOYMENT_PREFLIGHT_CONSUMED: ${runId}\n`);

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if ((key !== "--attempts-dir" && key !== "--run-id") || !value) fail("UAP_ARGUMENT_INVALID");
    parsed[key.slice(2)] = value;
  }
  if (typeof parsed["attempts-dir"] !== "string" || typeof parsed["run-id"] !== "string")
    fail("UAP_ARGUMENT_INVALID");
  return { attemptsDir: parsed["attempts-dir"], runId: parsed["run-id"] };
}

function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("UAP_DEPLOYMENT_PREFLIGHT_LINEAGE_INVALID");
  return value;
}

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(2);
}
