import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProviderPackageRegistry } from "../../provider-package-registry/src/index.js";
import {
  PostgresPmsUnitOfWork,
  runPmsMigrations,
} from "../../pms-persistence-postgres/src/index.js";
import { ProviderPackageSynchronizer, synchronizeWorkspaceProviderPackages } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("Provider Package PMS projection", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_package_sync_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let unitOfWork: PostgresPmsUnitOfWork;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    unitOfWork = new PostgresPmsUnitOfWork(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("imports all four controlled packages atomically", async () => {
    const result = await synchronizeWorkspaceProviderPackages(
      unitOfWork,
      { actorId: "system:package-sync", correlationId: "sync-1" },
      workspaceRoot,
    );

    expect(result).toEqual({ inserted: 4, updated: 0, unchanged: 0 });
    expect(await count("provider_package")).toBe(4);
    expect(await count("provider_type")).toBe(4);
    expect(await count("audit")).toBe(4);
  });

  it("does not create revision or audit noise when every checksum matches", async () => {
    const result = await synchronizeWorkspaceProviderPackages(
      unitOfWork,
      { actorId: "system:package-sync", correlationId: "sync-2" },
      workspaceRoot,
    );

    expect(result).toEqual({ inserted: 0, updated: 0, unchanged: 4 });
    expect(await count("audit")).toBe(4);
  });

  it("restores database drift from the file projection, never the reverse", async () => {
    await pool.query(
      `UPDATE provider_package
          SET checksum=repeat('f',64),source_document='{"tampered":true}'::jsonb
        WHERE package_id='builtin.isr.vehicle.ugv' AND package_version='1.0.0'`,
    );

    const result = await synchronizeWorkspaceProviderPackages(
      unitOfWork,
      { actorId: "system:package-sync", correlationId: "sync-3" },
      workspaceRoot,
    );
    const stored = await pool.query<{ source_document: Record<string, unknown> }>(
      `SELECT source_document FROM provider_package
        WHERE package_id='builtin.isr.vehicle.ugv' AND package_version='1.0.0'`,
    );

    expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 3 });
    expect(stored.rows[0]?.source_document).toMatchObject({
      packageId: "builtin.isr.vehicle.ugv",
      adapter: { entry: "apps/ugv-provider-adapter/src/main.ts" },
    });
    expect(await count("audit")).toBe(5);
  });

  it("rejects a damaged descriptor before opening a write transaction", async () => {
    const registry = await loadProviderPackageRegistry(workspaceRoot);
    const damaged = {
      ...registry.list()[0],
      hostingModes: [],
    };
    const synchronizer = new ProviderPackageSynchronizer(unitOfWork);

    await expect(
      synchronizer.synchronize([...registry.list(), damaged], {
        actorId: "system:package-sync",
        correlationId: "sync-invalid",
      }),
    ).rejects.toBeDefined();
    expect(await count("provider_package")).toBe(4);
    expect(await count("audit")).toBe(5);
  });

  async function count(table: "audit" | "provider_package" | "provider_type"): Promise<number> {
    const result = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    return Number(result.rows[0]?.count ?? 0);
  }
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
