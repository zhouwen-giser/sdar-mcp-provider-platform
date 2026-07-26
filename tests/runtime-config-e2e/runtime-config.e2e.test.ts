import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfigDocument } from "../../packages/runtime-config-client/src/index.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import {
  loadRuntimeConfigClientBootstrap,
  RuntimeConfigIntegration,
  type RuntimeConfigClientBootstrap,
} from "../../apps/runtime/src/runtime-config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";

const temporaryDirectories: string[] = [];
let runtime: RuntimeApplication | undefined;

afterEach(async () => {
  if (runtime !== undefined) await runtime.app.close();
  runtime = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Runtime Config integration", () => {
  it("keeps the legacy cold start path when PMS bootstrap is absent", async () => {
    const config = loadRuntimeConfig({});
    expect(loadRuntimeConfigClientBootstrap(config, {})).toBeNull();

    runtime = createRuntime(config);
    const before = await runtime.app.inject({ method: "GET", url: "/health/live" });
    await runtime.applyOtelEnabled(true);
    const enabled = await runtime.app.inject({ method: "GET", url: "/health/live" });
    await runtime.applyOtelEnabled(false);
    const disabled = await runtime.app.inject({ method: "GET", url: "/health/live" });

    expect([before.statusCode, enabled.statusCode, disabled.statusCode]).toEqual([200, 200, 200]);
    expect(runtime.telemetryEnabled()).toBe(false);
    expect(runtime.dependencies.database).toBe("starting");
  });

  it("requires a complete file-secret bootstrap and production HTTPS", () => {
    const development = loadRuntimeConfig({});
    const production = loadRuntimeConfig({
      RUNTIME_ENV: "production",
      AUTH_MODE: "trusted_headers",
      ADAPTER_TLS_MODE: "required",
      ADAPTER_TLS_CA_PATH: "/run/secrets/ca",
      ADAPTER_TLS_CERT_PATH: "/run/secrets/cert",
      ADAPTER_TLS_KEY_PATH: "/run/secrets/key",
    });
    expect(() =>
      loadRuntimeConfigClientBootstrap(development, {
        PMS_RUNTIME_CONFIG_URL: "http://pms.example.test",
      }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfigClientBootstrap(production, {
        PMS_RUNTIME_CONFIG_URL: "http://pms.example.test",
        PMS_RUNTIME_CONFIG_TOKEN_FILE: "/run/secrets/pms-token",
        PMS_RUNTIME_CONFIG_CACHE_PATH: "/var/lib/sdar/runtime-config.json",
        RUNTIME_DEPLOYMENT_ID: "deployment-1",
        RUNTIME_INSTANCE_ID: "instance-1",
      }),
    ).toThrow("PMS_RUNTIME_CONFIG_PRODUCTION_HTTPS_REQUIRED");
  });

  it("pulls, applies OTEL_ENABLED, acknowledges applied, follows Watch, and shuts down", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sdar-runtime-config-e2e-"));
    temporaryDirectories.push(directory);
    const bootstrap: RuntimeConfigClientBootstrap = {
      baseUrl: "http://pms.example.test/",
      tokenFile: "/run/secrets/pms-runtime-token",
      cachePath: join(directory, "runtime-observability.json"),
      target,
    };
    const applied: boolean[] = [];
    const acknowledgements: unknown[] = [];
    let latestCalls = 0;
    let watchCalls = 0;
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer opaque-token");
      if (url.pathname.endsWith("/latest")) {
        latestCalls += 1;
        if (latestCalls === 1) return Promise.resolve(latest(document("a", true)));
        if (latestCalls === 2) return Promise.resolve(latest(document("b", false)));
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: quoted("b") },
          }),
        );
      }
      if (url.pathname.endsWith("/acks")) {
        if (typeof init?.body !== "string") throw new Error("ACK_BODY_INVALID");
        acknowledgements.push(JSON.parse(init.body) as unknown);
        return Promise.resolve(Response.json({ ackId: `ack-${String(acknowledgements.length)}` }));
      }
      if (url.pathname.endsWith("/watch")) {
        watchCalls += 1;
        if (watchCalls === 1) {
          return Promise.resolve(
            new Response(
              `event: revision\ndata: ${JSON.stringify({
                revisionId: document("b", false).revisionId,
                revision: 2,
                checksum: "b".repeat(64),
              })}\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            ),
          );
        }
        const signal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                if (signal?.aborted === true) controller.close();
                else signal?.addEventListener("abort", () => controller.close(), { once: true });
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const integration = new RuntimeConfigIntegration(
      bootstrap,
      {
        applyOtelEnabled: (enabled) => {
          applied.push(enabled);
          return Promise.resolve();
        },
      },
      { warn: vi.fn() },
      {
        fetch,
        readTokenFile: () => Promise.resolve("opaque-token\n"),
        reconnectDelay: () => Promise.resolve(),
      },
    );

    integration.start();
    await vi.waitFor(() => expect(applied).toEqual([true, false]));
    await integration.stop();

    expect(latestCalls).toBeGreaterThanOrEqual(2);
    expect(watchCalls).toBeGreaterThanOrEqual(1);
    expect(acknowledgements).toEqual([
      {
        status: "applied",
        appliedChecksum: "a".repeat(64),
      },
      {
        status: "applied",
        appliedChecksum: "b".repeat(64),
      },
    ]);
    expect(
      fetch.mock.calls.some(([input, init]) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        return url.pathname.endsWith("/latest") && init?.method === "GET";
      }),
    ).toBe(true);
  });
});

function latest(value: RuntimeConfigDocument): Response {
  return Response.json(value, { headers: { etag: quoted(value.checksum[0] ?? "a") } });
}

function document(character: string, enabled: boolean): RuntimeConfigDocument {
  return {
    revisionId:
      character === "a"
        ? "00000000-0000-4000-8000-000000000001"
        : "00000000-0000-4000-8000-000000000002",
    revision: character === "a" ? 1 : 2,
    checksum: character.repeat(64),
    applyMode: "hot_reload",
    sourceTargetType: "runtime_deployment",
    identity: {
      environment: target.environment,
      deploymentId: target.deploymentId,
      instanceId: target.instanceId,
      providerId: "provider-1",
    },
    content: {
      LOG_LEVEL: "info",
      OTEL_ENABLED: enabled,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_TLS_MODE: "disabled",
      OTEL_EXPORTER_OTLP_TIMEOUT_MS: 10_000,
    },
  };
}

function quoted(character: string): string {
  return `"${character.repeat(64)}"`;
}

const target = {
  environment: "development",
  deploymentId: "deployment-1",
  instanceId: "instance-1",
  configGroup: "runtime.observability",
  dataId: "main",
} as const;
