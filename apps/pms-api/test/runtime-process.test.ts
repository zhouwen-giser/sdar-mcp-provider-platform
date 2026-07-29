import { describe, expect, it } from "vitest";
import {
  RuntimeProcessQueryService,
  type RuntimeProcessQueryRepository,
} from "../../../packages/pms-application/src/index.js";
import {
  createRuntimeProcessProjection,
  runtimeDeploymentId,
  runtimeInstanceId,
  type RuntimeProcessProjection,
} from "../../../packages/runtime-deployment/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

const now = new Date("2026-07-26T00:01:00.000Z");
const staleProcess = projection({
  lastHeartbeatAt: new Date("2026-07-26T00:00:00.000Z"),
});

describe("RuntimeProcess query API", () => {
  it("lists and filters Provider-scoped process status including stale health", async () => {
    const query = service([staleProcess]);
    const app = createPmsApi({ runtimeProcesses: query });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-processes?providerId=provider-1&deploymentId=deployment-1&processState=online&observedHealth=STALE",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          instanceId: "instance-1",
          deploymentId: "deployment-1",
          pm2Name: "sdar-runtime-provider-1",
          pid: 1201,
          port: 3101,
          processState: "online",
          observedHealth: "STALE",
          stale: true,
          readyForActive: false,
        },
      ],
    });
    expect(response.body).not.toContain("SECRET");
    expect(response.body).not.toContain("DATABASE_URL");
    expect(response.body).not.toContain("/var/");
    await app.close();
  });

  it("returns only an opaque fixed log reference, never a caller-selected path", async () => {
    const app = createPmsApi({ runtimeProcesses: service([staleProcess]) });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-processes/instance-1/logs?providerId=provider-1",
    });
    const arbitraryPath = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-processes/instance-1/logs?providerId=provider-1&path=%2Fetc%2Fpasswd",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      logReference: {
        referenceId: "runtime-process:instance-1",
        tailEndpoint: "/api/v1/runtime-processes/instance-1/logs/tail",
        contentIncluded: false,
      },
    });
    expect(arbitraryPath.statusCode).toBe(200);
    expect(arbitraryPath.json()).toEqual(response.json());
    expect(arbitraryPath.body).not.toContain("root:");
    await app.close();
  });

  it("returns a stable scoped not-found error", async () => {
    const app = createPmsApi({ runtimeProcesses: service([]) });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-processes/missing?providerId=provider-1",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "RUNTIME_PROCESS_NOT_FOUND",
        message: "The Runtime process does not exist in Provider scope",
      },
    });
    await app.close();
  });

  it("documents status and controlled log-reference endpoints as management reads", () => {
    const document = pmsOpenApiDocument() as {
      paths: Readonly<Record<string, { get?: Readonly<Record<string, unknown>> }>>;
    };
    for (const [path, operationId] of [
      ["/api/v1/runtime-processes", "listRuntimeProcesses"],
      ["/api/v1/runtime-processes/{instanceId}", "getRuntimeProcess"],
      ["/api/v1/runtime-processes/{instanceId}/logs", "getRuntimeProcessLogReference"],
    ] as const) {
      expect(document.paths[path]?.get).toMatchObject({
        operationId,
        security: [{ managementToken: [] }],
        "x-sdar-required-role": "reader_or_administrator",
      });
    }
  });
});

function service(processes: readonly RuntimeProcessProjection[]): RuntimeProcessQueryService {
  const repository: RuntimeProcessQueryRepository = {
    get(_providerId, instanceId) {
      return Promise.resolve(
        processes.find((process) => process.instanceId === instanceId) ?? null,
      );
    },
    listByDeployment() {
      return Promise.resolve(processes);
    },
  };
  return new RuntimeProcessQueryService(repository, {
    now: () => now,
    heartbeatStaleAfterMs: 30_000,
  });
}

function projection(overrides: Partial<RuntimeProcessProjection> = {}): RuntimeProcessProjection {
  return createRuntimeProcessProjection(
    {
      instanceId: runtimeInstanceId("instance-1"),
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
      ...overrides,
    },
  );
}
