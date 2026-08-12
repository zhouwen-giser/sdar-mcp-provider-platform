import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PMS_API_FROZEN_PROTOCOL_VERSION,
  assertCredentialFile,
  hashSecretToken,
  loadPmsApiBootstrapConfig,
} from "../src/config.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("PMS API bootstrap config", () => {
  it("loads valid config with stable protocol binding", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const config = await loadPmsApiBootstrapConfig(baseEnvironment(fixture));

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8090);
    expect(config.runtimeHeartbeatTtlMs).toBe(30_000);
    expect(config.sdarRegistryProjectionTtlSeconds).toBe(2_592_000);
    expect(config.managementAuthMode).toBe("file_credentials");
    expect(config.databaseUrl).toBe("postgresql://127.0.0.1:5432/pms_runtime");
    expect(config.management.readers).toMatchObject([
      {
        subjectId: "reader-1",
        roles: ["reader"],
        tokenDigest: hashSecretToken("management-reader-token"),
      },
    ]);
    expect(config.management.administrators).toMatchObject([
      {
        subjectId: "administrator-1",
        roles: ["administrator"],
        tokenDigest: hashSecretToken("management-admin-token"),
      },
    ]);
    expect(config.runtime.config[0]).toMatchObject({
      subjectId: "runtime-identity-1",
      providerId: "provider-a",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      runtimeVersion: "2.0.0",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
      tokenDigest: hashSecretToken("runtime-config-token"),
    });
    expect(config.runtime.registration[0]).toMatchObject({
      subjectId: "runtime-identity-1",
      providerId: "provider-a",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      runtimeVersion: "2.0.0",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
      tokenDigest: hashSecretToken("runtime-registration-token"),
    });
  });

  it("requires an explicit insecure-transport opt-in for anonymous intranet management", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const withoutManagementFile = { ...baseEnvironment(fixture) };
    delete withoutManagementFile.PMS_MANAGEMENT_CREDENTIAL_FILE;

    const config = await loadPmsApiBootstrapConfig({
      ...withoutManagementFile,
      PMS_API_MANAGEMENT_AUTH_MODE: "anonymous_intranet",
      ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
    });
    expect(config).toMatchObject({
      managementAuthMode: "anonymous_intranet",
      runtimeCredentialFile: fixture.runtimeCredentialPath,
    });
    expect(config).not.toHaveProperty("managementCredentialFile");
    expect(config.management).toEqual({ readers: [], administrators: [] });

    for (const optIn of [undefined, "false", "TRUE", "1"]) {
      await expect(
        loadPmsApiBootstrapConfig({
          ...withoutManagementFile,
          PMS_API_MANAGEMENT_AUTH_MODE: "anonymous_intranet",
          ...(optIn === undefined ? {} : { ALLOW_INSECURE_INTERNAL_TRANSPORT: optIn }),
        }),
      ).rejects.toMatchObject({
        code: "PMS_API_ANONYMOUS_INTRANET_TRANSPORT_OPT_IN_REQUIRED",
      });
    }
  });

  it("rejects unknown management auth modes and still requires Runtime credentials", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    for (const mode of ["", "file", "anonymous", "ANONYMOUS_INTRANET"]) {
      await expect(
        loadPmsApiBootstrapConfig({
          ...baseEnvironment(fixture),
          PMS_API_MANAGEMENT_AUTH_MODE: mode,
          ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
        }),
      ).rejects.toMatchObject({ code: "PMS_API_MANAGEMENT_AUTH_MODE_INVALID" });
    }

    const withoutCredentialFiles = { ...baseEnvironment(fixture) };
    delete withoutCredentialFiles.PMS_MANAGEMENT_CREDENTIAL_FILE;
    delete withoutCredentialFiles.PMS_RUNTIME_CREDENTIAL_FILE;
    await expect(
      loadPmsApiBootstrapConfig({
        ...withoutCredentialFiles,
        PMS_API_MANAGEMENT_AUTH_MODE: "anonymous_intranet",
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      }),
    ).rejects.toMatchObject({ code: "PMS_API_RUNTIME_CREDENTIAL_FILE_NOT_CONFIGURED" });
  });

  it("loads and validates the fixed SDAR Registry projection TTL", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });

    await expect(
      loadPmsApiBootstrapConfig(
        baseEnvironment(fixture, { SDAR_REGISTRY_PROJECTION_TTL_SECONDS: "3600" }),
      ),
    ).resolves.toMatchObject({ sdarRegistryProjectionTtlSeconds: 3_600 });
    await expect(
      loadPmsApiBootstrapConfig(
        baseEnvironment(fixture, { SDAR_REGISTRY_PROJECTION_TTL_SECONDS: "2592001" }),
      ),
    ).resolves.toMatchObject({ sdarRegistryProjectionTtlSeconds: 2_592_001 });

    for (const value of ["0", "9007199254740992", "1.5", "3600seconds", ""]) {
      await expect(
        loadPmsApiBootstrapConfig(
          baseEnvironment(fixture, { SDAR_REGISTRY_PROJECTION_TTL_SECONDS: value }),
        ),
      ).rejects.toMatchObject({
        code: "PMS_API_SDAR_REGISTRY_PROJECTION_TTL_SECONDS_INVALID",
      });
    }
  });

  it("rejects disallowed inline secret environment variables", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const base = baseEnvironment(fixture);
    for (const variable of [
      "PMS_DATABASE_URL",
      "DATABASE_URL",
      "PMS_ADMIN_TOKEN",
      "PMS_MANAGEMENT_TOKEN",
      "PMS_RUNTIME_TOKEN",
      "PMS_RUNTIME_CONFIG_TOKEN",
      "PMS_RUNTIME_REGISTRATION_TOKEN",
    ]) {
      await expect(
        loadPmsApiBootstrapConfig({
          ...base,
          [variable]: "not-allowed-secret",
        }),
      ).rejects.toMatchObject({ code: "PMS_API_INLINE_SECRET_REJECTED" });
      const reason = await loadPmsApiBootstrapConfig({
        ...base,
        [variable]: "not-allowed-secret",
      }).catch((value: unknown) => value);
      expect(errorMessage(reason)).not.toContain("not-allowed-secret");
    }
  });

  it("rejects missing credential file paths", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const removedManagement = fixture.managementCredentialPath;
    await rm(removedManagement, { force: true });

    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_READ_ERROR",
    });
  });

  it("rejects relative credential file paths", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });

    await expect(
      loadPmsApiBootstrapConfig({
        ...baseEnvironment(fixture),
        PMS_MANAGEMENT_CREDENTIAL_FILE: "relative-management.json",
      }),
    ).rejects.toMatchObject({ code: "PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE" });
  });

  it("rejects non-absolute credential paths with assertCredentialFile", async () => {
    await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });

    await expect(
      assertCredentialFile("relative/path/to/token", "PMS_API_CREDENTIAL_PATH_NOT_FILE"),
    ).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE",
    });
  });

  it("rejects plain token in credential descriptors", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    await writeManagementCredential({
      root: fixture.root,
      managementCredentialPath: fixture.managementCredentialPath,
      managementReaderToken: fixture.managementReaderTokenPath,
      managementAdministratorToken: fixture.managementAdministratorTokenPath,
    });
    await writeRuntimeCredentials({
      root: fixture.root,
      runtimeCredentialPath: fixture.runtimeCredentialPath,
      runtimeConfigTokenFile: fixture.runtimeConfigTokenPath,
      runtimeRegistrationTokenFile: fixture.runtimeRegistrationTokenPath,
      runtimeVersion: "2.0.0",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
      allowTokenInline: true,
    });

    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_DESCRIPTOR_PLAINTEXT_TOKEN",
    });
  });

  it("rejects non-file and symlink token locations", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const fakeDir = join(fixture.root, "token-dir");
    await mkdir(fakeDir);
    await expect(
      loadPmsApiBootstrapConfig({
        ...baseEnvironment(fixture),
        PMS_RUNTIME_CREDENTIAL_FILE: fakeDir,
      }),
    ).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_PATH_NOT_FILE",
    });

    if (process.platform === "win32") {
      // File symlinks require a Windows privilege that is not guaranteed in CI.
      // The non-file rejection above remains the portable safety assertion; the
      // file-symlink assertion runs on Unix and in the Linux verification job.
      return;
    }

    const symlinkTarget = join(fixture.root, "real.runtime.token");
    const symlinkPath = join(fixture.root, "linked.runtime.token");
    await writeFile(symlinkTarget, "runtime-config-token", { mode: 0o600 });
    await symlink(symlinkTarget, symlinkPath);
    await writeRuntimeCredentials({
      root: fixture.root,
      runtimeCredentialPath: fixture.runtimeCredentialPath,
      runtimeConfigTokenFile: symlinkPath,
      runtimeRegistrationTokenFile: fixture.runtimeRegistrationTokenPath,
      runtimeVersion: "2.0.0",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });

    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_PATH_IS_SYMLINK",
    });
  });

  it("rejects empty credential tokens and keeps token values out of messages", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    await writeFile(fixture.runtimeConfigTokenPath, "", { mode: 0o600 });
    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_TOKEN_INVALID",
    });
    const reason = await loadPmsApiBootstrapConfig(baseEnvironment(fixture)).catch(
      (value: unknown) => value,
    );
    expect(errorMessage(reason)).not.toContain("runtime-config-token");
  });

  it("rejects unsafe credential and parent directory permissions on Unix", async () => {
    if (process.platform === "win32") {
      return;
    }
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    await chmod(fixture.runtimeConfigTokenPath, 0o644);

    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION",
    });

    const unsafeParent = join(fixture.root, "parent-unsafe");
    await mkdir(unsafeParent);
    await writeFile(join(unsafeParent, "runtime-config.token"), "runtime-config-token", {
      mode: 0o600,
    });
    await chmod(unsafeParent, 0o777);
    await writeRuntimeCredentials({
      ...fixture,
      runtimeConfigTokenFile: join(unsafeParent, "runtime-config.token"),
      runtimeRegistrationTokenFile: fixture.runtimeRegistrationTokenPath,
      runtimeVersion: "2.0.0",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });

    await expect(
      loadPmsApiBootstrapConfig({
        ...baseEnvironment(fixture),
        PMS_RUNTIME_CREDENTIAL_FILE: fixture.runtimeCredentialPath,
      }),
    ).rejects.toMatchObject({ code: "PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION" });
  });

  it("rejects unsupported runtime credential protocol version", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "postgresql://127.0.0.1:5432/pms_runtime",
      protocolVersion: "legacy",
    });
    await expect(loadPmsApiBootstrapConfig(baseEnvironment(fixture))).rejects.toMatchObject({
      code: "PMS_API_CREDENTIAL_PROTOCOL_VERSION_UNSUPPORTED",
    });
  });

  it("reads and trims database URL", async () => {
    const fixture = await createFixture({
      runtimeVersion: "2.0.0",
      databaseUrl: "   postgresql://127.0.0.1:5432/pms_runtime   ",
      protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    });
    const config = await loadPmsApiBootstrapConfig(baseEnvironment(fixture));

    expect(config.databaseUrl).toBe("postgresql://127.0.0.1:5432/pms_runtime");
  });
});

interface Fixture {
  root: string;
  managementCredentialPath: string;
  runtimeCredentialPath: string;
  databaseUrlPath: string;
  managementReaderTokenPath: string;
  managementAdministratorTokenPath: string;
  runtimeConfigTokenPath: string;
  runtimeRegistrationTokenPath: string;
}

interface FixtureInput {
  runtimeVersion: string;
  databaseUrl: string;
  protocolVersion: string;
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "";
  }
  const message = (error as { readonly message: unknown }).message;
  return typeof message === "string" ? message : "";
}

interface ManagementCredentialWriteOptions {
  managementReaderToken: string;
  managementAdministratorToken: string;
}

interface RuntimeCredentialWriteOptions {
  runtimeConfigTokenFile: string;
  runtimeRegistrationTokenFile: string;
  runtimeVersion: string;
  protocolVersion: string;
  allowTokenInline?: boolean;
}

async function createFixture(input: FixtureInput): Promise<Fixture> {
  const root = await temporaryRoot();
  const managementCredentialPath = join(root, "management.json");
  const runtimeCredentialPath = join(root, "runtime.json");
  const databaseUrlPath = join(root, "database.url");
  const managementReaderTokenPath = join(root, "management-reader.token");
  const managementAdministratorTokenPath = join(root, "management-admin.token");
  const runtimeConfigTokenPath = join(root, "runtime-config.token");
  const runtimeRegistrationTokenPath = join(root, "runtime-registration.token");

  await writeManagementCredential({
    root,
    managementCredentialPath,
    managementReaderToken: managementReaderTokenPath,
    managementAdministratorToken: managementAdministratorTokenPath,
  });
  await writeRuntimeCredentials({
    root,
    runtimeCredentialPath,
    runtimeConfigTokenFile: runtimeConfigTokenPath,
    runtimeRegistrationTokenFile: runtimeRegistrationTokenPath,
    runtimeVersion: input.runtimeVersion,
    protocolVersion: input.protocolVersion,
  });
  await writeFile(databaseUrlPath, input.databaseUrl, { mode: 0o600 });
  return {
    root,
    managementCredentialPath,
    runtimeCredentialPath,
    databaseUrlPath,
    managementReaderTokenPath,
    managementAdministratorTokenPath,
    runtimeConfigTokenPath,
    runtimeRegistrationTokenPath,
  };
}

function baseEnvironment(
  fixture: Fixture,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    PMS_API_HOST: "127.0.0.1",
    PMS_API_PORT: "8090",
    PMS_API_RUNTIME_HEARTBEAT_TTL_MS: "30000",
    PMS_MANAGEMENT_CREDENTIAL_FILE:
      overrides.PMS_MANAGEMENT_CREDENTIAL_FILE ?? fixture.managementCredentialPath,
    PMS_RUNTIME_CREDENTIAL_FILE:
      overrides.PMS_RUNTIME_CREDENTIAL_FILE ?? fixture.runtimeCredentialPath,
    PMS_DATABASE_URL_FILE: overrides.PMS_DATABASE_URL_FILE ?? fixture.databaseUrlPath,
    ...overrides,
  };
}

async function writeManagementCredential(
  options: { root: string; managementCredentialPath: string } & ManagementCredentialWriteOptions,
): Promise<void> {
  await writeFile(
    options.managementCredentialPath,
    JSON.stringify({
      management: {
        reader: [{ subjectId: "reader-1", tokenFile: options.managementReaderToken }],
        administrator: [
          { subjectId: "administrator-1", tokenFile: options.managementAdministratorToken },
        ],
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(options.managementReaderToken, "management-reader-token", { mode: 0o600 });
  await writeFile(options.managementAdministratorToken, "management-admin-token", { mode: 0o600 });
}

async function writeRuntimeCredentials(
  options: { root: string; runtimeCredentialPath: string } & RuntimeCredentialWriteOptions,
): Promise<void> {
  await writeFile(
    options.runtimeCredentialPath,
    JSON.stringify({
      runtimeConfig: [
        {
          subjectId: "runtime-identity-1",
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          environment: "production",
          runtimeVersion: options.runtimeVersion,
          ...(options.allowTokenInline
            ? { token: "runtime-config-token" }
            : { tokenFile: options.runtimeConfigTokenFile }),
          protocolVersion: options.protocolVersion,
          scopes: ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
        },
      ],
      runtimeRegistration: [
        {
          subjectId: "runtime-identity-1",
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: options.runtimeVersion,
          ...(options.allowTokenInline
            ? { token: "runtime-registration-token" }
            : { tokenFile: options.runtimeRegistrationTokenFile }),
          protocolVersion: options.protocolVersion,
          scopes: ["runtime:register", "runtime:heartbeat"],
        },
      ],
    }),
    { mode: 0o600 },
  );
  if (!options.allowTokenInline) {
    await writeFile(options.runtimeConfigTokenFile, "runtime-config-token", { mode: 0o600 });
    await writeFile(options.runtimeRegistrationTokenFile, "runtime-registration-token", {
      mode: 0o600,
    });
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pms-api-fix-config-"));
  tempRoots.push(root);
  return root;
}
