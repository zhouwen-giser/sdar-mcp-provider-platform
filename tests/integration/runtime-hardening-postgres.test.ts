import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import {
  IdempotencyRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for H7 tests");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const authorization: AuthorizationContext = {
  hash: "7".repeat(64),
  executionMode: "live",
  simulationId: null,
};

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.query("DROP TABLE IF EXISTS task_input_response_inbox CASCADE");
  await pool.end();
});

describe("H7 PostgreSQL pool hardening", () => {
  it("T-044 releases the only PoolClient before waiting on a slow Adapter boundary", async () => {
    const repository = new IdempotencyRepository(pool, undefined, {
      leaseMs: 5_000,
      waitTimeoutMs: 2_000,
      pollMs: 10,
    });
    let releaseExternal!: () => void;
    const externalReleased = new Promise<void>((resolve) => {
      releaseExternal = resolve;
    });
    let markStarted!: (stableTaskId: string) => void;
    const externalStarted = new Promise<string>((resolve) => {
      markStarted = resolve;
    });

    const slowInvocation = repository.execute(input("slow-adapter"), async (stableTaskId) => {
      markStarted(stableTaskId);
      await externalReleased;
      return { kind: "result", result: { ok: true } };
    });
    const stableTaskId = await externalStarted;

    const ordinaryQuery = await Promise.race([
      pool.query<{ value: number }>("SELECT 1 AS value"),
      timeout(500, "ordinary query waited for the slow external call"),
    ]);
    expect(ordinaryQuery.rows[0]?.value).toBe(1);
    expect(pool.waitingCount).toBe(0);

    releaseExternal();
    await expect(slowInvocation).resolves.toEqual({ kind: "result", result: { ok: true } });
    const row = await pool.query<{
      state: string;
      stable_task_id: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
    }>(
      `SELECT state, stable_task_id, lease_owner, lease_expires_at
       FROM idempotency_record WHERE idempotency_key='slow-adapter'`,
    );
    expect(row.rows[0]).toMatchObject({
      state: "COMPLETE",
      stable_task_id: stableTaskId,
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("reclaims an abandoned lease with the same stable identity and recovery boundary", async () => {
    const repository = new IdempotencyRepository(pool, undefined, {
      leaseMs: 5_000,
      waitTimeoutMs: 2_000,
      pollMs: 10,
    });
    let firstStableTaskId = "";
    await expect(
      repository.execute(input("abandoned-adapter"), (stableTaskId) => {
        firstStableTaskId = stableTaskId;
        throw new Error("injected Adapter response loss");
      }),
    ).rejects.toThrow("injected Adapter response loss");

    await expect(
      repository.execute(input("abandoned-adapter"), (stableTaskId, recovering) => {
        expect(stableTaskId).toBe(firstStableTaskId);
        expect(recovering).toBe(true);
        return Promise.resolve({ kind: "result", result: { recovered: true } });
      }),
    ).resolves.toEqual({ kind: "result", result: { recovered: true } });
  });
});

function input(idempotencyKey: string) {
  return {
    authorization,
    operationName: "echo_sync",
    idempotencyKey,
    argumentHash: idempotencyKey.padEnd(64, "0").slice(0, 64),
  };
}

function timeout(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
