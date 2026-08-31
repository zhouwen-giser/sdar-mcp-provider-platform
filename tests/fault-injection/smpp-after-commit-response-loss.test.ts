import { describe, expect, it } from "vitest";
import type { TaskAdapterGateway } from "../../packages/task-engine/src/index.js";
import {
  DiagnosticAdapterGateway,
  DiagnosticFaultController,
  DiagnosticResponseLossError,
} from "../../packages/task-engine/src/index.js";

describe("SMPP after-commit response-loss transport seam", () => {
  it("suppresses only after the real Adapter start succeeds and consumes the lease once", async () => {
    let physicalStarts = 0;
    const delegate = fakeGateway(async () => {
      physicalStarts += 1;
      return acceptedResponse();
    });
    const faults = new DiagnosticFaultController({ enabled: true, runtimeProfile: "test" });
    const lease = faults.arm({
      operationName: "navigate",
      taskId: "task-1",
      executionMode: "simulation",
      ttlMs: 5_000,
    });
    const gateway = new DiagnosticAdapterGateway(delegate, faults);

    await expect(
      gateway.startOperation(
        "navigate",
        {},
        {
          taskId: "task-1",
          executionMode: "simulation",
        },
      ),
    ).rejects.toMatchObject({
      name: "DiagnosticResponseLossError",
      leaseId: lease.leaseId,
      uncertaintyClass: "response_lost_after_adapter_success",
    });
    expect(physicalStarts).toBe(1);
    expect(faults.activeLeases()).toEqual([]);
    expect(faults.auditTrail().map(({ action }) => action)).toEqual(["armed", "consumed"]);

    await expect(
      gateway.startOperation(
        "navigate",
        {},
        {
          taskId: "task-1",
          executionMode: "simulation",
        },
      ),
    ).resolves.toMatchObject({ result: "accepted" });
    expect(physicalStarts).toBe(2);
  });

  it("does not suppress an Adapter failure", async () => {
    const delegate = fakeGateway(() => Promise.reject(new Error("ADAPTER_FAILED_BEFORE_COMMIT")));
    const faults = new DiagnosticFaultController({ enabled: true, runtimeProfile: "test" });
    faults.arm({
      operationName: "navigate",
      correlationId: "correlation-1",
      executionMode: "simulation",
      ttlMs: 5_000,
    });
    const gateway = new DiagnosticAdapterGateway(delegate, faults);
    await expect(
      gateway.startOperation(
        "navigate",
        {},
        {
          correlationId: "correlation-1",
          executionMode: "simulation",
        },
      ),
    ).rejects.toThrow("ADAPTER_FAILED_BEFORE_COMMIT");
    expect(faults.activeLeases()).toHaveLength(1);
  });

  it("is disabled by default and forbidden outside test/simulation", () => {
    expect(() =>
      new DiagnosticFaultController().arm({
        operationName: "navigate",
        taskId: "task-1",
        executionMode: "simulation",
        ttlMs: 1_000,
      }),
    ).toThrow("DIAGNOSTIC_FAULTS_DISABLED");
    expect(() =>
      new DiagnosticFaultController({ enabled: true, runtimeProfile: "production" }).arm({
        operationName: "navigate",
        taskId: "task-1",
        executionMode: "simulation",
        ttlMs: 1_000,
      }),
    ).toThrow("DIAGNOSTIC_FAULT_PROFILE_FORBIDDEN");
  });

  it("expires with bounded TTL and records the audit action", () => {
    let now = new Date("2026-08-28T00:00:00.000Z");
    const faults = new DiagnosticFaultController({
      enabled: true,
      runtimeProfile: "test",
      maximumTtlMs: 2_000,
      now: () => now,
    });
    faults.arm({
      operationName: "navigate",
      taskId: "task-1",
      executionMode: "simulation",
      ttlMs: 1_000,
    });
    now = new Date("2026-08-28T00:00:01.001Z");
    expect(faults.activeLeases()).toEqual([]);
    expect(faults.auditTrail().map(({ action }) => action)).toEqual(["armed", "expired"]);
    expect(() =>
      faults.arm({
        operationName: "navigate",
        taskId: "task-1",
        executionMode: "simulation",
        ttlMs: 2_001,
      }),
    ).toThrow("DIAGNOSTIC_FAULT_TTL_INVALID");
  });

  it.each(["fire", "turret.fire", "launch-missile", "weapon/armament"])(
    "never arms a fire/weapon operation: %s",
    (operationName) => {
      const faults = new DiagnosticFaultController({ enabled: true, runtimeProfile: "test" });
      expect(() =>
        faults.arm({
          operationName,
          taskId: "task-1",
          executionMode: "simulation",
          ttlMs: 1_000,
        }),
      ).toThrow("DIAGNOSTIC_FAULT_OPERATION_FORBIDDEN");
    },
  );

  it("exports a distinct typed ambiguity error", () => {
    expect(new DiagnosticResponseLossError("lease-1")).toMatchObject({
      message: "DIAGNOSTIC_ADAPTER_RESPONSE_LOST_AFTER_SUCCESS",
    });
  });
});

function fakeGateway(startOperation: TaskAdapterGateway["startOperation"]): TaskAdapterGateway {
  return {
    startOperation,
    checkAvailability: () => Promise.resolve({ checkedAt: undefined, checks: [] }),
    getExecution: () => Promise.reject(new Error("unused")),
    reconcileExecution: () => Promise.reject(new Error("unused")),
  } as unknown as TaskAdapterGateway;
}

function acceptedResponse(): Awaited<ReturnType<TaskAdapterGateway["startOperation"]>> {
  return {
    result: "accepted",
    accepted: {
      externalExecutionId: "external-1",
      initialSnapshot: {
        taskId: "task-1",
        externalExecutionId: "external-1",
        operationName: "navigate",
        argumentHash: "a".repeat(64),
        state: "ACCEPTED",
        revision: "1",
        reasonCode: "",
        message: "accepted",
        retryable: false,
        result: {},
        inputRequests: [],
        mcpTaskInputRequests: [],
      },
    },
  } as Awaited<ReturnType<TaskAdapterGateway["startOperation"]>>;
}
