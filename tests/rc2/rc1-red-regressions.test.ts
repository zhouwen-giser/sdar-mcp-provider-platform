import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const engine = readFileSync("packages/task-engine/src/engine.ts", "utf8");
const scheduler = readFileSync("packages/task-engine/src/scheduler.ts", "utf8");
const recovery = readFileSync("packages/task-engine/src/recovery.ts", "utf8");
const tasks = readFileSync("packages/persistence-postgres/src/tasks.ts", "utf8");
const commandDispatcher = readFileSync("packages/task-engine/src/command-dispatcher.ts", "utf8");

function methodBody(source: string, methodName: string, nextMethodName: string): string {
  const start = source.indexOf(`async ${methodName}`);
  const end = source.indexOf(`async ${nextMethodName}`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Unable to locate ${methodName}`);
  return source.slice(start, end);
}

describe("rc.1 hardening red baseline", () => {
  it("T-029: returns a durable cancel acknowledgement without waiting for Adapter RPC", () => {
    const body = methodBody(engine, "cancelTask", "updateTask");
    expect(body).not.toContain("await this.gateway.requestCancel");
    expect(body).toContain("await this.#repository.beginCancel");
  });

  it("T-007: scans immediate tasks that exceed latestStartAt", () => {
    expect(scheduler).toContain("claimOverdueImmediateStarts");
    expect(tasks).toContain("START_WINDOW_MISSED");
    expect(tasks).toContain("actual_started_at IS NULL");
  });

  it("T-010: retries a scheduled retryable rejection inside the start window", () => {
    expect(scheduler).toContain("releaseScheduleRetry");
    expect(scheduler).toContain("invocationAttempt: task.invocationAttempt");
    expect(tasks).toContain("next_start_attempt_at");
    expect(methodBody(tasks, "claimDueScheduled", "completeDueStartWindowMisses")).toContain(
      "invocationAttempt: attempt",
    );
  });

  it("T-014: atomically appends an observation and outbox for a window miss", () => {
    const body = methodBody(tasks, "completeStartWindowMissed", "completeScheduledRejection");
    expect(body).toContain("transitionTask");
    expect(body).toContain("BEGIN");
    expect(tasks).toContain("observation_revision=observation_revision+1");
    expect(tasks).toContain("INSERT INTO task_observation");
    expect(tasks).toContain("INSERT INTO outbox_event");
  });

  it("T-017: recovery resolves an immutable operation snapshot instead of current Manifest", () => {
    expect(engine).toContain("loadOperationSnapshot");
    expect(recovery).toContain("ResolvedTaskOperation");
    expect(methodBody(engine, "recoverAdmission", "reconcileTask")).not.toContain(
      "this.manifest.operations",
    );
  });

  it("T-019/T-021: rejects Snapshot and command Ack identity mismatches", () => {
    expect(engine).toContain("validateAdapterSnapshotIdentity");
    expect([engine, commandDispatcher].join("")).toContain("validateCommandAckIdentity");
  });
});
