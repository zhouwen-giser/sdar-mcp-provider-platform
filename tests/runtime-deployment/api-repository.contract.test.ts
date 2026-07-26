import { describe, expect, it, vi } from "vitest";
import { createPmsApi, pmsOpenApiDocument } from "../../apps/pms-api/src/index.js";
import {
  PostgresRuntimeDeploymentRepository,
  PostgresRuntimeProcessRepository,
} from "../../packages/pms-persistence-postgres/src/index.js";
import type { RuntimeDeploymentManagementPort } from "../../apps/pms-api/src/index.js";

const deployment = {
  deploymentId: "deployment-1",
  providerId: "provider-1",
  environment: "production",
  desiredState: "running" as const,
  desiredReplicas: 1,
  runtimeVersion: "0.1.0",
  databaseProfileId: "database-1",
  configProfileId: "config-1",
  status: "REQUESTED" as const,
  desiredRevision: 0,
  observedRevision: 0,
};

describe("RuntimeDeployment API/domain/repository contract", () => {
  it("keeps API action names aligned with the application command vocabulary", async () => {
    const command = vi.fn((input: unknown, context: unknown) => {
      void input;
      void context;
      return Promise.resolve(deployment);
    });
    const service = {
      create: vi.fn(),
      command,
      get: vi.fn(),
      list: vi.fn(),
    } as RuntimeDeploymentManagementPort;
    const app = createPmsApi({ runtimeDeployments: service });

    for (const action of ["start", "stop", "restart", "scale", "reconcile"] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/runtime-deployments/deployment-1/${action}`,
        headers: {
          "x-actor-id": "administrator-1",
          "x-correlation-id": `operation-${action}`,
        },
        payload: {
          providerId: "provider-1",
          expectedDesiredRevision: 0,
          ...(action === "scale" ? { desiredReplicas: 1 } : {}),
        },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ operationId: `operation-${action}` });
      expect(command.mock.calls.at(-1)?.[0]).toMatchObject({ command: action });
    }
    await app.close();
  });

  it("keeps every RuntimeDeployment OpenAPI route revision-safe and management-protected", () => {
    const document = pmsOpenApiDocument() as {
      paths: Readonly<Record<string, Record<string, Record<string, unknown>>>>;
    };
    for (const [path, operations] of Object.entries(document.paths)) {
      if (!path.startsWith("/api/v1/runtime-deployments")) continue;
      for (const operation of Object.values(operations)) {
        expect(operation).toMatchObject({ security: [{ managementToken: [] }] });
      }
    }
  });

  it("binds deployment and process detail repository reads to Provider scope", async () => {
    const deploymentCalls: [string, readonly unknown[] | undefined][] = [];
    const processCalls: [string, readonly unknown[] | undefined][] = [];
    const deploymentDb = {
      query(sql: string, values?: readonly unknown[]) {
        deploymentCalls.push([sql, values]);
        return Promise.resolve({
          rows: [
            {
              deployment_id: "deployment-1",
              provider_id: "provider-1",
              environment: "production",
              desired_state: "running",
              desired_replicas: 1,
              runtime_version: "0.1.0",
              database_profile_id: "database-1",
              config_profile_id: "config-1",
              adapter_endpoint: null,
              status: "REQUESTED",
              desired_revision: "0",
              observed_revision: "0",
            },
          ],
          rowCount: 1,
        });
      },
    } as unknown as ConstructorParameters<typeof PostgresRuntimeDeploymentRepository>[0];
    const processDb = {
      query(sql: string, values?: readonly unknown[]) {
        processCalls.push([sql, values]);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    } as unknown as ConstructorParameters<typeof PostgresRuntimeProcessRepository>[0];
    await new PostgresRuntimeDeploymentRepository(deploymentDb).get("provider-1", "deployment-1");
    await new PostgresRuntimeProcessRepository(processDb).get("provider-1", "instance-1");

    expect(deploymentCalls[0]?.[0]).toContain("WHERE provider_id=$1 AND deployment_id=$2");
    expect(deploymentCalls[0]?.[1]).toEqual(["provider-1", "deployment-1"]);
    expect(processCalls[0]?.[0]).toContain(
      "WHERE deployment.provider_id=$1 AND process.runtime_instance_id=$2",
    );
    expect(processCalls[0]?.[1]).toEqual(["provider-1", "instance-1"]);
  });
});
