import { describe, expect, it } from "vitest";
import { pmsOpenApiDocument } from "../src/index.js";

describe("PMS API OpenAPI authentication contract", () => {
  it("documents the schemes and exact Runtime scopes implemented by routes", () => {
    const document = pmsOpenApiDocument() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { securitySchemes: Record<string, Record<string, unknown>> };
    };

    expect(document.paths["/api/v1/runtime-deployments"]?.get).toMatchObject({
      security: [{ managementToken: [] }],
    });
    expect(
      document.paths[
        "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/latest"
      ]?.get,
    ).toMatchObject({
      security: [{ runtimeConfigToken: [] }],
      "x-sdar-required-scope": "runtime:config:read",
    });
    expect(
      document.paths[
        "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/watch"
      ]?.get,
    ).toMatchObject({
      security: [{ runtimeConfigToken: [] }],
      "x-sdar-required-scope": "runtime:config:watch",
    });
    expect(
      document.paths[
        "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/revisions/{revisionId}/acks"
      ]?.post,
    ).toMatchObject({
      security: [{ runtimeConfigToken: [] }],
      "x-sdar-required-scope": "runtime:config:ack",
    });
    expect(
      document.paths[
        "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}/register"
      ]?.post,
    ).toMatchObject({
      security: [{ runtimeRegistrationToken: [] }],
      "x-sdar-required-scope": "runtime:register",
    });
    expect(
      document.paths[
        "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}/heartbeat"
      ]?.post,
    ).toMatchObject({
      security: [{ runtimeRegistrationToken: [] }],
      "x-sdar-required-scope": "runtime:heartbeat",
    });
    expect(document.components.securitySchemes.runtimeConfigToken).toMatchObject({
      "x-sdar-scopes": ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
    });
  });

  it("keeps the default file-backed management contract byte-for-byte stable", () => {
    expect(pmsOpenApiDocument({ managementAuthMode: "file_credentials" })).toEqual(
      pmsOpenApiDocument(),
    );
  });

  it("documents anonymous intranet management without weakening Runtime credentials", () => {
    const document = pmsOpenApiDocument({ managementAuthMode: "anonymous_intranet" }) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const managementPrefixes = [
      "/api/v1/provider-packages",
      "/api/v1/provider-types",
      "/api/v1/providers",
      "/api/v1/resources",
      "/api/v1/config-drafts",
      "/api/v1/runtime-deployments",
      "/api/v1/runtime-processes",
      "/api/v1/registry",
      "/api/v1/audit-events",
    ];
    const managementOperations = Object.entries(document.paths).flatMap(([path, operations]) =>
      managementPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
        ? Object.values(operations)
        : [],
    );
    expect(managementOperations.length).toBeGreaterThan(20);
    for (const operation of managementOperations) {
      expect(operation.security).toEqual([]);
      expect(operation).not.toHaveProperty("x-sdar-required-role");
      expect(operation["x-sdar-access-mode"]).toBe("anonymous_intranet");
    }

    expect(
      document.paths[
        "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/latest"
      ]?.get,
    ).toMatchObject({
      security: [{ runtimeConfigToken: [] }],
      "x-sdar-required-scope": "runtime:config:read",
    });
    expect(
      document.paths[
        "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}/register"
      ]?.post,
    ).toMatchObject({
      security: [{ runtimeRegistrationToken: [] }],
      "x-sdar-required-scope": "runtime:register",
    });
  });
});
