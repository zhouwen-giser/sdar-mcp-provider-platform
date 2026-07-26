import { describe, expect, it } from "vitest";
import {
  RuntimeRegistrationService,
  type RuntimeRegistrationAuditEvent,
  type RuntimeRegistrationSnapshot,
} from "../src/index.js";

describe("RuntimeRegistrationService", () => {
  it("persists with CAS and emits correlation-safe update audits", async () => {
    let registration: RuntimeRegistrationSnapshot | null = null;
    const audits: RuntimeRegistrationAuditEvent[] = [];
    const service = new RuntimeRegistrationService(
      { getExpected: () => Promise.resolve(expected()) },
      {
        get: () => Promise.resolve(registration),
        save(value, expectedRevision) {
          expect(expectedRevision).toBe(registration?.revision ?? null);
          registration = value;
          return Promise.resolve();
        },
      },
      {
        append(event) {
          audits.push(event);
          return Promise.resolve();
        },
      },
      { now: () => new Date("2026-07-26T00:00:00.000Z"), heartbeatTtlMs: 30_000 },
    );

    const first = await service.register(request(), context());
    const replay = await service.register(request(), context());

    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("unchanged");
    expect(audits).toEqual([
      expect.objectContaining({
        action: "runtime.register",
        outcome: "created",
        subjectId: "runtime-instance-1",
        correlationId: "correlation-1",
        revision: 0,
      }),
      expect.objectContaining({
        action: "runtime.register",
        outcome: "unchanged",
        revision: 0,
      }),
    ]);
    expect(JSON.stringify(audits)).not.toContain("Bearer");
  });

  it("cannot create an arbitrary Provider and audits a stable rejection", async () => {
    const audits: RuntimeRegistrationAuditEvent[] = [];
    const service = new RuntimeRegistrationService(
      { getExpected: () => Promise.resolve(null) },
      {
        get: () => Promise.resolve(null),
        save: () => Promise.reject(new Error("must not save")),
      },
      {
        append(event) {
          audits.push(event);
          return Promise.resolve();
        },
      },
    );

    await expect(service.register(request(), context())).rejects.toMatchObject({
      code: "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND",
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "runtime.register",
        outcome: "rejected",
        reasonCode: "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND",
      }),
    ]);
  });
});

function expected() {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    runtimeVersion: "0.1.0",
    protocolVersion: "2026-07-28",
  };
}

function request() {
  return {
    ...expected(),
    sessionId: "session-1",
    configRevision: 1,
    readinessState: "ready" as const,
  };
}

function context() {
  return {
    subjectId: "runtime-instance-1",
    requestId: "request-1",
    correlationId: "correlation-1",
  };
}
