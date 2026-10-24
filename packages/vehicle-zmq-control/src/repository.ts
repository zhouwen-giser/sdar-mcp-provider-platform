import type { Pool, PoolClient } from "pg";
import type { PostgresProviderStore } from "../../provider-adapter-kit/src/postgres-store.js";
import type {
  ProviderStore,
  MutationJournalEntry,
  MutationJournalState,
} from "../../provider-adapter-kit/src/types.js";
import { isZmqExecution, type ControlScope, type ZmqExecution } from "./model.js";

export interface ControlRepository {
  readonly store: ProviderStore;
  start(): Promise<void>;
  assertWriter(): Promise<void>;
  get(taskId: string): Promise<ZmqExecution | undefined>;
  findCommand(commandId: string): Promise<ZmqExecution | undefined>;
  pending(): Promise<ZmqExecution[]>;
  nativeTaskUsed(component: string, nativeTaskId: string, exceptTaskId: string): Promise<boolean>;
  save(execution: ZmqExecution): Promise<void>;
  close(): Promise<void>;
}
/** Existing Provider JSONB + immutable dispatch journal; no frozen migration changes. */
export class PostgresControlRepository implements ControlRepository {
  #lease: PoolClient | undefined;
  #lost = true;
  #started = false;
  constructor(
    readonly store: PostgresProviderStore,
    readonly pool: Pool,
    readonly scope: ControlScope,
  ) {
    if (store.pool !== pool || store.gowm || store.tables.execution !== "ugv_execution")
      throw Error("ZMQ_CONTROL_STORE_BINDING_UNSUPPORTED");
    if (pool.totalCount && pool.options.query_timeout !== scope.settings.databaseTimeoutMs)
      throw Error("ZMQ_CONTROL_BOUNDED_DATABASE_POOL_REQUIRED");
    pool.options.query_timeout = scope.settings.databaseTimeoutMs;
    pool.options.statement_timeout = scope.settings.databaseTimeoutMs;
    pool.options.connectionTimeoutMillis = scope.settings.databaseTimeoutMs;
  }
  async start(): Promise<void> {
    if (this.#started) throw Error("ZMQ_CONTROL_REPOSITORY_ALREADY_STARTED");
    this.#started = true;
    const lease = await this.pool.connect();
    lease.on("error", () => {
      this.#lost = true;
    });
    try {
      for (const writerKey of this.scope.writerKeys) {
        const lock = await lease.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1,790025)) locked",
          [writerKey],
        );
        if (!lock.rows[0]?.locked) throw Error("ZMQ_CONTROL_WRITER_ALREADY_ACTIVE");
      }
      await lease.query("SELECT task_id FROM ugv_execution LIMIT 0");
      await lease.query("SELECT step_id FROM ugv_mutation_journal LIMIT 0");
      const predecessors = await lease.query(
        "SELECT 1 FROM ugv_execution WHERE payload->'zmqControl'->>'occupancy'='held' AND payload->'zmqControl'->>'scopeHash'<>$1 AND payload->'zmqControl'->'writerKeys' ?| $2::text[] LIMIT 1",
        [this.scope.hash, this.scope.writerKeys],
      );
      if (predecessors.rowCount) throw Error("ZMQ_UNRESOLVED_PREDECESSOR_SCOPE");
      this.#lease = lease;
      this.#lost = false;
    } catch (error) {
      lease.release(true);
      throw error;
    }
  }
  async assertWriter(): Promise<void> {
    if (this.#lost || !this.#lease) throw Error("ZMQ_CONTROL_WRITER_LOST");
    try {
      await this.#lease.query("SELECT 1");
    } catch {
      this.#lost = true;
      throw Error("ZMQ_CONTROL_WRITER_LOST");
    }
    if (this.lost()) throw Error("ZMQ_CONTROL_WRITER_LOST");
  }
  async get(taskId: string): Promise<ZmqExecution | undefined> {
    const e = await this.store.getExecution(taskId);
    return isZmqExecution(e) && e.zmqControl.scopeHash === this.scope.hash ? e : undefined;
  }
  async pending(): Promise<ZmqExecution[]> {
    const result = await this.pool.query<{ payload: ZmqExecution }>(
      "SELECT payload FROM ugv_execution WHERE payload->'zmqControl'->>'scopeHash'=$1 AND (payload->'zmqControl'->>'occupancy'='held' OR payload->'zmqControl'->>'stage'<>'terminal') ORDER BY created_at",
      [this.scope.hash],
    );
    return result.rows.map((row) => row.payload);
  }
  async findCommand(commandId: string): Promise<ZmqExecution | undefined> {
    const result = await this.pool.query<{ payload: ZmqExecution }>(
      "SELECT payload FROM ugv_execution WHERE payload->'zmqControl'->>'scopeHash'=$1 AND (payload->'zmqControl'->>'commandId'=$2 OR payload->'zmqControl'->'controls' @> $3::jsonb) LIMIT 1",
      [this.scope.hash, commandId, JSON.stringify([{ commandId }])],
    );
    return result.rows[0]?.payload;
  }
  async nativeTaskUsed(
    component: string,
    nativeTaskId: string,
    exceptTaskId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM ugv_execution WHERE task_id<>$1 AND payload->'zmqControl'->>'component'=$2 AND payload->'zmqControl'->>'nativeTaskId'=$3 LIMIT 1",
      [exceptTaskId, component, nativeTaskId],
    );
    return result.rowCount !== 0;
  }
  async save(e: ZmqExecution): Promise<void> {
    await this.assertWriter();
    if (e.zmqControl.scopeHash !== this.scope.hash) throw Error("ZMQ_EXECUTION_SCOPE_MISMATCH");
    const current = await this.store.getExecution(e.taskId);
    if (
      current &&
      (!isZmqExecution(current) ||
        current.zmqControl.scopeHash !== this.scope.hash ||
        current.zmqControl.requestHash !== e.zmqControl.requestHash)
    )
      throw Error("ZMQ_TASK_ID_CONFLICT");
    await this.store.putExecution(e);
  }
  private lost(): boolean {
    return this.#lost;
  }
  close(): Promise<void> {
    this.#lost = true;
    if (this.#lease) {
      const lease = this.#lease;
      this.#lease = undefined;
      lease.release(true);
    }
    return Promise.resolve();
  }
}
export function journalFor(
  e: ZmqExecution,
  step: ZmqExecution["zmqControl"]["commands"][number],
  hash: string,
): MutationJournalEntry {
  return {
    taskId: e.taskId,
    stepId: step.stepId,
    phase:
      step.action === "stop"
        ? "CANCEL"
        : step.action === "pause"
          ? "PAUSE"
          : step.action === "resume"
            ? "RESUME"
            : step.action === "configure" || step.action === "camera"
              ? "PRIMARY"
              : "FOLLOWUP",
    toolName: step.method,
    argumentHash: hash,
    state: "INTENT_PERSISTED",
    intentPersistedAt: step.createdAt,
  };
}
export const journalAdvance = (
  entry: MutationJournalEntry,
  state: MutationJournalState,
  at: string,
): MutationJournalEntry => ({
  ...entry,
  state,
  ...(state === "DISPATCHING" ? { dispatchedAt: at } : { completedAt: at }),
});
