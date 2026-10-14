import { describe, expect, it, vi } from "vitest";
import {
  jsonToProtoStruct,
  type ExecutionSnapshot,
} from "../../packages/adapter-protocol/src/index.js";
import type { ValidatedOperation } from "../../packages/operation-registry/src/index.js";
import { startWindowMissed } from "../../packages/task-engine/src/engine.js";
import {
  sanitizedAdapterResultPayload,
  validatedSnapshotTransition,
  inspectionStoppedTransition,
} from "../../packages/task-engine/src/result-contract.js";

describe("H9 result contract hardening", () => {
  it.each(["start_window_missed", "deadline_reached"])(
    "retains inspection facts and explicitly downgrades the Runtime timing outcome %s",
    (outcome) => {
      const report = {
        resourceId: "vehicle:ugv1",
        status: "completed",
        observedAt: "2026-10-14T00:00:00Z",
        anomalies: [{ findingId: "observed-7" }],
        inspectionReport: {
          version: "1.0",
          completion: "complete",
          targetReportComplete: true,
          truncated: false,
          findingCount: 1,
          artifactRefs: [],
        },
        coverage: { coveragePercent: 100 },
        correlationStrength: "STRICT_CORRELATED",
        missingEvidence: [],
      };
      const inspection = { ...operation(vi.fn()), name: "vehicle_inspect_area" };
      const initial = validatedSnapshotTransition(inspection, snapshot("SUCCEEDED", report));
      const base = {
        ...initial,
        result: {
          content: [],
          isError: true,
          structuredContent: {
            outcome,
            reasonCode: "TIMING_STOP",
            retryable: false,
            completedAt: report.observedAt,
            adapterResult: { fields: {} },
          },
        },
      };
      const result = inspectionStoppedTransition(inspection, snapshot("SUCCEEDED", report), base);
      expect(result).toMatchObject({
        mcpStatus: "completed",
        result: {
          isError: true,
          structuredContent: {
            outcome,
            status: outcome === "deadline_reached" ? "timeout" : "failed",
            anomalies: report.anomalies,
            inspectionReport: { completion: "partial" },
            missingEvidence: [
              outcome === "deadline_reached"
                ? "INSPECTION_TASK_DEADLINE_REACHED"
                : "INSPECTION_START_WINDOW_MISSED",
            ],
          },
        },
      });
      expect(result.result?.structuredContent).not.toHaveProperty("adapterResult");
    },
  );
  it("sanitizes before validating BUSINESS_FAILED output", () => {
    const validateOutput = vi.fn((value: unknown) => {
      expect(value).toEqual({ safe: true });
    });
    const transition = validatedSnapshotTransition(
      operation(validateOutput),
      snapshot("BUSINESS_FAILED", { safe: true, constructor: { polluted: true } }),
    );
    expect(validateOutput).toHaveBeenCalledOnce();
    expect(transition).toMatchObject({
      internalState: "TERMINAL_COMPLETED",
      mcpStatus: "completed",
      result: { isError: true },
    });
  });

  it("applies size limits before schema validation", () => {
    const validateOutput = vi.fn();
    const transition = validatedSnapshotTransition(
      operation(validateOutput),
      snapshot("BUSINESS_FAILED", { value: "x".repeat(1_048_576) }),
    );
    expect(validateOutput).not.toHaveBeenCalled();
    expect(transition.error).toMatchObject({
      data: { reasonCode: "ADAPTER_RESULT_TOO_LARGE" },
    });
  });

  it("preserves a sanitized Adapter result in START_WINDOW_MISSED", () => {
    const adapterResult = sanitizedAdapterResultPayload(
      snapshot("CANCELLED", { stopped: true, __proto__: { polluted: true } }),
    );
    expect(
      startWindowMissed(new Date("2026-07-17T00:00:00Z"), "missed", adapterResult),
    ).toMatchObject({
      structuredContent: {
        outcome: "start_window_missed",
        reasonCode: "START_WINDOW_MISSED",
        adapterResult: { stopped: true },
      },
    });
  });

  it.each(["TECHNICAL_FAILED", "CANCELLED"])(
    "retains validated inspection facts in %s without changing the terminal status",
    (state) => {
      const report = {
        resourceId: "vehicle:ugv1",
        status: state === "CANCELLED" ? "cancelled" : "timeout",
        observedAt: "2026-10-14T00:00:00.000Z",
        anomalies: [{ findingId: "target-1", kind: "target_observed" }],
        inspectionReport: { completion: "partial", findingCount: 1 },
        missingEvidence: ["INSPECTION_COVERAGE_INCOMPLETE"],
      };
      const validateOutput = vi.fn((value: unknown) => expect(value).toEqual(report));
      const inspection = { ...operation(validateOutput), name: "vehicle_inspect_area" };
      const transition = validatedSnapshotTransition(inspection, snapshot(state, report));
      expect(validateOutput).toHaveBeenCalledOnce();
      expect(transition.mcpStatus).toBe(state === "CANCELLED" ? "cancelled" : "failed");
      expect(transition.result).toMatchObject({ isError: true, structuredContent: report });
      if (state === "TECHNICAL_FAILED") expect(transition.error?.data).toMatchObject(report);
    },
  );
});

function operation(validateOutput: (value: unknown) => void): ValidatedOperation {
  return {
    validateOutput,
  } as unknown as ValidatedOperation;
}

function snapshot(state: string, result: Record<string, unknown>): ExecutionSnapshot {
  return {
    taskId: "task",
    externalExecutionId: "execution",
    operationName: "operation",
    argumentHash: "a".repeat(64),
    state,
    revision: 1,
    reasonCode: state,
    message: state,
    retryable: false,
    result: jsonToProtoStruct(result),
  };
}
