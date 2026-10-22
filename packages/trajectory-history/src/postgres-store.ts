import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ReceptionEntrySchema,
  ReceptionReceiptSchema,
  ReceptionScopeSchema,
  type ReceptionEntry,
  type ReceptionReceipt,
  type ReceptionScope,
  type SignedHistoryManifest,
} from "./contract.js";
import { historyCanonicalJson, historySha256, receptionHash } from "./proof.js";
import { storageScope } from "../../gowm-shared-storage-adapter/src/scope.js";
import { readFileSync } from "node:fs";

export type ReceptionScopeIdentity = Omit<ReceptionScope, "streamId">;
export interface ReceptionStreamState {
  scope: ReceptionScope;
  highWatermark: string;
  capturedAt: string;
  genesisHash: string;
  headHash: string;
  prunedThrough: string;
  prunedHeadHash: string;
  captureFailureCount: number;
}
interface StreamRow {
  scope_payload: unknown;
  high_watermark: string;
  captured_at: string;
  genesis_hash: string;
  head_hash: string;
  pruned_through: string;
  pruned_head_hash: string;
  capture_failure_count: string;
}

const utcSql = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export class PostgresReceptionStore {
  #scope: ReceptionScope | undefined;
  #writerLeaseClient: PoolClient | undefined;
  readonly identityHash: string;
  constructor(
    readonly pool: Pool,
    readonly identity: ReceptionScopeIdentity,
  ) {
    this.identityHash = historySha256(historyCanonicalJson(identity));
  }
  get scope(): ReceptionScope {
    if (!this.#scope) throw Error("HISTORY_STORE_NOT_INITIALIZED");
    return this.#scope;
  }

  async initialize(): Promise<ReceptionStreamState> {
    const hosted = storageScope(this.pool);
    if (
      hosted &&
      (this.identity.deviceId !== hosted.allowedDeviceIds[0] ||
        this.identity.sourceSessionKey !== hosted.sourceSessionKey ||
        this.identity.bindingId !== hosted.bindingId ||
        this.identity.smppServiceKey !== hosted.serviceKey ||
        this.identity.deviceIdentityAuthority !== "GOWM_DEVICE_BINDING")
    )
      throw Error("HISTORY_HOSTED_POOL_SCOPE_MISMATCH");
    // Owner installation is an explicit deployment step. Startup performs no DDL.
    for (const table of [
      "ugv_trajectory_history_stream",
      "ugv_trajectory_history_session",
      "ugv_trajectory_history_reception",
      "ugv_trajectory_history_snapshot",
      "ugv_trajectory_projection_evidence",
    ]) {
      const installed = await this.pool.query<{ relation: string | null }>(
        "SELECT to_regclass($1)::text relation",
        [table],
      );
      if (!installed.rows[0]?.relation) throw Error("HISTORY_OWNER_SCHEMA_NOT_INSTALLED: " + table);
      if (hosted) {
        const protections = await this.pool.query<{
          nspname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          can_delete: boolean;
        }>(
          `SELECT n.nspname,c.relrowsecurity,c.relforcerowsecurity,
          has_table_privilege(current_user,c.oid,'DELETE') can_delete
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass($1)`,
          [table],
        );
        const row = protections.rows[0];
        if (
          row?.nspname !== "ugv_smpp" ||
          !row.relrowsecurity ||
          !row.relforcerowsecurity ||
          row.can_delete
        )
          throw Error("HISTORY_HOSTED_SCOPE_PROTECTION_REQUIRED");
      }
    }
    if (hosted) {
      const contract = JSON.parse(
        readFileSync("contracts/ugv-trajectory-history/v1/gowm-storage.json", "utf8"),
      ) as { installedSha256: string };
      const installed = await this.pool.query<{ checksum: string }>(
        "SELECT checksum FROM ugv_smpp.gowm_install_history WHERE family='UGV_PROVIDER' AND file='031_trajectory_reception_history.sql'",
      );
      if (installed.rows.length !== 1 || installed.rows[0]?.checksum !== contract.installedSha256)
        throw Error("HISTORY_HOSTED_OWNER_CHECKSUM_MISMATCH");
    }
    const candidate = ReceptionScopeSchema.parse({ ...this.identity, streamId: randomUUID() });
    const genesis = historySha256("SMPP_TRAJECTORY_GENESIS_V1\0" + this.identityHash);
    await this.pool.query(
      `INSERT INTO ugv_trajectory_history_stream
      (stream_id,scope_hash,scope_payload,genesis_hash,head_hash,pruned_head_hash)
      VALUES($1,$2,$3,$4,$4,$4) ON CONFLICT(scope_hash) DO NOTHING`,
      [candidate.streamId, this.identityHash, candidate, genesis],
    );
    const state = await this.state();
    this.#scope = state.scope;
    const { streamId: ignored, ...storedIdentity } = state.scope;
    void ignored;
    if (historyCanonicalJson(storedIdentity) !== historyCanonicalJson(this.identity))
      throw Error("HISTORY_STORE_SCOPE_CONFLICT");
    return state;
  }

  async state(client: Pick<Pool | PoolClient, "query"> = this.pool): Promise<ReceptionStreamState> {
    const result = await client.query<StreamRow>(
      `SELECT scope_payload,high_watermark::text,
      ${utcSql("captured_at")} captured_at,genesis_hash,head_hash,pruned_through::text,
      pruned_head_hash,capture_failure_count::text FROM ugv_trajectory_history_stream WHERE scope_hash=$1`,
      [this.identityHash],
    );
    const row = result.rows[0];
    if (!row) throw Error("HISTORY_STREAM_UNAVAILABLE");
    return {
      scope: ReceptionScopeSchema.parse(row.scope_payload),
      highWatermark: row.high_watermark,
      capturedAt: row.captured_at,
      genesisHash: row.genesis_hash,
      headHash: row.head_hash,
      prunedThrough: row.pruned_through,
      prunedHeadHash: row.pruned_head_hash,
      captureFailureCount: Number(row.capture_failure_count),
    };
  }

  async beginSession(): Promise<string> {
    if (this.#writerLeaseClient) throw Error("HISTORY_WRITER_SESSION_ALREADY_OPEN");
    if (this.pool.options.max < 2) throw Error("HISTORY_WRITER_POOL_MINIMUM_TWO_REQUIRED");
    const lease = await this.pool.connect();
    const acquired = await lease.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,718082)) acquired",
      [this.identityHash],
    );
    if (acquired.rows[0]?.acquired !== true) {
      lease.release();
      throw Error("HISTORY_WRITER_ALREADY_ACTIVE");
    }
    this.#writerLeaseClient = lease;
    const sessionId = randomUUID();
    try {
      await this.transaction(async (client) => {
        await client.query(
          `UPDATE ugv_trajectory_history_session SET state='UNCLEAN',closed_at=clock_timestamp()
        WHERE stream_id=$1 AND state='OPEN'`,
          [this.scope.streamId],
        );
        await client.query(
          `INSERT INTO ugv_trajectory_history_session(session_id,stream_id,state)
        VALUES($1,$2,'OPEN')`,
          [sessionId, this.scope.streamId],
        );
      });
    } catch (error) {
      await this.releaseWriterLease();
      throw error;
    }
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ugv_trajectory_history_session SET state='CLEAN_CLOSED',closed_at=clock_timestamp()
      WHERE session_id=$1 AND stream_id=$2 AND state='OPEN'`,
      [sessionId, this.scope.streamId],
    );
    await this.releaseWriterLease();
  }

  async releaseWriterLease(): Promise<void> {
    const lease = this.#writerLeaseClient;
    this.#writerLeaseClient = undefined;
    if (!lease) return;
    try {
      await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,718082))", [
        this.identityHash,
      ]);
      lease.release();
    } catch (error) {
      lease.release(true);
      throw error;
    }
  }
  async recordDisconnect(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ugv_trajectory_history_session SET disconnect_count=disconnect_count+1
      WHERE session_id=$1 AND stream_id=$2`,
      [sessionId, this.scope.streamId],
    );
  }
  async recordCaptureFailure(): Promise<void> {
    await this.pool.query(
      `UPDATE ugv_trajectory_history_stream SET capture_failure_count=capture_failure_count+1
      WHERE scope_hash=$1`,
      [this.identityHash],
    );
  }

  async append(input: ReceptionReceipt): Promise<ReceptionEntry> {
    const receipt = ReceptionReceiptSchema.parse(input);
    return this.transaction(async (client) => {
      const prior = await client.query<Record<string, unknown>>(
        `SELECT sequence::text,previous_hash,hash,receipt,
        ${utcSql("recorded_at")} recorded_at FROM ugv_trajectory_history_reception
        WHERE stream_id=$1 AND reception_id=$2`,
        [this.scope.streamId, receipt.receptionId],
      );
      if (prior.rows[0]) {
        if (historyCanonicalJson(prior.rows[0].receipt) !== historyCanonicalJson(receipt))
          throw Error("HISTORY_RECEPTION_ID_CONFLICT");
        return entry(prior.rows[0]);
      }
      const session = await client.query(
        `SELECT 1 FROM ugv_trajectory_history_session
        WHERE stream_id=$1 AND session_id=$2 AND state='OPEN'`,
        [this.scope.streamId, receipt.sessionId],
      );
      if (session.rowCount !== 1) throw Error("HISTORY_RECEPTION_SESSION_INVALID");
      const state = await this.state(client);
      const sequence = (BigInt(state.highWatermark) + 1n).toString();
      const time = await client.query<{ recorded_at: string }>(
        `SELECT ${utcSql("clock_timestamp()")} recorded_at`,
      );
      const timeRow = time.rows[0];
      if (!timeRow) throw Error("HISTORY_RECORDING_CLOCK_UNAVAILABLE");
      const recordedAt = timeRow.recorded_at;
      const hash = receptionHash(this.scope, sequence, state.headHash, receipt, recordedAt);
      await client.query(
        `INSERT INTO ugv_trajectory_history_reception
        (stream_id,sequence,reception_id,session_id,receipt,recorded_at,previous_hash,hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          this.scope.streamId,
          sequence,
          receipt.receptionId,
          receipt.sessionId,
          receipt,
          recordedAt,
          state.headHash,
          hash,
        ],
      );
      await client.query(
        `UPDATE ugv_trajectory_history_stream SET high_watermark=$2,head_hash=$3
        WHERE stream_id=$1`,
        [this.scope.streamId, sequence, hash],
      );
      return entry({
        sequence,
        previous_hash: state.headHash,
        hash,
        receipt,
        recorded_at: recordedAt,
      });
    });
  }

  async read(
    from: string,
    through: string,
    limit: number,
    client: Pick<Pool | PoolClient, "query"> = this.pool,
  ): Promise<ReceptionEntry[]> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT sequence::text,previous_hash,hash,receipt,
      ${utcSql("recorded_at")} recorded_at FROM ugv_trajectory_history_reception
      WHERE stream_id=$1 AND sequence >= $2 AND sequence <= $3 ORDER BY ugv_trajectory_history_reception.sequence LIMIT $4`,
      [this.scope.streamId, from, through, limit],
    );
    return result.rows.map(entry);
  }
  async count(
    from: string,
    through: string,
    client: Pick<Pool | PoolClient, "query"> = this.pool,
  ): Promise<string> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text count FROM ugv_trajectory_history_reception
      WHERE stream_id=$1 AND sequence >= $2 AND sequence <= $3`,
      [this.scope.streamId, from, through],
    );
    const count = result.rows[0]?.count;
    if (count === undefined) throw Error("HISTORY_RANGE_COUNT_UNAVAILABLE");
    return count;
  }
  async saveSnapshot(
    signed: SignedHistoryManifest,
    subjectHash: string,
    maxPageBytes: number,
    pageLimit: number,
    client: Pick<Pool | PoolClient, "query"> = this.pool,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ugv_trajectory_history_snapshot
      (snapshot_id,stream_id,subject_hash,signed_manifest,max_page_bytes,page_limit,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '7 days')`,
      [
        signed.manifest.snapshotId,
        this.scope.streamId,
        subjectHash,
        signed,
        maxPageBytes,
        pageLimit,
      ],
    );
  }
  async loadSnapshot(
    snapshotId: string,
    subjectHash: string,
    client: Pick<Pool | PoolClient, "query"> = this.pool,
  ): Promise<{
    signed: unknown;
    maxPageBytes: number;
    pageLimit: number;
  }> {
    const result = await client.query<{
      signed_manifest: unknown;
      max_page_bytes: number;
      page_limit: number;
    }>(
      `SELECT signed_manifest,max_page_bytes,page_limit
      FROM ugv_trajectory_history_snapshot WHERE snapshot_id=$1 AND stream_id=$2 AND subject_hash=$3
      AND expires_at>clock_timestamp()`,
      [snapshotId, this.scope.streamId, subjectHash],
    );
    const row = result.rows[0];
    if (!row) throw Error("HISTORY_SNAPSHOT_UNAVAILABLE_OR_UNAUTHORIZED");
    return {
      signed: row.signed_manifest,
      maxPageBytes: row.max_page_bytes,
      pageLimit: row.page_limit,
    };
  }
  async recovery(client: Pick<Pool | PoolClient, "query"> = this.pool): Promise<{
    uncleanSessionCount: number;
    disconnectCount: number;
    captureFailureCount: number;
  }> {
    const result = await client.query<{ unclean: string; disconnected: string }>(
      `SELECT count(*) FILTER(WHERE state='UNCLEAN')::text unclean,
      COALESCE(sum(disconnect_count),0)::text disconnected FROM ugv_trajectory_history_session WHERE stream_id=$1`,
      [this.scope.streamId],
    );
    const row = result.rows[0];
    if (!row) throw Error("HISTORY_RECOVERY_DIAGNOSTICS_UNAVAILABLE");
    return {
      uncleanSessionCount: Number(row.unclean),
      disconnectCount: Number(row.disconnected),
      captureFailureCount: (await this.state(client)).captureFailureCount,
    };
  }
  /** Serializes one bounded page/seal against append and explicit owner retention. */
  async fenced<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    // A disconnected reader must not hold the capture fence indefinitely while
    // counting a large retained range. A timeout fails the proof without trimming it.
    return this.transaction(action, true);
  }
  private async transaction<T>(
    action: (client: PoolClient) => Promise<T>,
    boundedRead = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (boundedRead) {
        await client.query("SET LOCAL lock_timeout='1000ms'");
        await client.query("SET LOCAL statement_timeout='5000ms'");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,718081))", [
        this.identityHash,
      ]);
      const value = await action(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function entry(row: Record<string, unknown>): ReceptionEntry {
  return ReceptionEntrySchema.parse({
    sequence: row.sequence,
    previousHash: row.previous_hash,
    hash: row.hash,
    receipt: row.receipt,
    recordedAt: row.recorded_at,
    recordingClockOwner: "POSTGRESQL_RECORD_INSERTION_CLOCK",
    recordingResolution: "MICROSECOND",
    exactTransactionCommittedAt: null,
  });
}
