import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const tables = [
  "ugv_trajectory_history_stream",
  "ugv_trajectory_history_session",
  "ugv_trajectory_history_reception",
  "ugv_trajectory_history_snapshot",
  "ugv_trajectory_projection_evidence",
];
export function trajectoryHistoryMigration() {
  const sql = readFileSync(
    new URL("031_trajectory_reception_history.sql", import.meta.url),
    "utf8",
  );
  const contract = JSON.parse(
    readFileSync(
      new URL("../../contracts/ugv-trajectory-history/v1/gowm-storage.json", import.meta.url),
      "utf8",
    ),
  );
  if (contract.installedSha256 !== createHash("sha256").update(sql).digest("hex"))
    throw Error("HISTORY_OWNER_MIGRATION_CHECKSUM_DRIFT");
  return { sql, contract };
}

/** Explicit owner connection only. Never called by Provider startup. */
export async function installGowmTrajectoryHistory(client, migration, apply) {
  const { sql, contract } = migration;
  if (
    contract.schema !== "gowm.trajectory-history-storage/v1" ||
    contract.family !== "UGV_PROVIDER" ||
    contract.migrationFile !== "031_trajectory_reception_history.sql" ||
    contract.installedSha256 !== createHash("sha256").update(sql).digest("hex")
  )
    throw Error("HISTORY_OWNER_MIGRATION_INVALID");
  await client.query("BEGIN");
  try {
    if (apply) await client.query("SELECT pg_advisory_xact_lock(718079)");
    else await client.query("SET TRANSACTION READ ONLY");
    const prerequisites = await client.query(
      "SELECT to_regclass('ugv_smpp.gowm_install_history') history,to_regclass('gowm_device.device_service_binding') binding",
    );
    if (!prerequisites.rows[0]?.history || !prerequisites.rows[0].binding)
      throw Error("HISTORY_GOWM_OWNER_PREREQUISITES_REQUIRED");
    const role = await client.query(
      "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='ugv_smpp_app'",
    );
    if (!role.rows[0]?.rolcanlogin || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
      throw Error("HISTORY_GOWM_APP_ROLE_INVALID");
    const previous = await client.query(
      "SELECT 1 FROM ugv_smpp.gowm_install_history WHERE family='UGV_PROVIDER' AND file='030_task_business_versions.sql'",
    );
    if (previous.rows.length !== 1) throw Error("HISTORY_TASK_BUSINESS_OWNER_INSTALL_REQUIRED");
    const old = await client.query(
      "SELECT checksum FROM ugv_smpp.gowm_install_history WHERE family=$1 AND file=$2",
      [contract.family, contract.migrationFile],
    );
    if (old.rows.length > 1 || (old.rows[0] && old.rows[0].checksum !== contract.installedSha256))
      throw Error("HISTORY_OWNER_MIGRATION_CHECKSUM_DRIFT");
    if (apply && !old.rows.length) {
      await client.query(sql);
      await client.query(
        "INSERT INTO ugv_smpp.gowm_install_history(family,file,checksum) VALUES($1,$2,$3)",
        [contract.family, contract.migrationFile, contract.installedSha256],
      );
    }
    if (apply) {
      // Restore immutable privileges after an owner bootstrap or deployment retry.
      await client.query(`REVOKE ALL ON ${tables.map((table) => "ugv_smpp." + table).join(",")} FROM ugv_smpp_app;
        GRANT SELECT,INSERT,UPDATE ON ugv_smpp.ugv_trajectory_history_stream,ugv_smpp.ugv_trajectory_history_session TO ugv_smpp_app;
        GRANT SELECT,INSERT ON ugv_smpp.ugv_trajectory_history_reception,ugv_smpp.ugv_trajectory_history_snapshot,ugv_smpp.ugv_trajectory_projection_evidence TO ugv_smpp_app;
        REVOKE ALL ON FUNCTION ugv_smpp.ugv_trajectory_history_prune(text,bigint) FROM ugv_smpp_app,PUBLIC;`);
    }
    if (apply || old.rows.length) {
      const state = await client.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='ugv_smpp'::regnamespace AND relname=ANY($1)",
        [tables],
      );
      if (
        state.rows.length !== tables.length ||
        state.rows.some((row) => !row.relrowsecurity || !row.relforcerowsecurity)
      )
        throw Error("HISTORY_OWNER_RLS_REQUIRED");
    }
    await client.query("COMMIT");
    return { installed: apply || old.rows.length === 1, contract };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
