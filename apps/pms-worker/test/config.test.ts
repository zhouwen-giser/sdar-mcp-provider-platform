import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPmsWorkerConfig, requirePmsWorkerRuntimeConfig } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

describe("PMS Worker production Runtime configuration", () => {
  it("loads an explicit secure Runtime lifecycle configuration without changing lease settings", async () => {
    const fixture = await secureFixture();

    const config = await loadPmsWorkerConfig({
      ...fixture.environment,
      PMS_WORKER_LEASE_DURATION_MS: "45000",
      PMS_WORKER_CLAIM_LIMIT: "17",
      PMS_WORKER_RETRY_DELAY_MS: "7000",
    });

    expect(config).toMatchObject({
      leaseDurationMs: 45_000,
      claimLimit: 17,
      retryDelayMs: 7_000,
    });
    expect(requirePmsWorkerRuntimeConfig(config)).toEqual({
      postgresProvisioningCredentialFile: fixture.provisioningCredential,
      runtimeReleaseRoot: fixture.releaseRoot,
      runtimeSecretRoot: fixture.secretRoot,
      runtimeConfigCacheRoot: fixture.cacheRoot,
      runtimeControlPlaneUrl: "http://127.0.0.1:8090/",
      runtimeControlPlaneCredentialRoot: fixture.controlPlaneCredentialRoot,
      pm2Home: fixture.pm2Home,
      runtimeReconcileIntervalMs: 15_000,
      runtimeReconcileTimeoutMs: 120_000,
      runtimeHealthTimeoutMs: 5_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.runtime)).toBe(true);
  });

  it("preserves foundation-only configuration but rejects a partial production configuration", async () => {
    const fixture = await secureFixture();
    const foundation = await loadPmsWorkerConfig({
      PMS_DATABASE_URL_FILE: fixture.databaseUrl,
    });

    expect(foundation.runtime).toBeUndefined();
    expect(() => requirePmsWorkerRuntimeConfig(foundation)).toThrow(
      "PMS_WORKER_RUNTIME_CONFIG_REQUIRED",
    );
    await expect(
      loadPmsWorkerConfig({
        PMS_DATABASE_URL_FILE: fixture.databaseUrl,
        PMS_RUNTIME_RELEASE_ROOT: fixture.releaseRoot,
      }),
    ).rejects.toThrow("PMS_WORKER_CONFIG_REQUIRED:PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE");
  });

  it.each([
    ["PMS_DATABASE_URL", "PMS_WORKER_INLINE_DATABASE_SECRET_REJECTED"],
    ["PMS_POSTGRES_PROVISIONING_PASSWORD", "PMS_WORKER_INLINE_PROVISIONING_SECRET_REJECTED"],
    ["PMS_RUNTIME_CONFIG_TOKEN", "PMS_WORKER_INLINE_RUNTIME_SECRET_REJECTED"],
    ["PMS_PM2_SECRET", "PMS_WORKER_INLINE_PM2_SECRET_REJECTED"],
  ])("rejects inline secret input %s", async (name, code) => {
    const fixture = await secureFixture();

    await expect(
      loadPmsWorkerConfig({ ...fixture.environment, [name]: "plaintext-secret" }),
    ).rejects.toThrow(code);
  });

  it.skipIf(process.platform === "win32")(
    "rejects empty, broad-permission and symlink secret files",
    async () => {
      const fixture = await secureFixture();
      const empty = join(fixture.directory, "empty");
      await writeFile(empty, "", { mode: 0o600 });
      await expect(
        loadPmsWorkerConfig({ ...fixture.environment, PMS_DATABASE_URL_FILE: empty }),
      ).rejects.toThrow("PMS_WORKER_SECRET_FILE_INVALID:PMS_DATABASE_URL_FILE");

      await chmod(fixture.provisioningCredential, 0o640);
      await expect(loadPmsWorkerConfig(fixture.environment)).rejects.toThrow(
        "PMS_WORKER_SECRET_FILE_PERMISSIONS:PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE",
      );
      await chmod(fixture.provisioningCredential, 0o600);

      const link = join(fixture.directory, "credential-link");
      await symlink(fixture.provisioningCredential, link);
      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE: link,
        }),
      ).rejects.toThrow("PMS_WORKER_SECRET_FILE_INVALID:PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE");
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects unsafe and overlapping Runtime roots",
    async () => {
      const fixture = await secureFixture();
      await chmod(fixture.pm2Home, 0o755);
      await expect(loadPmsWorkerConfig(fixture.environment)).rejects.toThrow(
        "PMS_WORKER_ROOT_PERMISSIONS:PMS_PM2_HOME",
      );
      await chmod(fixture.pm2Home, 0o700);

      const rootLink = join(fixture.directory, "release-link");
      await symlink(fixture.releaseRoot, rootLink, "dir");
      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_RUNTIME_RELEASE_ROOT: rootLink,
        }),
      ).rejects.toThrow("PMS_WORKER_ROOT_INVALID:PMS_RUNTIME_RELEASE_ROOT");

      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_RUNTIME_CONFIG_CACHE_ROOT: fixture.secretRoot,
        }),
      ).rejects.toThrow("PMS_WORKER_ROOT_OVERLAP");

      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT: fixture.secretRoot,
        }),
      ).rejects.toThrow("PMS_WORKER_ROOT_OVERLAP");

      const nested = join(fixture.releaseRoot, "nested");
      await mkdir(nested, { mode: 0o700 });
      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_RUNTIME_SECRET_ROOT: nested,
        }),
      ).rejects.toThrow("PMS_WORKER_ROOT_OVERLAP");
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a secret file under a group-writable parent",
    async () => {
      const fixture = await secureFixture();
      const unsafeParent = join(fixture.directory, "unsafe-parent");
      const unsafeFile = join(unsafeParent, "database-url");
      await mkdir(unsafeParent, { mode: 0o700 });
      await writeFile(unsafeFile, "postgresql://local-only\n", { mode: 0o600 });
      await chmod(unsafeParent, 0o770);

      await expect(
        loadPmsWorkerConfig({
          ...fixture.environment,
          PMS_DATABASE_URL_FILE: unsafeFile,
        }),
      ).rejects.toThrow("PMS_WORKER_SECRET_PARENT_UNSAFE:PMS_DATABASE_URL_FILE");
    },
  );

  it("rejects out-of-range and inverted Runtime timing bounds", async () => {
    const fixture = await secureFixture();
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_RECONCILE_INTERVAL_MS: "0",
      }),
    ).rejects.toThrow("PMS_WORKER_CONFIG_BOUNDS");
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_RECONCILE_TIMEOUT_MS: "1000",
        PMS_RUNTIME_HEALTH_TIMEOUT_MS: "5000",
      }),
    ).rejects.toThrow("PMS_WORKER_RUNTIME_TIMEOUT_ORDER_INVALID");
  });

  it("loads an explicit isolated Runtime port range", async () => {
    const fixture = await secureFixture();
    const config = await loadPmsWorkerConfig({
      ...fixture.environment,
      PMS_RUNTIME_PORT_RANGE_START: "28180",
      PMS_RUNTIME_PORT_RANGE_END: "28199",
    });

    expect(requirePmsWorkerRuntimeConfig(config).runtimePortRange).toEqual({
      start: 28_180,
      end: 28_199,
    });
  });

  it("rejects partial, inverted and oversized Runtime port ranges", async () => {
    const fixture = await secureFixture();
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_PORT_RANGE_START: "28180",
      }),
    ).rejects.toThrow("PMS_WORKER_RUNTIME_PORT_RANGE_PAIR_REQUIRED");
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_PORT_RANGE_START: "28199",
        PMS_RUNTIME_PORT_RANGE_END: "28180",
      }),
    ).rejects.toThrow("PMS_WORKER_CONFIG_BOUNDS");
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_PORT_RANGE_START: "20000",
        PMS_RUNTIME_PORT_RANGE_END: "30001",
      }),
    ).rejects.toThrow("PMS_WORKER_CONFIG_BOUNDS");
  });

  it("rejects the legacy global Runtime token file without fallback", async () => {
    const fixture = await secureFixture();
    await expect(
      loadPmsWorkerConfig({
        ...fixture.environment,
        PMS_RUNTIME_CONTROL_PLANE_TOKEN_FILE: fixture.databaseUrl,
      }),
    ).rejects.toThrow("PMS_WORKER_LEGACY_RUNTIME_TOKEN_FILE_REJECTED");
  });
});

async function secureFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pms-worker-production-config-"));
  temporaryDirectories.push(directory);
  const databaseUrl = join(directory, "database-url");
  const provisioningCredential = join(directory, "provisioning-credential");
  const controlPlaneCredentialRoot = join(directory, "control-plane-credentials");
  const releaseRoot = join(directory, "releases");
  const secretRoot = join(directory, "secrets");
  const cacheRoot = join(directory, "runtime-config-cache");
  const pm2Home = join(directory, "pm2");
  await Promise.all([
    writeFile(databaseUrl, "postgresql://local-only\n", { mode: 0o600 }),
    writeFile(provisioningCredential, '{"secretRef":"local-only"}\n', { mode: 0o600 }),
    mkdir(releaseRoot, { mode: 0o755 }),
    mkdir(secretRoot, { mode: 0o700 }),
    mkdir(cacheRoot, { mode: 0o700 }),
    mkdir(controlPlaneCredentialRoot, { mode: 0o700 }),
    mkdir(pm2Home, { mode: 0o700 }),
  ]);
  const environment = {
    PMS_DATABASE_URL_FILE: databaseUrl,
    PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE: provisioningCredential,
    PMS_RUNTIME_RELEASE_ROOT: releaseRoot,
    PMS_RUNTIME_SECRET_ROOT: secretRoot,
    PMS_RUNTIME_CONFIG_CACHE_ROOT: cacheRoot,
    PMS_RUNTIME_CONTROL_PLANE_URL: "http://127.0.0.1:8090",
    PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT: controlPlaneCredentialRoot,
    PMS_PM2_HOME: pm2Home,
    PMS_RUNTIME_RECONCILE_INTERVAL_MS: "15000",
    PMS_RUNTIME_RECONCILE_TIMEOUT_MS: "120000",
    PMS_RUNTIME_HEALTH_TIMEOUT_MS: "5000",
  };
  return {
    directory,
    databaseUrl,
    provisioningCredential,
    controlPlaneCredentialRoot,
    releaseRoot,
    secretRoot,
    cacheRoot,
    pm2Home,
    environment,
  };
}
