import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const check = resolve("scripts/task-business/check-adapter-proto-compat.mjs");
const relativeProto = "io/sdar/mcp/tasks/adapter/v1/adapter.proto";
const current = readFileSync(resolve("proto", relativeProto), "utf8");

function checkChangedProto(change: (source: string) => string) {
  const root = mkdtempSync(join(tmpdir(), "smpp-adapter-compat-"));
  const path = resolve(root, relativeProto);
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, change(current));
    return spawnSync(process.execPath, [check, "--proto-root", root], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true });
  }
}

describe("Adapter Proto legacy wire surface", () => {
  it("preserves every old descriptor while allowing the new business methods and fields", () => {
    const result = spawnSync(process.execPath, [check], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "PASS",
      legacyDefinitions: 55,
      currentDefinitions: 62,
    });
  });

  it("detects a legacy field renumbering from the parsed Proto", () => {
    const result = checkChangedProto((source) =>
      source.replace("  uint64 command_sequence = 5;", "  uint64 command_sequence = 50;"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "LEGACY_FIELDS_CHANGED io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity 5",
    );
  });

  it("detects a legacy RPC signature change from the parsed Proto", () => {
    const result = checkChangedProto((source) =>
      source.replace(
        "rpc GetExecution(GetExecutionRequest) returns (ExecutionSnapshot);",
        "rpc GetExecution(GetExecutionRequest) returns (CommandAck);",
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "LEGACY_METHODS_CHANGED io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter GetExecution",
    );
  });

  it("detects a legacy enum value change from the parsed Proto", () => {
    const result = checkChangedProto((source) =>
      source.replace("  SIMULATION = 2;", "  SIMULATION = 20;"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "LEGACY_VALUES_CHANGED io.sdar.mcp.tasks.adapter.v1.ExecutionMode SIMULATION",
    );
  });
});
