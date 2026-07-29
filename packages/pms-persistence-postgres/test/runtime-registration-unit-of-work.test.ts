import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRuntimeRegistrationUnitOfWork, runPmsMigrations } from "../src/index.js";
import { RuntimeRegistrationService } from "../../runtime-registration/src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const protocolVersion = "2026-07-28";

describe("PostgreSQL RuntimeRegistration unit of work", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_registration_uow_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let sequence = 0;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('isr.vehicle.ugv','UGV','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES ('provider:A','isr.vehicle.ugv','vendor_managed','active'),
              ('provider:B','isr.vehicle.ugv','vendor_managed','active')`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("atomically registers, heartbeats, patches only registration fields, and appends success Audit", async () => {
    const fixture = await seed(pool, ++sequence);
    let now = new Date("2026-07-28T00:00:00.000Z");
    const service = serviceFor(pool, () => now);

    await expect(service.register(fixture.request(), context())).resolves.toMatchObject({
      outcome: "created",
      registration: { revision: 0 },
    });
    const afterRegister = await state(pool, fixture);
    expect(afterRegister.registration).toMatchObject({ revision: "0", heartbeat_sequence: "0" });
    expect(afterRegister.process).toMatchObject({
      registration_state: "registered",
      readiness_state: "ready",
      runtime_version: "2.0.0",
      config_revision: "4",
      observed_revision: "1",
      pid: 1701,
      process_state: "online",
      liveness_state: "live",
      catalog_state: "valid",
      restart_count: 7,
    });
    expect(afterRegister.audit).toHaveLength(1);
    expect(afterRegister.audit[0]?.action).toBe("runtime.register");
    expect(afterRegister.audit[0]?.subject_type).toBe("runtime_registration");
    expect(afterRegister.audit[0]?.metadata).toMatchObject({ outcome: "created", revision: 0 });

    now = new Date("2026-07-28T00:00:01.000Z");
    await expect(
      service.heartbeat({ ...fixture.request(), sequence: 1, configRevision: 5 }, context()),
    ).resolves.toMatchObject({ outcome: "updated", registration: { revision: 1 } });
    const afterHeartbeat = await state(pool, fixture);
    expect(afterHeartbeat.registration).toMatchObject({ revision: "1", heartbeat_sequence: "1" });
    expect(afterHeartbeat.process).toMatchObject({
      config_revision: "5",
      observed_revision: "2",
      pid: 1701,
      process_state: "online",
      liveness_state: "live",
      catalog_state: "valid",
      restart_count: 7,
    });
    expect(afterHeartbeat.audit).toHaveLength(2);

    await expect(
      service.heartbeat({ ...fixture.request(), sequence: 1, configRevision: 5 }, context()),
    ).resolves.toMatchObject({ outcome: "unchanged" });
    expect((await state(pool, fixture)).audit).toHaveLength(2);
  });

  it("rolls Registration and Process back when success Audit cannot be appended", async () => {
    const fixture = await seed(pool, ++sequence);
    await installFailureTrigger(
      pool,
      "audit",
      "runtime_registration_fail_audit",
      "NEW.action = 'runtime.register'",
    );
    try {
      await expect(serviceFor(pool).register(fixture.request(), context())).rejects.toThrow(
        "forced audit failure",
      );
      const result = await state(pool, fixture);
      expect(result.registration).toBeNull();
      expect(result.process).toMatchObject({
        observed_revision: "0",
        registration_state: "unregistered",
      });
      expect(result.audit).toEqual([]);
    } finally {
      await removeFailureTrigger(pool, "audit", "runtime_registration_fail_audit");
    }
  });

  it("rolls Process and Audit back when Registration write fails", async () => {
    const fixture = await seed(pool, ++sequence);
    await installFailureTrigger(
      pool,
      "runtime_registration",
      "runtime_registration_fail_insert",
      "true",
    );
    try {
      await expect(serviceFor(pool).register(fixture.request(), context())).rejects.toThrow(
        "forced audit failure",
      );
      const result = await state(pool, fixture);
      expect(result.registration).toBeNull();
      expect(result.process).toMatchObject({
        observed_revision: "0",
        registration_state: "unregistered",
      });
      expect(result.audit).toEqual([]);
    } finally {
      await removeFailureTrigger(pool, "runtime_registration", "runtime_registration_fail_insert");
    }
  });

  it("rolls Registration and Audit back when the Process registration patch fails", async () => {
    const fixture = await seed(pool, ++sequence);
    await installFailureTrigger(pool, "runtime_process", "runtime_registration_fail_patch", "true");
    try {
      await expect(serviceFor(pool).register(fixture.request(), context())).rejects.toThrow(
        "forced audit failure",
      );
      const result = await state(pool, fixture);
      expect(result.registration).toBeNull();
      expect(result.process).toMatchObject({
        observed_revision: "0",
        registration_state: "unregistered",
      });
      expect(result.audit).toEqual([]);
    } finally {
      await removeFailureTrigger(pool, "runtime_process", "runtime_registration_fail_patch");
    }
  });

  it("enforces Provider scope and records a secret-free domain rejection separately", async () => {
    const fixture = await seed(pool, ++sequence);
    await expect(
      serviceFor(pool).register({ ...fixture.request(), providerId: "provider:B" }, context()),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND" });

    const result = await state(pool, fixture);
    expect(result.registration).toBeNull();
    expect(result.process).toMatchObject({ observed_revision: "0" });
    expect(result.audit).toHaveLength(1);
    const serializedAudit = JSON.stringify(result.audit[0]);
    expect(serializedAudit).toContain("RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND");
    expect(serializedAudit).not.toContain("session-transaction-secret");
    expect(serializedAudit).not.toContain("Bearer");
  });
});

function serviceFor(pool: Pool, now: () => Date = () => new Date("2026-07-28T00:00:00.000Z")) {
  return new RuntimeRegistrationService(
    new PostgresRuntimeRegistrationUnitOfWork(pool, { protocolVersion, now }),
    { now, heartbeatTtlMs: 30_000 },
  );
}

async function seed(pool: Pool, number: number) {
  const deploymentId = `deployment-uow-${String(number)}`;
  const instanceId = `instance-uow-${String(number)}`;
  await pool.query(
    `INSERT INTO runtime_deployment(
       deployment_id,provider_id,environment,desired_state,desired_replicas,
       runtime_version,database_profile_id,config_profile_id,status
     ) VALUES ($1,'provider:A','production','running',1,'2.0.0','database-profile','config-profile','REQUESTED')`,
    [deploymentId],
  );
  await pool.query(
    `INSERT INTO runtime_process(
       runtime_instance_id,deployment_id,environment,pm2_name,pid,port,
       process_state,liveness_state,readiness_state,registration_state,
       catalog_state,config_state,restart_count
     ) VALUES ($1,$2,'production',$3,1701,$4,'online','live','not_ready','unregistered','valid','current',7)`,
    [instanceId, deploymentId, `sdar-runtime-uow-${String(number)}`, 32000 + number],
  );
  return {
    deploymentId,
    instanceId,
    request() {
      return {
        providerId: "provider:A",
        deploymentId,
        instanceId,
        sessionId: "session-transaction-secret",
        runtimeVersion: "2.0.0",
        protocolVersion,
        configRevision: 4,
        readinessState: "ready" as const,
      };
    },
  };
}

function context() {
  return { subjectId: "runtime-uow", requestId: "request-uow", correlationId: "correlation-uow" };
}

async function state(
  pool: Pool,
  fixture: Awaited<ReturnType<typeof seed>>,
): Promise<{
  readonly registration: Record<string, unknown> | null;
  readonly process: Record<string, unknown>;
  readonly audit: readonly Record<string, unknown>[];
}> {
  const [registration, process, audit] = await Promise.all([
    pool.query<TestRow>("SELECT * FROM runtime_registration WHERE runtime_instance_id=$1", [
      fixture.instanceId,
    ]),
    pool.query<TestRow>("SELECT * FROM runtime_process WHERE runtime_instance_id=$1", [
      fixture.instanceId,
    ]),
    pool.query<TestRow>(
      "SELECT action,subject_type,metadata FROM audit WHERE subject_id=$1 ORDER BY occurred_at,audit_event_id",
      [`${fixture.deploymentId}:${fixture.instanceId}`],
    ),
  ]);
  return {
    registration: registration.rows[0] ?? null,
    process: process.rows[0] ?? {},
    audit: audit.rows,
  };
}

type TestRow = QueryResultRow & Readonly<Record<string, unknown>>;

async function installFailureTrigger(
  pool: Pool,
  table: "audit" | "runtime_registration" | "runtime_process",
  trigger: string,
  condition: string,
): Promise<void> {
  const functionName = `${trigger}_function`;
  await pool.query(
    `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF ${condition} THEN RAISE EXCEPTION 'forced audit failure'; END IF;
         RETURN NEW;
       END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON ${table}
       FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
  );
}

async function removeFailureTrigger(
  pool: Pool,
  table: "audit" | "runtime_registration" | "runtime_process",
  trigger: string,
): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${trigger}_function()`);
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
