import { describe, expect, it } from "vitest";
import {
  ConfigurationCenterError,
  type RuntimeConfigClientAuthorizer,
} from "../../../packages/configuration-center/src/index.js";
import {
  RuntimeRegistrationAuthorizationError,
  type RuntimeRegistrationAuthorizer,
} from "../../../packages/runtime-registration/src/index.js";
import {
  PmsApiAuthorizationError,
  createPmsApi,
  type AuthenticationRejectionAuditEvent,
  type AuthenticationRejectionAuditPort,
  type PmsApiRoleAuthorizer,
} from "../src/index.js";

describe("authentication rejection audit", () => {
  it("records management, Config, and Registration rejects without credentials or request bodies", async () => {
    const events: AuthenticationRejectionAuditEvent[] = [];
    const audit: AuthenticationRejectionAuditPort = {
      append(event) {
        events.push(event);
        return Promise.resolve();
      },
    };
    const app = createPmsApi({
      managementAuthorizer: rejectingManagement(),
      runtimeConfigQuery: { latest: () => Promise.reject(new Error("must not read")) } as never,
      runtimeConfigAuthorizer: rejectingConfig(),
      runtimeRegistration: {} as never,
      runtimeRegistrationAuthorizer: rejectingRegistration(),
      authenticationRejectionAudit: audit,
    });

    await expect(app.inject({ method: "GET", url: "/health/live" })).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(
      app.inject({
        method: "GET",
        url: "/api/v1/provider-packages",
        headers: {
          authorization: "Bearer management-secret",
          "x-request-id": "management-request",
        },
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      app.inject({
        method: "GET",
        url: "/api/v1/runtime-config/deployments/deployment-1/instances/instance-1/latest?environment=production&configGroup=runtime.bootstrap&dataId=main",
        headers: { authorization: "Bearer config-secret", "x-request-id": "config-request" },
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      app.inject({
        method: "POST",
        url: "/api/v1/runtime-registration/deployments/deployment-1/instances/instance-1/register",
        headers: {
          authorization: "Bearer registration-secret",
          "x-request-id": "registration-request",
        },
        payload: {
          providerId: "provider-1",
          sessionId: "session-secret",
          runtimeVersion: "2.0.0",
          protocolVersion: "2026-07-28",
          configRevision: 0,
          readinessState: "ready",
        },
      }),
    ).resolves.toMatchObject({ statusCode: 401 });

    expect(events).toHaveLength(3);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "MANAGEMENT_AUTHENTICATION_REQUIRED" }),
        expect.objectContaining({ reasonCode: "RUNTIME_CONFIG_UNAUTHORIZED" }),
        expect.objectContaining({ reasonCode: "RUNTIME_REGISTRATION_UNAUTHORIZED" }),
      ]),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(
      /management-secret|config-secret|registration-secret|session-secret|Bearer/i,
    );
    await app.close();
  });
});

function rejectingManagement(): PmsApiRoleAuthorizer {
  return {
    authenticate: () =>
      Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED")),
  };
}

function rejectingConfig(): RuntimeConfigClientAuthorizer {
  return {
    authorize: () =>
      Promise.reject(
        new ConfigurationCenterError("RUNTIME_CONFIG_UNAUTHORIZED", "credentials invalid"),
      ),
  };
}

function rejectingRegistration(): RuntimeRegistrationAuthorizer {
  return {
    authorize: () =>
      Promise.reject(
        new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_UNAUTHORIZED"),
      ),
  };
}
