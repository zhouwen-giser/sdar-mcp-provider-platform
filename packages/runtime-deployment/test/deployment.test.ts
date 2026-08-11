import { describe, expect, it } from "vitest";
import {
  databaseProfileId,
  requestRuntimeDeployment,
  rehydrateRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  type RuntimeDeployment,
  type PlatformManagedRuntimeDeploymentSpec,
  type RuntimeDeploymentStatus,
} from "../src/index.js";

const occurredAt = new Date("2026-07-26T00:00:00.000Z");

describe("RuntimeDeployment aggregate", () => {
  it("creates branded identity, requested state, revisions, and a domain event", () => {
    const deployment = createDeployment();

    expect(deployment.snapshot).toMatchObject({
      deploymentId: "deployment-1",
      providerId: "provider:ugv1",
      environment: "production",
      desiredState: "running",
      desiredReplicas: 1,
      runtimeAuthority: "platform_managed",
      status: "REQUESTED",
      desiredRevision: 0,
      observedRevision: 0,
    });
    expect(deployment.pullDomainEvents()).toEqual([
      expect.objectContaining({
        type: "RuntimeDeploymentRequested",
        deploymentId: "deployment-1",
        desiredRevision: 0,
        observedRevision: 0,
      }),
    ]);
    expect(deployment.pullDomainEvents()).toEqual([]);
  });

  it("permits the database-free direct-container activation shortcut only for that authority", () => {
    const deployment = requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId("deployment-direct"),
        providerId: runtimeProviderId("provider:ugv1"),
        environment: runtimeEnvironmentId("production"),
        desiredState: "running",
        desiredReplicas: 1,
        runtimeVersion: "2.0.0-rc.1",
        runtimeAuthority: "direct_container",
        adapterEndpoint: "ugv-adapter:50051",
        directContainer: {
          instanceId: runtimeInstanceId("runtime-direct-0"),
          controlEndpoint: "http://ugv-runtime:8080",
          advertisedEndpoint: "http://192.168.1.7:19100",
        },
      },
      occurredAt,
    );

    expect(() => transition(createDeployment(), "CONFIG_PREPARING")).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION" }),
    );
    expect(() => transition(deployment, "DATABASE_PROVISIONING")).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION" }),
    );
    transition(deployment, "CONFIG_PREPARING");
    expect(deployment.snapshot).toMatchObject({
      runtimeAuthority: "direct_container",
      status: "CONFIG_PREPARING",
    });
    expect(deployment.snapshot).not.toHaveProperty("databaseProfileId");
  });

  it("follows the full activation path and cannot treat process online as ACTIVE", () => {
    const deployment = createDeployment();
    deployment.pullDomainEvents();

    for (const status of [
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "CONFIG_PREPARING",
      "STARTING",
      "HEALTH_CHECKING",
      "DISCOVERING",
      "ACTIVE",
    ] as const) {
      transition(deployment, status);
    }

    expect(deployment.snapshot).toMatchObject({ status: "ACTIVE", observedRevision: 7 });
    expect(deployment.pullDomainEvents()).toHaveLength(7);

    const onlineOnly = createDeployment();
    transition(onlineOnly, "DATABASE_PROVISIONING");
    transition(onlineOnly, "MIGRATING");
    transition(onlineOnly, "CONFIG_PREPARING");
    transition(onlineOnly, "STARTING");
    expect(() =>
      onlineOnly.transition(
        "ACTIVE",
        {
          expectedStatus: "STARTING",
          expectedRevision: onlineOnly.snapshot.observedRevision,
        },
        occurredAt,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION" }));
  });

  it("rejects illegal jumps without mutating state or emitting an event", () => {
    const deployment = createDeployment();
    deployment.pullDomainEvents();

    expect(() =>
      deployment.transition(
        "ACTIVE",
        { expectedStatus: "REQUESTED", expectedRevision: 0 },
        occurredAt,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION",
        details: { currentStatus: "REQUESTED", targetStatus: "ACTIVE" },
      }),
    );
    expect(deployment.snapshot).toMatchObject({ status: "REQUESTED", observedRevision: 0 });
    expect(deployment.pullDomainEvents()).toEqual([]);
  });

  it("enforces expected status and observed revision preconditions", () => {
    const deployment = createDeployment();

    expect(() =>
      deployment.transition(
        "DATABASE_PROVISIONING",
        { expectedStatus: "STARTING", expectedRevision: 0 },
        occurredAt,
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_STATE_CONFLICT" }));
    expect(() =>
      deployment.transition(
        "DATABASE_PROVISIONING",
        { expectedStatus: "REQUESTED", expectedRevision: 1 },
        occurredAt,
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" }));
  });

  it("makes an immediately repeated worker transition idempotent", () => {
    const deployment = createDeployment();
    const precondition = { expectedStatus: "REQUESTED" as const, expectedRevision: 0 };

    expect(deployment.transition("DATABASE_PROVISIONING", precondition, occurredAt)).toBe(true);
    expect(deployment.transition("DATABASE_PROVISIONING", precondition, occurredAt)).toBe(false);
    expect(deployment.snapshot.observedRevision).toBe(1);
    expect(
      deployment
        .pullDomainEvents()
        .filter((event) => event.type === "RuntimeDeploymentStatusChanged"),
    ).toHaveLength(1);
  });

  it("does not disguise an unrelated stale transition as an idempotent retry", () => {
    const deployment = createDeployment();
    transition(deployment, "DATABASE_PROVISIONING");

    expect(() =>
      deployment.transition(
        "DATABASE_PROVISIONING",
        { expectedStatus: "ACTIVE", expectedRevision: 0 },
        occurredAt,
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_STATE_CONFLICT" }));
  });

  it("changes desired state with compare-and-set and idempotent retries", () => {
    const deployment = createDeployment();
    deployment.pullDomainEvents();

    expect(deployment.changeDesiredState("draining", 0, 0, occurredAt)).toBe(true);
    expect(deployment.changeDesiredState("draining", 0, 0, occurredAt)).toBe(false);
    expect(deployment.snapshot).toMatchObject({
      desiredState: "draining",
      desiredReplicas: 0,
      desiredRevision: 1,
    });
    expect(() => deployment.changeDesiredState("running", 1, 0, occurredAt)).toThrow(
      expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" }),
    );
    expect(deployment.pullDomainEvents()).toEqual([
      expect.objectContaining({
        type: "RuntimeDeploymentDesiredStateChanged",
        previousDesiredState: "running",
        desiredState: "draining",
        desiredRevision: 1,
      }),
    ]);
  });

  it("models draining, stopped, degraded, failure, and explicit retry paths", () => {
    const deployment = createDeployment();
    activate(deployment);
    transition(deployment, "DEGRADED");
    transition(deployment, "DISCOVERING");
    transition(deployment, "ACTIVE");
    deployment.changeDesiredState("stopped", 0, deployment.snapshot.desiredRevision, occurredAt);
    transition(deployment, "DRAINING");
    transition(deployment, "STOPPED");
    transition(deployment, "REQUESTED");
    transition(deployment, "FAILED");
    transition(deployment, "REQUESTED");

    expect(deployment.snapshot.status).toBe("REQUESTED");
  });

  it("rehydrates without creating false domain events", () => {
    const original = createDeployment();
    transition(original, "DATABASE_PROVISIONING");
    const restored = rehydrateRuntimeDeployment(original.snapshot);

    expect(restored.snapshot).toEqual(original.snapshot);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it("rejects invalid identity, desired replica combinations, and timestamps", () => {
    expect(() => runtimeDeploymentId("../deployment")).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER" }),
    );
    expect(() => createDeployment({ desiredReplicas: 2 })).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_SPEC" }),
    );
    expect(() => createDeployment({ desiredState: "stopped", desiredReplicas: 1 })).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_SPEC" }),
    );
    expect(() => requestRuntimeDeployment(spec(), new Date("invalid"))).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_SPEC" }),
    );
  });
});

function createDeployment(
  overrides: Partial<PlatformManagedRuntimeDeploymentSpec> = {},
): RuntimeDeployment {
  return requestRuntimeDeployment({ ...spec(), ...overrides }, occurredAt);
}

function spec(): PlatformManagedRuntimeDeploymentSpec {
  return {
    deploymentId: runtimeDeploymentId("deployment-1"),
    providerId: runtimeProviderId("provider:ugv1"),
    environment: runtimeEnvironmentId("production"),
    desiredState: "running",
    desiredReplicas: 1,
    runtimeVersion: "2.0.0-rc.1",
    databaseProfileId: databaseProfileId("database-profile-1"),
    configProfileId: runtimeConfigProfileId("config-profile-1"),
    adapterEndpoint: "127.0.0.1:50051",
  };
}

function transition(deployment: RuntimeDeployment, status: RuntimeDeploymentStatus): void {
  const before = deployment.snapshot;
  deployment.transition(
    status,
    {
      expectedStatus: before.status,
      expectedRevision: before.observedRevision,
    },
    occurredAt,
  );
}

function activate(deployment: RuntimeDeployment): void {
  for (const status of [
    "DATABASE_PROVISIONING",
    "MIGRATING",
    "CONFIG_PREPARING",
    "STARTING",
    "HEALTH_CHECKING",
    "DISCOVERING",
    "ACTIVE",
  ] as const) {
    transition(deployment, status);
  }
}
