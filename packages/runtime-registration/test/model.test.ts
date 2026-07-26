import { describe, expect, it } from "vitest";
import {
  acceptRuntimeHeartbeat,
  parseRuntimeHeartbeatRequest,
  parseRuntimeRegistrationRequest,
  registerRuntime,
  runtimeRegistrationFreshness,
  type RuntimeHeartbeatRequest,
  type RuntimeRegistrationRequest,
} from "../src/index.js";

const receivedAt = new Date("2026-07-26T00:00:00.000Z");
const ttlMs = 30_000;

describe("Runtime registration and heartbeat model", () => {
  it("requires a pre-existing expected instance and rejects every identity mismatch", () => {
    expect(() => registerRuntime(null, null, registration(), receivedAt, ttlMs)).toThrow(
      expect.objectContaining({
        code: "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND",
      }),
    );

    for (const field of ["providerId", "deploymentId", "instanceId"] as const) {
      expect(() =>
        registerRuntime(
          expected(),
          null,
          { ...registration(), [field]: `wrong-${field}` },
          receivedAt,
          ttlMs,
        ),
      ).toThrow(
        expect.objectContaining({
          code: "RUNTIME_REGISTRATION_IDENTITY_MISMATCH",
          field,
        }),
      );
    }
  });

  it("makes duplicate registration idempotent and rejects conflicting replay", () => {
    const created = registerRuntime(expected(), null, registration(), receivedAt, ttlMs);
    const replay = registerRuntime(
      expected(),
      created.registration,
      registration(),
      new Date(receivedAt.getTime() + 1_000),
      ttlMs,
    );

    expect(created.outcome).toBe("created");
    expect(replay).toEqual({ outcome: "unchanged", registration: created.registration });
    expect(replay.registration.revision).toBe(0);
    expect(() =>
      registerRuntime(
        expected(),
        created.registration,
        { ...registration(), configRevision: 8 },
        receivedAt,
        ttlMs,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_REGISTRATION_REPLAY_CONFLICT",
      }),
    );
  });

  it("persists ordered heartbeat state and detects TTL staleness", () => {
    const created = registerRuntime(expected(), null, registration(), receivedAt, ttlMs);
    const heartbeatAt = new Date(receivedAt.getTime() + 10_000);
    const updated = acceptRuntimeHeartbeat(
      expected(),
      created.registration,
      heartbeat({ sequence: 1, readinessState: "ready", configRevision: 8 }),
      heartbeatAt,
      ttlMs,
    );
    const replay = acceptRuntimeHeartbeat(
      expected(),
      updated.registration,
      heartbeat({ sequence: 1, readinessState: "ready", configRevision: 8 }),
      new Date(heartbeatAt.getTime() + 1_000),
      ttlMs,
    );

    expect(updated).toMatchObject({
      outcome: "updated",
      registration: {
        heartbeatSequence: 1,
        readinessState: "ready",
        configRevision: 8,
        revision: 1,
      },
    });
    expect(replay.outcome).toBe("unchanged");
    expect(runtimeRegistrationFreshness(updated.registration, heartbeatAt)).toBe("registered");
    expect(
      runtimeRegistrationFreshness(updated.registration, new Date(heartbeatAt.getTime() + ttlMs)),
    ).toBe("stale");
    expect(() =>
      acceptRuntimeHeartbeat(
        expected(),
        updated.registration,
        heartbeat({ sequence: 0 }),
        heartbeatAt,
        ttlMs,
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_HEARTBEAT_SEQUENCE_STALE" }));
  });

  it("tracks version/protocol/config/readiness and rejects expected version drift", () => {
    expect(() =>
      registerRuntime(
        expected(),
        null,
        { ...registration(), runtimeVersion: "0.2.0" },
        receivedAt,
        ttlMs,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_REGISTRATION_VERSION_MISMATCH",
        field: "runtimeVersion",
      }),
    );
    expect(() =>
      registerRuntime(
        expected(),
        null,
        { ...registration(), protocolVersion: "2027-01-01" },
        receivedAt,
        ttlMs,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_REGISTRATION_PROTOCOL_MISMATCH",
        field: "protocolVersion",
      }),
    );
  });

  it("parses exact DTOs and rejects unknown fields or invalid sequence", () => {
    expect(parseRuntimeRegistrationRequest(registration())).toEqual(registration());
    expect(parseRuntimeHeartbeatRequest(heartbeat({ sequence: 2 }))).toEqual(
      heartbeat({ sequence: 2 }),
    );
    expect(() =>
      parseRuntimeRegistrationRequest({ ...registration(), provider: "arbitrary-provider" }),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_REGISTRATION_INVALID_REQUEST" }));
    expect(() => parseRuntimeHeartbeatRequest(heartbeat({ sequence: -1 }))).toThrow(
      expect.objectContaining({ code: "RUNTIME_REGISTRATION_INVALID_REQUEST", field: "sequence" }),
    );
    expect(() => parseRuntimeRegistrationRequest({ ...registration(), providerId: 123 })).toThrow(
      expect.objectContaining({
        code: "RUNTIME_REGISTRATION_INVALID_REQUEST",
        field: "providerId",
      }),
    );
  });
});

function expected() {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    runtimeVersion: "0.1.0",
    protocolVersion: "2025-11-25",
  };
}

function registration(): RuntimeRegistrationRequest {
  return {
    ...expected(),
    sessionId: "session-1",
    configRevision: 7,
    readinessState: "not_ready",
  };
}

function heartbeat(overrides: Partial<RuntimeHeartbeatRequest> = {}): RuntimeHeartbeatRequest {
  return {
    ...registration(),
    sequence: 0,
    ...overrides,
  };
}
