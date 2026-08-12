import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { ProviderPackageQueryService } from "../../../packages/pms-application/src/index.js";
import { PMS_API_FROZEN_PROTOCOL_VERSION, type PmsApiBootstrapConfig } from "../src/config.js";
import { createPmsApiComposition } from "../src/composition.js";

describe("PMS API production composition", () => {
  it("registers every Goal 2 route with file-backed authorizers while health stays public", async () => {
    const fixture = poolFixture();
    const composition = await createPmsApiComposition(config(), dependencies(fixture.pool));
    await composition.app.ready();

    const routes = composition.app.printRoutes();
    expect(routes).toContain("deployments (POST, GET, HEAD)");
    expect(routes).toContain("processes (GET, HEAD)");
    expect(routes).toContain("registration/deployments/");
    expect(routes).toContain("config/deployments/");
    expect(routes).toContain("console/v1");

    await expect(
      composition.app.inject({ method: "GET", url: "/health/live" }),
    ).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(
      composition.app.inject({
        method: "GET",
        url: "/api/v1/provider-packages",
        headers: { authorization: "Bearer management-reader" },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      composition.app.inject({
        method: "GET",
        url: "/api/console/v1/provider-packages",
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      composition.app.inject({
        method: "GET",
        url: "/api/v1/provider-packages",
        headers: { authorization: "Bearer management-administrator" },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      composition.app.inject({
        method: "GET",
        url: "/api/v1/runtime-deployments?providerId=provider-1",
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      composition.app.inject({
        method: "GET",
        url: "/api/v1/runtime-processes?providerId=provider-1&deploymentId=deployment-1",
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      composition.app.inject({
        method: "POST",
        url: "/api/v1/provider-types",
        headers: { authorization: "Bearer management-reader", "x-actor-id": "reader" },
        payload: { providerTypeId: "demo.type", displayName: "Demo" },
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    await expect(
      composition.app.inject({
        method: "GET",
        url: runtimeConfigUrl("latest"),
        headers: { authorization: "Bearer config-watch" },
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      composition.app.inject({
        method: "GET",
        url: runtimeConfigUrl("watch"),
        headers: { authorization: "Bearer config-read" },
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      composition.app.inject({
        method: "POST",
        url: runtimeConfigUrl("revisions/11111111-1111-4111-8111-111111111111/acks"),
        headers: { authorization: "Bearer config-read" },
        payload: { status: "applied" },
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    await expect(
      composition.app.inject({
        method: "POST",
        url: runtimeRegistrationUrl("register"),
        headers: { authorization: "Bearer registration-heartbeat" },
        payload: registrationBody(),
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      composition.app.inject({
        method: "POST",
        url: "/api/v1/runtime-registration/deployments/deployment-1/instances/instance-2/register",
        headers: { authorization: "Bearer registration-register" },
        payload: registrationBody(),
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    await Promise.all([composition.close(), composition.close()]);
    expect(fixture.end).toHaveBeenCalledTimes(1);
  });

  it("stops an accepting HTTP server before closing owned resources", async () => {
    const fixture = poolFixture();
    const composition = await createPmsApiComposition(config(), dependencies(fixture.pool));
    await composition.app.listen({ host: "127.0.0.1", port: 0 });

    await expect(composition.close()).resolves.toBeUndefined();
    await expect(composition.close()).resolves.toBeUndefined();
    expect(fixture.end).toHaveBeenCalledTimes(1);
  });

  it("cleans the Pool when construction fails before Fastify is created", async () => {
    const fixture = poolFixture();
    await expect(
      createPmsApiComposition(config(), {
        ...dependencies(fixture.pool),
        loadProviderPackages: () => Promise.reject(new Error("credential validation failed")),
      }),
    ).rejects.toThrow("credential validation failed");
    expect(fixture.end).toHaveBeenCalledTimes(1);
  });

  it("closes Fastify and Pool when assembly fails after Fastify is created", async () => {
    const fixture = poolFixture();
    let fastifyClosed = false;
    await expect(
      createPmsApiComposition(config(), {
        ...dependencies(fixture.pool),
        afterAppCreated: (app) => {
          app.addHook("onClose", () => {
            fastifyClosed = true;
          });
          throw new Error("post-fastify failure");
        },
      }),
    ).rejects.toThrow("post-fastify failure");
    expect(fastifyClosed).toBe(true);
    expect(fixture.end).toHaveBeenCalledTimes(1);
  });
});

function dependencies(pool: Pool) {
  return {
    createPool: () => pool,
    runMigrations: () => Promise.resolve(),
    loadProviderPackages: () =>
      Promise.resolve({
        list: () => [],
        get: () => null,
      } as unknown as ProviderPackageQueryService),
  };
}

function poolFixture() {
  const end = vi.fn(() => Promise.resolve());
  const pool = {
    query: vi.fn(() => Promise.resolve({ rows: [] })),
    end,
  } as unknown as Pool;
  return { pool, end };
}

function config(): PmsApiBootstrapConfig {
  return {
    host: "127.0.0.1",
    port: 8090,
    databaseUrl: "postgresql://not-a-secret@localhost/pms",
    runtimeHeartbeatTtlMs: 30_000,
    sdarRegistryProjectionTtlSeconds: 2_592_000,
    managementCredentialFile: "/credentials/management.json",
    runtimeCredentialFile: "/credentials/runtime.json",
    management: {
      readers: [managementPrincipal("reader", "management-reader")],
      administrators: [managementPrincipal("administrator", "management-administrator")],
    },
    runtime: {
      config: [
        configPrincipal("config-read", ["runtime:config:read"]),
        configPrincipal("config-watch", ["runtime:config:watch"]),
        configPrincipal("config-ack", ["runtime:config:ack"]),
      ],
      registration: [
        registrationPrincipal("registration-register", ["runtime:register"]),
        registrationPrincipal("registration-heartbeat", ["runtime:heartbeat"]),
      ],
    },
  };
}

function managementPrincipal(subjectId: string, token: string) {
  return {
    subjectId,
    roles: [subjectId === "administrator" ? "administrator" : "reader"] as const,
    tokenDigest: digest(token),
    tokenFile: "/tokens/x",
  };
}

function configPrincipal(
  token: string,
  scopes: readonly ("runtime:config:read" | "runtime:config:watch" | "runtime:config:ack")[],
) {
  return {
    subjectId: `runtime-${token}`,
    providerId: "provider-1",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    environment: "production",
    runtimeVersion: "2.0.0",
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    scopes,
    tokenDigest: digest(token),
    tokenFile: "/tokens/runtime-config",
  };
}

function registrationPrincipal(
  token: string,
  scopes: readonly ("runtime:register" | "runtime:heartbeat")[],
) {
  return {
    subjectId: `runtime-${token}`,
    providerId: "provider-1",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    runtimeVersion: "2.0.0",
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    scopes,
    tokenDigest: digest(token),
    tokenFile: "/tokens/runtime-registration",
  };
}

function runtimeConfigUrl(suffix: string): string {
  return `/api/v1/runtime-config/deployments/deployment-1/instances/instance-1/${suffix}?environment=production&configGroup=runtime.bootstrap&dataId=main`;
}

function runtimeRegistrationUrl(suffix: string): string {
  return `/api/v1/runtime-registration/deployments/deployment-1/instances/instance-1/${suffix}`;
}

function registrationBody() {
  return {
    providerId: "provider-1",
    sessionId: "session-1",
    runtimeVersion: "2.0.0",
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    configRevision: 0,
    readinessState: "ready",
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
