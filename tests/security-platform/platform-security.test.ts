import { describe, expect, it, vi } from "vitest";
import type { ProviderManagementService } from "../../packages/pms-application/src/index.js";
import {
  createDatabaseProfile,
  environmentId,
  providerId,
  secretRef,
} from "../../packages/pms-domain/src/index.js";
import {
  BootstrapConfigRenderer,
  Pm2ProcessManager,
  RuntimeReleaseResolver,
  type Pm2JavascriptApi,
} from "../../packages/pm2-runtime-adapter/src/index.js";
import { createPmsApi } from "../../apps/pms-api/src/index.js";

describe("Goal 2 platform security", () => {
  it("rejects arbitrary PM2 names, scripts, paths, and environment injection before execution", () => {
    const connect = vi.fn();
    const manager = new Pm2ProcessManager(
      { connect } as unknown as Pm2JavascriptApi,
      "/opt/sdar/runtime-releases",
    );

    expect(() => manager.stop("../../bin/sh")).toThrow(
      expect.objectContaining({ code: "PM2_PROCESS_NAME_FORBIDDEN" }),
    );
    expect(connect).not.toHaveBeenCalled();
    expect(
      () =>
        new RuntimeReleaseResolver("/opt/sdar/runtime-releases", {
          schemaVersion: 1,
          releases: [{ version: "2.0.0-rc.1", directory: "../../tmp/payload" }],
        }),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_RELEASE_MANIFEST_INVALID" }));
    expect(() =>
      new BootstrapConfigRenderer().render({
        ...bootstrap(),
        effectiveConfig: { RUNTIME_ENV: "production", NODE_OPTIONS: "--require=/tmp/payload.js" },
      }),
    ).toThrow(expect.objectContaining({ code: "BOOTSTRAP_CONFIG_UNKNOWN_ENV" }));
  });

  it("rejects URL-shaped, credential-bearing, and invalid-port Adapter endpoints", async () => {
    const createProvider = vi.fn();
    const app = createPmsApi({
      management: { createProvider } as unknown as ProviderManagementService,
    });

    for (const adapterEndpoint of [
      "http://169.254.169.254/latest/meta-data",
      "user:password@adapter.internal:7001",
      "adapter.internal:99999",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { "x-actor-id": "security-test" },
        payload: {
          providerId: "provider-1",
          providerTypeId: "test.provider",
          adapterEndpoint,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(adapterEndpoint);
    }
    expect(createProvider).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps plaintext secrets out of stable errors and redacted bootstrap evidence", () => {
    const plaintext = "security-test-plaintext-token";
    const renderer = new BootstrapConfigRenderer();
    const error = capture(() =>
      renderer.render({
        ...bootstrap(),
        effectiveConfig: { RUNTIME_ENV: "production", API_TOKEN: plaintext },
      }),
    );
    const rendered = renderer.render(bootstrap());
    const observableEvidence = JSON.stringify({
      error,
      preview: rendered.redactedPreview,
      artifactId: rendered.artifactId,
    });

    expect(error).toMatchObject({ code: "BOOTSTRAP_CONFIG_SECRET_VALUE_FORBIDDEN" });
    expect(observableEvidence).not.toContain(plaintext);
    expect(observableEvidence).not.toContain("/run/secrets/runtime-database-url");
    expect(rendered.redactedPreview).toMatchObject({
      DATABASE_URL_FILE: "<secret-file>",
      PMS_RUNTIME_CONFIG_TOKEN_FILE: "<secret-file>",
    });
  });

  it("requires separated SecretRefs and rejects URL-shaped database hosts", () => {
    const base = {
      profileId: "database-1",
      providerId: providerId("provider-1"),
      environment: environmentId("production"),
      clusterRef: "postgres-primary",
      port: 5432,
      adminSecretRef: secretRef("vault/postgres/admin"),
      runtimeSecretRef: secretRef("vault/runtime/provider-1"),
    };

    expect(() =>
      createDatabaseProfile({
        ...base,
        host: "postgresql://user:password@database.internal",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
    expect(() =>
      createDatabaseProfile({
        ...base,
        host: "database.internal",
        runtimeSecretRef: base.adminSecretRef,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
  });
});

function bootstrap() {
  return {
    target: {
      providerId: "provider-a",
      deploymentId: "deployment-1",
      environment: "production",
      runtimeVersion: "2.0.0-rc.1",
      instanceId: "instance-1",
      ordinal: 0,
      processName: "sdar-runtime-provider-a-0",
    },
    configRevision: 7,
    configChecksum: "a".repeat(64),
    httpPort: 18_080,
    databaseUrlFile: "/run/secrets/runtime-database-url",
    pms: {
      baseUrl: "https://pms.internal",
      tokenFile: "/run/secrets/pms-token",
      cachePath: "/var/lib/sdar/runtime-config.json",
    },
    effectiveConfig: { RUNTIME_ENV: "production" },
  } as const;
}

function capture(action: () => unknown): unknown {
  try {
    action();
    return null;
  } catch (error) {
    return error;
  }
}
