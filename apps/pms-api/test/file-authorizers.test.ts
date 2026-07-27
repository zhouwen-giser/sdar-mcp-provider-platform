import { createHash } from "node:crypto";
import type { ProviderManagementService } from "../../../packages/pms-application/src/index.js";
import * as config from "../src/config.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPmsApi } from "../src/index.js";

const PMS_API_FROZEN_PROTOCOL_VERSION = "2026-07-28";

const MANAGEMENT_READ = {
  subjectId: "reader-1",
  roles: ["reader"] as const,
  tokenDigest: hashSecretToken("reader-token"),
  tokenFile: "/tmp/reader-management.token",
};
const MANAGEMENT_ADMIN = {
  subjectId: "administrator-1",
  roles: ["administrator"] as const,
  tokenDigest: hashSecretToken("administrator-token"),
  tokenFile: "/tmp/admin-management.token",
};
const RUNTIME_CONFIG_PRINCIPAL = {
  subjectId: "runtime-identity-1",
  providerId: "provider-a",
  deploymentId: "deployment-1",
  instanceId: "instance-1",
  environment: "production",
  runtimeVersion: "2.0.0",
  protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
  scopes: ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"] as const,
  tokenDigest: hashSecretToken("runtime-config-token"),
  tokenFile: "/tmp/runtime-config.token",
};
const RUNTIME_REGISTRATION_PRINCIPAL = {
  subjectId: "runtime-identity-1",
  providerId: "provider-a",
  deploymentId: "deployment-1",
  instanceId: "instance-1",
  runtimeVersion: "2.0.0",
  protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
  scopes: ["runtime:register", "runtime:heartbeat"] as const,
  tokenDigest: hashSecretToken("runtime-registration-token"),
  tokenFile: "/tmp/runtime-registration.token",
};

describe("PMS API file-backed authorizers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("authenticates management reader and administrator tokens", async () => {
    const { FilePmsApiRoleAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FilePmsApiRoleAuthorizer({
      readers: [MANAGEMENT_READ],
      administrators: [MANAGEMENT_ADMIN],
    });

    await expect(
      authorizer.authenticate({ authorization: "Bearer reader-token" }),
    ).resolves.toMatchObject({
      subjectId: "reader-1",
      roles: ["reader"],
    });
    await expect(
      authorizer.authenticate({ authorization: "Bearer administrator-token" }),
    ).resolves.toMatchObject({ subjectId: "administrator-1", roles: ["administrator"] });
    await expect(
      authorizer.authenticate({ authorization: "Bearer invalid-token" }),
    ).rejects.toMatchObject({
      code: "MANAGEMENT_AUTHENTICATION_REQUIRED",
    });
  });

  it("enforces reader path and write semantics for management routes", async () => {
    const { FilePmsApiRoleAuthorizer } = await import("../src/file-authorizers.js");
    const app = createPmsApi({
      management: {
        listProviderTypes: vi.fn(() => Promise.resolve({ items: [] })),
      } as unknown as ProviderManagementService,
      managementAuthorizer: new FilePmsApiRoleAuthorizer({
        readers: [MANAGEMENT_READ],
        administrators: [MANAGEMENT_ADMIN],
      }),
    });

    const readOk = await app.inject({
      method: "GET",
      url: "/api/v1/provider-types",
      headers: { authorization: "Bearer reader-token" },
    });
    expect(readOk.statusCode).toBe(200);

    const writeBlocked = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      headers: {
        authorization: "Bearer reader-token",
        "x-actor-id": "reader-1",
      },
      payload: { providerTypeId: "demo", displayName: "Demo" },
    });
    expect(writeBlocked.statusCode).toBe(403);

    const missing = await app.inject({ method: "GET", url: "/api/v1/provider-types" });
    expect(missing.statusCode).toBe(401);
    await app.close();
  });

  it("authorizes Runtime Config identities, scopes and binding fields", async () => {
    const { FileRuntimeConfigClientAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeConfigClientAuthorizer({
      config: [RUNTIME_CONFIG_PRINCIPAL],
      registration: [],
    });

    await expect(
      authorizer.authorize(
        { authorization: "Bearer runtime-config-token" },
        {
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
      ),
    ).resolves.toMatchObject({
      providerId: "provider-a",
      environment: "production",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
    });

    await expect(
      authorizer
        .authorize(
          {
            authorization: "Bearer runtime-config-token",
          },
          {
            environment: "production",
            deploymentId: "deployment-1",
            instanceId: "instance-1",
            configGroup: "runtime.bootstrap",
            dataId: "main",
          },
        )
        .then(
          () => "ok",
          () => "error",
        ),
    ).resolves.toBe("ok");

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-config-token" },
        {
          providerId: "provider-a",
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
        "runtime:config:watch",
      ),
    ).resolves.toMatchObject({ providerId: "provider-a" });

    const missingScope = new FileRuntimeConfigClientAuthorizer({
      config: [{ ...RUNTIME_CONFIG_PRINCIPAL, scopes: ["runtime:config:read"] }],
      registration: [],
    });
    await expect(
      missingScope.authorizeForScope(
        { authorization: "Bearer runtime-config-token" },
        {
          providerId: "provider-a",
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
        "runtime:config:watch",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_CONFIG_UNAUTHORIZED" });
  });

  it("rejects Runtime Config cross-instance, cross-version, and cross-protocol tokens", async () => {
    const { FileRuntimeConfigClientAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeConfigClientAuthorizer({
      config: [RUNTIME_CONFIG_PRINCIPAL],
      registration: [],
    });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-config-token" },
        {
          providerId: "provider-a",
          environment: "production",
          deploymentId: "deployment-2",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
        "runtime:config:read",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_CONFIG_IDENTITY_MISMATCH" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-config-token" },
        {
          providerId: "provider-a",
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "9.9.9",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
        "runtime:config:read",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_CONFIG_IDENTITY_MISMATCH" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-config-token" },
        {
          providerId: "provider-a",
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: "legacy",
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
        "runtime:config:read",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_CONFIG_IDENTITY_MISMATCH" });
  });

  it("authorizes Runtime Registration token scope and binding and rejects mismatches", async () => {
    const { FileRuntimeRegistrationAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeRegistrationAuthorizer({
      config: [],
      registration: [RUNTIME_REGISTRATION_PRINCIPAL],
    });

    await expect(
      authorizer.authorize(
        { authorization: "Bearer runtime-registration-token" },
        { deploymentId: "deployment-1", instanceId: "instance-1" },
        "runtime:register",
      ),
    ).resolves.toMatchObject({ subjectId: "runtime-identity-1", providerId: "provider-a" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        },
        "runtime:heartbeat",
      ),
    ).resolves.toMatchObject({ subjectId: "runtime-identity-1" });

    const readOnly = new FileRuntimeRegistrationAuthorizer({
      config: [],
      registration: [{ ...RUNTIME_REGISTRATION_PRINCIPAL, scopes: ["runtime:register"] }],
    });
    await expect(
      readOnly.authorize(
        { authorization: "Bearer runtime-registration-token" },
        { deploymentId: "deployment-1", instanceId: "instance-1" },
        "runtime:heartbeat",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });
  });

  it("rejects Runtime Registration cross-provider/deployment/instance/version/protocol mismatches", async () => {
    const { FileRuntimeRegistrationAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeRegistrationAuthorizer({
      config: [],
      registration: [RUNTIME_REGISTRATION_PRINCIPAL],
    });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-b",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        },
        "runtime:register",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-a",
          deploymentId: "deployment-2",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        },
        "runtime:register",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-2",
          runtimeVersion: "2.0.0",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        },
        "runtime:register",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "9.9.9",
          protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        },
        "runtime:register",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });

    await expect(
      authorizer.authorizeForScope(
        { authorization: "Bearer runtime-registration-token" },
        {
          providerId: "provider-a",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          runtimeVersion: "2.0.0",
          protocolVersion: "legacy",
        },
        "runtime:register",
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_REGISTRATION_FORBIDDEN" });
  });

  it("uses timing-safe comparison in configuration path", async () => {
    const { FileRuntimeConfigClientAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeConfigClientAuthorizer({
      config: [RUNTIME_CONFIG_PRINCIPAL],
      registration: [],
    });
    const hashEqualsSpy = vi.spyOn(config, "hashEquals");

    await expect(
      authorizer.authorize(
        { authorization: "Bearer runtime-config-token" },
        {
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
      ),
    ).resolves.toMatchObject({ providerId: "provider-a" });
    expect(hashEqualsSpy).toHaveBeenCalledTimes(1);
    expect(hashEqualsSpy).toHaveBeenCalled();
  });

  it("uses constant subject identity for audit-binding context", async () => {
    const { FilePmsApiRoleAuthorizer } = await import("../src/file-authorizers.js");
    const app = createPmsApi({
      management: {
        listProviderTypes: vi.fn(() => Promise.resolve({ items: [] })),
      } as unknown as ProviderManagementService,
      managementAuthorizer: new FilePmsApiRoleAuthorizer({
        readers: [MANAGEMENT_READ],
        administrators: [MANAGEMENT_ADMIN],
      }),
    });

    const actorMismatch = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      headers: {
        authorization: "Bearer administrator-token",
        "x-actor-id": "someone-else",
      },
      payload: { providerTypeId: "demo", displayName: "Demo" },
    });

    expect(actorMismatch.statusCode).toBe(403);
    await app.close();
  });

  it("rejects missing runtime credentials", async () => {
    const { FileRuntimeConfigClientAuthorizer } = await import("../src/file-authorizers.js");
    const authorizer = new FileRuntimeConfigClientAuthorizer({
      config: [RUNTIME_CONFIG_PRINCIPAL],
      registration: [],
    });
    await expect(
      authorizer.authorize(
        {},
        {
          environment: "production",
          deploymentId: "deployment-1",
          instanceId: "instance-1",
          configGroup: "runtime.bootstrap",
          dataId: "main",
        },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_CONFIG_UNAUTHORIZED" });
  });
});

function hashSecretToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
