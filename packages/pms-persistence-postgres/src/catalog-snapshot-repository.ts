import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  catalogChecksum,
  catalogDocument,
  diffCatalogSnapshots,
  type CatalogSnapshot,
  type CatalogSnapshotDiff,
  type CatalogSnapshotDocument,
  type CatalogSnapshotPublication,
  type CatalogSnapshotRepository,
  type PublishCatalogSnapshot,
} from "../../catalog-manager/src/index.js";
import { json } from "./shared.js";

interface CatalogSnapshotRow extends QueryResultRow {
  provider_id: string;
  revision: string;
  checksum: string;
  catalog_document: CatalogSnapshotDocument;
  discovered_at: Date;
  created_at: Date;
}

export class PostgresCatalogSnapshotRepository implements CatalogSnapshotRepository {
  constructor(private readonly db: Pool) {}

  async publish(input: PublishCatalogSnapshot): Promise<CatalogSnapshotPublication> {
    assertPublication(input);
    const document = catalogDocument(input.catalog);
    const checksum = catalogChecksum(document);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `catalog:${input.providerId}`,
      ]);
      const active = await this.#active(client, input.providerId);
      if (active?.checksum === checksum) {
        await client.query("COMMIT");
        return { created: false, snapshot: active };
      }
      const revisionResult = await client.query<{ revision: string }>(
        `SELECT COALESCE(MAX(revision),0)+1 AS revision
           FROM catalog_snapshot
          WHERE provider_id=$1`,
        [input.providerId],
      );
      const revision = Number(revisionResult.rows[0]?.revision);
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("CATALOG_REVISION_ALLOCATION_FAILED");
      }
      const inserted = await client.query<CatalogSnapshotRow>(
        `INSERT INTO catalog_snapshot(
           provider_id,revision,checksum,catalog_document,discovered_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5)
         RETURNING provider_id,revision,checksum,catalog_document,discovered_at,created_at`,
        [input.providerId, revision, checksum, json(document), input.discoveredAt],
      );
      await client.query(
        `INSERT INTO active_catalog_snapshot(provider_id,revision,checksum)
         VALUES ($1,$2,$3)
         ON CONFLICT (provider_id) DO UPDATE
           SET revision=EXCLUDED.revision,checksum=EXCLUDED.checksum,
               updated_at=clock_timestamp()`,
        [input.providerId, revision, checksum],
      );
      await appendAudit(client, input, revision, checksum);
      await client.query("COMMIT");
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("CATALOG_SNAPSHOT_INSERT_FAILED");
      return { created: true, snapshot: snapshotFromRow(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async active(providerId: string): Promise<CatalogSnapshot | null> {
    return this.#active(this.db, providerId);
  }

  async get(providerId: string, revision: number): Promise<CatalogSnapshot | null> {
    assertRevision(revision);
    const result = await this.db.query<CatalogSnapshotRow>(
      `SELECT provider_id,revision,checksum,catalog_document,discovered_at,created_at
         FROM catalog_snapshot
        WHERE provider_id=$1 AND revision=$2`,
      [providerId, revision],
    );
    return result.rows[0] === undefined ? null : snapshotFromRow(result.rows[0]);
  }

  async history(providerId: string, limit = 100): Promise<readonly CatalogSnapshot[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("CATALOG_HISTORY_LIMIT_INVALID");
    }
    const result = await this.db.query<CatalogSnapshotRow>(
      `SELECT provider_id,revision,checksum,catalog_document,discovered_at,created_at
         FROM catalog_snapshot
        WHERE provider_id=$1
        ORDER BY revision DESC
        LIMIT $2`,
      [providerId, limit],
    );
    return result.rows.map(snapshotFromRow);
  }

  async diff(
    providerId: string,
    fromRevision: number,
    toRevision: number,
  ): Promise<CatalogSnapshotDiff> {
    const [from, to] = await Promise.all([
      this.get(providerId, fromRevision),
      this.get(providerId, toRevision),
    ]);
    if (from === null || to === null) throw new Error("CATALOG_SNAPSHOT_NOT_FOUND");
    return diffCatalogSnapshots(from, to);
  }

  async #active(db: Pool | PoolClient, providerId: string): Promise<CatalogSnapshot | null> {
    const result = await db.query<CatalogSnapshotRow>(
      `SELECT snapshot.provider_id,snapshot.revision,snapshot.checksum,
              snapshot.catalog_document,snapshot.discovered_at,snapshot.created_at
         FROM active_catalog_snapshot active
         JOIN catalog_snapshot snapshot
           ON snapshot.provider_id=active.provider_id
          AND snapshot.revision=active.revision
        WHERE active.provider_id=$1`,
      [providerId],
    );
    return result.rows[0] === undefined ? null : snapshotFromRow(result.rows[0]);
  }
}

async function appendAudit(
  client: PoolClient,
  input: PublishCatalogSnapshot,
  revision: number,
  checksum: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit(
       audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
     ) VALUES ($1,'catalog.snapshot.published',$2,$3,'catalog_snapshot',$4,$5::jsonb)`,
    [
      randomUUID(),
      input.actorId,
      input.correlationId,
      `${input.providerId}:${String(revision)}`,
      json({ providerId: input.providerId, revision, checksum }),
    ],
  );
}

function snapshotFromRow(row: CatalogSnapshotRow): CatalogSnapshot {
  return Object.freeze({
    providerId: row.provider_id,
    revision: Number(row.revision),
    checksum: row.checksum,
    document: Object.freeze({
      ...row.catalog_document,
      tools: Object.freeze([...row.catalog_document.tools]),
    }),
    discoveredAt: new Date(row.discovered_at),
    createdAt: new Date(row.created_at),
  });
}

function assertPublication(input: PublishCatalogSnapshot): void {
  if (
    input.providerId.trim().length === 0 ||
    input.actorId.trim().length === 0 ||
    input.correlationId.trim().length === 0 ||
    Number.isNaN(input.discoveredAt.getTime())
  ) {
    throw new RangeError("CATALOG_PUBLICATION_INVALID");
  }
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RangeError("CATALOG_REVISION_INVALID");
  }
}
