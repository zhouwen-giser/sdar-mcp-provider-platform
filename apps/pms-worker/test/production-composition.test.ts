import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
  BootstrapConfigRenderer,
  CURRENT_RUNTIME_RELEASE_MANIFEST,
  Pm2ProcessManager,
  RuntimeHealthProbe,
  RuntimeLifecycleManager,
  RuntimeReleaseResolver,
} from "../../../packages/pm2-runtime-adapter/src/index.js";
import type { PmsWorkerConfig } from "../src/config.js";
import { createPmsWorkerProductionComposition } from "../src/composition.js";

const roots: string[] = [];
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(testDatabaseUrl === undefined)("PMS Worker production composition", () => {
  it("assembles the complete runtime lifecycle and exactly two external jobs", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const fixture = await productionConfig(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const composition = await createPmsWorkerProductionComposition(pool, fixture.config);
    try {
      expect(composition.registry.jobTypes()).toEqual([
        "provider_package.sync",
        "runtime_deployment.reconcile",
      ]);
      expect(composition.runtime.components.databasePreparation).toBeTypeOf("object");
      expect(composition.runtime.components.provisioner).toBeTypeOf("object");
      expect(composition.runtime.components.provisioningCredentialResolver).toBeTypeOf("object");
      expect(composition.runtime.components.runtimeMigrationRunner).toBeTypeOf("object");
      for (const repository of Object.values(composition.runtime.components.repositories)) {
        expect(repository).toBeTypeOf("object");
      }
      expect(composition.runtime.components.releaseResolver).toBeInstanceOf(RuntimeReleaseResolver);
      expect(composition.runtime.components.processManager).toBeInstanceOf(Pm2ProcessManager);
      expect(composition.runtime.components.lifecycle).toBeInstanceOf(RuntimeLifecycleManager);
      expect(composition.runtime.components.health).toBeInstanceOf(RuntimeHealthProbe);
      expect(BootstrapConfigRenderer).toBeTypeOf("function");
      await composition.close();
      await composition.close();
      expect(await pool.query("SELECT 1 AS ready")).toMatchObject({
        rows: [{ ready: 1 }],
      });
    } finally {
      await composition.close();
      await pool.end();
    }
  });

  it("fails closed before timers or PM2 connections when release authority is invalid", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const fixture = await productionConfig(databaseUrl);
    await writeFile(
      join(fixture.releaseRoot, "runtime-releases.json"),
      JSON.stringify({ schemaVersion: 1, releases: [] }),
    );
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await expect(
        createPmsWorkerProductionComposition(pool, fixture.config),
      ).rejects.toMatchObject({ code: "RUNTIME_RELEASE_MANIFEST_INVALID" });
      expect(await pool.query("SELECT 1 AS ready")).toMatchObject({
        rows: [{ ready: 1 }],
      });
    } finally {
      await pool.end();
    }
  });
});

function requireTestDatabaseUrl(): string {
  if (testDatabaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");
  return testDatabaseUrl;
}

async function productionConfig(databaseUrl: string): Promise<{
  readonly config: PmsWorkerConfig;
  readonly releaseRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "sdar-worker-composition-"));
  roots.push(root);
  const releaseRoot = join(root, "releases");
  const secretRoot = join(root, "secrets");
  const cacheRoot = join(root, "cache");
  const pm2Home = join(root, "pm2");
  await Promise.all(
    [releaseRoot, secretRoot, cacheRoot, pm2Home].map((directory) =>
      mkdir(directory, { mode: 0o700 }),
    ),
  );
  const credentialFile = join(root, "provisioning.json");
  await writeFile(
    credentialFile,
    JSON.stringify({
      clusterRef: "local-test-postgres",
      adminSecretRef: "file/test/provisioning-admin",
      adminDatabaseUrl: databaseUrl,
      runtimePassword: "runtime-test-password-04",
    }),
    { mode: 0o600 },
  );
  await chmod(credentialFile, 0o600);
  await writeFile(
    join(releaseRoot, "runtime-releases.json"),
    JSON.stringify(CURRENT_RUNTIME_RELEASE_MANIFEST),
  );
  return {
    releaseRoot,
    config: Object.freeze({
      databaseUrlFile: join(root, "database-url"),
      workerId: "production-composition-test",
      pollIntervalMs: 1_000,
      leaseDurationMs: 5_000,
      claimLimit: 5,
      retryDelayMs: 1_000,
      workspaceRoot: process.cwd(),
      runtime: Object.freeze({
        postgresProvisioningCredentialFile: credentialFile,
        runtimeReleaseRoot: releaseRoot,
        runtimeSecretRoot: secretRoot,
        runtimeConfigCacheRoot: cacheRoot,
        pm2Home,
        runtimeReconcileIntervalMs: 1_000,
        runtimeReconcileTimeoutMs: 5_000,
        runtimeHealthTimeoutMs: 1_000,
      }),
    }),
  };
}
