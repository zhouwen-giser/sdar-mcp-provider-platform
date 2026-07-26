export function pmsOpenApiDocument(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    openapi: "3.1.0",
    info: {
      title: "SDAR MCP Provider Management Service API",
      version: "1.0.0",
    },
    paths: {
      "/health/live": {
        get: {
          operationId: "getLiveness",
          responses: { "200": { description: "Process is live" } },
        },
      },
      "/health/ready": {
        get: {
          operationId: "getReadiness",
          responses: {
            "200": { description: "Control-plane dependencies are ready" },
            "503": { description: "A required dependency is unavailable" },
          },
        },
      },
      "/api/v1": {
        get: {
          operationId: "getApiRoot",
          responses: { "200": { description: "Versioned API discovery document" } },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          operationId: "getOpenApiDocument",
          responses: { "200": { description: "OpenAPI 3.1 document" } },
        },
      },
      "/api/v1/provider-packages": {
        get: {
          operationId: "listProviderPackages",
          parameters: [
            { name: "providerType", in: "query", schema: { type: "string" } },
            {
              name: "hostingMode",
              in: "query",
              schema: { enum: ["vendor_managed", "platform_managed"] },
            },
            {
              name: "componentStatus",
              in: "query",
              schema: { enum: ["passed", "partial", "pending", "failed"] },
            },
            {
              name: "realResourceStatus",
              in: "query",
              schema: { enum: ["qualified", "pending", "failed", "not_applicable"] },
            },
          ],
          responses: { "200": { description: "Stable Provider Package projections" } },
        },
      },
      "/api/v1/provider-packages/{packageId}": {
        get: {
          operationId: "getProviderPackage",
          parameters: [
            { name: "packageId", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Provider Package projection" },
            "404": { description: "Provider Package not found" },
          },
        },
      },
      "/api/v1/provider-types": {
        get: {
          operationId: "listProviderTypes",
          responses: { "200": { description: "Provider Types" } },
        },
        post: {
          operationId: "createProviderType",
          responses: { "201": { description: "Provider Type created" } },
        },
      },
      "/api/v1/provider-types/{providerTypeId}": {
        get: {
          operationId: "getProviderType",
          responses: { "200": { description: "Provider Type" } },
        },
      },
      "/api/v1/provider-types/{providerTypeId}/status": {
        patch: {
          operationId: "updateProviderTypeStatus",
          responses: { "200": { description: "Provider Type status updated" } },
        },
      },
      "/api/v1/providers": {
        get: {
          operationId: "listProviders",
          responses: { "200": { description: "Providers" } },
        },
        post: {
          operationId: "createProvider",
          responses: { "201": { description: "Provider created" } },
        },
      },
      "/api/v1/providers/{providerId}": {
        get: {
          operationId: "getProvider",
          responses: { "200": { description: "Provider" } },
        },
      },
      "/api/v1/providers/{providerId}/status": {
        patch: {
          operationId: "updateProviderStatus",
          responses: { "200": { description: "Provider status updated" } },
        },
      },
      "/api/v1/resources": {
        get: {
          operationId: "listResources",
          responses: { "200": { description: "Environment-scoped Resources" } },
        },
        post: {
          operationId: "createResource",
          responses: { "201": { description: "Resource created" } },
        },
      },
      "/api/v1/resources/{environment}/{resourceId}": {
        get: {
          operationId: "getResource",
          responses: { "200": { description: "Resource" } },
        },
      },
      "/api/v1/resources/{environment}/{resourceId}/status": {
        patch: {
          operationId: "updateResourceStatus",
          responses: { "200": { description: "Resource status updated" } },
        },
      },
      "/api/v1/providers/{providerId}/resource-bindings": {
        get: {
          operationId: "listProviderResourceBindings",
          responses: { "200": { description: "Provider Resource bindings" } },
        },
        post: {
          operationId: "bindProviderResource",
          responses: { "201": { description: "Provider Resource binding created" } },
        },
      },
      "/api/v1/providers/{providerId}/resource-bindings/{environment}/{resourceId}": {
        delete: {
          operationId: "unbindProviderResource",
          responses: { "204": { description: "Provider Resource binding removed" } },
        },
      },
      "/api/v1/config-drafts": {
        post: {
          operationId: "createConfigurationDraft",
          responses: { "201": { description: "Configuration Draft created" } },
        },
      },
      "/api/v1/config-drafts/{draftId}": {
        get: {
          operationId: "getConfigurationDraft",
          responses: { "200": { description: "Configuration Draft" } },
        },
        patch: {
          operationId: "updateConfigurationDraft",
          responses: { "200": { description: "Configuration Draft updated" } },
        },
      },
      "/api/v1/config-drafts/{draftId}/validate": {
        post: {
          operationId: "validateConfigurationDraft",
          responses: { "200": { description: "Configuration Draft validation result" } },
        },
      },
      "/api/v1/config-drafts/{draftId}/effective": {
        get: {
          operationId: "previewEffectiveConfiguration",
          responses: { "200": { description: "Redacted effective configuration preview" } },
        },
      },
      "/api/v1/config-drafts/{draftId}/publish": {
        post: {
          operationId: "publishConfigurationDraft",
          responses: {
            "200": { description: "Published revision or canonical checksum no-op" },
            "409": { description: "Optimistic publication conflict" },
          },
        },
      },
      "/api/v1/config-drafts/{draftId}/rollback": {
        post: {
          operationId: "rollbackConfiguration",
          responses: {
            "200": { description: "New revision created from explicit historical revision" },
            "409": { description: "Optimistic publication conflict" },
          },
        },
      },
      "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/latest": {
        get: {
          operationId: "getLatestRuntimeConfiguration",
          security: [{ runtimeConfigToken: [] }],
          parameters: [
            { name: "deploymentId", in: "path", required: true, schema: { type: "string" } },
            { name: "instanceId", in: "path", required: true, schema: { type: "string" } },
            { name: "environment", in: "query", required: true, schema: { type: "string" } },
            { name: "configGroup", in: "query", required: true, schema: { type: "string" } },
            { name: "dataId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Latest authorized Published Effective Config" },
            "304": { description: "The Runtime already has this checksum" },
            "401": { description: "Runtime Config client authentication failed" },
            "403": { description: "Runtime Config client target mismatch" },
            "404": { description: "No Published Effective Config" },
          },
        },
      },
    },
    components: {
      schemas: {
        ErrorEnvelope: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "requestId", "correlationId"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
                correlationId: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      securitySchemes: {
        runtimeConfigToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-runtime-config-token",
        },
      },
    },
  });
}
