import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "../src/config.js";
import {
  loadRuntimeRegistrationBootstrap,
  RuntimeRegistrationIntegration,
} from "../src/runtime-registration.js";

describe("Runtime registration integration", () => {
  it("loads canonical platform identity and a separate token file bootstrap", () => {
    const environment = {
      RUNTIME_ENV: "test",
      PROVIDER_ID: "provider-a",
      PMS_DEPLOYMENT_ID: "deployment-1",
      PMS_INSTANCE_ID: "instance-1",
      PMS_RUNTIME_REGISTRATION_URL: "http://pms.internal",
      PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "/run/secrets/runtime-registration-token",
      PMS_RUNTIME_HEARTBEAT_INTERVAL_MS: "5000",
    };
    const bootstrap = loadRuntimeRegistrationBootstrap(loadRuntimeConfig(environment), environment);

    expect(bootstrap).toMatchObject({
      baseUrl: "http://pms.internal/",
      tokenFile: "/run/secrets/runtime-registration-token",
      intervalMs: 5_000,
      providerId: "provider-a",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      runtimeVersion: "2.0.0-rc.1",
      protocolVersion: "2026-07-28",
    });
  });

  it("reads the scoped token from file and stops the background loop cleanly", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ outcome: "created", registration: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const readTokenFile = vi.fn(() => Promise.resolve("scoped-runtime-token\n"));
    const integration = new RuntimeRegistrationIntegration(
      bootstrap(),
      () => ({ configRevision: 7, readinessState: "ready" }),
      { warn: vi.fn() },
      {
        fetch,
        readTokenFile,
        sessionId: "session-1",
        correlationId: () => "correlation-1",
        delay: waitForAbort,
      },
    );

    integration.start();
    await waitUntil(() => fetch.mock.calls.length === 1);
    await integration.stop();

    expect(readTokenFile).toHaveBeenCalledWith("/run/secrets/runtime-registration-token");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: "Bearer scoped-runtime-token",
        "x-correlation-id": "correlation-1",
      },
    });
  });

  it("tolerates PMS outage without changing Runtime data-plane state", async () => {
    let runtimeDataPlaneReady = true;
    const warn = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("PMS offline")));
    const integration = new RuntimeRegistrationIntegration(
      bootstrap(),
      () => ({
        configRevision: 7,
        readinessState: runtimeDataPlaneReady ? "ready" : "not_ready",
      }),
      { warn },
      {
        fetch,
        readTokenFile: () => Promise.resolve("scoped-runtime-token"),
        delay: waitForAbort,
      },
    );

    integration.start();
    await waitUntil(() => warn.mock.calls.length > 0);
    expect(runtimeDataPlaneReady).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      {
        code: "RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE",
        retryable: true,
      },
      "Runtime registration is unavailable; Runtime remains operational",
    );
    await integration.stop();
    runtimeDataPlaneReady = false;
  });

  it("requires HTTPS for production and complete URL/token pairing", () => {
    const production = {
      ...loadRuntimeConfig({
        RUNTIME_ENV: "test",
        PMS_DEPLOYMENT_ID: "deployment-1",
        PMS_INSTANCE_ID: "instance-1",
      }),
      RUNTIME_ENV: "production" as const,
    };
    expect(() =>
      loadRuntimeRegistrationBootstrap(production, {
        PMS_DEPLOYMENT_ID: "deployment-1",
        PMS_INSTANCE_ID: "instance-1",
        PMS_RUNTIME_REGISTRATION_URL: "http://pms.internal",
        PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "/run/secrets/token",
      }),
    ).toThrow("PMS_RUNTIME_REGISTRATION_PRODUCTION_HTTPS_REQUIRED");
    expect(() =>
      loadRuntimeRegistrationBootstrap(loadRuntimeConfig({ RUNTIME_ENV: "test" }), {
        PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "/run/secrets/token",
      }),
    ).toThrow();
  });
});

function bootstrap() {
  return {
    baseUrl: "https://pms.internal/",
    tokenFile: "/run/secrets/runtime-registration-token",
    intervalMs: 100,
    providerId: "provider-a",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    runtimeVersion: "2.0.0-rc.1",
    protocolVersion: "2026-07-28",
  };
}

function waitForAbort(_milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("TEST_WAIT_TIMEOUT");
}
