import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import prettier from "prettier";
import { describe, expect, it } from "vitest";
import { runNpcTankProviderMigrations } from "../../apps/npc-tank-provider-adapter/src/migrate.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for Migration isolation tests");
}

const suffix = `${process.pid.toString()}_${Date.now().toString(36)}`;
const schemas = {
  runtime: `migration_isolation_runtime_${suffix}`,
  ugv: `migration_isolation_ugv_${suffix}`,
  npcTank: `migration_isolation_npc_${suffix}`,
} as const;

describe("Migration set isolation", () => {
  it("keeps Runtime, UGV, and NPC Tank schemas mutually isolated and idempotent", async () => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    const runtime = schemaPool(schemas.runtime);
    const ugv = schemaPool(schemas.ugv);
    const npcTank = schemaPool(schemas.npcTank);

    try {
      for (const schema of Object.values(schemas)) {
        await admin.query(`CREATE SCHEMA ${schema}`);
      }

      for (let run = 0; run < 2; run += 1) {
        await runMigrations(runtime);
        await runUgvProviderMigrations(ugv);
        await runNpcTankProviderMigrations(npcTank);
      }

      const [runtimeTables, ugvTables, npcTankTables] = await Promise.all([
        listTables(runtime, schemas.runtime),
        listTables(ugv, schemas.ugv),
        listTables(npcTank, schemas.npcTank),
      ]);

      expect(runtimeTables).toContain("provider_task");
      expect(runtimeTables).toContain("runtime_schema_migration");
      expect(runtimeTables).not.toContain("ugv_execution");
      expect(runtimeTables).not.toContain("npc_tank_execution");

      expect(ugvTables).toContain("ugv_execution");
      expect(ugvTables).not.toContain("provider_task");
      expect(ugvTables).not.toContain("runtime_schema_migration");
      expect(ugvTables).not.toContain("npc_tank_execution");

      expect(npcTankTables).toContain("npc_tank_execution");
      expect(npcTankTables).not.toContain("provider_task");
      expect(npcTankTables).not.toContain("runtime_schema_migration");
      expect(npcTankTables).not.toContain("ugv_execution");

      const runtimeMigrationCount = await runtime.query<{ count: string }>(
        "SELECT count(*) FROM runtime_schema_migration",
      );
      expect(runtimeMigrationCount.rows[0]?.count).toBe("25");

      await writeEvidence({
        runtime: runtimeTables,
        ugv: ugvTables,
        npcTank: npcTankTables,
      });
    } finally {
      await Promise.all([runtime.end(), ugv.end(), npcTank.end()]);
      for (const schema of Object.values(schemas).reverse()) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      }
      await admin.end();
    }
  });
});

function schemaPool(schema: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: `-c search_path=${schema}`,
  });
}

async function listTables(pool: Pool, schema: string): Promise<readonly string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  );
  return result.rows.map(({ table_name }) => table_name);
}

async function writeEvidence(tables: {
  readonly runtime: readonly string[];
  readonly ugv: readonly string[];
  readonly npcTank: readonly string[];
}): Promise<void> {
  const evidencePath = resolve("reports/evidence/migration-isolation.json");
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "PASS",
    database: {
      implementation: "PostgreSQL",
      connection: "TEST_DATABASE_URL (credentials redacted)",
      isolation: "three temporary schemas",
    },
    repeatedRunsPerSet: 2,
    sets: {
      runtime: {
        migrationCount: 25,
        representativePresent: ["provider_task", "runtime_schema_migration"],
        representativeAbsent: ["ugv_execution", "npc_tank_execution"],
        tableCount: tables.runtime.length,
      },
      "provider:ugv": {
        representativePresent: ["ugv_execution"],
        representativeAbsent: ["provider_task", "runtime_schema_migration", "npc_tank_execution"],
        tableCount: tables.ugv.length,
      },
      "provider:npc-tank": {
        representativePresent: ["npc_tank_execution"],
        representativeAbsent: ["provider_task", "runtime_schema_migration", "ugv_execution"],
        tableCount: tables.npcTank.length,
      },
    },
  };
  await writeFile(
    evidencePath,
    await prettier.format(JSON.stringify(evidence), {
      ...(await prettier.resolveConfig(evidencePath)),
      filepath: evidencePath,
    }),
    "utf8",
  );
}
