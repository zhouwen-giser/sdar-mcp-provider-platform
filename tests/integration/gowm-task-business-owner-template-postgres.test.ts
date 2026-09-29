import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGowmPool } from "../../packages/gowm-shared-storage-adapter/src/connection.js";
import { verifyGowmTaskBusinessStorage } from "../../packages/gowm-shared-storage-adapter/src/task-business.js";

const enabled = process.env.SMPP_GOWM_BUSINESS_TEMPLATE_TEST_ENABLE === "true";
const databaseUrl = process.env.SMPP_GOWM_BUSINESS_TEMPLATE_TEST_URL;
if (enabled && (!databaseUrl || !new URL(databaseUrl).pathname.includes("test"))) {
  throw new Error("ISOLATED_GOWM_BUSINESS_TEMPLATE_TEST_DATABASE_REQUIRED");
}

const ownerTemplate = "contracts/gowm-shared-storage/task-business-owner-handoff.sql.template";
const role = `ugvb_template_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const password = `ugvb-test-${randomUUID()}`;
const firstBinding = randomUUID();
const secondBinding = randomUUID();
let admin: Pool;
let first: Pool;
let second: Pool;
let otherBinding: Pool;
let otherService: Pool;
let otherSession: Pool;
let contractDir: string;
let ownerSchemaCreated = false;
let deviceSchemaCreated = false;
let migrationMarkerCreated = false;

function roleDatabaseUrl(): URL {
  if (!databaseUrl) throw new Error("ISOLATED_GOWM_BUSINESS_TEMPLATE_TEST_DATABASE_REQUIRED");
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  return url;
}

function appPool(
  deviceId: string,
  bindingId: string,
  serviceKey = "ugvb-template-test",
  sourceSessionKey = "source-a",
): Pool {
  const url = roleDatabaseUrl();
  url.searchParams.set(
    "options",
    `-c smpp.device_id=${deviceId} -c smpp.binding_id=${bindingId} -c smpp.service_key=${serviceKey} -c smpp.source_session_key=${sourceSessionKey}`,
  );
  return new Pool({ connectionString: url.toString(), max: 2 });
}

const suite = enabled ? describe : describe.skip;
suite("GOWM owner template component qualification in disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("ISOLATED_GOWM_BUSINESS_TEMPLATE_TEST_DATABASE_REQUIRED");
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    const existing = await admin.query<{
      owner_schema: string | null;
      device_schema: string | null;
      migration_marker: string | null;
    }>(
      "SELECT to_regnamespace('ugv_smpp')::text AS owner_schema,to_regnamespace('gowm_device')::text AS device_schema,to_regclass('public.schema_migration')::text AS migration_marker",
    );
    if (
      existing.rows[0]?.owner_schema ||
      existing.rows[0]?.device_schema ||
      existing.rows[0]?.migration_marker
    ) {
      throw new Error("GOWM_BUSINESS_TEMPLATE_TEST_REQUIRES_EMPTY_SCHEMAS");
    }
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await admin.query("CREATE SCHEMA ugv_smpp");
    ownerSchemaCreated = true;
    await admin.query("CREATE SCHEMA gowm_device");
    deviceSchemaCreated = true;
    await admin.query(
      "CREATE TABLE public.schema_migration(version text PRIMARY KEY,checksum text NOT NULL)",
    );
    migrationMarkerCreated = true;
    await admin.query(
      "CREATE TABLE gowm_device.device_service_binding(binding_id uuid PRIMARY KEY)",
    );
    await admin.query(
      "CREATE TABLE ugv_smpp.gowm_install_history(family text NOT NULL,file text NOT NULL,checksum text NOT NULL)",
    );
    await admin.query(
      "INSERT INTO gowm_device.device_service_binding(binding_id) VALUES($1),($2)",
      [firstBinding, secondBinding],
    );
    const template = await readFile(ownerTemplate, "utf8");
    const installedSql = template.replaceAll(":smpp_app_role", role);
    await admin.query(installedSql);
    const checksum = createHash("sha256").update(installedSql).digest("hex");
    await admin.query(
      "INSERT INTO ugv_smpp.gowm_install_history(family,file,checksum) VALUES($1,$2,$3)",
      ["UGV_PROVIDER", "030_task_business_versions.sql", checksum],
    );
    contractDir = await mkdtemp(join(tmpdir(), "smpp-gowm-business-template-"));
    await writeFile(
      join(contractDir, "task-business.json"),
      JSON.stringify({
        schema: "gowm.task-business-storage/v1",
        family: "UGV_PROVIDER",
        migrationFile: "030_task_business_versions.sql",
        installedSha256: checksum,
      }),
    );
    first = createGowmPool(
      {
        mode: "gowm-shared",
        databaseUrl: roleDatabaseUrl().toString(),
        serviceKey: "ugvb-template-test",
        allowedDeviceIds: ["ugv-template-a"],
        bindingId: firstBinding,
        sourceSessionKey: "source-a",
        contractDir,
      },
      2,
    );
    second = appPool("ugv-template-b", secondBinding);
    otherBinding = appPool("ugv-template-a", secondBinding);
    otherService = appPool("ugv-template-a", firstBinding, "another-service");
    otherSession = appPool("ugv-template-a", firstBinding, "ugvb-template-test", "source-b");
  }, 30_000);

  afterAll(async () => {
    await first?.end();
    await second?.end();
    await otherBinding?.end();
    await otherService?.end();
    await otherSession?.end();
    if (admin) {
      if (ownerSchemaCreated) await admin.query("DROP SCHEMA ugv_smpp CASCADE");
      if (deviceSchemaCreated) await admin.query("DROP SCHEMA gowm_device CASCADE");
      if (migrationMarkerCreated) await admin.query("DROP TABLE public.schema_migration");
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
    if (contractDir) await rm(contractDir, { recursive: true, force: true });
  });

  it("accepts the exact owner template under a non-bypass application role", async () => {
    await expect(verifyGowmTaskBusinessStorage(first, { contractDir })).resolves.toBeUndefined();
    const roleCheck = await first.query<{
      current_user: string;
      search_path: string;
      device_id: string;
      binding_id: string;
      service_key: string;
      source_session_key: string;
    }>(`SELECT current_user,current_setting('search_path') AS search_path,
      current_setting('smpp.device_id') AS device_id,
      current_setting('smpp.binding_id') AS binding_id,
      current_setting('smpp.service_key') AS service_key,
      current_setting('smpp.source_session_key') AS source_session_key`);
    expect(roleCheck.rows[0]).toEqual({
      current_user: role,
      search_path: "ugv_smpp,public",
      device_id: "ugv-template-a",
      binding_id: firstBinding,
      service_key: "ugvb-template-test",
      source_session_key: "source-a",
    });
  });

  it("requires the application role to have schema usage", async () => {
    await admin.query(`REVOKE USAGE ON SCHEMA ugv_smpp FROM ${role}`);
    try {
      await expect(verifyGowmTaskBusinessStorage(first, { contractDir })).rejects.toThrow(
        "GOWM_BUSINESS_SCHEMA_USAGE_MISSING",
      );
    } finally {
      await admin.query(`GRANT USAGE ON SCHEMA ugv_smpp TO ${role}`);
    }
  });

  it("grants read-only core and overlay marker access without test-side grants", async () => {
    for (const table of ["public.schema_migration", "ugv_smpp.gowm_install_history"]) {
      const privileges = await first.query<{ readable: boolean; writable: boolean }>(
        "SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE') AS writable",
        [table],
      );
      expect(privileges.rows[0]).toEqual({ readable: true, writable: false });
      await expect(first.query(`SELECT * FROM ${table}`)).resolves.toBeDefined();
    }
  });

  it("rejects a manifest checksum that differs from the installed history", async () => {
    const path = join(contractDir, "task-business.json");
    const original = await readFile(path, "utf8");
    try {
      const altered = JSON.parse(original) as Record<string, unknown>;
      altered.installedSha256 = "0".repeat(64);
      await writeFile(path, JSON.stringify(altered));
      await expect(verifyGowmTaskBusinessStorage(first, { contractDir })).rejects.toThrow(
        "GOWM_BUSINESS_INSTALL_HISTORY_MISMATCH",
      );
    } finally {
      await writeFile(path, original);
    }
  });

  it("uses the installed UGV migration family instead of inventing a second family", async () => {
    const source = JSON.parse(
      await readFile("contracts/gowm-shared-storage/current/source.json", "utf8"),
    ) as { entries: { family: string; file: string }[] };
    expect(source.entries.find((entry) => entry.file === "024_ugv_provider.sql")?.family).toBe(
      "UGV_PROVIDER",
    );
    const path = join(contractDir, "task-business.json");
    const original = await readFile(path, "utf8");
    try {
      const altered = JSON.parse(original) as Record<string, unknown>;
      altered.family = "SMPP_PROVIDER_UGV";
      await writeFile(path, JSON.stringify(altered));
      await expect(verifyGowmTaskBusinessStorage(first, { contractDir })).rejects.toThrow(
        "GOWM_BUSINESS_CONTRACT_INVALID",
      );
    } finally {
      await writeFile(path, original);
    }
  });

  it("keeps Context rows invisible across device and binding settings", async () => {
    const insert = `INSERT INTO ugv_smpp.ugv_task_business_context
      (scope_hash,scope_key,task_id,external_execution_id,context_revision,effective_plan_revision,payload,updated_at)
      VALUES($1,$2,$3,$4,1,0,'{}'::jsonb,now())`;
    await first.query(insert, ["a".repeat(64), "scope-a", "task-a", "execution-a"]);
    expect(
      (await first.query("SELECT task_id FROM ugv_smpp.ugv_task_business_context")).rows,
    ).toEqual([{ task_id: "task-a" }]);
    expect(
      (await second.query("SELECT task_id FROM ugv_smpp.ugv_task_business_context")).rows,
    ).toEqual([]);
    for (const pool of [otherBinding, otherService, otherSession]) {
      expect(
        (await pool.query("SELECT task_id FROM ugv_smpp.ugv_task_business_context")).rows,
      ).toEqual([]);
    }
    await expect(
      second.query(
        `INSERT INTO ugv_smpp.ugv_task_business_context
          (scope_hash,scope_key,device_id,task_id,external_execution_id,context_revision,effective_plan_revision,payload,updated_at)
          VALUES($1,$2,$3,$4,$5,1,0,'{}'::jsonb,now())`,
        ["b".repeat(64), "scope-b", "ugv-template-a", "task-b", "execution-b"],
      ),
    ).rejects.toThrow(/row-level security/i);
    await second.query(insert, ["c".repeat(64), "scope-c", "task-c", "execution-c"]);
    expect(
      (await first.query("SELECT task_id FROM ugv_smpp.ugv_task_business_context")).rows,
    ).toEqual([{ task_id: "task-a" }]);
    expect(
      (await second.query("SELECT task_id FROM ugv_smpp.ugv_task_business_context")).rows,
    ).toEqual([{ task_id: "task-c" }]);
  });
});
