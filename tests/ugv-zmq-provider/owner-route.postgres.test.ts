import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  PostgresControlRepository,
  controlScope,
  resultIdentity,
} from "../../packages/vehicle-zmq-control/src/index.js";
import type { GowmStorageConfig } from "../../packages/gowm-shared-storage-adapter/src/index.js";
import { rig, camera, request, testScope, present } from "../ugv-zmq-control/helpers.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE,
  role = "zmq_owner_" + randomUUID().replaceAll("-", "").slice(0, 18),
  password = randomUUID();
let admin: Pool, url: string;
const stores: PostgresProviderStore[] = [],
  repos: PostgresControlRepository[] = [];
const bindingA = randomUUID(),
  bindingB = randomUUID();
function repository(bindingId: string) {
  const u = new URL(url);
  u.username = role;
  u.password = password;
  const config: GowmStorageConfig = {
    mode: "gowm-shared",
    databaseUrl: u.toString(),
    serviceKey: "SIMULATED-service",
    allowedDeviceIds: ["SIMULATED-device"],
    bindingId,
    sourceSessionKey: "SIMULATED-source",
    contractDir: "not-used-by-component-fixture",
  };
  const store = new PostgresProviderStore(config.databaseUrl, 4, "ugv", config);
  stores.push(store);
  const original = testScope(),
    scope = controlScope(original.profile, {
      ...original.settings,
      storageBinding: {
        deviceId: config.allowedDeviceIds[0],
        bindingId,
        serviceKey: config.serviceKey,
        sourceSessionKey: config.sourceSessionKey,
      },
    });
  const repo = new PostgresControlRepository(store, store.pool, scope);
  repos.push(repo);
  return repo;
}
describe.skipIf(!file)("GOWM scoped SQL component fixture (not owner startup acceptance)", () => {
  beforeAll(async () => {
    url = (JSON.parse(readFileSync(present(file), "utf8")) as { databaseUrl: string }).databaseUrl;
    admin = new Pool({ connectionString: url, max: 1 });
    const existing = await admin.query<{ n: string | null }>(
      "SELECT to_regnamespace('ugv_smpp') n",
    );
    if (existing.rows[0]?.n) throw Error("EMPTY_OWNER_FIXTURE_DATABASE_REQUIRED");
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await admin.query("CREATE SCHEMA ugv_smpp");
    await admin.query("CREATE SCHEMA gowm_device");
    await admin.query(
      "CREATE TABLE gowm_device.device(device_id text PRIMARY KEY,enabled boolean NOT NULL)",
    );
    await admin.query(
      "CREATE TABLE gowm_device.device_service_binding(binding_id uuid PRIMARY KEY,device_id text NOT NULL,data_scope_key text NOT NULL,smpp_service_key text NOT NULL,provider_id text NOT NULL,resource_id text NOT NULL,valid_from timestamptz NOT NULL DEFAULT now(),valid_to timestamptz)",
    );
    await admin.query("INSERT INTO gowm_device.device VALUES('SIMULATED-device',true)");
    for (const binding of [bindingA, bindingB])
      await admin.query(
        "INSERT INTO gowm_device.device_service_binding(binding_id,device_id,data_scope_key,smpp_service_key,provider_id,resource_id) VALUES($1,'SIMULATED-device','SIMULATED-scope','SIMULATED-service','SIMULATED-provider','vehicle:SIMULATED')",
        [binding],
      );
    await admin.query("SET search_path=ugv_smpp");
    for (const path of [
      "migrations/providers/ugv/024_ugv_provider.sql",
      "migrations/providers/ugv/027_mutation_journal.sql",
    ])
      await admin.query(readFileSync(path, "utf8"));
    await admin.query(
      "ALTER TABLE ugv_execution ADD device_id text NOT NULL,ADD gowm_binding_id uuid NOT NULL,ADD smpp_service_key text NOT NULL,ADD source_session_key text NOT NULL",
    );
    for (const table of ["ugv_state_snapshot", "ugv_mutation_journal"]) {
      await admin.query(`ALTER TABLE ${table} ADD device_id text NOT NULL`);
      await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await admin.query(
        `CREATE POLICY device_scope ON ${table} USING(device_id=current_setting('smpp.device_id')) WITH CHECK(device_id=current_setting('smpp.device_id'))`,
      );
    }
    await admin.query("ALTER TABLE ugv_execution ENABLE ROW LEVEL SECURITY");
    await admin.query(
      "CREATE POLICY device_scope ON ugv_execution USING(device_id=current_setting('smpp.device_id')) WITH CHECK(device_id=current_setting('smpp.device_id'))",
    );
    await admin.query(`GRANT USAGE ON SCHEMA ugv_smpp,gowm_device TO ${role}`);
    await admin.query(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ugv_smpp TO ${role}`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA gowm_device TO ${role}`);
    await admin.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ugv_smpp TO ${role}`);
  });
  afterAll(async () => {
    for (const r of repos) await r.close();
    for (const s of stores) await s.close();
    if (admin) {
      await admin.query("DROP SCHEMA IF EXISTS ugv_smpp CASCADE");
      await admin.query("DROP SCHEMA IF EXISTS gowm_device CASCADE");
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  });
  it("persists owner binding, scopes reads/results and fences held actions across bindings", async () => {
    const a = repository(bindingA);
    await a.start();
    const memory = await rig();
    const e = await memory.engine.start(request(memory.clock, camera));
    await memory.engine.close();
    e.zmqControl.scopeHash = a.scope.hash;
    e.zmqControl.writerKeys = a.scope.writerKeys;
    await a.save(e);
    expect(e.deviceContext).toMatchObject({ deviceId: "SIMULATED-device", bindingId: bindingA });
    const draft = {
      identity: resultIdentity(e),
      kind: "effect" as const,
      sourceRef: {
        partitionHash: "a".repeat(64),
        sessionId: randomUUID(),
        ordinal: "1",
        entryHash: "b".repeat(64),
      },
      receivedAt: new Date().toISOString(),
      content: { nativeTask: { effect: "unknown" } },
    };
    const record = await a.appendResult(draft);
    expect((await a.resultPage(resultIdentity(e))).records).toEqual([record]);
    const b = repository(bindingB);
    expect(b.scope.hash).not.toBe(a.scope.hash);
    expect(await b.get(e.taskId)).toBeUndefined();
    expect(await b.store.getExecution(e.taskId)).toBeUndefined();
    await expect(b.start()).rejects.toThrow("ZMQ_CONTROL_WRITER_ALREADY_ACTIVE");
    await a.close();
    const successor = repository(bindingB);
    await expect(successor.start()).rejects.toThrow("ZMQ_UNRESOLVED_PREDECESSOR_SCOPE");
    const old = repository(bindingA);
    await old.start();
    e.zmqControl.occupancy = "released";
    e.zmqControl.stage = "terminal";
    e.state = "TECHNICAL_FAILED";
    e.terminalAt = e.updatedAt;
    await old.save(e);
    await old.close();
    const released = repository(bindingB);
    await released.start();
    await expect(released.resultPage(resultIdentity(e))).rejects.toThrow(
      "ZMQ_EXECUTION_SCOPE_MISMATCH",
    );
  });
});
