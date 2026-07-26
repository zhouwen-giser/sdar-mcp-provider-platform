import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../packages/domain/src/index.js";
import type { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import { RecoveryManager, type TaskEngine } from "../../packages/task-engine/src/index.js";

describe("H8 recovery fairness", () => {
  it("enumerates Tasks after uncertain admissions are recovered", async () => {
    const tasks: TaskRecord[] = [];
    const admission = {
      taskId: "recovered-admission",
      operationSnapshotId: "snapshot",
    };
    const repository = {
      listAdmissionsForRecovery: () => Promise.resolve([admission]),
      listTasksForRecovery: () => Promise.resolve(tasks),
      withRecoveryLock: <T>(_taskId: string, recover: () => Promise<T>) => recover(),
      getById: (taskId: string) =>
        Promise.resolve(tasks.find((task) => task.taskId === taskId) ?? null),
      noteRecoveryFailure: () => Promise.resolve(),
    };
    const engine = {
      resolveTaskOperation: () => Promise.resolve({ operation: {} }),
      recoverAdmission: () => {
        tasks.push(candidate("recovered-admission"));
        return Promise.resolve({ kind: "task" });
      },
      reconcileTask: () => Promise.resolve("found"),
    } as unknown as TaskEngine;

    const result = await new RecoveryManager(
      engine,
      repository as unknown as TaskRepository,
    ).scan();

    expect(result).toMatchObject({ admissionsRecovered: 1, tasksReconciled: 1 });
  });

  it("backs off a persistent failure without preventing a fresh candidate", async () => {
    const repository = new FairRecoveryRepository();
    const events: [string, number][] = [];
    const engine = {
      resolveTaskOperation: () => Promise.resolve({ operation: {} }),
      reconcileTask: (task: TaskRecord) =>
        Promise.resolve(task.taskId === "persistent" ? "deferred" : "found"),
    } as unknown as TaskEngine;
    const result = await new RecoveryManager(
      engine,
      repository as unknown as TaskRepository,
      undefined,
      undefined,
      (event, amount) => events.push([event, amount]),
    ).scan();

    expect(result).toMatchObject({ tasksReconciled: 1, deferred: 1 });
    expect(repository.failures).toEqual(["persistent"]);
    expect(repository.visited).toEqual(["persistent", "fresh"]);
    expect(events).toEqual([
      ["reconcile_start", 2],
      ["reconcile_success", 1],
      ["reconcile_failed", 1],
    ]);
  });

  it("selects only due Tasks in persisted fairness order", () => {
    const source = readFileSync("packages/persistence-postgres/src/tasks.ts", "utf8");
    expect(source).toContain("next_recovery_at <= clock_timestamp()");
    expect(source).toContain("ORDER BY next_recovery_at, last_reconciled_at NULLS FIRST, task_id");
  });
});

class FairRecoveryRepository {
  readonly failures: string[] = [];
  readonly visited: string[] = [];
  readonly tasks = [candidate("persistent"), candidate("fresh")];

  listAdmissionsForRecovery(): Promise<never[]> {
    return Promise.resolve([]);
  }
  listTasksForRecovery(): Promise<TaskRecord[]> {
    return Promise.resolve(this.tasks);
  }
  withRecoveryLock<T>(_taskId: string, recover: () => Promise<T>): Promise<T> {
    return recover();
  }
  getById(taskId: string): Promise<TaskRecord> {
    this.visited.push(taskId);
    const value = this.tasks.find((task) => task.taskId === taskId);
    if (value === undefined) throw new Error("TASK_NOT_FOUND");
    return Promise.resolve(value);
  }
  listPendingCommands(): Promise<never[]> {
    return Promise.resolve([]);
  }
  noteRecoveryFailure(taskId: string): Promise<void> {
    this.failures.push(taskId);
    return Promise.resolve();
  }
}

function candidate(taskId: string): TaskRecord {
  return {
    taskId,
    internalState: "RUNNING",
    operationSnapshotId: "snapshot",
  } as unknown as TaskRecord;
}
