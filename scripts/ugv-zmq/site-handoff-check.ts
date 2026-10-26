import { readFileSync, statSync, writeFileSync } from "node:fs";
import {
  loadGowmStorageConfig,
  createGowmPool,
  verifyGowmStorage,
  scopePredicate,
  scoped,
  resolveDeviceContext,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import {
  PostgresProviderStore,
  openGowmTaskBusinessStore,
} from "../../packages/provider-adapter-kit/src/index.js";
import { DeploymentProfile } from "../../packages/vehicle-zmq-contract/src/index.js";
import { readZmqHandoffState } from "../../packages/vehicle-zmq-control/src/handoff.js";
const privateJson = (path: string | undefined): unknown => {
  if (!path || (statSync(path).mode & 0o077) !== 0)
    throw Error("ZMQ_PRIVATE_OWNER_CONFIG_REQUIRED");
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};
const environment = privateJson(process.env.SMPP_ZMQ_OWNER_CONFIG_FILE) as NodeJS.ProcessEnv;
const config = loadGowmStorageConfig(environment);
if (!config) throw Error("ZMQ_OWNER_GOWM_MODE_REQUIRED");
const profile = DeploymentProfile.parse(privateJson(process.env.UGV_ZMQ_SITE_PROFILE_FILE));
const store = new PostgresProviderStore(config.databaseUrl, 2, "ugv", config),
  runtime = createGowmPool(config, 2);
try {
  await store.initialize();
  await verifyGowmStorage(runtime, config);
  await openGowmTaskBusinessStore(store.pool, config);
  const providerId = profile.providerBinding.providerId ?? "";
  const binding = await resolveDeviceContext(
    store.pool,
    config,
    { providerId, resourceId: profile.providerBinding.resourceId ?? "" },
    false,
  );
  if (binding.sourceSessionKey !== profile.providerBinding.sourceSessionKey)
    throw Error("ZMQ_READONLY_OWNER_SOURCE_MISMATCH");
  const base = await readZmqHandoffState(runtime, store.pool, providerId);
  const client = await runtime.connect();
  let pendingCommands = -1,
    unresolvedDispatches = -1,
    liveLeases = -1;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='2000ms'");
    const command = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM task_command c JOIN provider_task p ON p.task_id=c.task_id ${scoped(runtime) ? "AND p.device_id=c.device_id" : ""} WHERE (${scopePredicate(runtime, "p", "provider_task")}) AND p.provider_id=$1 AND c.state NOT IN ('ACKNOWLEDGED','REJECTED')`,
      [providerId],
    );
    pendingCommands = command.rows[0]?.count ?? -1;
    const uncertainty = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM smpp_dispatch_uncertainty d JOIN admission_intent a ON a.task_id=d.task_id  WHERE (${scopePredicate(runtime, "a", "admission_intent")}) AND a.provider_id=$1 AND a.state IN ('PENDING','ACCEPTED','UNCERTAIN')`,
      [providerId],
    );
    unresolvedDispatches = uncertainty.rows[0]?.count ?? -1;
    const leases = await client.query<{ count: number }>(
      `SELECT count(*)::int count FROM runtime_lease r WHERE ((${scopePredicate(runtime, "r", "runtime_lease")}) OR r.scope_key='SERVICE:'||current_setting('smpp.service_key')) AND r.expires_at>clock_timestamp()`,
    );
    liveLeases = leases.rows[0]?.count ?? -1;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const role = await store.pool.query<{ role: string; superuser: boolean }>(
    "SELECT current_user role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) superuser",
  );
  const report = {
    ...base,
    schemaVersion: "ugv.zmq-site-handoff-snapshot/1",
    ownerStartup: "verified",
    role: role.rows[0],
    binding,
    pendingCommands,
    unresolvedDispatches,
    liveLeases,
    databaseIdle: base.databaseIdle && pendingCommands === 0 && unresolvedDispatches === 0,
    switchAuthorized: false,
    missingEvidence: [
      ...base.missingEvidence,
      ...(liveLeases > 0 ? ["LIVE_RUNTIME_LEASES_PRESENT"] : []),
    ],
  };
  const reportPath = process.env.UGV_ZMQ_SITE_HANDOFF_REPORT;
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exitCode = report.databaseIdle && liveLeases === 0 ? 0 : 2;
} finally {
  await store.close();
  await runtime.end();
}
