import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adapterProtoPath,
  adapterServiceDefinition,
} from "../../packages/adapter-protocol/src/index.js";

describe("Adapter Protocol v1", () => {
  it("declares every mandatory, conditional and optional RPC", () => {
    expect(Object.keys(adapterServiceDefinition()).sort()).toEqual(
      [
        "CheckAvailability",
        "DescribeProvider",
        "GetExecution",
        "ListResources",
        "PauseExecution",
        "ReconcileExecution",
        "RequestCancel",
        "ResumeExecution",
        "StartOperation",
        "StreamBusinessEvents",
        "StreamExecutionEvents",
        "UpdateExecution",
      ].sort(),
    );
  });

  it("freezes task identity and unified StartOperation publication semantics", () => {
    const source = readFileSync(adapterProtoPath, "utf8");
    expect(source).toContain("string authorization_context_hash");
    expect(source).toContain("string argument_hash");
    expect(source).toContain("uint64 command_sequence");
    expect(source).toContain("SYNCHRONOUS requires an");
    expect(source).toContain("TASK_REQUIRED always publishes");
  });

  it("adds frozen MRTR fields without replacing Legacy field numbers", () => {
    const source = readFileSync(adapterProtoPath, "utf8");
    expect(source).toContain("message McpTaskInputRequest");
    expect(source).toContain("message McpTaskInputResponse");
    expect(source).toContain("repeated InputRequest input_requests = 8 [deprecated = true]");
    expect(source).toContain("repeated McpTaskInputRequest mcp_input_requests = 17");
    expect(source).toContain("repeated UpdateValue inputs = 3 [deprecated = true]");
    expect(source).toContain("repeated McpTaskInputResponse input_responses = 4");
  });

  it("adds type-only Evidence at field 16 without requirementId", () => {
    const source = readFileSync(adapterProtoPath, "utf8");
    expect(source).toContain("message EvidenceItem");
    expect(source).toContain("repeated EvidenceItem evidence = 16");
    expect(source).not.toContain("requirement_id");
  });

  it("adds the frozen reservation reference without renumbering StartOperation", () => {
    const source = readFileSync(adapterProtoPath, "utf8");
    expect(source).toContain("optional string reservation_ref = 9");
  });

  it("has reproducibly generated JavaScript and TypeScript bindings", () => {
    const generated = resolve("packages/adapter-protocol/generated/io/sdar/mcp/tasks/adapter/v1");
    expect(existsSync(resolve(generated, "adapter_pb.js"))).toBe(true);
    expect(existsSync(resolve(generated, "adapter_pb.d.ts"))).toBe(true);
    expect(existsSync(resolve(generated, "adapter_grpc_pb.js"))).toBe(true);
    expect(existsSync(resolve(generated, "adapter_grpc_pb.d.ts"))).toBe(true);
  });

  it("keeps the Python Adapter source syntactically valid", () => {
    expect(() =>
      execFileSync(process.platform === "win32" ? "python" : "python3", [
        "-m",
        "py_compile",
        "examples/mock-adapter-python/adapter.py",
      ]),
    ).not.toThrow();
  });
});
