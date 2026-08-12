import { describe, expect, it, vi } from "vitest";
import { ExternalRuntimeHealthProbe } from "../src/external-runtime-health.js";

describe("ExternalRuntimeHealthProbe", () => {
  it("observes live and ready endpoints without consulting a process manager", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((url) => {
      const path = new URL(requestUrl(url)).pathname;
      return Promise.resolve(
        Response.json(
          path.endsWith("/health/live")
            ? { status: "live" }
            : { status: "ready", dependencies: { database: "ready", adapter: "ready" } },
        ),
      );
    });
    const probe = new ExternalRuntimeHealthProbe({
      fetch,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    await expect(
      probe.probe({
        controlEndpoint: "http://127.0.0.1:8080/runtime",
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      processState: "online",
      live: true,
      ready: true,
      reasonCode: "HEALTHY",
      checkedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(fetch.mock.calls.map(([url]) => requestUrl(url))).toEqual([
      "http://127.0.0.1:8080/runtime/health/live",
      "http://127.0.0.1:8080/runtime/health/ready",
    ]);
  });

  it("fails closed for non-loopback plaintext unless internal transport is explicit", async () => {
    const input = {
      controlEndpoint: "http://runtime.internal:8080",
      timeoutMs: 1_000,
      signal: new AbortController().signal,
    };
    await expect(new ExternalRuntimeHealthProbe().probe(input)).rejects.toThrow(
      "EXTERNAL_RUNTIME_CONTROL_ENDPOINT_INVALID",
    );
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ status: "live" })),
    );
    await new ExternalRuntimeHealthProbe({
      allowInsecureInternalTransport: true,
      fetch,
    }).probe(input);
    expect(fetch).toHaveBeenCalled();
  });

  it("reports an unavailable external Runtime without claiming it is online", async () => {
    const probe = new ExternalRuntimeHealthProbe({
      fetch: () => Promise.reject(new Error("connection refused")),
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    await expect(
      probe.probe({
        controlEndpoint: "https://runtime.internal",
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      processState: "errored",
      live: false,
      ready: false,
      reasonCode: "LIVE_UNAVAILABLE",
    });
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}
