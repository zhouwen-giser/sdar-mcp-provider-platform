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
    },
  });
}
