import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../packages/domain/src/index.js";
import { validateAvailabilityResponse } from "../../packages/domain/src/index.js";
import { mapTaskToDetailedTask } from "../../packages/task-engine/src/index.js";

describe("PR16 strict interop projections", () => {
  it("keeps CreateTaskResult base-only", () => {
    const created = mapTaskToDetailedTask(
      {
        taskId: "00000000-0000-4000-8000-000000000001",
        mcpStatus: "input_required",
        createdAt: new Date("2026-07-22T00:00:00.000Z"),
        updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        runtimeUpdatedAt: new Date("2026-07-22T00:00:00.000Z"),
        runtimeRevision: "1",
        handleExpiresAt: null,
        pollIntervalMs: 500,
        result: { structuredContent: {} },
        error: { code: -32603, message: "hidden" },
      } as unknown as TaskRecord,
      [],
      "create",
    );
    expect(created).not.toHaveProperty("inputRequests");
    expect(created).not.toHaveProperty("result");
    expect(created).not.toHaveProperty("error");
  });

  it("requires reservationRef only for guaranteed availability", () => {
    const checks = [
      {
        requestId: "one",
        operationName: "op",
        arguments: { state: "complete" as const, value: {} },
      },
    ];
    expect(() =>
      validateAvailabilityResponse(new Date(), checks, [
        {
          requestId: "one",
          operationName: "op",
          availability: "available",
          reservationMode: "guaranteed",
        },
      ]),
    ).toThrow();
    expect(() =>
      validateAvailabilityResponse(new Date(), checks, [
        {
          requestId: "one",
          operationName: "op",
          availability: "available",
          reservationMode: "none",
          reservationRef: "forbidden",
        },
      ]),
    ).toThrow();
  });
});
