import { describe, expect, it } from "vitest";
import {
  RuntimeRegistrationService,
  type RuntimeRegistrationAuditEvent,
  type RuntimeRegistrationUnitOfWork,
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

  it("commits registration, process projection, and success audit together while no-op replays stay read-only", async () => {
    const fixture = transactionalFixture();
    const service = new RuntimeRegistrationService(fixture.unitOfWork, {
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      heartbeatTtlMs: 30_000,
    });

    await expect(service.register(request(), context())).resolves.toMatchObject({
      outcome: "created",
    });
    await expect(service.register(request(), context())).resolves.toMatchObject({
      outcome: "unchanged",
    });

    expect(fixture.registration).toMatchObject({ revision: 0, sessionId: "session-1" });
    expect(fixture.observedRevision).toBe(1);
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]).toMatchObject({ outcome: "created", revision: 0 });
    expect(fixture.readOrder).toEqual([
      "expected",
      "process",
      "registration",
      "expected",
      "process",
      "registration",
    ]);
  });

  it("rolls an entire transaction back when Audit append fails", async () => {
    const fixture = transactionalFixture({ auditFails: true });
    const service = new RuntimeRegistrationService(fixture.unitOfWork, {
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    await expect(service.register(request(), context())).rejects.toThrow("audit failed");
    expect(fixture.registration).toBeNull();
    expect(fixture.observedRevision).toBe(0);
    expect(fixture.audits).toEqual([]);
  });

  it("retries a complete transaction after Process CAS conflict and stops after three attempts", async () => {
    const retried = transactionalFixture({ projectionConflicts: 1 });
    const retriedService = new RuntimeRegistrationService(retried.unitOfWork, {
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    await expect(retriedService.register(request(), context())).resolves.toMatchObject({
      outcome: "created",
    });
    expect(retried.transactionCount).toBe(2);
    expect(retried.observedRevision).toBe(1);

    const conflicted = transactionalFixture({ projectionConflicts: 3 });
    const conflictedService = new RuntimeRegistrationService(conflicted.unitOfWork, {
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    await expect(conflictedService.register(request(), context())).rejects.toMatchObject({
      code: "RUNTIME_REGISTRATION_PROJECTION_CONFLICT",
    });
    expect(conflicted.transactionCount).toBe(4); // three mutations plus best-effort rejection audit
    expect(conflicted.registration).toBeNull();
    expect(conflicted.observedRevision).toBe(0);
    expect(JSON.stringify(conflicted.audits)).not.toContain("session-1");
  });

  it("maps Registration revision CAS conflicts to replay conflict", async () => {
    const fixture = transactionalFixture({ registrationConflict: true });
    fixture.registration = registered();
    const service = new RuntimeRegistrationService(fixture.unitOfWork, {
      now: () => new Date("2026-07-26T00:00:01.000Z"),
    });

    await expect(service.heartbeat({ ...request(), sequence: 1 }, context())).rejects.toMatchObject(
      { code: "RUNTIME_REGISTRATION_REPLAY_CONFLICT" },
    );
    expect(fixture.registration).toMatchObject({ revision: 0 });
    expect(fixture.observedRevision).toBe(0);
  });
});

function transactionalFixture(
  options: {
    readonly auditFails?: boolean;
    readonly projectionConflicts?: number;
    readonly registrationConflict?: boolean;
  } = {},
) {
  let registration: RuntimeRegistrationSnapshot | null = null;
  let observedRevision = 0;
  let projectionConflicts = options.projectionConflicts ?? 0;
  const audits: RuntimeRegistrationAuditEvent[] = [];
  const readOrder: string[] = [];
  let transactionCount = 0;

  const fixture = {
    get registration() {
      return registration;
    },
    set registration(value: RuntimeRegistrationSnapshot | null) {
      registration = value;
    },
    get observedRevision() {
      return observedRevision;
    },
    get audits() {
      return audits;
    },
    get readOrder() {
      return readOrder;
    },
    get transactionCount() {
      return transactionCount;
    },
    unitOfWork: undefined as unknown as RuntimeRegistrationUnitOfWork,
  };

  fixture.unitOfWork = {
    transaction(work) {
      transactionCount += 1;
      let stagedRegistration = registration;
      let stagedObservedRevision = observedRevision;
      const stagedAudits = [...audits];
      return work({
        expectedInstances: {
          getExpected: () => {
            readOrder.push("expected");
            return Promise.resolve(expected());
          },
        },
        processes: {
          get: () => {
            readOrder.push("process");
            return Promise.resolve({ ...expected(), observedRevision: stagedObservedRevision });
          },
        },
        registrations: {
          get: () => {
            readOrder.push("registration");
            return Promise.resolve(stagedRegistration);
          },
          insert: (_scope, value) => {
            if (options.registrationConflict) return Promise.reject(concurrencyError());
            stagedRegistration = value;
            return Promise.resolve();
          },
          update: (_scope, _expectedRevision, value) => {
            if (options.registrationConflict) return Promise.reject(concurrencyError());
            stagedRegistration = value;
            return Promise.resolve();
          },
          updateRegistrationProjection: (_scope, expectedRevision, patch) => {
            if (projectionConflicts > 0) {
              projectionConflicts -= 1;
              return Promise.reject(concurrencyError());
            }
            if (expectedRevision !== stagedObservedRevision)
              return Promise.reject(concurrencyError());
            stagedObservedRevision = patch.observedRevision;
            return Promise.resolve();
          },
        },
        audit: {
          append: (event) => {
            if (options.auditFails && event.outcome !== "rejected")
              return Promise.reject(new Error("audit failed"));
            stagedAudits.push(event);
            return Promise.resolve();
          },
        },
      }).then((result) => {
        registration = stagedRegistration;
        observedRevision = stagedObservedRevision;
        audits.splice(0, audits.length, ...stagedAudits);
        return result;
      });
    },
  };
  return fixture;
}

function concurrencyError() {
  return Object.assign(new Error("concurrent update"), {
    code: "OPTIMISTIC_CONCURRENCY_CONFLICT",
  });
}

function registered(): RuntimeRegistrationSnapshot {
  const at = new Date("2026-07-26T00:00:00.000Z");
  return {
    ...request(),
    heartbeatSequence: 0,
    registeredAt: at,
    lastHeartbeatAt: at,
    expiresAt: new Date(at.getTime() + 30_000),
    revision: 0,
  };
}

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
