import { describe, expect, it, vi } from "vitest";
import {
  FetchRuntimeRegistrationTransport,
  RuntimeHeartbeatLoop,
  RuntimeRegistrationClientError,
  type RuntimeHeartbeatRequest,
  type RuntimeRegistrationRequest,
  type RuntimeRegistrationTransport,
} from "../src/index.js";

describe("Runtime registration HTTP client and heartbeat loop", () => {
  it("uses fixed target paths, bearer authorization and correlation without reflecting responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ outcome: "created", registration: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const transport = new FetchRuntimeRegistrationTransport({
      baseUrl: "https://pms.internal/base",
      authorization: () => Promise.resolve("Bearer file-token"),
      fetch,
    });

    await transport.register(registration(), {
      correlationId: "correlation-1",
      signal: new AbortController().signal,
    });

    const url = fetch.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect(url instanceof URL ? url.toString() : "").toBe(
      "https://pms.internal/api/v1/runtime-registration/deployments/deployment-1/instances/instance-1/register",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer file-token",
        "x-correlation-id": "correlation-1",
      },
    });
    const requestBody = fetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody === "string" ? requestBody : "").not.toContain("deploymentId");
  });

  it("keeps Runtime operational during PMS outage with bounded exponential retry", async () => {
    const controller = new AbortController();
    const unavailable: unknown[] = [];
    const delays: number[] = [];
    const transport: RuntimeRegistrationTransport = {
      register: () =>
        Promise.reject(
          new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", true),
        ),
      heartbeat: () => Promise.reject(new Error("not reached")),
    };
    const loop = new RuntimeHeartbeatLoop(transport, registrationBase(), {
      correlationId: () => "correlation-1",
      observe: () => ({ configRevision: 1, readinessState: "ready" }),
      onUnavailable: (value) => unavailable.push(value),
      delay: (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) controller.abort();
        return Promise.resolve();
      },
    });

    await expect(loop.run(controller.signal)).resolves.toBeUndefined();
    expect(delays).toEqual([500, 1_000, 2_000]);
    expect(unavailable).toHaveLength(3);
  });

  it("replays the same heartbeat sequence after a transient failure", async () => {
    const controller = new AbortController();
    const heartbeatSequences: number[] = [];
    let heartbeatAttempt = 0;
    const transport: RuntimeRegistrationTransport = {
      register: () => Promise.resolve(),
      heartbeat(request) {
        heartbeatSequences.push(request.sequence);
        heartbeatAttempt += 1;
        return heartbeatAttempt === 1
          ? Promise.reject(
              new RuntimeRegistrationClientError("RUNTIME_REGISTRATION_CLIENT_UNAVAILABLE", true),
            )
          : Promise.resolve();
      },
    };
    let delayCount = 0;
    const loop = new RuntimeHeartbeatLoop(transport, registrationBase(), {
      intervalMs: 100,
      correlationId: () => "correlation-1",
      observe: () => ({ configRevision: 1, readinessState: "ready" }),
      delay: () => {
        delayCount += 1;
        if (delayCount === 3) controller.abort();
        return Promise.resolve();
      },
    });

    await loop.run(controller.signal);
    expect(heartbeatSequences).toEqual([1, 1]);
  });
});

function registration(): RuntimeRegistrationRequest {
  return {
    ...registrationBase(),
    configRevision: 1,
    readinessState: "ready",
  };
}

function registrationBase(): Omit<
  RuntimeHeartbeatRequest,
  "configRevision" | "readinessState" | "sequence"
> {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    sessionId: "session-1",
    runtimeVersion: "0.1.0",
    protocolVersion: "2026-07-28",
  };
}
