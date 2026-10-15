import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  installGowmTaskBusiness,
  taskBusinessMigration,
} from "../../deploy/gowm-task-business/install.mjs";
import {
  verifyGowmTaskBusinessStorage,
  verifyGowmTaskBusinessRuntimeCommands,
} from "../../packages/gowm-shared-storage-adapter/src/task-business.js";

const databaseUrl = process.env.SMPP_GOWM_BUSINESS_DEPLOY_TEST_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.includes("test"))
  throw Error("ISOLATED_DEPLOY_TEST_DATABASE_REQUIRED");
const suite = databaseUrl ? describe : describe.skip;
let admin: Pool;
let app: Pool;
let created = false;
suite("SMPP packaged SQL explicit GOWM owner installation", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw Error("ISOLATED_DEPLOY_TEST_DATABASE_REQUIRED");
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    const existing = await admin.query<Record<string, string | null>>(
      "SELECT to_regnamespace('ugv_smpp') owner,to_regnamespace('gowm_device') device,to_regclass('public.schema_migration') core,(SELECT 1 FROM pg_roles WHERE rolname='ugv_smpp_app') role",
    );
    if (Object.values(existing.rows[0] ?? {}).some(Boolean))
      throw Error("ISOLATED_DEPLOY_TEST_REQUIRES_EMPTY_DATABASE");
    await admin.query(`CREATE SCHEMA ugv_smpp; CREATE SCHEMA gowm_device;
      CREATE TABLE public.schema_migration(version text PRIMARY KEY,checksum text NOT NULL);
      CREATE TABLE gowm_device.device_service_binding(binding_id uuid PRIMARY KEY);
      CREATE TABLE ugv_smpp.gowm_install_history(family text,file text,checksum text NOT NULL,applied_at timestamptz DEFAULT now(),PRIMARY KEY(family,file));
      INSERT INTO ugv_smpp.gowm_install_history VALUES('UGV_PROVIDER','029_smpp_diagnostic_exact_argument_selector.sql','component-prerequisite',now());
      INSERT INTO ugv_smpp.gowm_install_history VALUES('SMPP_RUNTIME','026_smpp_reconciliation_audit.sql','component-prerequisite',now());
      CREATE TABLE ugv_smpp.task_command(device_id text NOT NULL,task_id text NOT NULL,command_sequence bigint NOT NULL,command_type text NOT NULL CHECK(command_type IN ('CANCEL','UPDATE','PAUSE','RESUME')),payload jsonb NOT NULL,PRIMARY KEY(device_id,task_id,command_sequence));
      CREATE ROLE ugv_smpp_app LOGIN PASSWORD 'isolated-app-test' NOSUPERUSER NOBYPASSRLS;`);
    created = true;
    const url = new URL(databaseUrl);
    url.username = "ugv_smpp_app";
    url.password = "isolated-app-test";
    app = new Pool({ connectionString: url.href, max: 1 });
  });
  afterAll(async () => {
    await app?.end();
    if (created)
      await admin.query(
        "DROP SCHEMA ugv_smpp CASCADE; DROP SCHEMA gowm_device CASCADE; DROP TABLE public.schema_migration; DROP ROLE ugv_smpp_app;",
      );
    await admin?.end();
  });
  it("read-only preflight does not create tables or migration history", async () => {
    const client = await admin.connect();
    try {
      expect(await installGowmTaskBusiness(client, taskBusinessMigration(), false)).toMatchObject({
        installed: false,
      });
    } finally {
      client.release();
    }
    expect(
      (
        await admin.query<{ relation: string | null }>(
          "SELECT to_regclass('ugv_smpp.ugv_task_business_context') relation",
        )
      ).rows[0]?.relation,
    ).toBeNull();
  });
  it("rolls back all four tables and marker if late SQL fails", async () => {
    const migration = taskBusinessMigration();
    migration.sql += "\nSELECT 1 / 0;";
    migration.contract.installedSha256 = createHash("sha256").update(migration.sql).digest("hex");
    const client = await admin.connect();
    try {
      await expect(installGowmTaskBusiness(client, migration, true)).rejects.toThrow(
        "division by zero",
      );
    } finally {
      client.release();
    }
    expect(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int n FROM ugv_smpp.gowm_install_history",
        )
      ).rows[0]?.n,
    ).toBe(2);
    expect(
      (
        await admin.query<{ relation: string | null }>(
          "SELECT to_regclass('ugv_smpp.ugv_task_business_content') relation",
        )
      ).rows[0]?.relation,
    ).toBeNull();
  });
  it("installs pinned bytes and passes the strict overlay verifier with app privileges", async () => {
    const client = await admin.connect();
    try {
      expect(await installGowmTaskBusiness(client, taskBusinessMigration(), true)).toMatchObject({
        installed: true,
      });
    } finally {
      client.release();
    }
    await expect(
      verifyGowmTaskBusinessStorage(app, { contractDir: "contracts/gowm-shared-storage/current" }),
    ).resolves.toBeUndefined();
  });
  it("enables Runtime interventions, fences duplicate commands by device, and rejects missing constraints", async () => {
    await verifyGowmTaskBusinessRuntimeCommands(app, {
      contractDir: "contracts/gowm-shared-storage/current",
    });
    const payload = JSON.stringify({
      commandId: "same-id",
      semanticHash: "a".repeat(64),
      command: {},
    });
    await admin.query(
      "INSERT INTO ugv_smpp.task_command VALUES('a','same-task',1,'INTERVENTION',$1),('b','same-task',1,'INTERVENTION',$1)",
      [payload],
    );
    await expect(
      admin.query("INSERT INTO ugv_smpp.task_command VALUES('a','same-task',2,'INTERVENTION',$1)", [
        payload,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      admin.query("INSERT INTO ugv_smpp.task_command VALUES('a','bad-task',1,'INTERVENTION','{}')"),
    ).rejects.toMatchObject({ code: "23514" });
    await admin.query(
      "ALTER TABLE ugv_smpp.task_command DROP CONSTRAINT task_command_intervention_payload_check",
    );
    try {
      await expect(
        verifyGowmTaskBusinessRuntimeCommands(app, {
          contractDir: "contracts/gowm-shared-storage/current",
        }),
      ).rejects.toThrow("GOWM_BUSINESS_RUNTIME_COMMAND_CONSTRAINT_MISSING");
    } finally {
      await admin.query("DELETE FROM ugv_smpp.task_command");
      await admin.query(
        "DELETE FROM ugv_smpp.gowm_install_history WHERE family='SMPP_RUNTIME' AND file='027_task_business_intervention_command.sql'; DROP INDEX ugv_smpp.task_command_intervention_id_idx",
      );
      const client = await admin.connect();
      try {
        await installGowmTaskBusiness(client, taskBusinessMigration(), true);
      } finally {
        client.release();
      }
    }
  });

  it("serializes concurrent retries and restores immutable-table privileges", async () => {
    await admin.query("GRANT ALL ON ALL TABLES IN SCHEMA ugv_smpp TO ugv_smpp_app");
    await Promise.all(
      [1, 2].map(async () => {
        const client = await admin.connect();
        try {
          await installGowmTaskBusiness(client, taskBusinessMigration(), true);
        } finally {
          client.release();
        }
      }),
    );
    expect(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int n FROM ugv_smpp.gowm_install_history",
        )
      ).rows[0]?.n,
    ).toBe(4);
    expect(
      (
        await app.query(
          "SELECT has_table_privilege('ugv_smpp.ugv_task_business_object_version','UPDATE') u,has_table_privilege('ugv_smpp.ugv_task_business_content','DELETE') d",
        )
      ).rows[0],
    ).toEqual({ u: false, d: false });
    await expect(
      verifyGowmTaskBusinessStorage(app, { contractDir: "contracts/gowm-shared-storage/current" }),
    ).resolves.toBeUndefined();
  });
  it.each(["provider", "runtime"] as const)(
    "rejects %s checksum drift instead of replacing an installed migration",
    async (family) => {
      const migration = taskBusinessMigration();
      const target = family === "runtime" ? migration.runtime : migration;
      target.sql += "\n-- changed\n";
      target.contract.installedSha256 = createHash("sha256").update(target.sql).digest("hex");
      const client = await admin.connect();
      try {
        await expect(installGowmTaskBusiness(client, migration, true)).rejects.toThrow(
          family === "runtime"
            ? "GOWM_BUSINESS_RUNTIME_CHECKSUM_DRIFT"
            : "GOWM_BUSINESS_MIGRATION_CHECKSUM_DRIFT",
        );
      } finally {
        client.release();
      }
    },
  );
});
