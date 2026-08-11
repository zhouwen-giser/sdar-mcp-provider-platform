import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/config.js";
import { loadRuntimeConfigClientBootstrap } from "../src/runtime-config.js";

describe("Runtime platform bootstrap identity and Secret File support", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("accepts canonical PMS identity and keeps it stable in Runtime Config targeting", () => {
    const environment = {
      PMS_DEPLOYMENT_ID: "deployment-1",
      PMS_INSTANCE_ID: "instance-1",
      PMS_RUNTIME_CONFIG_URL: "http://pms.internal",
      PMS_RUNTIME_CONFIG_TOKEN_FILE: "/run/secrets/pms-token",
      PMS_RUNTIME_CONFIG_CACHE_PATH: "/var/lib/sdar/runtime-config.json",
    };
    const config = loadRuntimeConfig(environment);
    const bootstrap = loadRuntimeConfigClientBootstrap(config, environment);

    expect(config.platformIdentity).toEqual({
      deploymentId: "deployment-1",
      instanceId: "instance-1",
    });
    expect(bootstrap?.target).toMatchObject({
      deploymentId: "deployment-1",
      instanceId: "instance-1",
    });
  });

  it("permits production PMS Config over HTTP only for explicit internal transport", () => {
    const environment = {
      RUNTIME_ENV: "production",
      AUTH_MODE: "jwt_hs256",
      JWT_HS256_SECRET: "0123456789abcdef0123456789abcdef",
      PMS_DEPLOYMENT_ID: "deployment-1",
      PMS_INSTANCE_ID: "instance-1",
      PMS_RUNTIME_CONFIG_URL: "http://pms.internal",
      PMS_RUNTIME_CONFIG_TOKEN_FILE: "/run/secrets/pms-token",
      PMS_RUNTIME_CONFIG_CACHE_PATH: "/var/lib/sdar/runtime-config.json",
    };
    expect(() => loadRuntimeConfig(environment)).toThrow("production requires Adapter mTLS");

    const allowed = {
      ...environment,
      ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
    };
    const bootstrap = loadRuntimeConfigClientBootstrap(loadRuntimeConfig(allowed), allowed);
    expect(bootstrap?.baseUrl).toBe("http://pms.internal/");
  });

  it("accepts matching legacy aliases and rejects every partial or conflicting identity", () => {
    expect(
      loadRuntimeConfig({
        PMS_DEPLOYMENT_ID: "deployment-1",
        PMS_INSTANCE_ID: "instance-1",
        RUNTIME_DEPLOYMENT_ID: "deployment-1",
        RUNTIME_INSTANCE_ID: "instance-1",
      }).platformIdentity,
    ).toEqual({ deploymentId: "deployment-1", instanceId: "instance-1" });

    for (const environment of [
      { PMS_DEPLOYMENT_ID: "deployment-1" },
      { RUNTIME_INSTANCE_ID: "instance-1" },
      {
        PMS_DEPLOYMENT_ID: "deployment-1",
        PMS_INSTANCE_ID: "instance-1",
        RUNTIME_DEPLOYMENT_ID: "deployment-2",
        RUNTIME_INSTANCE_ID: "instance-1",
      },
    ]) {
      expect(() => loadRuntimeConfig(environment)).toThrow(
        /RUNTIME_PLATFORM_IDENTITY_(?:PMS_INVALID|RUNTIME_INVALID|CONFLICT)/,
      );
    }
  });

  it("rejects an attempted bootstrap identity override after config resolution", () => {
    const config = loadRuntimeConfig({
      PMS_DEPLOYMENT_ID: "deployment-1",
      PMS_INSTANCE_ID: "instance-1",
    });
    expect(() =>
      loadRuntimeConfigClientBootstrap(config, {
        PMS_RUNTIME_CONFIG_URL: "http://pms.internal",
        PMS_RUNTIME_CONFIG_TOKEN_FILE: "/run/secrets/pms-token",
        PMS_RUNTIME_CONFIG_CACHE_PATH: "/var/lib/sdar/runtime-config.json",
        PMS_DEPLOYMENT_ID: "deployment-other",
        PMS_INSTANCE_ID: "instance-1",
      }),
    ).toThrow("RUNTIME_PLATFORM_IDENTITY_CONFLICT");
  });

  it("gives DATABASE_URL_FILE priority while preserving legacy DATABASE_URL", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sdar-runtime-bootstrap-"));
    temporaryDirectories.push(directory);
    const secretFile = resolve(directory, "database-url");
    await writeFile(secretFile, "postgresql://file.example.test/runtime\n", {
      mode: 0o600,
    });

    expect(
      loadRuntimeConfig({
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
      }).DATABASE_URL,
    ).toBe("postgresql://legacy.example.test/runtime");
    expect(
      loadRuntimeConfig({
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
        DATABASE_URL_FILE: secretFile,
      }).DATABASE_URL,
    ).toBe("postgresql://file.example.test/runtime");
  });

  it("returns stable Secret File errors without leaking file contents", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sdar-runtime-bootstrap-"));
    temporaryDirectories.push(directory);
    const secretFile = resolve(directory, "database-url");
    await writeFile(secretFile, "not-a-database-url", { mode: 0o600 });

    const error = capture(() => loadRuntimeConfig({ DATABASE_URL_FILE: secretFile }));

    expect(error).toMatchObject({
      code: "DATABASE_URL_FILE_INVALID",
      message: "DATABASE_URL_FILE_INVALID",
    });
    expect(JSON.stringify(error)).not.toContain("not-a-database-url");
  });
});

function capture(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("EXPECTED_OPERATION_TO_FAIL");
}
