import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGowmPool,
  verifyGowmStorage,
  verifyGowmTaskBusinessStorage,
} from "./dist/packages/gowm-shared-storage-adapter/src/index.js";
import { PostgresReceptionStore } from "./dist/packages/trajectory-history/src/postgres-store.js";

// Mounted at /app in the actual production image; only task-owned fake identities.
const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const url = new URL(fixture.databaseUrl);
assert.equal(url.hostname, "127.0.0.1");
assert.ok(url.pathname.includes("test"));
const contract = JSON.parse(
  readFileSync("contracts/ugv-trajectory-history/v1/gowm-storage.json", "utf8"),
);
assert.equal(contract.schema, "gowm.trajectory-history-storage/v1");
const config = {
  mode: "gowm-shared",
  databaseUrl: fixture.databaseUrl,
  contractDir: "contracts/gowm-shared-storage/current",
  serviceKey: fixture.serviceKey,
  sourceSessionKey: fixture.sourceSessionKey,
  allowedDeviceIds: [fixture.deviceIds[0]],
  bindingId: fixture.bindingIds[0],
};
const pool = createGowmPool(config, 2);
try {
  const role = (
    await pool.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
  ).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  await verifyGowmStorage(pool, config);
  await verifyGowmTaskBusinessStorage(pool, config);
  const store = new PostgresReceptionStore(pool, {
    providerId: fixture.providerId,
    resourceId: fixture.resourceIds[0],
    deviceId: fixture.deviceIds[0],
    deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
    sourceSessionKey: config.sourceSessionKey,
    smppServiceKey: config.serviceKey,
    bindingId: config.bindingId,
  });
  await store.initialize();
  assert.equal((await store.state()).scope.deviceId, fixture.deviceIds[0]);
  console.log(
    JSON.stringify({
      status: "PASS",
      path: "ACTUAL_UGV_PRODUCTION_IMAGE_TO_ISOLATED_FULL_GOWM",
      hostedHistoryOwnerChecksumVerified: contract.installedSha256,
      nonBypassApplicationRole: true,
      ddlExecutedByRuntime: false,
      realDeviceQualification: "NOT_RUN",
      siteOperations: "NOT_RUN",
      deployment19100: "NOT_RUN",
    }),
  );
} finally {
  await pool.end();
}
