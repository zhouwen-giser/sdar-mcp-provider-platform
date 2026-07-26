import { describe, expect, it } from "vitest";
import {
  RuntimeRegistrationAuthorizationError,
  RuntimeRegistrationService,
  type RuntimeRegistrationAuditEvent,
  type RuntimeRegistrationAuthorizer,
  type RuntimeRegistrationSnapshot,
} from "../../../packages/runtime-registration/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

describe("Runtime registration and heartbeat API", () => {
  it("registers and heartbeats only the token-bound expected instance with audit correlation", async () => {
    const harness = fixture();
    const app = createPmsApi({
      runtimeRegistration: harness.service,
      runtimeRegistrationAuthorizer: authorizer(),
    });
    const registered = await app.inject({
      method: "POST",
      url: `${baseUrl()}/register`,
      headers: {
        authorization: "Bearer registration-token",
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
      },
      payload: body(),
    });
    const heartbeat = await app.inject({
      method: "POST",
      url: `${baseUrl()}/heartbeat`,
      headers: {
        authorization: "Bearer heartbeat-token",
        "x-request-id": "request-2",
        "x-correlation-id": "correlation-1",
      },
      payload: { ...body(), sequence: 1, readinessState: "ready" },
    });

    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({
      outcome: "created",
      registration: {
        providerId: "provider-a",
        heartbeatSequence: 0,
        readinessState: "not_ready",
      },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({
      outcome: "updated",
      registration: { heartbeatSequence: 1, readinessState: "ready" },
    });
    expect(heartbeat.headers["x-correlation-id"]).toBe("correlation-1");
    expect(harness.audits).toEqual([
      expect.objectContaining({
        action: "runtime.register",
        subjectId: "runtime-instance-1",
        correlationId: "correlation-1",
      }),
      expect.objectContaining({
        action: "runtime.heartbeat",
        subjectId: "runtime-instance-1",
        correlationId: "correlation-1",
      }),
    ]);
    expect(JSON.stringify(harness.audits)).not.toContain("registration-token");
    await app.close();
  });

  it("rejects missing credentials, wrong scope, target mismatch and arbitrary Provider", async () => {
    const harness = fixture();
    const app = createPmsApi({
      runtimeRegistration: harness.service,
      runtimeRegistrationAuthorizer: authorizer(),
    });
    const missing = await app.inject({
      method: "POST",
      url: `${baseUrl()}/register`,
      payload: body(),
    });
    const wrongScope = await app.inject({
      method: "POST",
      url: `${baseUrl()}/heartbeat`,
      headers: { authorization: "Bearer registration-token" },
      payload: { ...body(), sequence: 1 },
    });
    const arbitraryProvider = await app.inject({
      method: "POST",
      url: `${baseUrl()}/register`,
      headers: { authorization: "Bearer registration-token" },
      payload: { ...body(), providerId: "arbitrary-provider" },
    });
    const wrongInstance = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-registration/deployments/deployment-1/instances/other/register",
      headers: { authorization: "Bearer registration-token" },
      payload: body(),
    });

    expect(missing.statusCode).toBe(401);
    expect(wrongScope.statusCode).toBe(403);
    expect(arbitraryProvider.statusCode).toBe(403);
    expect(wrongInstance.statusCode).toBe(403);
    expect(harness.registration()).toBeNull();
    expect(missing.body).not.toContain("token");
    await app.close();
  });

  it("documents dedicated least-privilege Runtime scopes", () => {
    const document = pmsOpenApiDocument() as {
      paths: Record<string, { post: Record<string, unknown> }>;
      components: { securitySchemes: Record<string, Record<string, unknown>> };
    };

    const registrationPath =
      "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}";
    expect(document.paths[`${registrationPath}/register`]?.post.security).toEqual([
      { runtimeRegistrationToken: [] },
    ]);
    expect(document.paths[`${registrationPath}/register`]?.post["x-sdar-required-scope"]).toBe(
      "runtime:register",
    );
    expect(document.paths[`${registrationPath}/heartbeat`]?.post.security).toEqual([
      { runtimeRegistrationToken: [] },
    ]);
    expect(document.paths[`${registrationPath}/heartbeat`]?.post["x-sdar-required-scope"]).toBe(
      "runtime:heartbeat",
    );
    expect(document.components.securitySchemes.runtimeRegistrationToken).toMatchObject({
      type: "http",
      scheme: "bearer",
      "x-sdar-scopes": ["runtime:register", "runtime:heartbeat"],
    });
  });
});

function fixture() {
  let registration: RuntimeRegistrationSnapshot | null = null;
  const audits: RuntimeRegistrationAuditEvent[] = [];
  return {
    audits,
    registration: () => registration,
    service: new RuntimeRegistrationService(
      {
        getExpected: ({ providerId, deploymentId, instanceId }) =>
          Promise.resolve(
            providerId === "provider-a" &&
              deploymentId === "deployment-1" &&
              instanceId === "instance-1"
              ? expected()
              : null,
          ),
      },
      {
        get: () => Promise.resolve(registration),
        save(value) {
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
      { now: () => new Date("2026-07-26T00:00:00.000Z") },
    ),
  };
}

function authorizer(): RuntimeRegistrationAuthorizer {
  return {
    authorize(credentials, target) {
      if (credentials.authorization === undefined) {
        return Promise.reject(
          new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_UNAUTHORIZED"),
        );
      }
      const scopes =
        credentials.authorization === "Bearer registration-token"
          ? (["runtime:register"] as const)
          : credentials.authorization === "Bearer heartbeat-token"
            ? (["runtime:heartbeat"] as const)
            : [];
      return Promise.resolve({
        ...expected(),
        deploymentId: target.deploymentId,
        instanceId: target.instanceId === "instance-1" ? target.instanceId : "instance-1",
        subjectId: "runtime-instance-1",
        scopes,
      });
    },
  };
}

function expected() {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    runtimeVersion: "2.0.0-rc.1",
    protocolVersion: "2026-07-28",
  };
}

function body() {
  return {
    providerId: "provider-a",
    sessionId: "session-1",
    runtimeVersion: "2.0.0-rc.1",
    protocolVersion: "2026-07-28",
    configRevision: 0,
    readinessState: "not_ready",
  };
}

function baseUrl() {
  return "/api/v1/runtime-registration/deployments/deployment-1/instances/instance-1";
}
