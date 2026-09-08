/* global deploymentInput */
// Runs only inside the existing GOWM application image, with its existing admin connection.
// deploymentInput is supplied over stdin by prepare-gowm.mjs, never as a process argument.
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { install } from "./dist/scripts/business-storage/installer.js";
import { resolveBusinessDeviceContext } from "./dist/packages/integrations/device-business-storage/src/context.js";
const { site, contract, password, credentialExists, apply } = deploymentInput;
const identifier = (x) => {
  if (!/^[a-z][a-z0-9_]*$/.test(x)) throw Error("UNSAFE_ROLE");
  return '"' + x + '"';
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  if ((await c.query("SELECT current_database() name")).rows[0].name !== site.database)
    throw Error("GOWM_DATABASE_MISMATCH");
  const actual = JSON.parse(
    await readFile("database/shared-business-storage/install-manifest.json", "utf8"),
  );
  for (const expected of contract.entries) {
    if (
      !actual.entries.some(
        (e) =>
          e.family === expected.family &&
          e.file === expected.file &&
          e.generatedSha256 === expected.generatedSha256,
      )
    )
      throw Error("GOWM_INSTALLER_CONTRACT_MISMATCH");
  }
  for (const e of contract.overlays) {
    const paths = {
      "device_scope_v1.sql": "ugv_smpp.sql",
      "scope_hardening_v1.sql": "smpp-hardening.sql",
      "additional_scope_v1.sql": "smpp-additional.sql",
    };
    const source = await readFile(
      "database/shared-business-storage/overlays/" + paths[e.file],
      "utf8",
    );
    if (createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("hex") !== e.sha256)
      throw Error("GOWM_OVERLAY_CONTRACT_MISMATCH");
  }
  const core = await c.query("SELECT checksum FROM public.schema_migration WHERE version=$1", [
    contract.core.file,
  ]);
  if (core.rows[0]?.checksum !== contract.core.sha256) throw Error("GOWM_CORE_CONTRACT_MISMATCH");
  const device = await c.query(
    "SELECT device_id FROM gowm_device.device WHERE device_id=$1 AND data_scope_key=$2 AND enabled",
    [site.deviceId, site.dataScopeKey],
  );
  if (device.rowCount !== 1) throw Error("DEVICE_CONTEXT_UNAVAILABLE");
  const role = (
    await c.query(
      "SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1",
      [site.loginRole],
    )
  ).rows[0];
  if (role && (!role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole))
    throw Error("EXISTING_ROLE_UNSAFE");
  if (role && !credentialExists) throw Error("EXISTING_ROLE_SECRET_REQUIRED_NO_ROTATION");
  if (!role || !credentialExists) throw Error("GOWM_MANAGED_ACCOUNT_REQUIRED");
  if (role && credentialExists) {
    const url = new URL(process.env.DATABASE_URL);
    url.username = site.loginRole;
    url.password = password;
    const loginPool = new pg.Pool({ connectionString: url.href });
    try {
      await loginPool.query("SELECT 1");
    } finally {
      await loginPool.end();
    }
  }
  if (!apply) {
    const schema = await c.query("SELECT to_regclass('ugv_smpp.gowm_install_history') name");
    console.log(
      JSON.stringify({
        status: "PREFLIGHT_PASS",
        schemaInstalled: !!schema.rows[0].name,
        roleExists: !!role,
        deviceId: site.deviceId,
      }),
    );
  } else {
    await install(c, "smpp");
    await c.query("BEGIN");
    try {
      await c.query("SELECT pg_advisory_xact_lock(718080)");
      const login = identifier(site.loginRole);
      await c.query(`GRANT CONNECT ON DATABASE ${identifier(site.database)} TO ${login}`);
      await c.query(`GRANT gowm_device_reader TO ${login}`);
      await c.query(`GRANT USAGE ON SCHEMA ugv_smpp,gowm_task,gowm_execution TO ${login}`);
      await c.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_smpp TO ${login}`,
      );
      await c.query(
        `GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA gowm_task,gowm_execution TO ${login}`,
      );
      await c.query(
        `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_smpp,gowm_task,gowm_execution TO ${login}`,
      );
      await c.query(`GRANT SELECT ON public.schema_migration TO ${login}`);
      const binding = await resolveBusinessDeviceContext(c, {
        scope: site.dataScopeKey,
        deviceId: site.deviceId,
        smppServiceKey: site.serviceKey,
        providerId: site.providerId,
        resourceId: site.resourceId,
      });
      await c.query("COMMIT");
      console.log(
        JSON.stringify({ ...binding, providerId: site.providerId, resourceId: site.resourceId }),
      );
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
} catch (e) {
  console.error(
    "GOWM_PREPARE_FAILED:" +
      (e.code ?? (/^[A-Z_]+$/.test(e.message) ? e.message : "SEE_DATABASE_ADMIN_LOG")),
  );
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
