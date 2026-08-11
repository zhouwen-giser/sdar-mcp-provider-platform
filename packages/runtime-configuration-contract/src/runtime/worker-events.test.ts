import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuntimeBootstrapConfigurationDefinition } from "./bootstrap.js";
import { RuntimeObservabilityConfigurationDefinition } from "./observability.js";
import {
  loadRuntimeWorkerEventsEnvironment,
  RuntimeWorkerEventsConfigurationDefinition,
} from "./worker-events.js";

describe("Runtime worker and event configuration contract", () => {
  it("covers every Runtime inventory field exactly once across the three contracts", () => {
    const inventory = JSON.parse(
      readFileSync("../../docs/configuration/CONFIG_INVENTORY.json", "utf8"),
    ) as { items: { component: string; key: string }[] };
    const inventoryKeys = inventory.items
      .filter(({ component }) => component === "runtime")
      .map(({ key }) => key)
      .concat("DATABASE_URL_FILE")
      .sort();
    const definitionKeys = [
      ...RuntimeBootstrapConfigurationDefinition.fields,
      ...RuntimeObservabilityConfigurationDefinition.fields,
      ...RuntimeWorkerEventsConfigurationDefinition.fields,
    ]
      .map(({ path }) => path.slice(1))
      .sort();

    expect(definitionKeys).toHaveLength(100);
    expect(new Set(definitionKeys).size).toBe(definitionKeys.length);
    expect(definitionKeys).toEqual(inventoryKeys);
  });

  it("preserves readiness and capacity defaults", () => {
    expect(loadRuntimeWorkerEventsEnvironment({})).toMatchObject({
      BUSINESS_EVENTS_ENABLED: false,
      BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: false,
      PROVIDER_TELEMETRY_INGRESS_ENABLED: false,
      TASK_NOTIFICATION_MAX_QUEUE_MESSAGES: 64,
      COMMAND_DISPATCH_CONCURRENCY: 8,
      SCHEDULER_CONCURRENCY: 8,
      TTL_CLEANER_BATCH_SIZE: 128,
      OUTBOX_BATCH_SIZE: 100,
    });
  });

  it("retains bounded capacity validation", () => {
    expect(() =>
      loadRuntimeWorkerEventsEnvironment({ BUSINESS_EVENTS_MAX_QUEUE_BYTES: "4095" }),
    ).toThrow();
    expect(() =>
      loadRuntimeWorkerEventsEnvironment({ TASK_NOTIFICATION_MAX_TASK_BINDINGS: "100001" }),
    ).toThrow();
    expect(() =>
      loadRuntimeWorkerEventsEnvironment({ COMMAND_DISPATCH_CONCURRENCY: "129" }),
    ).toThrow();
    expect(() => loadRuntimeWorkerEventsEnvironment({ TTL_CLEANER_BATCH_SIZE: "10001" })).toThrow();
  });

  it("limits the internal plaintext opt-in to transport checks", () => {
    const production = {
      RUNTIME_ENV: "production",
      AUTH_MODE: "jwt_hs256",
      JWT_HS256_SECRET: "0123456789abcdef0123456789abcdef",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
      PROVIDER_TELEMETRY_TLS_MODE: "disabled",
      OUTBOX_SINK: "webhook",
      OUTBOX_WEBHOOK_URL: "http://events.internal/hook",
    };
    expect(() => loadRuntimeWorkerEventsEnvironment(production)).toThrow(
      "production Provider telemetry ingress requires mTLS",
    );
    expect(
      loadRuntimeWorkerEventsEnvironment({
        ...production,
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      }),
    ).toMatchObject({
      AUTH_MODE: "jwt_hs256",
      PROVIDER_TELEMETRY_TLS_MODE: "disabled",
      OUTBOX_WEBHOOK_URL: "http://events.internal/hook",
    });
    expect(() =>
      loadRuntimeWorkerEventsEnvironment({
        RUNTIME_ENV: "production",
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      }),
    ).toThrow("production forbids development auth");
  });

  it("uses conservative restart Apply Modes and marks secrets", () => {
    expect(
      RuntimeWorkerEventsConfigurationDefinition.fields.every(
        ({ applyMode }) => applyMode === "restart_required",
      ),
    ).toBe(true);
    expect(RuntimeWorkerEventsConfigurationDefinition.secretPaths).toEqual([
      "/PROVIDER_TELEMETRY_TLS_CA_PATH",
      "/PROVIDER_TELEMETRY_TLS_CERT_PATH",
      "/PROVIDER_TELEMETRY_TLS_KEY_PATH",
      "/JWT_HS256_SECRET",
      "/INTERNAL_ADMIN_TOKEN",
    ]);
  });
});
