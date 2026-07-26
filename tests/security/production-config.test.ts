import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig, parseBooleanEnv } from "../../apps/runtime/src/config.js";
import { createRuntime, loadOtlpExporterSecurity } from "../../apps/runtime/src/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("H4 production fail-closed configuration", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    ["1", true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
  ] as const)("parses boolean environment value %s", (input, expected) => {
    expect(parseBooleanEnv(input)).toBe(expected);
  });

  it("rejects ambiguous boolean values", () => {
    expect(() => parseBooleanEnv("abc")).toThrow("INVALID_BOOLEAN_ENV:abc");
    expect(() => loadRuntimeConfig({ ALLOW_WEAK_LEASE_CONFIGURATION: "abc" })).toThrow(
      "INVALID_BOOLEAN_ENV:abc",
    );
  });

  it("rejects development auth, plaintext Adapter transport, and weak leases in production", () => {
    expect(() => loadRuntimeConfig({ RUNTIME_ENV: "production" })).toThrow(
      "production forbids development auth",
    );
    expect(() =>
      loadRuntimeConfig({
        RUNTIME_ENV: "production",
        AUTH_MODE: "trusted_headers",
      }),
    ).toThrow("production requires Adapter mTLS");
    expect(() =>
      loadRuntimeConfig({
        ...secureProduction(),
        ALLOW_WEAK_LEASE_CONFIGURATION: "true",
      }),
    ).toThrow("production forbids weak lease configuration");
  });

  it("accepts explicit fail-closed production configuration", () => {
    expect(loadRuntimeConfig(secureProduction())).toMatchObject({
      RUNTIME_ENV: "production",
      AUTH_MODE: "trusted_headers",
      ADAPTER_TLS_MODE: "required",
      ALLOW_WEAK_LEASE_CONFIGURATION: false,
    });
  });

  it("production_otel_rejects_plain_http", () => {
    expect(() =>
      loadRuntimeConfig({
        ...secureProduction(),
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.test:4318",
      }),
    ).toThrow("production OTLP requires HTTPS");
  });

  it("otel_mtls_requires_complete_files", () => {
    expect(() =>
      loadRuntimeConfig({
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TLS_MODE: "required",
        OTEL_EXPORTER_OTLP_CA_PATH: "/run/secrets/otel/ca.pem",
        OTEL_EXPORTER_OTLP_CERT_PATH: "/run/secrets/otel/tls.crt",
      }),
    ).toThrow("OTLP mTLS requires CA, certificate, and key paths");
  });

  it("otel_header_secret_is_not_logged", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-otel-"));
    temporaryDirectories.push(directory);
    const headersFile = join(directory, "headers.json");
    const secret = "Bearer classified-collector-token";
    writeFileSync(headersFile, JSON.stringify({ authorization: secret }));
    const config = loadRuntimeConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_HEADERS_FILE: headersFile,
    });

    expect(loadOtlpExporterSecurity(config).otlpHeaders).toEqual({ authorization: secret });
    expect(JSON.stringify(config)).not.toContain(secret);
  });

  it("otel_initialization_failure_keeps_business_runtime_available", async () => {
    const config = loadRuntimeConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_HEADERS_FILE: join(tmpdir(), "missing-sdar-otel-headers.json"),
    });
    expect(() => loadOtlpExporterSecurity(config)).toThrow();

    const runtime = createRuntime(config);
    try {
      const response = await runtime.app.inject({ method: "GET", url: "/health/live" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "live" });
      expect(runtime.dependencies).not.toHaveProperty("telemetry");
    } finally {
      await runtime.app.close();
    }
  });

  it("requires mTLS whenever Provider telemetry ingress is enabled in production", () => {
    expect(() =>
      loadRuntimeConfig({
        ...secureProduction(),
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
      }),
    ).toThrow("production Provider telemetry ingress requires mTLS");
  });

  it("requires a configured webhook and HTTPS in production", () => {
    expect(() => loadRuntimeConfig({ OUTBOX_SINK: "webhook" })).toThrow(
      "webhook Outbox requires OUTBOX_WEBHOOK_URL",
    );
    expect(() =>
      loadRuntimeConfig({
        ...secureProduction(),
        OUTBOX_SINK: "webhook",
        OUTBOX_WEBHOOK_URL: "http://events.example.test/outbox",
      }),
    ).toThrow("production Outbox webhook requires HTTPS");
  });
});

function secureProduction(): NodeJS.ProcessEnv {
  return {
    RUNTIME_ENV: "production",
    AUTH_MODE: "trusted_headers",
    ADAPTER_TLS_MODE: "required",
    ADAPTER_TLS_CA_PATH: "/run/secrets/ca.pem",
    ADAPTER_TLS_CERT_PATH: "/run/secrets/client.pem",
    ADAPTER_TLS_KEY_PATH: "/run/secrets/client-key.pem",
    ALLOW_WEAK_LEASE_CONFIGURATION: "false",
  };
}
