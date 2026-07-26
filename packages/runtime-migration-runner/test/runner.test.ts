import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RuntimeMigrationRunner,
  RuntimeMigrationRunnerError,
  type RuntimeMigrationEngine,
  type RuntimeMigrationRequest,
} from "../src/index.js";

describe("RuntimeMigrationRunner controlled PostgreSQL integration", () => {
  const workspaceRoot = resolve(import.meta.dirname, "../../..");
  const rootUrl = requiredDatabaseUrl();
  const databaseName = `sdar_migration_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const root = new Pool({ connectionString: rootUrl });
  let pool: Pool;
  let lockClient: PoolClient | undefined;

  beforeAll(async () => {
    await root.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    pool = new Pool({ connectionString: connectionUrl(rootUrl, databaseName), max: 6 });
  });

  afterAll(async () => {
    if (lockClient !== undefined) {
      await lockClient
        .query("SELECT pg_advisory_unlock(hashtext('sdar_runtime_migrations'))")
        .catch(() => undefined);
      lockClient.release();
    }
    await pool.end();
    await root.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await root.end();
  });

  it("allows only one concurrent engine execution and records full checksum evidence", async () => {
    const runner = realRunner(pool, 10_000);
    const [left, right] = await Promise.all([runner.run(request()), runner.run(request())]);
    const outcomes = [left, right].map(
      (evidence) => new Set(evidence.migrations.map(({ outcome }) => outcome)),
    );

    expect(left.status).toBe("PASS");
    expect(right.status).toBe("PASS");
    expect(left.migrations).toHaveLength(24);
    expect(right.migrations).toHaveLength(24);
    expect(outcomes).toContainEqual(new Set(["applied"]));
    expect(outcomes).toContainEqual(new Set(["already_applied"]));
    for (const evidence of [left, right]) {
      expect(evidence).toMatchObject({
        runtimeVersion: "2.0.0-rc.1",
        migrationSet: "runtime",
      });
      expect(evidence.migrations.every(({ checksum }) => /^[0-9a-f]{64}$/.test(checksum))).toBe(
        true,
      );
      expect(evidence.migrations.some(({ version }) => version.includes("024_"))).toBe(false);
      expect(evidence.migrations.some(({ version }) => version.includes("025_"))).toBe(false);
    }

    const history = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM runtime_schema_migration",
    );
    expect(history.rows).toEqual([{ count: 24 }]);
  });

  it("times out advisory-lock waits with redacted failure evidence", async () => {
    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock(hashtext('sdar_runtime_migrations'))");
    const runner = realRunner(pool, 100);

    let caught: unknown;
    try {
      await runner.run(request());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "RUNTIME_MIGRATION_TIMEOUT",
      retryable: true,
      evidence: {
        status: "FAIL",
        runtimeVersion: "2.0.0-rc.1",
        migrationSet: "runtime",
        error: { code: "RUNTIME_MIGRATION_TIMEOUT", retryable: true },
      },
    });
    expect(caught).toBeInstanceOf(RuntimeMigrationRunnerError);
    if (!(caught instanceof RuntimeMigrationRunnerError)) {
      throw new Error("EXPECTED_RUNTIME_MIGRATION_ERROR");
    }
    expect(caught.evidence.migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: "001_operation_snapshot.sql",
          outcome: "present_after_failure",
        }),
      ]),
    );
    await lockClient.query("SELECT pg_advisory_unlock(hashtext('sdar_runtime_migrations'))");
    lockClient.release();
    lockClient = undefined;
  });

  it("preserves database state on execution failure and emits no rollback SQL", async () => {
    const failingEngine: RuntimeMigrationEngine = async (target) => {
      await target.query("CREATE TABLE migration_failure_preserved(marker text NOT NULL)");
      throw Object.assign(new Error("controlled migration failure"), { code: "42601" });
    };
    const runner = new RuntimeMigrationRunner(pool, {
      supportedRuntimeVersions: ["2.0.0-rc.1"],
      timeoutMs: 1_000,
      workspaceRoot,
      engine: failingEngine,
    });

    await expect(runner.run(request("deployment-failure"))).rejects.toMatchObject({
      code: "RUNTIME_MIGRATION_EXECUTION_FAILED",
      retryable: false,
      evidence: {
        status: "FAIL",
        error: {
          code: "RUNTIME_MIGRATION_EXECUTION_FAILED",
          retryable: false,
        },
      },
    });
    const preserved = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('migration_failure_preserved') IS NOT NULL AS present",
    );
    expect(preserved.rows).toEqual([{ present: true }]);
  });

  it("rejects unsupported versions and checksum drift with stable non-retryable codes", async () => {
    await expect(
      realRunner(pool, 1_000).run({
        ...request("deployment-version"),
        runtimeVersion: "9.9.9",
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_MIGRATION_VERSION_UNSUPPORTED",
      retryable: false,
    });
    const checksumEngine: RuntimeMigrationEngine = () =>
      Promise.reject(new Error("MIGRATION_CHECKSUM_MISMATCH:001_operation_snapshot.sql"));
    await expect(
      new RuntimeMigrationRunner(pool, {
        supportedRuntimeVersions: ["2.0.0-rc.1"],
        timeoutMs: 1_000,
        workspaceRoot,
        engine: checksumEngine,
      }).run(request("deployment-checksum")),
    ).rejects.toMatchObject({
      code: "RUNTIME_MIGRATION_CHECKSUM_MISMATCH",
      retryable: false,
    });
  });
});

function realRunner(pool: Pool, timeoutMs: number): RuntimeMigrationRunner {
  return new RuntimeMigrationRunner(pool, {
    supportedRuntimeVersions: ["2.0.0-rc.1"],
    timeoutMs,
    workspaceRoot: resolve(import.meta.dirname, "../../.."),
  });
}

function request(deploymentId = "deployment-1"): RuntimeMigrationRequest {
  return {
    deploymentId,
    providerId: "provider-1",
    runtimeVersion: "2.0.0-rc.1",
    migrationSet: "runtime",
  };
}

function connectionUrl(source: string, databaseName: string): string {
  const value = new URL(source);
  value.pathname = `/${databaseName}`;
  return value.toString();
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("UNSAFE_TEST_DATABASE_NAME");
  return `"${value}"`;
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
