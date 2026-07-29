import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  databaseProfileId,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeProviderId,
} from "@sdar/runtime-deployment";
import {
  PostgresRuntimeInstanceAllocator,
  postgresRuntimeDeploymentRepositories,
  runPmsMigrations,
} from "../src/index.js";

describe("PostgreSQL Runtime instance allocation", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_instance_${randomUUID().replaceAll("-", "")}`;
  const providerId = "provider:allocation";
  const deploymentId = "deployment:allocation";
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, resolve(import.meta.dirname, "../../.."));
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('test.provider','Test','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES ($1,'test.provider','vendor_managed','active')`,
      [providerId],
    );
    await postgresRuntimeDeploymentRepositories(pool).deployments.insert(
      requestRuntimeDeployment(
        {
          deploymentId: runtimeDeploymentId(deploymentId),
          providerId: runtimeProviderId(providerId),
          environment: runtimeEnvironmentId("production"),
          desiredState: "running",
          desiredReplicas: 1,
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: databaseProfileId("database-allocation"),
          configProfileId: runtimeConfigProfileId("config-allocation"),
        },
        new Date("2026-07-26T00:00:00.000Z"),
      ).snapshot,
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it("serializes concurrent leases, replays identity, and explicitly reuses released ports", async () => {
    const allocator = new PostgresRuntimeInstanceAllocator(pool);
    const base = {
      providerId,
      deploymentId,
      portRange: { start: 32_000, end: 32_001 },
    };
    const [first, second] = await Promise.all([
      allocator.allocate({ ...base, ordinal: 0 }),
      allocator.allocate({ ...base, ordinal: 1 }),
    ]);
    expect(new Set([first.port, second.port])).toEqual(new Set([32_000, 32_001]));
    expect(await allocator.allocate({ ...base, ordinal: 0 })).toEqual(first);
    await expect(allocator.allocate({ ...base, ordinal: 2 })).rejects.toMatchObject({
      code: "RUNTIME_PORT_RANGE_EXHAUSTED",
    });

    expect(
      await allocator.release(
        { ...base, ordinal: 0 },
        {
          kind: "explicit-runtime-port-release",
          providerId,
          deploymentId,
          instanceId: first.instanceId,
          reason: "controlled integration cleanup",
        },
      ),
    ).toBe("released");
    const reused = await allocator.allocate({ ...base, ordinal: 2 });
    expect(reused.port).toBe(first.port);
    expect(reused.instanceId).not.toBe(first.instanceId);
  });
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
