import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { canonicalize } from "../../catalog-manager/src/index.js";
import {
  diffRegistrySnapshots,
  type PublishRegistrySnapshot,
  type RegistrySnapshot,
  type RegistrySnapshotDiff,
  type RegistrySnapshotDocument,
  type RegistrySnapshotPublication,
  type RegistrySnapshotRepository,
} from "../../registry-snapshot/src/index.js";
import { json } from "./shared.js";

interface RegistrySnapshotRow extends QueryResultRow {
  environment: string;
  revision: string;
  checksum: string;
  registry_document: RegistrySnapshotDocument;
  published_at: Date;
  created_at: Date;
}

export class PostgresRegistrySnapshotRepository implements RegistrySnapshotRepository {
  constructor(private readonly db: Pool) {}

  async publish(input: PublishRegistrySnapshot): Promise<RegistrySnapshotPublication> {
    assertPublication(input);
    if (
      canonicalize(input.candidate.document) !== input.candidate.canonicalJson ||
      createHash("sha256").update(input.candidate.canonicalJson).digest("hex") !==
        input.candidate.checksum ||
      input.candidate.document.environment.trim().length === 0
    ) {
      throw new Error("REGISTRY_CANDIDATE_INTEGRITY_INVALID");
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `registry:${input.candidate.document.environment}`,
      ]);
      const revisionResult = await client.query<{ revision: string }>(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision
           FROM registry_snapshot
          WHERE environment=$1`,
        [input.candidate.document.environment],
      );
      const revision = Number(revisionResult.rows[0]?.revision);
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("REGISTRY_REVISION_ALLOCATION_FAILED");
      }
      const inserted = await client.query<RegistrySnapshotRow>(
        `INSERT INTO registry_snapshot(
           environment,revision,checksum,registry_document,published_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5)
         RETURNING environment,revision,checksum,registry_document,published_at,created_at`,
        [
          input.candidate.document.environment,
          revision,
          input.candidate.checksum,
          json(input.candidate.document),
          input.publishedAt,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("REGISTRY_SNAPSHOT_INSERT_FAILED");
      await activateSnapshot(client, snapshotFromRow(row));
      await appendAudit(client, input, revision, "registry.snapshot.published");
      await client.query("COMMIT");
      return { created: true, snapshot: snapshotFromRow(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async latest(environment: string): Promise<RegistrySnapshot | null> {
    return this.#latest(this.db, environment);
  }

  async get(environment: string, revision: number): Promise<RegistrySnapshot | null> {
    assertRevision(revision);
    const result = await this.db.query<RegistrySnapshotRow>(
      `SELECT environment,revision,checksum,registry_document,published_at,created_at
         FROM registry_snapshot
        WHERE environment=$1 AND revision=$2`,
      [environment, revision],
    );
    return result.rows[0] === undefined ? null : snapshotFromRow(result.rows[0]);
  }

  async history(environment: string, limit = 100): Promise<readonly RegistrySnapshot[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("REGISTRY_HISTORY_LIMIT_INVALID");
    }
    const result = await this.db.query<RegistrySnapshotRow>(
      `SELECT environment,revision,checksum,registry_document,published_at,created_at
         FROM registry_snapshot
        WHERE environment=$1
        ORDER BY revision DESC
        LIMIT $2`,
      [environment, limit],
    );
    return result.rows.map(snapshotFromRow);
  }

  async diff(
    environment: string,
    fromRevision: number,
    toRevision: number,
  ): Promise<RegistrySnapshotDiff> {
    const [from, to] = await Promise.all([
      this.get(environment, fromRevision),
      this.get(environment, toRevision),
    ]);
    if (from === null || to === null) throw new Error("REGISTRY_SNAPSHOT_NOT_FOUND");
    return diffRegistrySnapshots(from, to);
  }

  async #latest(db: Pool | PoolClient, environment: string): Promise<RegistrySnapshot | null> {
    const result = await db.query<RegistrySnapshotRow>(
      `SELECT snapshot.environment,snapshot.revision,snapshot.checksum,
              snapshot.registry_document,snapshot.published_at,snapshot.created_at
         FROM active_registry_snapshot active
         JOIN registry_snapshot snapshot
           ON snapshot.environment=active.environment
          AND snapshot.revision=active.revision
        WHERE active.environment=$1`,
      [environment],
    );
    return result.rows[0] === undefined ? null : snapshotFromRow(result.rows[0]);
  }
}

async function appendAudit(
  client: PoolClient,
  input: PublishRegistrySnapshot,
  revision: number,
  action: "registry.snapshot.published",
): Promise<void> {
  const environment = input.candidate.document.environment;
  await client.query(
    `INSERT INTO audit(
       audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
     ) VALUES ($1,$2,$3,$4,'registry_snapshot',$5,$6::jsonb)`,
    [
      randomUUID(),
      action,
      input.actorId,
      input.correlationId,
      `${environment}:${String(revision)}`,
      json({ environment, revision, checksum: input.candidate.checksum }),
    ],
  );
}

async function activateSnapshot(client: PoolClient, snapshot: RegistrySnapshot): Promise<void> {
  await client.query(
    `INSERT INTO active_registry_snapshot(environment,revision,checksum)
     VALUES ($1,$2,$3)
     ON CONFLICT (environment) DO UPDATE
       SET revision=EXCLUDED.revision,checksum=EXCLUDED.checksum,
           updated_at=clock_timestamp()`,
    [snapshot.environment, snapshot.revision, snapshot.checksum],
  );
}

function snapshotFromRow(row: RegistrySnapshotRow): RegistrySnapshot {
  return Object.freeze({
    environment: row.environment,
    revision: Number(row.revision),
    checksum: row.checksum,
    document: Object.freeze({
      ...row.registry_document,
      providers: Object.freeze([...row.registry_document.providers]),
    }),
    publishedAt: new Date(row.published_at),
    createdAt: new Date(row.created_at),
  });
}

function assertPublication(input: PublishRegistrySnapshot): void {
  if (
    input.actorId.trim().length === 0 ||
    input.correlationId.trim().length === 0 ||
    Number.isNaN(input.publishedAt.getTime())
  ) {
    throw new RangeError("REGISTRY_PUBLICATION_INVALID");
  }
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RangeError("REGISTRY_REVISION_INVALID");
  }
}
