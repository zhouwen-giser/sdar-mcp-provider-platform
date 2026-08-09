import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const legacyTaskResultMethod = ["tasks", "result"].join("/");

describe("real-device runner frozen MCP profile", () => {
  it("excludes local Home Assistant credentials from the Docker build context", () => {
    const dockerIgnore = readFileSync(resolve(root, ".dockerignore"), "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim());
    expect(dockerIgnore).toContain(".local");
  });

  it("uses tasks/get as the only terminal task read", () => {
    for (const relativePath of ["scripts/run-ha-real-climate.ts", "scripts/run-ha-real-light.ts"]) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source, relativePath).toContain('"tasks/get"');
      expect(source, relativePath).not.toContain(legacyTaskResultMethod);
      expect(source, relativePath).not.toContain("taskResultCompatibility");
      expect(source, relativePath).toContain("not_applicable_to_frozen_runtime_surface");
      expect(source, relativePath).not.toMatch(/(?:readOnlyCall|request)\(mcpUrl,\s*"initialize"/);
    }
    const aggregateSource = readFileSync(resolve(root, "scripts/run-ha-real-e2e.ts"), "utf8");
    expect(aggregateSource).toContain("terminalTask");
    expect(aggregateSource).not.toContain(legacyTaskResultMethod);
    expect(aggregateSource).not.toContain("taskResultCompatibility");
  });

  it("documents the removed legacy method without listing it as a current API method", () => {
    const apiReference = readFileSync(resolve(root, "docs/protocol/api-reference.md"), "utf8");
    const runtimeBoundary = readFileSync(resolve(root, "docs/protocol/mcp-runtime.md"), "utf8");
    expect(apiReference).not.toMatch(/\|\s*`tasks\/result`\s*\|/);
    expect(apiReference).not.toMatch(/\|\s*`initialize`\s*\|/);
    expect(apiReference).not.toMatch(/\|\s*`tasks\/observations`\s*\|/);
    expect(apiReference).toContain("`server/discover`");
    expect(apiReference).toContain("`io.sdar/taskExecution/tasks/observations`");
    expect(runtimeBoundary).toContain("does not expose the legacy `tasks/result` method");
    expect(runtimeBoundary).not.toContain("接口 `tasks/observations`");
    expect(runtimeBoundary).toContain("接口 `io.sdar/taskExecution/tasks/observations`");
  });

  it("stops automatic climate writes when an opposite power restore is inside five minutes", () => {
    const qualificationSource = readFileSync(
      resolve(root, "scripts/run-ha-real-climate.ts"),
      "utf8",
    );
    expect(qualificationSource).toContain(
      'restoration.reason = "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE"',
    );
    expect(qualificationSource).toContain('restoration.status = "manual_restore_required"');
    expect(qualificationSource).toContain("`${correlationId}:restore-mode`");
    expect(qualificationSource).toContain(
      'modePreState.normalized.power === "off" && !climatePowerTestGateOpen',
    );
    expect(qualificationSource).not.toContain("await sleep(remaining)");

    for (const relativePath of [
      "scripts/run-live-smpp-three-device-e2e.ts",
      "scripts/restore-live-smpp-climate.ts",
    ]) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source, relativePath).toContain("ALLOW_CLIMATE_POWER_TEST");
      expect(source, relativePath).toContain("CLIMATE_POWER_TEST_GATE_CLOSED");
      expect(source, relativePath).toContain("CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE");
      expect(source, relativePath).not.toContain("await delay(waitMs)");
    }

    const restoreSource = readFileSync(
      resolve(root, "scripts/restore-live-smpp-climate.ts"),
      "utf8",
    );
    expect(restoreSource).toContain('runtimeTaskCountSource: "not_queried"');
    expect(restoreSource).not.toContain("report.activeTasks = 0");
    expect(restoreSource).not.toContain("report.uncertainTasks = 0");
  });
});
