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
});
