import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthorizationContext } from "../../domain/src/index.js";

export interface IdempotencyInput {
  authorization: AuthorizationContext;
  operationName: string;
  idempotencyKey: string;
  argumentHash: string;
}

export type StoredInvocation =
  { kind: "task"; taskId: string } | { kind: "result"; result: Record<string, unknown> };

interface IdempotencyRow {
  argument_hash: string;
  stable_task_id: string;
  state: "PENDING" | "COMPLETE";
  task_id: string | null;
  synchronous_result: Record<string, unknown> | null;
  lease_owner: string | null;
  lease_expired: boolean;
}

export interface IdempotencyRepositoryOptions {
  leaseMs?: number;
  waitTimeoutMs?: number;
  pollMs?: number;
}

type ClaimResult =
  | { kind: "claimed"; stableTaskId: string; recovering: boolean; duplicate: boolean }
  | { kind: "complete"; outcome: StoredInvocation; duplicate: boolean }
  | { kind: "wait"; duplicate: true };

export class IdempotencyRepository {
  readonly #leaseMs: number;
  readonly #waitTimeoutMs: number;
  readonly #pollMs: number;

  constructor(
    readonly pool: Pool,
    readonly onHit: () => void = () => undefined,
    options: IdempotencyRepositoryOptions = {},
  ) {
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.#waitTimeoutMs = options.waitTimeoutMs ?? 10_000;
    this.#pollMs = options.pollMs ?? 20;
  }

  async execute(
    input: IdempotencyInput,
    invoke: (stableTaskId: string, recovering: boolean) => Promise<StoredInvocation>,
  ): Promise<StoredInvocation> {
    const owner = randomUUID();
    const waitUntil = Date.now() + this.#waitTimeoutMs;
    let hitRecorded = false;

    for (;;) {
      const claim = await this.#claim(input, owner);
      if (claim.duplicate && !hitRecorded) {
        this.onHit();
        hitRecorded = true;
      }
      if (claim.kind === "complete") return claim.outcome;
      if (claim.kind === "wait") {
        if (Date.now() >= waitUntil) throw new Error("IDEMPOTENCY_IN_PROGRESS");
        await delay(this.#pollMs);
        continue;
      }

      try {
        // The durable claim transaction and its PoolClient are closed before
        // this callback can issue an Adapter RPC or any other slow side effect.
        const outcome = await invoke(claim.stableTaskId, claim.recovering);
        return await this.#complete(input, owner, outcome);
      } catch (error) {
        await this.#abandon(input, owner).catch(() => undefined);
        throw error;
      }
    }
  }

  async #claim(input: IdempotencyInput, owner: string): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stableTaskId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO idempotency_record
          (authorization_context_hash, operation_name, idempotency_key,
           argument_hash, execution_mode, simulation_key, stable_task_id, state,
           lease_owner, lease_expires_at, claim_attempt)
         VALUES ($1,$2,$3,$6,$4,$5,$7,'PENDING',$8,
                 clock_timestamp() + ($9::bigint * interval '1 millisecond'),1)
         ON CONFLICT DO NOTHING`,
        [...keyValues(input), input.argumentHash, stableTaskId, owner, this.#leaseMs],
      );
      const row = await this.#find(client, input, true);
      if (row === undefined) throw new Error("IDEMPOTENCY_CLAIM_NOT_VISIBLE");
      if (row.argument_hash !== input.argumentHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");

      if (row.state === "COMPLETE") {
        await client.query("COMMIT");
        return { kind: "complete", outcome: completed(row), duplicate: true };
      }
      if ((inserted.rowCount ?? 0) === 1 || row.lease_owner === owner) {
        await client.query("COMMIT");
        return {
          kind: "claimed",
          stableTaskId: row.stable_task_id,
          recovering: false,
          duplicate: false,
        };
      }
      if (!row.lease_expired) {
        await client.query("COMMIT");
        return { kind: "wait", duplicate: true };
      }

      const claimed = await client.query<{ stable_task_id: string }>(
        `UPDATE idempotency_record
         SET lease_owner=$7,
             lease_expires_at=clock_timestamp() + ($8::bigint * interval '1 millisecond'),
             claim_attempt=claim_attempt + 1,
             updated_at=clock_timestamp()
         WHERE authorization_context_hash=$1 AND operation_name=$2
           AND idempotency_key=$3 AND execution_mode=$4 AND simulation_key=$5
           AND state='PENDING' AND lease_expires_at <= clock_timestamp()
           AND argument_hash=$6
         RETURNING stable_task_id`,
        [...keyValues(input), input.argumentHash, owner, this.#leaseMs],
      );
      await client.query("COMMIT");
      const recovered = claimed.rows[0];
      return recovered === undefined
        ? { kind: "wait", duplicate: true }
        : {
            kind: "claimed",
            stableTaskId: recovered.stable_task_id,
            recovering: true,
            duplicate: true,
          };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #complete(
    input: IdempotencyInput,
    owner: string,
    outcome: StoredInvocation,
  ): Promise<StoredInvocation> {
    const values = [
      ...keyValues(input),
      owner,
      outcome.kind === "task" ? outcome.taskId : null,
      outcome.kind === "result" ? JSON.stringify(outcome.result) : null,
    ];
    const updated = await this.pool.query(
      `UPDATE idempotency_record
       SET state='COMPLETE', task_id=$7, synchronous_result=$8::jsonb,
           lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
       WHERE authorization_context_hash=$1 AND operation_name=$2
         AND idempotency_key=$3 AND execution_mode=$4 AND simulation_key=$5
         AND state='PENDING' AND lease_owner=$6`,
      values,
    );
    if ((updated.rowCount ?? 0) === 1) return outcome;

    const row = await this.#find(this.pool, input, false);
    if (row?.state === "COMPLETE") return completed(row);
    throw new Error("IDEMPOTENCY_LEASE_LOST");
  }

  async #abandon(input: IdempotencyInput, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_record
       SET lease_expires_at=clock_timestamp(), updated_at=clock_timestamp()
       WHERE authorization_context_hash=$1 AND operation_name=$2
         AND idempotency_key=$3 AND execution_mode=$4 AND simulation_key=$5
         AND state='PENDING' AND lease_owner=$6`,
      [...keyValues(input), owner],
    );
  }

  async #find(
    queryable: Pick<Pool | PoolClient, "query">,
    input: IdempotencyInput,
    forUpdate: boolean,
  ): Promise<IdempotencyRow | undefined> {
    const result = await queryable.query<IdempotencyRow>(
      `SELECT argument_hash, stable_task_id, state, task_id, synchronous_result,
              lease_owner,
              COALESCE(lease_expires_at <= clock_timestamp(), false) AS lease_expired
       FROM idempotency_record
       WHERE authorization_context_hash=$1 AND operation_name=$2
         AND idempotency_key=$3 AND execution_mode=$4 AND simulation_key=$5
       ${forUpdate ? "FOR UPDATE" : ""}`,
      keyValues(input),
    );
    return result.rows[0];
  }
}

function completed(row: IdempotencyRow): StoredInvocation {
  if (row.task_id !== null) return { kind: "task", taskId: row.task_id };
  if (row.synchronous_result !== null) return { kind: "result", result: row.synchronous_result };
  throw new Error("INVALID_COMPLETED_IDEMPOTENCY_RECORD");
}

function keyValues(input: IdempotencyInput): unknown[] {
  return [
    input.authorization.hash,
    input.operationName,
    input.idempotencyKey,
    input.authorization.executionMode,
    input.authorization.simulationId ?? "",
  ];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
