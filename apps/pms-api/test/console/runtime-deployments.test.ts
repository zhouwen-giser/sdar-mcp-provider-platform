import { describe, expect, it, vi } from "vitest";
import {
  RuntimeDeploymentApplicationError,
  type RuntimeProcessQueryService,
} from "../../../../packages/pms-application/src/index.js";
import type { RuntimeDeploymentManagementPort } from "../../src/index.js";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console RuntimeDeployment operations", () => {
  it("returns 202 intents and preserves desiredState=stopped", async () => {
    const { app, spies } = createConsoleTestApp();
    const stopped = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-1/stop",
      headers: WRITE_HEADERS,
      payload: { providerId: "provider-1", expectedDesiredRevision: 1 },
    });
    expect(stopped.statusCode).toBe(202);
    expect(stopped.json()).toMatchObject({
      operationId: "corr-1",
      deployment: { desiredState: "stopped", desiredReplicas: 0 },
    });
    expect(spies.commandDeployment).toHaveBeenCalledWith(
      {
        providerId: "provider-1",
        deploymentId: "deployment-1",
        command: "stop",
        expectedDesiredRevision: 1,
      },
      { actorId: "prototype-user", correlationId: "corr-1" },
    );
    await app.close();
  });

  it("keeps direct-container deployments and expected processes visible through frozen V1 DTOs", async () => {
    const direct = {
      deploymentId: "deployment-direct",
      providerId: "provider-1",
      environment: "production",
      desiredState: "running" as const,
      desiredReplicas: 1,
      runtimeVersion: "1.0.0",
      runtimeAuthority: "direct_container" as const,
      adapterEndpoint: "ugv-adapter:50051",
      directContainer: {
        instanceId: "runtime-direct-0",
        controlEndpoint: "http://ugv-runtime:8080",
        advertisedEndpoint: "http://192.168.1.7:19100",
      },
      status: "REQUESTED" as const,
      desiredRevision: 0,
      observedRevision: 0,
    };
    const process = {
      instanceId: "runtime-direct-0",
      deploymentId: "deployment-direct",
      processManager: "direct_container" as const,
      pm2Name: null,
      port: null,
      controlEndpoint: "http://ugv-runtime:8080",
      advertisedEndpoint: "http://192.168.1.7:19100",
      pid: null,
      processState: "missing" as const,
      livenessState: "unknown" as const,
      readinessState: "unknown" as const,
      registrationState: "unregistered" as const,
      catalogState: "unknown" as const,
      configState: "externally_managed" as const,
      lastHeartbeatAt: null,
      runtimeVersion: null,
      configRevision: 0,
      restartCount: 0,
      observedRevision: 0,
      observedHealth: "STOPPED" as const,
      readyForActive: false,
      healthReasonCode: "PROCESS_ABSENT" as const,
      stale: false,
      registrationFreshness: "unregistered" as const,
      logReference: {
        referenceId: "runtime-process:runtime-direct-0",
        tailEndpoint: "/api/v1/runtime-processes/runtime-direct-0/logs/tail",
        contentIncluded: false as const,
      },
    };
    const { app } = createConsoleTestApp({
      runtimeDeployments: {
        list: vi.fn(async () => ({ items: [direct] })),
        get: vi.fn(async () => direct),
      } as unknown as RuntimeDeploymentManagementPort,
      runtimeProcesses: {
        list: vi.fn(async () => ({ items: [process] })),
        get: vi.fn(async () => process),
      } as unknown as RuntimeProcessQueryService,
    });

    const deployments = await app.inject({
      method: "GET",
      url: "/api/console/v1/runtime-deployments?providerId=provider-1",
    });
    const processes = await app.inject({
      method: "GET",
      url: "/api/console/v1/runtime-processes?providerId=provider-1&deploymentId=deployment-direct",
    });

    expect(deployments.statusCode).toBe(200);
    expect(deployments.json()).toMatchObject({
      items: [
        {
          deploymentId: "deployment-direct",
          databaseProfileId: "not_applicable",
          configProfileId: "not_applicable",
          status: "REQUESTED",
        },
      ],
    });
    expect(processes.statusCode).toBe(200);
    expect(processes.json()).toMatchObject({
      items: [{ instanceId: "runtime-direct-0", processState: "missing" }],
    });
    await app.close();
  });

  it("maps unsupported direct-container lifecycle commands to the frozen V1 problem enum", async () => {
    const command = vi.fn(async () => {
      throw new RuntimeDeploymentApplicationError(
        "RUNTIME_DEPLOYMENT_COMMAND_UNSUPPORTED",
        "Direct-container Runtime lifecycle is controlled outside PMS",
      );
    });
    const { app } = createConsoleTestApp({
      runtimeDeployments: { command } as unknown as RuntimeDeploymentManagementPort,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-direct/stop",
      headers: WRITE_HEADERS,
      payload: { providerId: "provider-1", expectedDesiredRevision: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      status: 400,
      code: "INVALID_STATE_TRANSITION",
    });
    await app.close();
  });
});
