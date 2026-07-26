import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  captureTaskOperationalEvent,
  insertCommittedTaskEvent,
  type TaskRepository,
} from "../../persistence-postgres/src/index.js";

export interface TtlCleanerTickResult {
  renewed: number;
  expired: number;
  purged: number;
  blocked: number;
}

export interface TtlCleanerOptions {
  batchSize?: number;
  purgeGraceMs?: number;
  recoveryLeaseMs?: number;
  onMetric?: (
    outcome: "renewed" | "expired" | "purged" | "blocked" | "error",
    amount?: number,
  ) => void;
  onEvent?: (event: "renew" | "expire" | "purge" | "blocked", amount: number) => void;
}

export class TtlCleaner {
  readonly #batchSize: number;
  readonly #purgeGraceMs: number;
  readonly #recoveryLeaseMs: number;
  readonly #onMetric: TtlCleanerOptions["onMetric"];
  readonly #onEvent: TtlCleanerOptions["onEvent"];

  constructor(
    readonly repository: TaskRepository,
    options: TtlCleanerOptions = {},
  ) {
    this.#batchSize = options.batchSize ?? 128;
    this.#purgeGraceMs = options.purgeGraceMs ?? 86_400_000;
    this.#recoveryLeaseMs = options.recoveryLeaseMs ?? 30_000;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1) {
      throw new RangeError("TTL_CLEANER_BATCH_SIZE_INVALID");
    }
    if (!Number.isInteger(this.#purgeGraceMs) || this.#purgeGraceMs < 1) {
      throw new RangeError("TTL_PURGE_GRACE_MS_INVALID");
    }
    if (!Number.isInteger(this.#recoveryLeaseMs) || this.#recoveryLeaseMs < 1) {
      throw new RangeError("RECOVERY_LEASE_MS_INVALID");
    }
    this.#onMetric = options.onMetric;
    this.#onEvent = options.onEvent;
  }

  async tick(now = new Date()): Promise<TtlCleanerTickResult> {
    const client = await this.repository.pool.connect();
    let purged = 0;
    let blocked = 0;
    try {
      await client.query("BEGIN");
      const renewed = await client.query<{ task_id: string }>(
        `WITH due AS (
           SELECT task_id FROM provider_task
           WHERE internal_state NOT LIKE 'TERMINAL_%'
             AND ttl_ms IS NOT NULL
             AND (handle_expires_at IS NULL OR handle_expires_at <= $1)
           ORDER BY handle_expires_at NULLS FIRST, task_id
           FOR UPDATE SKIP LOCKED LIMIT $2
         )
         UPDATE provider_task task
         SET handle_expires_at=$1 + (task.ttl_ms * interval '1 millisecond')
         FROM due WHERE task.task_id=due.task_id
         RETURNING task.task_id`,
        [now, this.#batchSize],
      );
      const expired = await client.query<{
        task_id: string;
        internal_state: string;
        substate: string | null;
        observation_revision: string;
        adapter_revision: string;
        external_execution_id: string | null;
        operation_name: string;
        execution_mode: string;
        simulation_id: string | null;
        argument_hash: string;
        authorization_context_hash: string;
        handle_expires_at: Date | null;
        purge_after: Date | null;
      }>(
        `WITH due AS (
           SELECT task_id FROM provider_task
           WHERE internal_state LIKE 'TERMINAL_%'
             AND expired_at IS NULL
             AND handle_expires_at IS NOT NULL
             AND handle_expires_at <= $1
           ORDER BY handle_expires_at, task_id
           FOR UPDATE SKIP LOCKED LIMIT $2
         )
         UPDATE provider_task task
         SET expired_at=$1,
             purge_after=$1 + ($3 * interval '1 millisecond')
         FROM due WHERE task.task_id=due.task_id
         RETURNING task.task_id, task.internal_state, task.substate,
           task.observation_revision, task.adapter_revision, task.external_execution_id,
           task.operation_name, task.execution_mode, task.simulation_id,
           task.argument_hash, task.authorization_context_hash,
           task.handle_expires_at, task.purge_after`,
        [now, this.#batchSize, this.#purgeGraceMs],
      );
      for (const row of expired.rows) {
        const eventKey = `${row.task_id}:expired`;
        await insertCommittedTaskEvent(
          client,
          row.task_id,
          "task.expired",
          {
            taskId: row.task_id,
            previousState: row.internal_state,
            currentState: "EXPIRED",
            previousSubstate: row.substate,
            currentSubstate: "expired",
            reasonCode: "TTL_EXPIRED",
            observationRevision: Number(row.observation_revision),
            adapterRevision: Number(row.adapter_revision),
            terminal: true,
            resultClass: "expired",
            externalExecutionId: row.external_execution_id,
            operationName: row.operation_name,
            executionMode: row.execution_mode,
            simulationId: row.simulation_id,
            argumentHash: row.argument_hash,
            authorizationContextHash: row.authorization_context_hash,
            expiredAt: now.toISOString(),
          },
          eventKey,
        );
        await captureTaskOperationalEvent(client, row.task_id, {
          recordType: "provider.ttl.lifecycle",
          eventType: "expire",
          eventIdentity: eventKey,
          occurredAt: now,
          payload: {
            event: "expire",
            taskId: row.task_id,
            previousExpiry: row.handle_expires_at?.toISOString() ?? null,
            newExpiry: null,
            purgeAfter: row.purge_after?.toISOString() ?? null,
            blockedReason: null,
          },
        });
      }
      const purgeDue = await client.query<{
        task_id: string;
        handle_expires_at: Date | null;
        purge_after: Date | null;
      }>(
        `SELECT task_id,handle_expires_at,purge_after
         FROM provider_task
         WHERE internal_state LIKE 'TERMINAL_%'
           AND expired_at IS NOT NULL
           AND purge_after <= $1
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_event outbox
             WHERE outbox.aggregate_id = provider_task.task_id
               AND outbox.published_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM task_command command
             WHERE command.task_id = provider_task.task_id
               AND command.state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT')
           )
           AND NOT EXISTS (
             SELECT 1
             FROM admission_intent admission
              WHERE admission.task_id = provider_task.task_id
                AND admission.state IN ('PENDING', 'ACCEPTED', 'UNCERTAIN')
             )
         ORDER BY purge_after, task_id
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, this.#batchSize],
      );
      for (const row of purgeDue.rows) {
        const lockOwner = await this.#acquireRecoveryLease(client, row.task_id);
        if (lockOwner === null) {
          blocked += 1;
          await captureTaskOperationalEvent(client, row.task_id, {
            recordType: "provider.ttl.lifecycle",
            eventType: "blocked",
            eventIdentity: `${row.task_id}:ttl-blocked:${row.purge_after?.toISOString() ?? now.toISOString()}`,
            occurredAt: now,
            payload: {
              event: "blocked",
              taskId: row.task_id,
              previousExpiry: row.handle_expires_at?.toISOString() ?? null,
              newExpiry: null,
              purgeAfter: row.purge_after?.toISOString() ?? null,
              blockedReason: "RECOVERY_LEASE_HELD",
            },
          });
          continue;
        }
        try {
          await client.query(
            `INSERT INTO provider_task_visibility_tombstone
               (provider_id, task_id, authorization_context_hash, execution_mode,
                simulation_id, resource_ref, terminal_at, retain_until)
             SELECT task.provider_id, task.task_id, task.authorization_context_hash,
                    task.execution_mode, task.simulation_id, binding.resource_ref,
                    task.terminal_at,
                    GREATEST(
                      COALESCE(binding.retain_until,
                        task.terminal_at + (1209960000 * interval '1 millisecond')),
                      $2
                    )
             FROM provider_task task
             LEFT JOIN provider_task_resource_binding binding
               ON binding.provider_id=task.provider_id AND binding.task_id=task.task_id
             WHERE task.task_id=$1 AND task.terminal_at IS NOT NULL
             ON CONFLICT (provider_id, task_id) DO UPDATE
               SET retain_until=GREATEST(
                 provider_task_visibility_tombstone.retain_until, EXCLUDED.retain_until
               )`,
            [row.task_id, now],
          );
          await captureTaskOperationalEvent(client, row.task_id, {
            recordType: "provider.ttl.lifecycle",
            eventType: "purge",
            eventIdentity: `${row.task_id}:ttl-purge:${row.purge_after?.toISOString() ?? now.toISOString()}`,
            occurredAt: now,
            payload: {
              event: "purge",
              taskId: row.task_id,
              previousExpiry: row.handle_expires_at?.toISOString() ?? null,
              newExpiry: null,
              purgeAfter: row.purge_after?.toISOString() ?? null,
              blockedReason: null,
            },
          });
          await client.query("DELETE FROM task_input_request WHERE task_id=$1", [row.task_id]);
          await client.query("DELETE FROM idempotency_record WHERE task_id=$1", [row.task_id]);
          await client.query("DELETE FROM task_command WHERE task_id=$1", [row.task_id]);
          await client.query("DELETE FROM admission_intent WHERE task_id=$1", [row.task_id]);
          await client.query("DELETE FROM provider_task WHERE task_id=$1", [row.task_id]);
          purged += 1;
        } finally {
          await this.#releaseRecoveryLease(client, row.task_id, lockOwner);
        }
      }
      await client.query(
        `DELETE FROM provider_task_resource_binding binding
         WHERE binding.retain_until <= $1
           AND NOT EXISTS (
             SELECT 1 FROM provider_business_event_relation relation
             JOIN provider_business_event event
               ON event.provider_id=relation.provider_id
              AND event.stream_id=relation.stream_id
              AND event.event_id=relation.event_id
             WHERE relation.provider_id=binding.provider_id
               AND relation.task_id=binding.task_id
               AND event.expires_at > $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM provider_business_event_relation_projection_item item
             JOIN provider_business_event_relation_projection projection
               ON projection.token_hash=item.token_hash
             WHERE item.task_id=binding.task_id AND projection.expires_at > $1
           )`,
        [now],
      );
      await client.query(
        `DELETE FROM provider_task_visibility_tombstone tombstone
         WHERE tombstone.retain_until <= $1
           AND NOT EXISTS (
             SELECT 1 FROM provider_business_event_relation relation
             JOIN provider_business_event event
               ON event.provider_id=relation.provider_id
              AND event.stream_id=relation.stream_id
              AND event.event_id=relation.event_id
             WHERE relation.provider_id=tombstone.provider_id
               AND relation.task_id=tombstone.task_id
               AND event.expires_at > $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM provider_business_event_relation_projection_item item
             JOIN provider_business_event_relation_projection projection
               ON projection.token_hash=item.token_hash
             WHERE item.task_id=tombstone.task_id AND projection.expires_at > $1
           )`,
        [now],
      );
      await client.query("COMMIT");
      const result = {
        renewed: renewed.rowCount ?? 0,
        expired: expired.rowCount ?? 0,
        purged,
        blocked,
      };
      if (result.renewed > 0) this.#onMetric?.("renewed", result.renewed);
      if (result.expired > 0) this.#onMetric?.("expired", result.expired);
      if (result.purged > 0) this.#onMetric?.("purged", result.purged);
      if (result.blocked > 0) this.#onMetric?.("blocked", result.blocked);
      this.#emit("renew", result.renewed);
      this.#emit("expire", result.expired);
      this.#emit("purge", result.purged);
      this.#emit("blocked", result.blocked);
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.#onMetric?.("error");
      throw error;
    } finally {
      client.release();
    }
  }

  #emit(event: "renew" | "expire" | "purge" | "blocked", amount: number): void {
    if (amount < 1) return;
    try {
      this.#onEvent?.(event, amount);
    } catch {
      // Operational telemetry must never alter TTL lifecycle outcomes.
    }
  }

  async #acquireRecoveryLease(client: PoolClient, taskId: string): Promise<string | null> {
    const leaseKey = `sdar-recovery:${taskId}`;
    const ownerId = randomUUID();
    const claimed = await client.query<{ owner_id: string }>(
      `INSERT INTO runtime_lease(lease_key, owner_id, fencing_token, expires_at)
       VALUES ($1,$2,1,clock_timestamp() + ($3::text || ' milliseconds')::interval)
       ON CONFLICT (lease_key) DO UPDATE SET
         owner_id=EXCLUDED.owner_id,
         fencing_token=runtime_lease.fencing_token+1,
         expires_at=EXCLUDED.expires_at,
         updated_at=clock_timestamp()
       WHERE runtime_lease.expires_at <= clock_timestamp()
       RETURNING owner_id`,
      [leaseKey, ownerId, this.#recoveryLeaseMs],
    );
    return claimed.rowCount === 1 ? (claimed.rows[0]?.owner_id ?? null) : null;
  }

  async #releaseRecoveryLease(client: PoolClient, taskId: string, ownerId: string): Promise<void> {
    await client.query("DELETE FROM runtime_lease WHERE lease_key=$1 AND owner_id=$2", [
      `sdar-recovery:${taskId}`,
      ownerId,
    ]);
  }
}
