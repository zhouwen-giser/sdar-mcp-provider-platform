import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import pg from "pg";
import {
  installGowmTaskBusiness,
  taskBusinessMigration,
} from "../../deploy/gowm-task-business/install.mjs";

// Explicit test provisioning, never imported by a Runtime/Provider startup path.
const args = process.argv.slice(2);
function required(name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`REQUIRED_ARGUMENT: ${name}`);
  return value;
}
if (args.includes("--help")) {
  process.stdout.write(
    "node --import tsx scripts/task-business/provision-gowm-test.mjs --owner-root /read-only/gowm --admin-url-file /private/admin-url --output /private/fixture.json --allow-empty-test-install\nRequires an empty loopback database with test in its name. Runs GOWM core migrations through 079, its SMPP installer, then the packaged business overlay. Outputs a private non-bypass app-role fixture; does not modify GOWM source or a deployed database.\n",
  );
  process.exit(0);
}
if (!args.includes("--allow-empty-test-install")) throw new Error("EXPLICIT_TEST_INSTALL_REQUIRED");
const smppRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ownerRoot = resolve(required("--owner-root"));
const output = resolve(required("--output"));
const adminUrl = new URL((await readFile(required("--admin-url-file"), "utf8")).trim());
if (
  !["postgres:", "postgresql:"].includes(adminUrl.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
  !/^\/[a-z][a-z0-9_]*test[a-z0-9_]*$/.test(adminUrl.pathname) ||
  adminUrl.search
)
  throw new Error("EMPTY_LOOPBACK_TEST_DATABASE_REQUIRED");
const database = adminUrl.pathname.slice(1);
const contractDir = resolve(smppRoot, "contracts/gowm-shared-storage/current");
const contract = JSON.parse(await readFile(resolve(contractDir, "source.json"), "utf8"));
const ownerManifest = JSON.parse(
  await readFile(
    resolve(ownerRoot, "database/shared-business-storage/install-manifest.json"),
    "utf8",
  ),
);
for (const entry of contract.entries) {
  if (
    !ownerManifest.entries.some(
      (e) =>
        e.family === entry.family &&
        e.file === entry.file &&
        e.generatedSha256 === entry.generatedSha256,
    )
  )
    throw new Error(`OWNER_CONTRACT_MISMATCH: ${entry.family}/${entry.file}`);
}
const core = await readFile(resolve(ownerRoot, "database/migrations", contract.core.file), "utf8");
if (
  createHash("sha256").update(core.replace(/\r\n?/g, "\n")).digest("hex") !== contract.core.sha256
)
  throw new Error("OWNER_CORE_CONTRACT_MISMATCH");
const migration = taskBusinessMigration();
const admin = new pg.Pool({ connectionString: adminUrl.href, max: 1 });
try {
  const preflight = await admin.query(`SELECT current_database() name,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
       AND c.relkind IN ('r','p','v','m')
       AND NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
         WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) objects,
    (SELECT count(*)::int FROM pg_roles WHERE rolname='ugv_smpp_app') app_roles`);
  if (
    preflight.rows[0]?.name !== database ||
    preflight.rows[0].objects !== 0 ||
    preflight.rows[0].app_roles !== 0
  )
    throw new Error("EMPTY_TEST_INSTALLATION_REQUIRED");
  process.chdir(ownerRoot);
  process.env.DATABASE_URL = adminUrl.href;
  process.env.STAS_DB_PASSWORD = randomBytes(32).toString("hex");
  const { migrate } = await import(pathToFileURL(resolve(ownerRoot, "scripts/migrate.ts")).href);
  await migrate({ maximumMigrationNumber: 79 });
  const { install } = await import(
    pathToFileURL(resolve(ownerRoot, "scripts/business-storage/installer.ts")).href
  );
  const { resolveBusinessDeviceContext } = await import(
    pathToFileURL(
      resolve(ownerRoot, "packages/integrations/device-business-storage/src/context.ts"),
    ).href
  );
  const c = await admin.connect();
  try {
    await install(c, "smpp");
    const password = randomBytes(32).toString("hex");
    await c.query("CREATE ROLE ugv_smpp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS");
    await c.query("SELECT set_config('smpp.test_password',$1,false)", [password]);
    await c.query(
      `DO $p$ BEGIN EXECUTE format('ALTER ROLE ugv_smpp_app PASSWORD %L', current_setting('smpp.test_password')); END $p$`,
    );
    await c.query("SELECT set_config('smpp.test_password','',false)");
    await c.query(`GRANT gowm_device_reader TO ugv_smpp_app;
      GRANT USAGE ON SCHEMA ugv_smpp,gowm_task,gowm_execution TO ugv_smpp_app;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_smpp TO ugv_smpp_app;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA gowm_task,gowm_execution TO ugv_smpp_app;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_smpp,gowm_task,gowm_execution TO ugv_smpp_app;
      GRANT SELECT ON public.schema_migration TO ugv_smpp_app;`);
    await installGowmTaskBusiness(c, migration, true);
    const runId = randomUUID();
    const dataScopeKey = `smpp-bff-test-${runId}`;
    const serviceKey = `smpp-bff-test-${runId}`;
    const providerId = "isr.vehicle.ugv.qualification";
    const deviceIds = ["A", "B"].map((id) => `smpp-bff-${runId}-${id}`);
    const resourceIds = ["vehicle:qualification-a", "vehicle:qualification-b"];
    const bindingIds = [];
    await c.query("BEGIN");
    try {
      await c.query(
        "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','SMPP disposable shared business qualification')",
        [dataScopeKey],
      );
      for (const [index, deviceId] of deviceIds.entries()) {
        await c.query(
          "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
          [deviceId, dataScopeKey],
        );
        await c.query(
          `INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type)
          VALUES($1,$2,'SMPP_TEST',$1,'SMPP qualification fixture','UGV')`,
          [deviceId, dataScopeKey],
        );
        const context = await resolveBusinessDeviceContext(c, {
          scope: dataScopeKey,
          deviceId,
          smppServiceKey: serviceKey,
          providerId,
          resourceId: resourceIds[index],
        });
        bindingIds.push(context.bindingId);
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    }
    const appUrl = new URL(adminUrl);
    appUrl.username = "ugv_smpp_app";
    appUrl.password = password;
    await writeFile(
      output,
      JSON.stringify(
        {
          databaseUrl: appUrl.href,
          contractDir,
          serviceKey,
          sourceSessionKey: `test-session-${runId}`,
          dataScopeKey,
          providerId,
          deviceIds,
          bindingIds,
          resourceIds,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    const version = await c.query("SELECT version() version");
    const history = await c.query(
      "SELECT family,count(*)::int count FROM ugv_smpp.gowm_install_history GROUP BY family ORDER BY family",
    );
    process.stdout.write(
      JSON.stringify({
        status: "INSTALLED_NOT_YET_QUALIFIED",
        database,
        fixture: output,
        version: version.rows[0].version,
        history: history.rows,
      }) + "\n",
    );
  } finally {
    c.release();
  }
} finally {
  await admin.end();
}
