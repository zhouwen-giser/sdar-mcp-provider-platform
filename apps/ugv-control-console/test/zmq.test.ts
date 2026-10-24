import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  nativeContract,
  inspectionArguments,
  zmqConsoleTool,
  zmqToolReason,
  ZMQ_INSPECT,
  EFFECT_APPLY,
  EFFECT_RESULT,
} from "../shared/zmq.js";
import { classifyTask, record } from "../shared/model.js";
import { Service } from "../server/service.js";
import { fakeMcp } from "./fixture.js";
import type { Store } from "../server/store.js";
function resultFixture() {
  const fake = fakeMcp();
  Object.assign(fake.mcp.headers, {
    "x-sdar-execution-mode": "simulation",
    "x-sdar-simulation-id": "SIMULATED-run",
  });
  const store = {
    task: async (id: string) => (id === "task-1" ? { operation: EFFECT_APPLY } : undefined),
  } as unknown as Store;
  const service = new Service(fake.mcp, store, "operator"),
    provider = { providerId: "provider-1" };
  vi.spyOn(service, "catalog").mockResolvedValue({
    provider,
    extensions: {},
    tools: [zmqConsoleTool(EFFECT_RESULT, "vehicle:ugv")],
    resourceId: "vehicle:ugv",
    catalogHash: "candidate",
    checkedAt: "",
  });
  const identity = {
    scopeHash: "c".repeat(64),
    providerId: "provider-1",
    resourceId: "vehicle:ugv",
    taskId: "task-1",
    externalExecutionId: "execution-1",
    operationName: "simulation.applyEffect",
    authorizationContextHash: "d".repeat(64),
    executionMode: "simulation",
    simulationId: "SIMULATED-run",
  };
  const business = {
    context: {
      identity: { taskId: "task-1", executionId: "execution-1", simulationId: "SIMULATED-run" },
    },
    objects: [],
    resumeFrom: {},
    complete: true,
    missingRefs: [],
  };
  vi.spyOn(service, "business").mockImplementation(async () => business);
  const draft = {
    identity,
    kind: "effect",
    sourceRef: {
      partitionHash: "a".repeat(64),
      sessionId: "receiver",
      ordinal: "1",
      entryHash: "b".repeat(64),
    },
    receivedAt: new Date().toISOString(),
    content: { nativeTask: { effect: "miss" } },
  };
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  const row = {
    ...draft,
    schemaVersion: "ugv.zmq-result-record/1",
    revision: 1,
    contentHash: createHash("sha256")
      .update(JSON.stringify(sorted(draft)))
      .digest("hex"),
  };
  const result = {
    schemaVersion: "ugv.zmq-effect-query/1",
    page: {
      schemaVersion: "ugv.zmq-result-page/1",
      identity,
      records: [row],
      nextRevision: 1,
      hasMore: false,
      historySource: "platform_retained_only",
    },
  };
  vi.spyOn(fake.mcp, "tool").mockImplementation(async () => ({
    isError: false,
    structuredContent: result,
  }));
  return { service, result, row, business, fake };
}
const quad = "lon: 106, lat: 29\n106.001,29\n106.001,29.001\n106,29.001";
describe("restricted ZMQ console contracts", () => {
  it("retains longitude/latitude and explicit ellipsoid height", () => {
    expect(inspectionArguments("vehicle:ugv", quad, "10", "track").area.vertices[0]).toEqual({
      longitude: 106,
      latitude: 29,
      ellipsoidHeightM: 10,
    });
    expect(() => inspectionArguments("vehicle:ugv", quad, "", "recognize")).toThrow("椭球高");
    expect(
      inspectionArguments("vehicle:ugv", quad, "0", "recognize").area.vertices[0].ellipsoidHeightM,
    ).toBe(0);
  });
  it.each([
    "0,0\n1,0\n0,1",
    "0,0\n1,0\n0.4,0.4\n0,1",
    "0,0\n1,1\n0,1\n1,0",
    "179,0\n180,0\n180,1\n179,1",
  ])("rejects unsupported geometry %s", (value) =>
    expect(() => inspectionArguments("vehicle:ugv", value, "10", "recognize")).toThrow(),
  );
  it("requires exact schema, wire metadata and a non-cancellable simulation Task Profile", () => {
    const tool = zmqConsoleTool(EFFECT_APPLY, "vehicle:ugv");
    expect(zmqToolReason(tool, "vehicle:ugv")).toBeNull();
    expect(
      zmqToolReason(
        { ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: true } },
        "vehicle:ugv",
      ),
    ).toBe("ZMQ_CONSOLE_CONTRACT_MISMATCH");
    if (!tool._meta) throw Error("FIXTURE_TOOL_METADATA_REQUIRED");
    tool._meta["io.sdar/taskExecution"] = {
      ...record(tool._meta["io.sdar/taskExecution"]),
      supportsCancellation: true,
    };
    expect(zmqToolReason(tool, "vehicle:ugv")).toBe("ZMQ_TASK_PROFILE_MISMATCH");
  });
  it("rejects the new control tools outside the server-configured simulation domain", () => {
    const fake = fakeMcp(),
      tool = zmqConsoleTool(ZMQ_INSPECT, "vehicle:ugv"),
      service = new Service(fake.mcp, {} as Store, "operator");
    const catalog = {
      provider: {},
      extensions: {},
      tools: [tool],
      resourceId: "vehicle:ugv",
      catalogHash: "candidate",
      checkedAt: "",
    };
    const args = inspectionArguments("vehicle:ugv", quad, "10", "recognize");
    expect(() => service.validateTool(catalog, ZMQ_INSPECT, args)).toThrow(
      "SIMULATION_DOMAIN_REQUIRED",
    );
    Object.assign(fake.mcp.headers, {
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "SIMULATED-run",
    });
    expect(service.validateTool(catalog, ZMQ_INSPECT, args)).toBe(tool);
    expect(() =>
      service.validateTool(catalog, ZMQ_INSPECT, {
        ...args,
        upstreamUrl: "http://arbitrary.invalid",
      }),
    ).toThrow("SCHEMA_MISMATCH");
    expect(() =>
      service.validateTool(catalog, ZMQ_INSPECT, {
        ...args,
        area: { ...args.area, excludedZones: [1] },
      }),
    ).toThrow("SCHEMA_MISMATCH");
  });
  it.each(["miss", "hit", "destroyed"])(
    "shows the explicit virtual effect %s independently from successful execution",
    (effect) => {
      const task = {
        status: "completed",
        result: {
          isError: false,
          structuredContent: {
            schemaVersion: "ugv.zmq-effect-result/1",
            executionState: "succeeded",
            executionFinished: true,
            effect,
          },
        },
      };
      expect(classifyTask(task).label).toContain("仿真执行完成");
      expect(
        classifyTask({
          ...task,
          result: { structuredContent: { ...task.result.structuredContent, effect: "unknown" } },
        }).tone,
      ).toBe("warning");
    },
  );
  it("binds supplemental reads to imported execution identity and checks retained-record hashes", async () => {
    const f = resultFixture();
    expect(await f.service.supplement("task-1")).toEqual(f.result);
    await expect(f.service.supplement("foreign-task")).rejects.toThrow("NOT_IMPORTED");
    await expect(f.service.readTool(EFFECT_RESULT, {})).rejects.toThrow("USE_IMPORTED_TASK");
    f.row.content.nativeTask.effect = "hit";
    await expect(f.service.supplement("task-1")).rejects.toThrow("INTEGRITY_FAILED");
  });
  it("rejects a foreign execution, scenario or invalid cursor before accepting a result page", async () => {
    const f = resultFixture();
    f.business.context.identity.simulationId = "other";
    await expect(f.service.supplement("task-1")).rejects.toThrow("IDENTITY_UNCONFIRMED");
    f.business.context.identity.simulationId = "SIMULATED-run";
    f.result.page.identity.externalExecutionId = "other-execution";
    await expect(f.service.supplement("task-1")).rejects.toThrow("IDENTITY_MISMATCH");
    f.result.page.identity.externalExecutionId = "execution-1";
    f.result.page.nextRevision = 0;
    await expect(f.service.supplement("task-1")).rejects.toThrow("CURSOR_INVALID");
  });
});

describe("formal native console contracts", () => {
  it("accepts exact native controls and rejects schema or business policy drift", () => {
    const t = nativeContract("vehicle_zmq_camera", "vehicle:ugv");
    expect(t).toBeDefined();
    expect(zmqToolReason(t, "vehicle:ugv")).toBeNull();
    if (!t) throw Error("FIXTURE_TOOL_REQUIRED");
    const drift = structuredClone(t);
    drift.outputSchema = {};
    expect(zmqToolReason(drift, "vehicle:ugv")).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
});
