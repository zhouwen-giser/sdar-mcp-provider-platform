import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext, TaskExecutionTiming } from "../../packages/domain/src/index.js";
import type {
  AdmissionIntentInput,
  AdmissionIntentRecord,
  IdempotencyInput,
  StoredInvocation,
} from "../../packages/persistence-postgres/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const taskId = "00000000-0000-4000-8000-000000000080";
const argumentsValue = { resourceId: "retry-fixture" };
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "simulation",
  simulationId: "wi080-unit",
  correlationId: "original-correlation",
};
const timing: TaskExecutionTiming = {
  start: {
    mode: "scheduled",
    scheduledAt: "2026-08-26T10:00:00.000Z",
    startToleranceMs: 30_000,
  },
  maxElapsedMs: 60_000,
};
const admission: AdmissionIntentRecord = {
  taskId,
  providerId: "wi080-provider",
  providerInstanceId: "original-owner",
  operationName: "durable_task",
  operationSnapshotId: "snapshot-1",
  authorization,
  arguments: argumentsValue,
  argumentHash: createHash("sha256").update(JSON.stringify(argumentsValue)).digest("hex"),
  acceptedAt: new Date("2026-08-26T09:00:00.000Z"),
  notBefore: new Date("2026-08-26T10:00:00.000Z"),
  latestStartAt: new Date("2026-08-26T10:00:30.000Z"),
  deadlineAt: new Date("2026-08-26T10:01:00.000Z"),
  ttlMs: 600_000,
  timing,
  reservationRef: "original-reservation",
  state: "PENDING",
};

// Repository/Adapter doubles exercise the real public engine retry callback;
// actual durable claims and SQL are covered by the dedicated PostgreSQL file.
function fixture(recovering: boolean, stored: AdmissionIntentRecord | null = null) {
  const operation = {
    name: "durable_task",
    execution: "TASK_ONLY",
    capabilities: { idempotency: true, scheduling: true, maxElapsed: true },
    validateArguments: vi.fn(),
  };
  const repository = {
    pool: {},
    createAdmissionIntent: vi.fn((input: AdmissionIntentInput) => {
      if (stored !== null) return Promise.resolve(false);
      stored = { ...input, state: "PENDING" };
      return Promise.resolve(true);
    }),
    getAdmission: vi.fn(() => Promise.resolve(stored)),
    getById: vi.fn().mockResolvedValue(null),
    publishScheduled: vi.fn().mockRejectedValue(new Error("SCHEDULED_PUBLICATION_REACHED")),
    markAdmissionUncertain: vi.fn(),
  };
  const gateway = {
    reconcileExecution: vi.fn().mockResolvedValue({ status: "NOT_FOUND" }),
    startOperation: vi.fn().mockRejectedValue(new Error("UNEXPECTED_ADAPTER_DISPATCH")),
  };
  const idempotency = {
    execute: (
      _input: IdempotencyInput,
      invoke: (id: string, isRecovery: boolean) => Promise<StoredInvocation>,
    ) => invoke(taskId, recovering),
  };
  const engine = new TaskEngine(
    { providerId: admission.providerId, operations: [operation] } as never,
    new Map([[operation.name, admission.operationSnapshotId]]),
    gateway as never,
    repository as never,
    "replacement-owner",
    idempotency as never,
    { now: () => new Date("2026-08-26T09:30:00.000Z") },
  );
  return { engine, operation, repository, gateway };
}

describe("WI080 public pending-idempotency retry", () => {
  it("rejects a missing durable intent before creating an owner or contacting the Adapter", async () => {
    const { engine, operation, repository, gateway } = fixture(true);
    await expect(
      engine.callFrozenOperation(operation as never, argumentsValue, authorization, "key"),
    ).rejects.toThrow("ADMISSION_INTENT_MISSING");
    expect(repository.createAdmissionIntent).not.toHaveBeenCalled();
    expect(gateway.reconcileExecution).not.toHaveBeenCalled();
    expect(gateway.startOperation).not.toHaveBeenCalled();
    expect(await repository.getAdmission()).toBeNull();
  });

  it("resumes the original scheduled intent, anchors and correlation when retry timing is omitted", async () => {
    const { engine, operation, repository, gateway } = fixture(true, admission);
    await expect(
      engine.callFrozenOperation(
        operation as never,
        argumentsValue,
        { ...authorization, correlationId: "replacement-correlation" },
        "key",
      ),
    ).rejects.toThrow("SCHEDULED_PUBLICATION_REACHED");
    expect(repository.createAdmissionIntent).not.toHaveBeenCalled();
    expect(repository.publishScheduled).toHaveBeenCalledWith(admission);
    expect(gateway.reconcileExecution).toHaveBeenCalledWith(
      taskId,
      admission.operationName,
      admission.argumentHash,
      expect.objectContaining({ correlationId: "original-correlation" }),
    );
    expect(gateway.startOperation).not.toHaveBeenCalled();
  });

  it("still creates the current owner for a genuinely new scheduled admission", async () => {
    const { engine, operation, repository, gateway } = fixture(false);
    await expect(
      engine.callFrozenOperation(operation as never, argumentsValue, authorization, "new", timing),
    ).rejects.toThrow("SCHEDULED_PUBLICATION_REACHED");
    expect(repository.createAdmissionIntent).toHaveBeenCalledOnce();
    expect(repository.publishScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ providerInstanceId: "replacement-owner", timing }),
    );
    expect(gateway.reconcileExecution).not.toHaveBeenCalled();
    expect(gateway.startOperation).not.toHaveBeenCalled();
  });
});
