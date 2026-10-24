import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canonical, ObserverSettings, sha256, type ObserverIdentity } from "./config.js";
import {
  archiveEntryHash,
  decimal,
  gap,
  ObservationEvent,
  reconstructFrames,
  stamp,
  type ArchiveEntry,
  type ArchiveSession,
  type ObservationArchive,
} from "./model.js";

const sqlFile = new URL(
  "../../../deploy/ugv-zmq/migrations/001_observation_archive.sql",
  import.meta.url,
);
// Compiled files have the same repository-relative layout under dist/.
function migrationSource() {
  const original = fileURLToPath(sqlFile).replace(/\/dist\/deploy\//, "/deploy/");
  return readFileSync(original, "utf8");
}
const schemaName = (name: string) => `"${ObserverSettings.shape.schema.parse(name)}"`;
type Query = Pick<PoolClient, "query">;
interface SessionRow {
  session_id: string;
  partition_hash: string;
  started_at: Date;
  status: string;
  head_hash: string;
  genesis_hash: string;
  last_ordinal: string;
  failure_code: string | null;
}
interface EntryRow {
  ordinal: string;
  previous_hash: string;
  entry_hash: string;
  payload: unknown;
  canonical_bytes: number;
}

export async function installObservationArchive(
  pool: Pool,
  schema = "ugv_zmq_observation",
): Promise<void> {
  const name = schemaName(schema),
    source = migrationSource(),
    checksum = sha256(source),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,790024))", [schema]);
    const existing = await client.query<{ name: string | null }>(
      "SELECT to_regclass($1)::text name",
      [`${name}.install_history`],
    );
    if (existing.rows[0]?.name) {
      const history = await client.query<{ checksum: string }>(
        `SELECT checksum FROM ${name}.install_history WHERE version=1`,
      );
      if (history.rows[0]?.checksum !== checksum) throw Error("ZMQ_ARCHIVE_MIGRATION_DRIFT");
    } else {
      await client.query(source.replaceAll("{{schema}}", name));
      await client.query(`INSERT INTO ${name}.install_history(version,checksum) VALUES(1,$1)`, [
        checksum,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresObservationArchive implements ObservationArchive {
  readonly #name: string;
  #session: ArchiveSession | undefined;
  #lease: PoolClient | undefined;
  #leaseLost = false;
  #onFailure: ((code: string) => void) | undefined;
  setFailureHandler(handler: (code: string) => void): void {
    this.#onFailure = handler;
  }
  constructor(
    readonly pool: Pool,
    readonly scope: ObserverIdentity,
    readonly settings: ObserverSettings,
  ) {
    this.#name = schemaName(settings.schema);
  }
  async start(): Promise<ArchiveSession> {
    if (this.#session || this.#lease) throw Error("ZMQ_ARCHIVE_ALREADY_STARTED");
    this.#leaseLost = false;
    const installed = await this.pool
      .query<{ checksum: string }>(
        `SELECT checksum FROM ${this.#name}.install_history WHERE version=1`,
      )
      .catch(() => {
        throw Error("ZMQ_ARCHIVE_OWNER_INSTALL_REQUIRED");
      });
    if (installed.rows[0]?.checksum !== sha256(migrationSource()))
      throw Error("ZMQ_ARCHIVE_MIGRATION_DRIFT");
    const lease = await this.pool.connect();
    lease.on("error", () => {
      this.#leaseLost = true;
      this.#onFailure?.("ZMQ_ARCHIVE_WRITER_CONNECTION_LOST");
    });
    try {
      const locked = await lease.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,790025)) locked",
        [this.scope.partitionHash],
      );
      if (!locked.rows[0]?.locked) throw Error("ZMQ_ARCHIVE_WRITER_ALREADY_ACTIVE");
      this.#lease = lease;
      const sessionId = randomUUID(),
        startedAt = new Date().toISOString();
      const genesisHash = sha256(
        `SMPP_ZMQ_ARCHIVE_GENESIS_V2\0${this.scope.partitionHash}\0${sessionId}`,
      );
      await this.transaction(async (client) => {
        await client.query(
          `INSERT INTO ${this.#name}.archive_partition(partition_hash,identity) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [this.scope.partitionHash, this.scope.identity],
        );
        const partition = await client.query<{ identity: unknown }>(
          `SELECT identity FROM ${this.#name}.archive_partition WHERE partition_hash=$1 FOR UPDATE`,
          [this.scope.partitionHash],
        );
        if (canonical(partition.rows[0]?.identity) !== canonical(this.scope.identity))
          throw Error("ZMQ_ARCHIVE_IDENTITY_CONFLICT");
        const predecessors = await client.query<SessionRow>(
          `SELECT * FROM ${this.#name}.archive_session WHERE partition_hash=$1 AND status='open' FOR UPDATE`,
          [this.scope.partitionHash],
        );
        for (const predecessor of predecessors.rows) {
          await this.insertEvents(client, predecessor, [
            gap(stamp(`recovery:${sessionId}`), "UNCLEAN_RECEIVER_SESSION_PREDECESSOR"),
          ]);
          await client.query(
            `UPDATE ${this.#name}.archive_session SET status='abandoned',ended_at=clock_timestamp(),failure_code='UNCLEAN_RECEIVER_SESSION_PREDECESSOR' WHERE session_id=$1`,
            [predecessor.session_id],
          );
        }
        await client.query(
          `INSERT INTO ${this.#name}.archive_session(session_id,partition_hash,started_at,status,genesis_hash,head_hash) VALUES($1,$2,$3,'open',$4,$4)`,
          [sessionId, this.scope.partitionHash, startedAt, genesisHash],
        );
        await client.query(
          `UPDATE ${this.#name}.archive_partition SET active_session=$2 WHERE partition_hash=$1`,
          [this.scope.partitionHash, sessionId],
        );
      });
      this.#session = {
        sessionId,
        partitionHash: this.scope.partitionHash,
        startedAt,
        genesisHash,
      };
      return this.#session;
    } catch (error) {
      if (this.#lease) await this.releaseLease();
      else lease.release();
      throw error;
    }
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
        [String(this.settings.databaseTimeoutMs)],
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async lockActiveSession(client: Query) {
    if (!this.#session || !this.#lease || this.#leaseLost)
      throw Error("ZMQ_ARCHIVE_WRITER_UNAVAILABLE");
    const partition = await client.query<{
      active_session: string | null;
      canonical_bytes: string;
    }>(
      `SELECT active_session,canonical_bytes FROM ${this.#name}.archive_partition WHERE partition_hash=$1 FOR UPDATE`,
      [this.scope.partitionHash],
    );
    if (partition.rows[0]?.active_session !== this.#session.sessionId)
      throw Error("ZMQ_ARCHIVE_WRITER_FENCED");
    const result = await client.query<SessionRow>(
      `SELECT * FROM ${this.#name}.archive_session WHERE session_id=$1 AND status='open' FOR UPDATE`,
      [this.#session.sessionId],
    );
    const session = result.rows[0];
    if (!session) throw Error("ZMQ_ARCHIVE_SESSION_NOT_OPEN");
    return { session, usedBytes: BigInt(partition.rows[0].canonical_bytes) };
  }
  async append(events: readonly ObservationEvent[]): Promise<ArchiveEntry[]> {
    if (events.length === 0 || events.length > this.settings.maxBatchRecords)
      throw Error("ZMQ_ARCHIVE_BATCH_COUNT_INVALID");
    const parsed = events.map((e) => ObservationEvent.parse(e));
    const bytes = parsed.reduce((sum, e) => sum + Buffer.byteLength(canonical(e)), 0);
    if (bytes > this.settings.maxBatchBytes && events.length > 1)
      throw Error("ZMQ_ARCHIVE_BATCH_BYTES_INVALID");
    return this.transaction(async (client) => {
      const locked = await this.lockActiveSession(client);
      if (locked.usedBytes + BigInt(bytes) > BigInt(this.settings.maxArchivePayloadBytes))
        throw Error("ZMQ_ARCHIVE_PAYLOAD_BUDGET_EXHAUSTED");
      const entries = await this.insertEvents(client, locked.session, parsed);
      if (this.#leaseLost) throw Error("ZMQ_ARCHIVE_WRITER_UNAVAILABLE");
      return entries;
    });
  }
  private async insertEvents(
    client: Query,
    session: SessionRow,
    events: readonly ObservationEvent[],
  ): Promise<ArchiveEntry[]> {
    let ordinal = BigInt(session.last_ordinal),
      previousHash = session.head_hash,
      bytes = 0;
    const entries: ArchiveEntry[] = [];
    for (const payload of events) {
      const size = Buffer.byteLength(canonical(payload));
      if (size > 2_097_152) throw Error("ZMQ_ARCHIVE_EVENT_SIZE_INVALID");
      const index = (++ordinal).toString(),
        entryHash = archiveEntryHash(previousHash, index, payload);
      entries.push({ ordinal: index, previousHash, entryHash, payload });
      bytes += size;
      previousHash = entryHash;
    }
    await client.query(
      `INSERT INTO ${this.#name}.archive_entry(session_id,ordinal,event_id,previous_hash,entry_hash,canonical_bytes,payload)
      SELECT $1,(r->>'ordinal')::bigint,(r->'payload'->>'eventId')::uuid,r->>'previousHash',r->>'entryHash',(r->>'size')::integer,r->'payload'
      FROM jsonb_array_elements($2::jsonb) r`,
      [
        session.session_id,
        JSON.stringify(
          entries.map((e) => ({ ...e, size: Buffer.byteLength(canonical(e.payload)) })),
        ),
      ],
    );
    await client.query(
      `UPDATE ${this.#name}.archive_session SET last_ordinal=$2,head_hash=$3 WHERE session_id=$1`,
      [session.session_id, ordinal.toString(), previousHash],
    );
    await client.query(
      `UPDATE ${this.#name}.archive_partition SET canonical_bytes=canonical_bytes+$2,entry_count=entry_count+$3 WHERE partition_hash=$1`,
      [session.partition_hash, bytes, entries.length],
    );
    return entries;
  }
  async fail(code: string, locallyDiscardedMessages: number): Promise<void> {
    if (!this.#session) return;
    await this.transaction(async (client) => {
      const { session } = await this.lockActiveSession(client);
      // One reserved failure marker may exceed the payload budget; raw data is never pruned.
      await this.insertEvents(client, session, [
        gap(
          stamp(`archive:${this.#session?.sessionId ?? "unknown"}`),
          code,
          null,
          locallyDiscardedMessages,
        ),
      ]);
      await client.query(
        `UPDATE ${this.#name}.archive_session SET status='failed',failure_code=$2,ended_at=clock_timestamp() WHERE session_id=$1`,
        [session.session_id, code],
      );
    });
  }
  async close(): Promise<void> {
    try {
      if (this.#session && !this.#leaseLost)
        await this.transaction(async (client) => {
          await client.query(
            `UPDATE ${this.#name}.archive_session SET status='closed',ended_at=clock_timestamp() WHERE session_id=$1 AND status='open'`,
            [this.#session?.sessionId],
          );
          await client.query(
            `UPDATE ${this.#name}.archive_partition SET active_session=NULL WHERE partition_hash=$1 AND active_session=$2`,
            [this.scope.partitionHash, this.#session?.sessionId],
          );
        });
    } finally {
      await this.releaseLease();
      this.#session = undefined;
    }
  }
  private async releaseLease() {
    const lease = this.#lease;
    this.#lease = undefined;
    if (!lease) return;
    try {
      if (!this.#leaseLost)
        await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,790025))", [
          this.scope.partitionHash,
        ]);
    } finally {
      lease.release(this.#leaseLost);
    }
  }
  async sessions(limit = 50) {
    z.number().int().min(1).max(100).parse(limit);
    const rows = await this.pool.query<SessionRow>(
      `SELECT * FROM ${this.#name}.archive_session WHERE partition_hash=$1 ORDER BY started_at DESC,session_id DESC LIMIT $2`,
      [this.scope.partitionHash, limit],
    );
    return rows.rows.map((r) => ({
      sessionId: r.session_id,
      startedAt: r.started_at.toISOString(),
      status: r.status,
      lastOrdinal: r.last_ordinal,
      headHash: r.head_hash,
      genesisHash: r.genesis_hash,
      failureCode: r.failure_code,
    }));
  }
  async storage() {
    const counters = await this.pool.query<{ canonical_bytes: string; entry_count: string }>(
      `SELECT canonical_bytes,entry_count FROM ${this.#name}.archive_partition WHERE partition_hash=$1`,
      [this.scope.partitionHash],
    );
    const physical = await this.pool.query<{ bytes: string }>(
      "SELECT COALESCE(SUM(pg_total_relation_size(c.oid)),0)::text bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'",
      [this.settings.schema],
    );
    return {
      partitionHash: this.scope.partitionHash,
      usedCanonicalPayloadBytes: counters.rows[0]?.canonical_bytes ?? "0",
      payloadBudgetBytes: String(this.settings.maxArchivePayloadBytes),
      entryCount: counters.rows[0]?.entry_count ?? "0",
      schemaPhysicalBytes: physical.rows[0]?.bytes ?? "0",
      physicalMeasurementScope: "entire_observer_schema_including_other_partitions",
      retentionPolicy: "append_only_no_automatic_pruning",
      upstreamLossCount: null,
    };
  }
  async page(sessionId: string, after = "0", limit = 100) {
    z.uuid().parse(sessionId);
    decimal.parse(after);
    z.number().int().min(1).max(200).parse(limit);
    const sessionResult = await this.pool.query<SessionRow>(
      `SELECT * FROM ${this.#name}.archive_session WHERE session_id=$1 AND partition_hash=$2`,
      [sessionId, this.scope.partitionHash],
    );
    const session = sessionResult.rows[0];
    if (!session) throw Error("ZMQ_ARCHIVE_SESSION_NOT_FOUND");
    if (BigInt(after) > BigInt(session.last_ordinal)) throw Error("ZMQ_ARCHIVE_CURSOR_NOT_FOUND");
    let anchor = session.genesis_hash;
    if (after !== "0") {
      const previous = await this.pool.query<{ entry_hash: string }>(
        `SELECT entry_hash FROM ${this.#name}.archive_entry WHERE session_id=$1 AND ordinal=$2`,
        [sessionId, after],
      );
      if (!previous.rows[0]) throw Error("ZMQ_ARCHIVE_CURSOR_NOT_FOUND");
      anchor = previous.rows[0].entry_hash;
    }
    const result = await this.pool.query<EntryRow>(
      `SELECT ordinal,previous_hash,entry_hash,payload,canonical_bytes FROM ${this.#name}.archive_entry WHERE session_id=$1 AND ordinal>$2 AND ordinal<=$4 ORDER BY ordinal LIMIT $3`,
      [sessionId, after, limit + 1, session.last_ordinal],
    );
    let expected = BigInt(after),
      previous = anchor,
      bytes = 0;
    const entries: ArchiveEntry[] = [];
    for (const row of result.rows) {
      if (
        entries.length >= limit ||
        (entries.length > 0 && bytes + row.canonical_bytes > 1_048_576)
      )
        break;
      const payload = ObservationEvent.parse(row.payload);
      if (
        row.ordinal !== (++expected).toString() ||
        row.previous_hash !== previous ||
        row.entry_hash !== archiveEntryHash(previous, row.ordinal, payload)
      )
        throw Error("ZMQ_ARCHIVE_CHAIN_INTEGRITY_FAILED");
      if (payload.type === "reception" && payload.rawComplete) reconstructFrames(payload);
      entries.push({
        ordinal: row.ordinal,
        previousHash: row.previous_hash,
        entryHash: row.entry_hash,
        payload,
      });
      previous = row.entry_hash;
      bytes += row.canonical_bytes;
    }
    const last = entries.at(-1)?.ordinal ?? after;
    return {
      schemaVersion: "ugv.zmq-observation-page/2.0",
      partitionHash: this.scope.partitionHash,
      sessionId,
      anchorHash: anchor,
      entries,
      nextCursor: BigInt(last) < BigInt(session.last_ordinal) ? last : null,
      sessionHeadHash: session.head_hash,
      proof: "local_hash_chain_unsigned",
      sourceContinuity: "unverified",
    };
  }
  async raw(sessionId: string, ordinal: string) {
    decimal.parse(ordinal);
    if (ordinal === "0") throw Error("ZMQ_ARCHIVE_RECEPTION_NOT_FOUND");
    const page = await this.page(sessionId, (BigInt(ordinal) - 1n).toString(), 1);
    const entry = page.entries[0];
    if (entry?.ordinal !== ordinal || entry.payload.type !== "reception")
      throw Error("ZMQ_ARCHIVE_RECEPTION_NOT_FOUND");
    reconstructFrames(entry.payload);
    return {
      sessionId,
      ordinal,
      entryHash: entry.entryHash,
      multipartSha256: entry.payload.multipartSha256,
      frames: entry.payload.frames,
      proof: "local_hash_chain_unsigned",
    };
  }
}
