import { describe, expect, it } from "vitest";
import {
  BootstrapConfigRenderer,
  BootstrapConfigRendererError,
  type BootstrapConfigRendererInput,
} from "../src/index.js";

describe("BootstrapConfigRenderer", () => {
  const renderer = new BootstrapConfigRenderer();

  it("renders deterministic immutable identity, allocated port and secret file references", () => {
    const left = renderer.render(input());
    const right = renderer.render({
      ...input(),
      effectiveConfig: {
        LOG_LEVEL: "info",
        RUNTIME_ENV: "production",
        ADAPTER_TLS_MODE: "required",
      },
    });

    expect(left).toEqual(right);
    expect(left.artifactId).toMatch(/^bootstrap-[0-9a-f]{24}$/);
    expect(left.environment).toMatchObject({
      PROVIDER_ID: "provider-a",
      RUNTIME_DEPLOYMENT_ID: "deployment-1",
      RUNTIME_INSTANCE_ID: "instance-1",
      OTEL_SERVICE_INSTANCE_ID: "instance-1",
      PORT: "18080",
      DATABASE_URL_FILE: "/run/sdar/database-url",
      PMS_RUNTIME_CONFIG_TOKEN_FILE: "/run/sdar/pms-token",
      PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "/run/sdar/pms-token",
      PMS_BOOTSTRAP_CHECKSUM: "a".repeat(64),
      PMS_CONFIG_REVISION: "7",
      PMS_RUNTIME_VERSION: "2.0.0-rc.1",
    });
    expect(left.redactedPreview).toMatchObject({
      DATABASE_URL_FILE: "<secret-file>",
      PMS_RUNTIME_CONFIG_TOKEN_FILE: "<secret-file>",
      PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "<secret-file>",
    });
    expect(JSON.stringify(left.redactedPreview)).not.toContain("/run/sdar/database-url");
  });

  it.each([
    "PORT",
    "PROVIDER_ID",
    "DATABASE_URL",
    "RUNTIME_INSTANCE_ID",
    "PMS_BOOTSTRAP_CHECKSUM",
    "PMS_CONFIG_REVISION",
    "PMS_RUNTIME_VERSION",
  ])("rejects reserved effective config key %s", (key) => {
    expect(() =>
      renderer.render({
        ...input(),
        effectiveConfig: { ...input().effectiveConfig, [key]: "x" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "BOOTSTRAP_CONFIG_IMMUTABLE_OVERRIDE",
        field: key,
      }),
    );
  });

  it("rejects unknown environment keys and plaintext secret-shaped values", () => {
    expect(() =>
      renderer.render({
        ...input(),
        effectiveConfig: { ...input().effectiveConfig, NODE_OPTIONS: "--require=/tmp/inject" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "BOOTSTRAP_CONFIG_UNKNOWN_ENV",
        field: "NODE_OPTIONS",
      }),
    );
    expect(() =>
      renderer.render({
        ...input(),
        effectiveConfig: { ...input().effectiveConfig, JWT_HS256_SECRET: "plaintext" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "BOOTSTRAP_CONFIG_SECRET_VALUE_FORBIDDEN",
        field: "JWT_HS256_SECRET",
      }),
    );
    expect(() =>
      renderer.render({
        ...input(),
        effectiveConfig: {
          ...input().effectiveConfig,
          ADAPTER_TLS_KEY_PATH: "plaintext-not-a-file-reference",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "BOOTSTRAP_CONFIG_INVALID_INPUT",
        field: "ADAPTER_TLS_KEY_PATH",
      }),
    );
  });

  it("requires HTTPS PMS bootstrap in production and rejects credential-bearing URLs", () => {
    for (const baseUrl of ["http://pms.internal", "https://user:pass@pms.internal"]) {
      const value = input();
      const pms = value.pms;
      if (pms === undefined) throw new Error("TEST_PMS_BOOTSTRAP_MISSING");
      expect(() => renderer.render({ ...value, pms: { ...pms, baseUrl } })).toThrow(
        BootstrapConfigRendererError,
      );
    }
  });

  it("permits production PMS bootstrap over HTTP only with the internal transport opt-in", () => {
    const value = input();
    const pms = value.pms;
    if (pms === undefined) throw new Error("TEST_PMS_BOOTSTRAP_MISSING");
    const rendered = renderer.render({
      ...value,
      pms: { ...pms, baseUrl: "http://pms.internal" },
      effectiveConfig: {
        ...value.effectiveConfig,
        ALLOW_INSECURE_INTERNAL_TRANSPORT: true,
        ADAPTER_TLS_MODE: "disabled",
      },
    });

    expect(rendered.environment).toMatchObject({
      ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      ADAPTER_TLS_MODE: "disabled",
      PMS_RUNTIME_CONFIG_URL: "http://pms.internal/",
      PMS_RUNTIME_REGISTRATION_URL: "http://pms.internal/",
    });
  });
});

function input(): BootstrapConfigRendererInput {
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
    databaseUrlFile: "/run/sdar/database-url",
    pms: {
      baseUrl: "https://pms.internal",
      tokenFile: "/run/sdar/pms-token",
      cachePath: "/var/lib/sdar/runtime-config.json",
    },
    effectiveConfig: {
      ADAPTER_TLS_MODE: "required",
      RUNTIME_ENV: "production",
      LOG_LEVEL: "info",
    },
  };
}
