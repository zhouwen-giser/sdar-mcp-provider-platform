import { closeSync, existsSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const { attemptsDir, runId } = parseArguments(process.argv.slice(2));
if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(runId) || runId.includes(".."))
  fail("UAP_SIMULATION_RUN_ID_INVALID");

const outputName = `deployment-preflight-${runId}.redacted.json`;
const markerName = `deployment-preflight-${runId}.used.json`;
const outputPath = resolve(attemptsDir, outputName);
const markerPath = resolve(attemptsDir, markerName);
if (existsSync(outputPath)) fail("UAP_SIMULATION_RUN_ID_ALREADY_USED");

let descriptor;
try {
  const generatedAt = new Date().toISOString();
  descriptor = openSync(markerPath, "wx", 0o600);
  writeFileSync(
    descriptor,
    `${JSON.stringify(
      {
        schemaVersion: "ugv-agent-profile.preflight-run-reservation/v1",
        runId,
        generatedAt,
        reservedAt: generatedAt,
        status: "RESERVED_IMMUTABLY",
        evidenceClass: "external_simulation",
        expectedEvidence: outputName,
        productionEligible: false,
        physicalVehicleQualified: false,
        authorizationGranted: false,
        safety: {
          toolsCallCount: 0,
          mqttPublishCount: 0,
          controlInvocationCount: 0,
          forbiddenOperationCallCount: 0,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  if (error?.code === "EEXIST") fail("UAP_SIMULATION_RUN_ID_ALREADY_USED");
  fail("UAP_SIMULATION_RUN_ID_RESERVATION_FAILED");
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}

process.stdout.write(`UAP_SIMULATION_RUN_ID_RESERVED: ${runId}\n`);

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

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(2);
}
