import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../../pms-application/src/index.js";
import { postgresRepositories, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("PMS Audit and Job Lease foundations", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_audit_jobs_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("requires actor/correlation context and persists it with every Audit event", async () => {
    const repository = postgresRepositories(pool).audit;
    const service = new AuditService(repository, {
      newId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    await expect(
      service.record(
        { actorId: "", correlationId: "request-1" },
        { action: "provider.created", subjectType: "provider", subjectId: "provider-1" },
      ),
    ).rejects.toThrow("PMS_AUDIT_CONTEXT_INVALID");

    const event = await service.record(
      { actorId: "admin-1", correlationId: "request-1" },
      {
        action: "provider.created",
        subjectType: "provider",
        subjectId: "provider-1",
        metadata: { source: "console" },
      },
    );
    expect(event).toMatchObject({ actorId: "admin-1", correlationId: "request-1" });
    expect((await repository.list({ correlationId: "request-1", limit: 10 })).items).toHaveLength(
      1,
    );
  });

  it("rejects Audit update and delete at the database boundary", async () => {
    await expect(
      pool.query(
        `UPDATE audit SET action='tampered'
          WHERE audit_event_id='11111111-1111-4111-8111-111111111111'`,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(
        `DELETE FROM audit
          WHERE audit_event_id='11111111-1111-4111-8111-111111111111'`,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    expect(await count("audit")).toBe(1);
  });

  it("lets two workers race without claiming the same job", async () => {
    const first = postgresRepositories(pool).jobs;
    const second = postgresRepositories(pool).jobs;
    await first.enqueue({ jobId: "race-job", jobType: "reconcile", payload: {} });

    const [firstClaims, secondClaims] = await Promise.all([
      first.claim({
        owner: "worker-1",
        jobTypes: ["reconcile"],
        limit: 1,
        leaseDurationMs: 30_000,
      }),
      second.claim({
        owner: "worker-2",
        jobTypes: ["reconcile"],
        limit: 1,
        leaseDurationMs: 30_000,
      }),
    ]);
    const claims = [...firstClaims, ...secondClaims];

    expect(claims).toHaveLength(1);
    expect(new Set(claims.map(({ job }) => job.jobId)).size).toBe(1);
    const claim = claims[0];
    if (claim === undefined) throw new Error("RACE_JOB_NOT_CLAIMED");
    await first.complete(identity(claim));
  });

  it("recovers an expired lease with a higher fence and rejects the stale owner", async () => {
    const jobs = postgresRepositories(pool).jobs;
    await jobs.enqueue({ jobId: "expiry-job", jobType: "config.publish", payload: {} });
    const original = (
      await jobs.claim({
        owner: "worker-old",
        jobTypes: ["config.publish"],
        limit: 1,
        leaseDurationMs: 30_000,
      })
    )[0];
    if (original === undefined) throw new Error("ORIGINAL_LEASE_NOT_CLAIMED");
    await pool.query(
      `UPDATE job_lease
          SET lease_expires_at=clock_timestamp()-interval '1 second'
        WHERE job_id='expiry-job'`,
    );

    const recovered = (
      await jobs.claim({
        owner: "worker-new",
        jobTypes: ["config.publish"],
        limit: 1,
        leaseDurationMs: 30_000,
      })
    )[0];
    if (recovered === undefined) throw new Error("EXPIRED_LEASE_NOT_RECOVERED");

    expect(recovered.owner).toBe("worker-new");
    expect(recovered.fencingToken).toBe(original.fencingToken + 1n);
    await expect(jobs.renew(identity(original), 30_000)).rejects.toMatchObject({
      code: "LEASE_NOT_OWNED",
    });
    await expect(jobs.release(identity(original))).rejects.toMatchObject({
      code: "LEASE_NOT_OWNED",
    });

    const databaseNow = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const databaseTimestamp = databaseNow.rows[0]?.now;
    if (databaseTimestamp === undefined) throw new Error("DATABASE_TIME_NOT_RETURNED");
    const renewed = await jobs.renew(identity(recovered), 60_000);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(databaseTimestamp.getTime());
    await jobs.release(identity(renewed));

    const reclaimed = (
      await jobs.claim({
        owner: "worker-third",
        jobTypes: ["config.publish"],
        limit: 1,
        leaseDurationMs: 30_000,
      })
    )[0];
    expect(reclaimed?.fencingToken).toBe(renewed.fencingToken + 1n);
  });

  async function count(table: "audit"): Promise<number> {
    const result = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    return Number(result.rows[0]?.count ?? 0);
  }
});

function identity(lease: {
  readonly job: { readonly jobId: string };
  readonly owner: string;
  readonly token: string;
  readonly fencingToken: bigint;
}) {
  return {
    jobId: lease.job.jobId,
    owner: lease.owner,
    token: lease.token,
    fencingToken: lease.fencingToken,
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
