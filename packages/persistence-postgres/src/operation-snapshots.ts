import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  OperationRegistry,
  type ValidatedManifest,
  type ValidatedOperation,
} from "../../operation-registry/src/index.js";

export interface ResolvedTaskOperation {
  snapshotId: string;
  providerId: string;
  providerVersion: string;
  manifestHash: string;
  operation: ValidatedOperation;
}

export class OperationSnapshotRepository {
  constructor(readonly pool: Pool) {}

  async saveManifest(manifest: ValidatedManifest): Promise<Map<string, string>> {
    const client = await this.pool.connect();
    const snapshotIds = new Map<string, string>();
    try {
      await client.query("BEGIN");
      for (const operation of manifest.operations) {
        const saved = await client.query<{ snapshot_id: string }>(
          `INSERT INTO operation_snapshot
             (snapshot_id, provider_id, provider_version, operation_name, manifest_hash, definition)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (provider_id, provider_version, operation_name, manifest_hash)
           DO UPDATE SET definition = operation_snapshot.definition
           RETURNING snapshot_id`,
          [
            randomUUID(),
            manifest.providerId,
            manifest.providerVersion,
            operation.name,
            manifest.manifestHash,
            JSON.stringify(operation.definition),
          ],
        );
        const snapshotId = saved.rows[0]?.snapshot_id;
        if (snapshotId === undefined) throw new Error("OPERATION_SNAPSHOT_NOT_RETURNED");
        snapshotIds.set(operation.name, snapshotId);
      }
      await client.query("COMMIT");
      return snapshotIds;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadOperationSnapshot(snapshotId: string): Promise<ResolvedTaskOperation> {
    const result = await this.pool.query<{
      snapshot_id: string;
      provider_id: string;
      provider_version: string;
      operation_name: string;
      manifest_hash: string;
      definition: Record<string, unknown>;
    }>("SELECT * FROM operation_snapshot WHERE snapshot_id=$1", [snapshotId]);
    const row = result.rows[0];
    if (row === undefined) throw new Error("OPERATION_SNAPSHOT_NOT_FOUND");
    const operation = new OperationRegistry().validateStoredDefinition(row.definition, {
      providerId: row.provider_id,
      providerVersion: row.provider_version,
      manifestHash: row.manifest_hash,
    });
    if (operation.name !== row.operation_name) throw new Error("OPERATION_SNAPSHOT_NAME_MISMATCH");
    return {
      snapshotId: row.snapshot_id,
      providerId: row.provider_id,
      providerVersion: row.provider_version,
      manifestHash: row.manifest_hash,
      operation,
    };
  }
}
