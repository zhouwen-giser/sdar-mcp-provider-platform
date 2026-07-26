import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  OperationSnapshotRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

function manifest(): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "snapshot-provider",
    providerType: "test",
    providerVersion: "1.0.0",
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "snapshot_echo",
        description: "Snapshot test",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({ type: "object" }),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: false,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
});

afterAll(async () => {
  await pool.query("DROP TABLE IF EXISTS task_input_response_inbox CASCADE");
  await pool.end();
});

describe("PostgreSQL operation snapshots", () => {
  it("migrates an empty database and preserves immutable restart snapshots", async () => {
    await runMigrations(pool);
    const validated = new OperationRegistry().validate(manifest());
    const repository = new OperationSnapshotRepository(pool);
    await repository.saveManifest(validated);
    await runMigrations(pool);
    await repository.saveManifest(validated);

    const snapshots = await pool.query<{
      provider_id: string;
      operation_name: string;
      manifest_hash: string;
      definition: Record<string, unknown>;
    }>("SELECT provider_id, operation_name, manifest_hash, definition FROM operation_snapshot");
    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0]).toMatchObject({
      provider_id: "snapshot-provider",
      operation_name: "snapshot_echo",
      manifest_hash: validated.manifestHash,
    });
    expect(snapshots.rows[0]?.definition).toMatchObject({ name: "snapshot_echo" });
  });

  it("rejects modification of an applied migration", async () => {
    await pool.query(
      "UPDATE runtime_schema_migration SET checksum = repeat('0', 64) WHERE version = '001_operation_snapshot.sql'",
    );
    await expect(runMigrations(pool)).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH");
  });
});
