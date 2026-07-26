import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../packages/domain/src/index.js";
import { mapTaskToDetailedTask } from "../../packages/task-engine/src/index.js";

describe("frozen DetailedTask projection", () => {
  it("C-013 C-016 C-027 C-029 C-070 uses flat results, true TTL and one Runtime revision", () => {
    const task = fixture({
      mcpStatus: "completed",
      result: { content: [], structuredContent: { ok: true }, isError: false },
      handleExpiresAt: new Date("2026-07-18T04:00:00.000Z"),
    });

    const created = mapTaskToDetailedTask(task, [], "create");
    expect(created).toMatchObject({
      resultType: "task",
      taskId: "00000000-0000-4000-8000-000000000001",
      ttlMs: 3_600_000,
      _meta: {
        "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: "42" },
      },
    });
    expect(created).not.toHaveProperty("task");
    expect(created).not.toHaveProperty("ttl");
    expect(created).not.toHaveProperty("pollInterval");
    expect(created).not.toHaveProperty("result");
    expect(created).not.toHaveProperty("error");
    expect(created).not.toHaveProperty("inputRequests");

    expect(mapTaskToDetailedTask(task, [], "get")).toMatchObject({ resultType: "complete" });
    expect(mapTaskToDetailedTask(task)).not.toHaveProperty("resultType");
  });

  it.each([
    ["input_required", { inputRequests: {} }],
    ["completed", { result: { structuredContent: {}, isError: false } }],
    ["failed", { error: { code: -32603, message: "Execution failed" } }],
  ] as const)("keeps %s status payloads out of CreateTaskResult", (mcpStatus, payload) => {
    const created = mapTaskToDetailedTask(fixture({ mcpStatus, ...payload }), [], "create");
    expect(created).not.toHaveProperty("inputRequests");
    expect(created).not.toHaveProperty("result");
    expect(created).not.toHaveProperty("error");
  });

  it("C-017 maps input_required with open MRTR requests by stable request key", () => {
    const task = fixture({ mcpStatus: "input_required" });
    expect(
      mapTaskToDetailedTask(
        task,
        [
          {
            key: "approval-1",
            description: "Approve the movement?",
            schema: { type: "object", properties: { approved: { type: "boolean" } } },
            required: true,
            status: "OPEN",
            answerHash: null,
            requestJson: {
              method: "elicitation/create",
              params: {
                mode: "form",
                message: "Approve the movement?",
                requestedSchema: {
                  type: "object",
                  properties: { approved: { type: "boolean" } },
                },
              },
            },
            responseHash: null,
            responseJson: null,
          },
          {
            key: "answered-1",
            description: "Already answered",
            schema: { type: "object" },
            required: true,
            status: "ANSWERED",
            answerHash: "a".repeat(64),
            requestJson: {
              method: "elicitation/create",
              params: { mode: "form", message: "Already answered", requestedSchema: {} },
            },
            responseHash: "a".repeat(64),
            responseJson: { action: "accept", content: true },
          },
        ],
        "get",
      ),
    ).toMatchObject({
      inputRequests: {
        "approval-1": {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "Approve the movement?",
            requestedSchema: { type: "object" },
          },
        },
      },
    });
  });

  it("C-026 uses null TTL when the handle has no expiry", () => {
    expect(mapTaskToDetailedTask(fixture({ handleExpiresAt: null }), [], "get")).toMatchObject({
      ttlMs: null,
    });
  });

  it("C-028 projects a dynamic pollIntervalMs", () => {
    expect(mapTaskToDetailedTask(fixture({ pollIntervalMs: 2_500 }), [], "get")).toMatchObject({
      pollIntervalMs: 2_500,
    });
  });

  it.each([
    ["C-030", true],
    ["C-029", false],
  ])("%s preserves completed isError=%s", (_caseId, isError) => {
    expect(
      mapTaskToDetailedTask(
        fixture({ mcpStatus: "completed", result: { structuredContent: {}, isError } }),
        [],
        "get",
      ),
    ).toMatchObject({ status: "completed", result: { isError } });
  });

  it("C-031 projects failed as a JSON-RPC Error", () => {
    expect(
      mapTaskToDetailedTask(
        fixture({ mcpStatus: "failed", error: { code: -32603, message: "Execution failed" } }),
        [],
        "get",
      ),
    ).toMatchObject({ status: "failed", error: { code: -32603 } });
  });
});

function fixture(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "00000000-0000-4000-8000-000000000001",
    mcpStatus: "working",
    statusMessage: "Working",
    createdAt: new Date("2026-07-18T03:00:00.000Z"),
    updatedAt: new Date("2026-07-18T03:01:30.000Z"),
    runtimeUpdatedAt: new Date("2026-07-18T03:01:00.000Z"),
    runtimeRevision: "42",
    handleExpiresAt: new Date("2026-07-18T04:00:00.000Z"),
    pollIntervalMs: 1_000,
    adapterRevision: 7,
    substate: "running",
    cancelRequested: false,
    result: null,
    error: null,
    ...overrides,
  } as TaskRecord;
}
