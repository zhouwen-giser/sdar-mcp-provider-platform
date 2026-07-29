import { describe, expect, it, vi } from "vitest";
import { RuntimeDeploymentApplicationError } from "../../../packages/pms-application/src/index.js";
import {
  createPmsApi,
  pmsOpenApiDocument,
  type RuntimeDeploymentManagementPort,
  type RuntimeDeploymentView,
} from "../src/index.js";

const deployment: RuntimeDeploymentView = {
  deploymentId: "runtime-1",
  providerId: "provider-1",
  environment: "production",
  desiredState: "running",
  desiredReplicas: 1,
  runtimeVersion: "0.1.0",
  databaseProfileId: "database-1",
  configProfileId: "config-1",
  status: "REQUESTED",
  desiredRevision: 0,
  observedRevision: 0,
};

describe("RuntimeDeployment management API", () => {
  it("accepts a create intent and returns its traceable operation ID", async () => {
    const create = vi.fn(() => Promise.resolve(deployment));
    const app = createPmsApi({ runtimeDeployments: service({ create }) });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-deployments",
      headers: {
        "x-actor-id": "admin-1",
        "x-correlation-id": "operation-create-1",
      },
      payload: {
        deploymentId: "runtime-1",
        providerId: "provider-1",
        environment: "production",
        runtimeVersion: "0.1.0",
        databaseProfileId: "database-1",
        configProfileId: "config-1",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      operationId: "operation-create-1",
      deployment,
    });
    expect(create).toHaveBeenCalledWith(
      {
        deploymentId: "runtime-1",
        providerId: "provider-1",
        environment: "production",
        runtimeVersion: "0.1.0",
        databaseProfileId: "database-1",
        configProfileId: "config-1",
      },
      { actorId: "admin-1", correlationId: "operation-create-1" },
    );
    await app.close();
  });

  it("requires Provider scope for detail and list queries", async () => {
    const get = vi.fn(() => Promise.resolve(deployment));
    const list = vi.fn(() => Promise.resolve({ items: [deployment] }));
    const app = createPmsApi({ runtimeDeployments: service({ get, list }) });

    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-deployments/runtime-1?providerId=provider-1",
    });
    const collection = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-deployments?providerId=provider-1&environment=production&status=ACTIVE",
    });
    const unscoped = await app.inject({
      method: "GET",
      url: "/api/v1/runtime-deployments/runtime-1",
    });

    expect(detail.statusCode).toBe(200);
    expect(collection.statusCode).toBe(200);
    expect(unscoped.statusCode).toBe(400);
    expect(get).toHaveBeenCalledWith("provider-1", "runtime-1");
    expect(list).toHaveBeenCalledWith({
      providerId: "provider-1",
      environment: "production",
      status: "ACTIVE",
      limit: 100,
    });
    await app.close();
  });

  it.each(["start", "stop", "restart", "reconcile"] as const)(
    "routes the %s desired-state action with revision and audit context",
    async (action) => {
      const command = vi.fn(() => Promise.resolve(deployment));
      const app = createPmsApi({ runtimeDeployments: service({ command }) });
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/runtime-deployments/runtime-1/${action}`,
        headers: {
          "x-actor-id": "admin-1",
          "x-correlation-id": `operation-${action}`,
        },
        payload: { providerId: "provider-1", expectedDesiredRevision: 2 },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ operationId: `operation-${action}` });
      expect(command).toHaveBeenCalledWith(
        {
          providerId: "provider-1",
          deploymentId: "runtime-1",
          command: action,
          expectedDesiredRevision: 2,
        },
        { actorId: "admin-1", correlationId: `operation-${action}` },
      );
      await app.close();
    },
  );

  it("requires an explicit V0.1-safe replica count for scale", async () => {
    const command = vi.fn(() => Promise.resolve(deployment));
    const app = createPmsApi({ runtimeDeployments: service({ command }) });
    const headers = { "x-actor-id": "admin-1", "x-correlation-id": "operation-scale" };

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-deployments/runtime-1/scale",
      headers,
      payload: {
        providerId: "provider-1",
        expectedDesiredRevision: 2,
        desiredReplicas: 1,
      },
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-deployments/runtime-1/scale",
      headers,
      payload: {
        providerId: "provider-1",
        expectedDesiredRevision: 2,
        desiredReplicas: 2,
      },
    });

    expect(accepted.statusCode).toBe(202);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(
      {
        providerId: "provider-1",
        deploymentId: "runtime-1",
        command: "scale",
        expectedDesiredRevision: 2,
        desiredReplicas: 1,
      },
      { actorId: "admin-1", correlationId: "operation-scale" },
    );
    await app.close();
  });

  it("exposes stable RuntimeDeployment application errors", async () => {
    const command = vi.fn(() =>
      Promise.reject(
        new RuntimeDeploymentApplicationError(
          "RUNTIME_DEPLOYMENT_REVISION_CONFLICT",
          "internal detail",
        ),
      ),
    );
    const app = createPmsApi({ runtimeDeployments: service({ command }) });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-deployments/runtime-1/start",
      headers: { "x-actor-id": "admin-1" },
      payload: { providerId: "provider-1", expectedDesiredRevision: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT",
        message: "The RuntimeDeployment desired revision changed; reload and retry",
      },
    });
    await app.close();
  });

  it("documents every desired-state endpoint and management authorization", () => {
    const document = pmsOpenApiDocument() as {
      paths: Readonly<
        Record<
          string,
          {
            get?: Readonly<Record<string, unknown>>;
            post?: Readonly<Record<string, unknown>>;
          }
        >
      >;
    };

    expect(document.paths["/api/v1/runtime-deployments"]?.post).toMatchObject({
      operationId: "createRuntimeDeployment",
      security: [{ managementToken: [] }],
      "x-sdar-required-role": "administrator",
    });
    expect(document.paths["/api/v1/runtime-deployments"]?.get).toMatchObject({
      operationId: "listRuntimeDeployments",
      "x-sdar-required-role": "reader_or_administrator",
    });
    for (const action of ["start", "stop", "restart", "scale", "reconcile"]) {
      expect(
        document.paths[`/api/v1/runtime-deployments/{deploymentId}/${action}`]?.post,
      ).toMatchObject({
        operationId: `${action}RuntimeDeployment`,
        security: [{ managementToken: [] }],
      });
    }
  });
});

function service(
  overrides: Partial<RuntimeDeploymentManagementPort>,
): RuntimeDeploymentManagementPort {
  return {
    create: vi.fn(),
    command: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    ...overrides,
  };
}
