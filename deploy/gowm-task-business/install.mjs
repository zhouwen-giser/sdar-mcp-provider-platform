import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function taskBusinessMigration() {
  const sql = readFileSync(new URL("030_task_business_versions.sql", import.meta.url), "utf8");
  const migration = {
    sql,
    contract: {
      schema: "gowm.task-business-storage/v1",
      family: "UGV_PROVIDER",
      migrationFile: "030_task_business_versions.sql",
      installedSha256: createHash("sha256").update(sql).digest("hex"),
    },
  };
  const pinned = JSON.parse(
    readFileSync(
      new URL("../../contracts/gowm-shared-storage/current/task-business.json", import.meta.url),
      "utf8",
    ),
  );
  if (JSON.stringify(pinned) !== JSON.stringify(migration.contract))
    throw Error("GOWM_BUSINESS_PACKAGE_CONTRACT_DRIFT");
  const runtimeSql = readFileSync(
    new URL("027_task_business_intervention_command.sql", import.meta.url),
    "utf8",
  );
  const runtimeContract = JSON.parse(
    readFileSync(
      new URL(
        "../../contracts/gowm-shared-storage/current/task-business-runtime.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (runtimeContract.installedSha256 !== createHash("sha256").update(runtimeSql).digest("hex"))
    throw Error("GOWM_BUSINESS_PACKAGE_CONTRACT_DRIFT");
  return { ...migration, runtime: { sql: runtimeSql, contract: runtimeContract } };
}

// Self-contained: prepare-gowm sends this function and pinned SQL over stdin to
// the existing GOWM owner container. No admin secret is placed in argv/artifacts.
export async function installGowmTaskBusiness(client, migration, apply) {
  const { sql, contract } = migration;
  if (
    contract.schema !== "gowm.task-business-storage/v1" ||
    contract.family !== "UGV_PROVIDER" ||
    contract.migrationFile !== "030_task_business_versions.sql" ||
    createHash("sha256").update(sql).digest("hex") !== contract.installedSha256
  )
    throw Error("GOWM_BUSINESS_MIGRATION_INVALID");
  const runtime = migration.runtime;
  if (
    !runtime ||
    runtime.contract.schema !== "gowm.task-business-runtime/v1" ||
    runtime.contract.family !== "SMPP_RUNTIME" ||
    runtime.contract.migrationFile !== "027_task_business_intervention_command.sql" ||
    createHash("sha256").update(runtime.sql).digest("hex") !== runtime.contract.installedSha256
  )
    throw Error("GOWM_BUSINESS_RUNTIME_MIGRATION_INVALID");
  await client.query("BEGIN");
  try {
    // Share the owner's installer lock, including concurrent deploy attempts.
    if (apply) await client.query("SELECT pg_advisory_xact_lock(718079)");
    else await client.query("SET TRANSACTION READ ONLY");
    const prerequisites = await client.query(`SELECT
      to_regclass('ugv_smpp.gowm_install_history') history,
      to_regclass('gowm_device.device_service_binding') binding,
      to_regclass('public.schema_migration') core`);
    const prerequisite = prerequisites.rows[0];
    if (!prerequisite?.history || !prerequisite.binding || !prerequisite.core)
      throw Error("GOWM_BUSINESS_OWNER_INSTALL_REQUIRED");
    const role = await client.query(
      "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='ugv_smpp_app'",
    );
    if (!role.rows[0]?.rolcanlogin || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
      throw Error("GOWM_BUSINESS_APP_ROLE_INVALID");
    const previous = await client.query(
      "SELECT 1 FROM ugv_smpp.gowm_install_history WHERE family='UGV_PROVIDER' AND file='029_smpp_diagnostic_exact_argument_selector.sql'",
    );
    if (previous.rows.length !== 1) throw Error("GOWM_BUSINESS_PREVIOUS_MIGRATION_REQUIRED");
    const runtimePrevious = await client.query(
      "SELECT 1 FROM ugv_smpp.gowm_install_history WHERE family='SMPP_RUNTIME' AND file='026_smpp_reconciliation_audit.sql'",
    );
    if (runtimePrevious.rows.length !== 1)
      throw Error("GOWM_BUSINESS_RUNTIME_PREVIOUS_MIGRATION_REQUIRED");
    const oldRuntime = await client.query(
      "SELECT checksum FROM ugv_smpp.gowm_install_history WHERE family=$1 AND file=$2",
      [runtime.contract.family, runtime.contract.migrationFile],
    );
    if (
      oldRuntime.rows.length > 1 ||
      (oldRuntime.rows.length === 1 &&
        oldRuntime.rows[0].checksum !== runtime.contract.installedSha256)
    )
      throw Error("GOWM_BUSINESS_RUNTIME_CHECKSUM_DRIFT");
    if (!oldRuntime.rows.length && apply) {
      await client.query(runtime.sql);
      await client.query(
        "INSERT INTO ugv_smpp.gowm_install_history(family,file,checksum) VALUES($1,$2,$3)",
        [runtime.contract.family, runtime.contract.migrationFile, runtime.contract.installedSha256],
      );
    }
    const old = await client.query(
      "SELECT checksum FROM ugv_smpp.gowm_install_history WHERE family=$1 AND file=$2",
      [contract.family, contract.migrationFile],
    );
    if (
      old.rows.length > 1 ||
      (old.rows.length === 1 && old.rows[0].checksum !== contract.installedSha256)
    )
      throw Error("GOWM_BUSINESS_MIGRATION_CHECKSUM_DRIFT");
    if (!old.rows.length && apply) {
      await client.query(sql);
      await client.query(
        "INSERT INTO ugv_smpp.gowm_install_history(family,file,checksum) VALUES($1,$2,$3)",
        [contract.family, contract.migrationFile, contract.installedSha256],
      );
    } else if (old.rows.length && apply) {
      // The existing owner bootstrap grants broad domain access on each run.
      // Restore immutable business-version/content privileges on every retry.
      await client.query(`REVOKE ALL ON ugv_smpp.ugv_task_business_context,
        ugv_smpp.ugv_task_business_command,ugv_smpp.ugv_task_business_object_version,
        ugv_smpp.ugv_task_business_content FROM ugv_smpp_app;
        GRANT SELECT,INSERT,UPDATE ON ugv_smpp.ugv_task_business_context,
          ugv_smpp.ugv_task_business_command TO ugv_smpp_app;
        GRANT SELECT,INSERT ON ugv_smpp.ugv_task_business_object_version,
          ugv_smpp.ugv_task_business_content TO ugv_smpp_app;`);
    }
    await client.query("COMMIT");
    return {
      installed: apply || (old.rows.length === 1 && oldRuntime.rows.length === 1),
      contract,
      runtimeContract: runtime.contract,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
