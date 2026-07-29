import { describe, expect, it, vi } from "vitest";
import type { RuntimeInfrastructureProcessObservation } from "@sdar/runtime-deployment";
import { RuntimeHealthProbe, RuntimeHealthProbeError } from "../src/index.js";

describe("RuntimeHealthProbe", () => {
  it("requires process online plus distinct live and ready success", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { status: "live" }))
      .mockResolvedValueOnce(
        json(200, {
          status: "ready",
          dependencies: {
            database: "ready",
            adapter: "ready",
            adapterManifest: "ready",
            businessEventPersistence: "disabled",
            businessEventAdapterSources: {},
          },
        }),
      );
    const probe = new RuntimeHealthProbe(onlineProcess(), {
      fetch,
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    expect(await probe.probe(request())).toMatchObject({
      processState: "online",
      live: true,
      ready: true,
      reasonCode: "HEALTHY",
      checkedAt: "2026-07-26T00:00:00.000Z",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("http://127.0.0.1:18080/health/live");
    expect(fetch.mock.calls[1]?.[0]).toBe("http://127.0.0.1:18080/health/ready");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("does not probe HTTP unless the managed process is online", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const probe = new RuntimeHealthProbe(
      { describe: () => Promise.resolve(observation("stopped")) },
      { fetch },
    );

    expect(await probe.probe(request())).toMatchObject({
      live: false,
      ready: false,
      reasonCode: "PROCESS_NOT_ONLINE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ database: "failed", adapter: "ready", adapterManifest: "ready" }, "DATABASE_NOT_READY"],
    [{ database: "ready", adapter: "failed", adapterManifest: "ready" }, "ADAPTER_NOT_READY"],
    [
      { database: "ready", adapter: "ready", adapterManifest: "ready", scheduler: "starting" },
      "DEPENDENCY_NOT_READY",
    ],
  ])(
    "classifies not-ready dependency failures without returning raw details",
    async (dependencies, reasonCode) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json(200, { status: "live" }))
        .mockResolvedValueOnce(json(503, { status: "not_ready", dependencies }));
      const result = await new RuntimeHealthProbe(onlineProcess(), { fetch }).probe(request());

      expect(result).toMatchObject({ live: true, ready: false, reasonCode });
      expect(result).not.toHaveProperty("dependencies");
    },
  );

  it("times out a hung live request and returns a stable redacted reason", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("private URL detail")));
      });
    });
    const result = await new RuntimeHealthProbe(onlineProcess(), { fetch }).probe({
      ...request(),
      timeoutMs: 5,
    });

    expect(result).toMatchObject({
      live: false,
      ready: false,
      reasonCode: "LIVE_TIMEOUT",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects invalid JSON/status schemas and has no caller-supplied host or URL", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { status: "alive", extra: "forbidden" }));
    const result = await new RuntimeHealthProbe(onlineProcess(), { fetch }).probe(request());
    expect(result.reasonCode).toBe("LIVE_INVALID_RESPONSE");
    expect(request()).not.toHaveProperty("url");
    expect(request()).not.toHaveProperty("host");
    expect(
      () =>
        new RuntimeHealthProbe(onlineProcess(), {
          host: "169.254.169.254" as "127.0.0.1",
        }),
    ).toThrow(RuntimeHealthProbeError);
  });
});

function onlineProcess() {
  return { describe: () => Promise.resolve(observation("online")) };
}

function request() {
  return {
    target: observation("online").target,
    httpPort: 18_080,
    timeoutMs: 100,
    signal: new AbortController().signal,
  };
}

function observation(
  state: RuntimeInfrastructureProcessObservation["state"],
): RuntimeInfrastructureProcessObservation {
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
    state,
    restartCount: 0,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
