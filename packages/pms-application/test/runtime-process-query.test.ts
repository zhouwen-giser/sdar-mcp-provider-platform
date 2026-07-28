import { describe, expect, it } from "vitest";
import {
  createRuntimeProcessProjection,
  runtimeDeploymentId,
  runtimeInstanceId,
  type RuntimeProcessObservation,
  type RuntimeProcessProjection,
} from "@sdar/runtime-deployment";
import { RuntimeProcessQueryService, type RuntimeProcessQueryRepository } from "../src/index.js";

const now = new Date("2026-07-26T00:01:00.000Z");

describe("RuntimeProcess query service", () => {
  it("projects stale health and only an opaque controlled log reference", async () => {
    const process = projection({
      lastHeartbeatAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    const service = new RuntimeProcessQueryService(repository([process]), {
      now: () => now,
      heartbeatStaleAfterMs: 30_000,
    });

    const view = await service.get("provider-1", "instance-1");

    expect(view).toMatchObject({
      pid: 1201,
      processState: "online",
      observedHealth: "STALE",
      healthReasonCode: "HEARTBEAT_STALE",
      stale: true,
      logReference: {
        referenceId: "runtime-process:instance-1",
        tailEndpoint: "/api/v1/runtime-processes/instance-1/logs/tail",
        contentIncluded: false,
      },
    });
    expect(view).not.toHaveProperty("environment");
    expect(view).not.toHaveProperty("env");
    expect(view).not.toHaveProperty("secret");
    expect(JSON.stringify(view)).not.toContain("/var/");
  });

  it("filters observed status before cursor pagination", async () => {
    const stale = projection({
      instanceId: "instance-1",
      lastHeartbeatAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    const ready = projection({
      instanceId: "instance-2",
      lastHeartbeatAt: new Date("2026-07-26T00:00:59.000Z"),
    });
    const service = new RuntimeProcessQueryService(repository([stale, ready]), {
      now: () => now,
      heartbeatStaleAfterMs: 30_000,
    });

    const result = await service.list({
      providerId: "provider-1",
      deploymentId: "deployment-1",
      observedHealth: "READY",
      limit: 1,
    });

    expect(result.items.map(({ instanceId }) => instanceId)).toEqual(["instance-2"]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("rejects cross-Provider or missing instances with a stable code", async () => {
    const service = new RuntimeProcessQueryService(repository([]), { now: () => now });

    await expect(service.get("provider-2", "instance-1")).rejects.toMatchObject({
      code: "RUNTIME_PROCESS_NOT_FOUND",
    });
  });

  it("derives registration freshness from the durable expiry at query time", async () => {
    const process = projection({ registrationState: "registered" });
    const calls: string[] = [];
    const service = new RuntimeProcessQueryService(repository([process]), {
      now: () => now,
      registrations: {
        get(providerId, deploymentId, instanceId) {
          calls.push(`${providerId}/${deploymentId}/${instanceId}`);
          return Promise.resolve({ expiresAt: new Date("2026-07-26T00:01:01.000Z") });
        },
      },
    });

    await expect(service.get("provider-1", "instance-1")).resolves.toMatchObject({
      registrationFreshness: "registered",
    });
    expect(calls).toEqual(["provider-1/deployment-1/instance-1"]);

    const rebuilt = new RuntimeProcessQueryService(repository([process]), {
      now: () => now,
      registrations: { get: () => Promise.resolve({ expiresAt: now }) },
    });
    await expect(rebuilt.get("provider-1", "instance-1")).resolves.toMatchObject({
      registrationFreshness: "stale",
    });
  });

  it("keeps unregistered and identity-mismatch freshness independent of expiry lookup", async () => {
    const unregistered = projection({
      instanceId: "instance-unregistered",
      registrationState: "unregistered",
    });
    const mismatch = projection({
      instanceId: "instance-mismatch",
      registrationState: "identity_mismatch",
    });
    const service = new RuntimeProcessQueryService(repository([unregistered, mismatch]), {
      now: () => now,
      registrations: { get: () => Promise.reject(new Error("must not query")) },
    });

    await expect(service.get("provider-1", "instance-unregistered")).resolves.toMatchObject({
      registrationFreshness: "unregistered",
    });
    await expect(service.get("provider-1", "instance-mismatch")).resolves.toMatchObject({
      registrationFreshness: "identity_mismatch",
    });
  });
});

function projection(
  overrides: Partial<RuntimeProcessObservation> & {
    readonly instanceId?: string;
  } = {},
): RuntimeProcessProjection {
  const { instanceId = "instance-1", ...observationOverrides } = overrides;
  return createRuntimeProcessProjection(
    {
      instanceId: runtimeInstanceId(instanceId),
      deploymentId: runtimeDeploymentId("deployment-1"),
      pm2Name: "sdar-runtime-provider-1",
      port: 3101,
    },
    {
      pid: 1201,
      processState: "online",
      livenessState: "live",
      readinessState: "ready",
      registrationState: "registered",
      catalogState: "valid",
      configState: "current",
      lastHeartbeatAt: now,
      runtimeVersion: "0.1.0",
      configRevision: 3,
      restartCount: 0,
      ...observationOverrides,
    },
  );
}

function repository(processes: readonly RuntimeProcessProjection[]): RuntimeProcessQueryRepository {
  return {
    get(_providerId, instanceId) {
      return Promise.resolve(
        processes.find((process) => process.instanceId === instanceId) ?? null,
      );
    },
    listByDeployment() {
      return Promise.resolve(processes);
    },
  };
}
