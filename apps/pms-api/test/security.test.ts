import { describe, expect, it, vi } from "vitest";
import type { ProviderManagementService } from "../../../packages/pms-application/src/index.js";
import {
  PmsApiAuthorizationError,
  createPmsApi,
  pmsOpenApiDocument,
  type PmsApiRoleAuthorizer,
} from "../src/index.js";

describe("PMS API security gate", () => {
  it("separates reader and administrator roles and binds writes to the audit actor", async () => {
    const listProviderTypes = vi.fn(() => Promise.resolve({ items: [] }));
    const createProviderType = vi.fn(() =>
      Promise.resolve({
        providerTypeId: "isr.vehicle.ugv",
        displayName: "UGV",
        status: "active",
      }),
    );
    const app = createPmsApi({
      management: management({ listProviderTypes, createProviderType }),
      managementAuthorizer: roleAuthorizer(),
    });

    const missing = await app.inject({ method: "GET", url: "/api/v1/provider-types" });
    expect(missing.statusCode).toBe(401);
    const readable = await app.inject({
      method: "GET",
      url: "/api/v1/provider-types",
      headers: { authorization: "Bearer reader-token" },
    });
    expect(readable.statusCode).toBe(200);
    const readerWrite = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      headers: {
        authorization: "Bearer reader-token",
        "x-actor-id": "reader-1",
      },
      payload: { providerTypeId: "isr.vehicle.ugv", displayName: "UGV" },
    });
    expect(readerWrite.statusCode).toBe(403);
    const spoofedActor = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      headers: {
        authorization: "Bearer administrator-token",
        "x-actor-id": "someone-else",
      },
      payload: { providerTypeId: "isr.vehicle.ugv", displayName: "UGV" },
    });
    expect(spoofedActor.statusCode).toBe(403);
    const administratorWrite = await app.inject({
      method: "POST",
      url: "/api/v1/provider-types",
      headers: {
        authorization: "Bearer administrator-token",
        "x-actor-id": "administrator-1",
      },
      payload: { providerTypeId: "isr.vehicle.ugv", displayName: "UGV" },
    });
    expect(administratorWrite.statusCode).toBe(201);
    expect(createProviderType).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not accept a Runtime token as a management credential", async () => {
    const app = createPmsApi({
      management: management({ listProviderTypes: vi.fn(() => Promise.resolve({ items: [] })) }),
      managementAuthorizer: roleAuthorizer(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/provider-types",
      headers: { authorization: "Bearer runtime-client-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("runtime-client-token");
    await app.close();
  });

  it("rejects oversized and malformed JSON with safe stable envelopes", async () => {
    const app = createPmsApi({
      management: management({ createProvider: vi.fn() }),
    });
    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/providers",
      headers: { "content-type": "application/json", "x-actor-id": "administrator-1" },
      payload: JSON.stringify({
        providerId: "provider-1",
        providerTypeId: "isr.vehicle.ugv",
        padding: "x".repeat(1_048_576),
      }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ error: { code: "REQUEST_BODY_TOO_LARGE" } });

    const malformed = await app.inject({
      method: "POST",
      url: "/api/v1/providers",
      headers: { "content-type": "application/json", "x-actor-id": "administrator-1" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
    await app.close();
  });

  it("rejects URL-shaped or invalid-port Adapter endpoints before application code", async () => {
    const createProvider = vi.fn();
    const app = createPmsApi({ management: management({ createProvider }) });
    for (const adapterEndpoint of [
      "http://169.254.169.254/latest/meta-data",
      "adapter.internal:99999",
      "user:password@adapter.internal:7001",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/providers",
        headers: { "x-actor-id": "administrator-1" },
        payload: {
          providerId: "provider-1",
          providerTypeId: "isr.vehicle.ugv",
          adapterEndpoint,
        },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(createProvider).not.toHaveBeenCalled();
    await app.close();
  });

  it("documents separate management/runtime schemes and per-operation roles", () => {
    const document = pmsOpenApiDocument() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(document.components.securitySchemes).toHaveProperty("managementToken");
    expect(document.components.securitySchemes).toHaveProperty("runtimeConfigToken");
    expect(document.paths["/api/v1/provider-types"]?.get).toMatchObject({
      security: [{ managementToken: [] }],
      "x-sdar-required-role": "reader_or_administrator",
    });
    expect(document.paths["/api/v1/provider-types"]?.post).toMatchObject({
      security: [{ managementToken: [] }],
      "x-sdar-required-role": "administrator",
    });
    expect(
      document.paths[
        "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/latest"
      ]?.get,
    ).toMatchObject({ security: [{ runtimeConfigToken: [] }] });
  });
});

function roleAuthorizer(): PmsApiRoleAuthorizer {
  return {
    authenticate({ authorization }) {
      if (authorization === "Bearer reader-token") {
        return Promise.resolve({ subjectId: "reader-1", roles: ["reader"] });
      }
      if (authorization === "Bearer administrator-token") {
        return Promise.resolve({
          subjectId: "administrator-1",
          roles: ["administrator"],
        });
      }
      return Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED"));
    },
  };
}

function management(overrides: Readonly<Record<string, unknown>>): ProviderManagementService {
  return overrides as unknown as ProviderManagementService;
}
