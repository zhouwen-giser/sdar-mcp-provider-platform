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
} from "../../packages/task-engine/src/result-contract.js";

describe("H9 result contract hardening", () => {
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
