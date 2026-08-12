import { describe, expect, it } from "vitest";
import {
  loadRuntimeObservabilityEnvironment,
  RuntimeObservabilityConfigurationDefinition,
  toRuntimeObservabilityEffectivePlainOutput,
} from "./observability.js";

describe("Runtime observability configuration contract", () => {
  it("preserves existing defaults", () => {
    expect(loadRuntimeObservabilityEnvironment({})).toEqual({
      LOG_LEVEL: "info",
      OTEL_ENABLED: false,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_TLS_MODE: "disabled",
      OTEL_EXPORTER_OTLP_TIMEOUT_MS: 10_000,
    });
  });

  it("assigns explicit Apply Modes", () => {
    const byPath = new Map(
      RuntimeObservabilityConfigurationDefinition.fields.map((item) => [item.path, item]),
    );

    expect(byPath.get("/LOG_LEVEL")?.applyMode).toBe("hot_reload");
    expect(byPath.get("/OTEL_ENABLED")?.applyMode).toBe("hot_reload");
    expect(byPath.get("/OTEL_EXPORTER_OTLP_ENDPOINT")?.applyMode).toBe("reconnect_required");
    expect(byPath.get("/OTEL_EXPORTER_OTLP_TLS_MODE")?.applyMode).toBe("reconnect_required");
    expect(byPath.get("/OTEL_EXPORTER_OTLP_HEADERS_FILE")?.applyMode).toBe("reconnect_required");
    expect(byPath.get("/OTEL_SERVICE_INSTANCE_ID")?.applyMode).toBe("restart_required");
  });

  it("keeps TLS and header SecretRefs out of effective plain output", () => {
    const resolved = loadRuntimeObservabilityEnvironment({
      OTEL_EXPORTER_OTLP_TLS_MODE: "required",
      OTEL_EXPORTER_OTLP_CA_PATH: "/run/secrets/otel/ca.pem",
      OTEL_EXPORTER_OTLP_CERT_PATH: "/run/secrets/otel/client.pem",
      OTEL_EXPORTER_OTLP_KEY_PATH: "/run/secrets/otel/client-key.pem",
      OTEL_EXPORTER_OTLP_HEADERS_FILE: "/run/secrets/otel/headers.json",
    });

    const effective = toRuntimeObservabilityEffectivePlainOutput(resolved);
    expect(effective).not.toHaveProperty("OTEL_EXPORTER_OTLP_CA_PATH");
    expect(effective).not.toHaveProperty("OTEL_EXPORTER_OTLP_CERT_PATH");
    expect(effective).not.toHaveProperty("OTEL_EXPORTER_OTLP_KEY_PATH");
    expect(effective).not.toHaveProperty("OTEL_EXPORTER_OTLP_HEADERS_FILE");
    expect(JSON.stringify(effective)).not.toContain("/run/secrets");
  });

  it("retains production HTTPS and complete mTLS validation", () => {
    expect(() =>
      loadRuntimeObservabilityEnvironment({
        RUNTIME_ENV: "production",
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.test:4318",
      }),
    ).toThrow("production OTLP requires HTTPS");
    expect(
      loadRuntimeObservabilityEnvironment({
        RUNTIME_ENV: "production",
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.internal:4318",
      }),
    ).toMatchObject({
      OTEL_ENABLED: true,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.internal:4318",
      OTEL_EXPORTER_OTLP_TLS_MODE: "disabled",
    });
    expect(() =>
      loadRuntimeObservabilityEnvironment({
        OTEL_EXPORTER_OTLP_TLS_MODE: "required",
        OTEL_EXPORTER_OTLP_CA_PATH: "/run/secrets/otel/ca.pem",
      }),
    ).toThrow("OTLP mTLS requires CA, certificate, and key paths");
  });
});
