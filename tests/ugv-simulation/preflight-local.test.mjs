import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("UGV local preflight is read-only and reports the simulator boundary", () => {
  const output = `/tmp/ugv-preflight-${process.pid}.json`;
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/ugv-provider-preflight.mjs", "--output", output],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.status, "BLOCKED_BY_SIMULATOR");
    assert.equal(report.localReadiness, "PASS_LOCAL");
    assert.equal(report.realQualification, "PENDING_SIMULATOR");
    assert.equal(report.safety.fire, "DISABLED");
    assert.equal(report.safety.mockContract, "DISABLED");
    assert.deepEqual(report.sideEffects, {
      deviceMutations: 0,
      mqttPublishes: 0,
      physicalMotion: false,
    });
    assert.equal(report.localChecks.fireDisabled, "PASS");
    assert.equal(report.localChecks.mockFallback, "PASS");
    assert.equal(report.externalChecks.deviceMcpContract, "PENDING_SIMULATOR_CONTRACT");
    assert.equal(report.externalChecks.mqttObservation, "PENDING_SIMULATOR_OBSERVATION");
    assert.equal(report.externalChecks.activeTasks, "NOT_OBSERVED");
    assert.equal(report.externalChecks.uncertainTasks, "NOT_OBSERVED");
  } finally {
    rmSync(output, { force: true });
  }
});

test("UGV local preflight fails closed when fire or mock fallback is enabled", () => {
  const output = `/tmp/ugv-preflight-fail-${process.pid}.json`;
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/ugv-provider-preflight.mjs", "--output", output],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          UGV_FIRE_ENABLED: "true",
          UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "true",
        },
      },
    );
    assert.equal(result.status, 2);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.status, "LOCAL_CONFIGURATION_FAILED");
    assert.equal(report.localReadiness, "FAIL_LOCAL");
    assert.equal(report.realQualification, "NOT_REAL_QUALIFIED");
    assert.equal(report.safety.fire, "ENABLED_BLOCKED");
    assert.equal(report.safety.mockContract, "NOT_REAL_QUALIFIED");
    assert.equal(report.localChecks.fireDisabled, "FAIL");
    assert.equal(report.localChecks.mockFallback, "FAIL");
    assert.equal(report.sideEffects.deviceMutations, 0);
  } finally {
    rmSync(output, { force: true });
  }
});
