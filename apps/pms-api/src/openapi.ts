import type { PmsManagementAuthMode } from "./config.js";

export interface PmsOpenApiDocumentOptions {
  readonly managementAuthMode?: PmsManagementAuthMode;
}

export function pmsOpenApiDocument(
  options: PmsOpenApiDocumentOptions = {},
): Readonly<Record<string, unknown>> {
  const managementAuthMode = options.managementAuthMode ?? "file_credentials";
  const document = {
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
      "/api/v1/runtime-deployments": {
        get: {
          operationId: "listRuntimeDeployments",
          parameters: [
            { name: "providerId", in: "query", required: true, schema: { type: "string" } },
            { name: "environment", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Provider-scoped RuntimeDeployments" } },
        },
        post: {
          operationId: "createRuntimeDeployment",
          responses: {
            "202": {
              description: "RuntimeDeployment desired state accepted with an operation ID",
            },
            "409": { description: "A prerequisite is unavailable or state conflicts" },
          },
        },
      },
      "/api/v1/runtime-deployments/{deploymentId}": {
        get: {
          operationId: "getRuntimeDeployment",
          parameters: [
            { name: "deploymentId", in: "path", required: true, schema: { type: "string" } },
            { name: "providerId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "RuntimeDeployment desired and observed state" },
            "404": { description: "RuntimeDeployment not found in Provider scope" },
          },
        },
      },
      ...runtimeDeploymentActionPaths(),
      "/api/v1/runtime-processes": {
        get: {
          operationId: "listRuntimeProcesses",
          parameters: [
            { name: "providerId", in: "query", required: true, schema: { type: "string" } },
            { name: "deploymentId", in: "query", required: true, schema: { type: "string" } },
            { name: "processState", in: "query", schema: { type: "string" } },
            { name: "observedHealth", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Runtime process projections with evaluated stale state" },
          },
        },
      },
      "/api/v1/runtime-processes/{instanceId}": {
        get: {
          operationId: "getRuntimeProcess",
          parameters: [
            { name: "instanceId", in: "path", required: true, schema: { type: "string" } },
            { name: "providerId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Runtime process projection without environment or secrets" },
            "404": { description: "Runtime process not found in Provider scope" },
          },
        },
      },
      "/api/v1/runtime-processes/{instanceId}/logs": {
        get: {
          operationId: "getRuntimeProcessLogReference",
          parameters: [
            { name: "instanceId", in: "path", required: true, schema: { type: "string" } },
            { name: "providerId", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Opaque controlled log reference; file content is never returned",
            },
            "404": { description: "Runtime process not found in Provider scope" },
          },
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
          "x-sdar-required-scope": "runtime:config:read",
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
      "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/watch": {
        get: {
          operationId: "watchRuntimeConfiguration",
          security: [{ runtimeConfigToken: [] }],
          "x-sdar-required-scope": "runtime:config:watch",
          responses: {
            "200": { description: "SSE stream containing revision/checksum hints only" },
            "401": { description: "Runtime Config client authentication failed" },
          },
        },
      },
      "/api/v1/runtime-config/deployments/{deploymentId}/instances/{instanceId}/revisions/{revisionId}/acks":
        {
          post: {
            operationId: "acknowledgeRuntimeConfiguration",
            security: [{ runtimeConfigToken: [] }],
            "x-sdar-required-scope": "runtime:config:ack",
            responses: {
              "200": { description: "Idempotent structured Runtime acknowledgement" },
              "400": { description: "Invalid acknowledgement status or checksum" },
              "403": { description: "Runtime instance identity mismatch" },
              "404": { description: "Published revision does not exist" },
              "409": { description: "Conflicting duplicate acknowledgement" },
            },
          },
        },
      "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}/register": {
        post: {
          operationId: "registerRuntimeInstance",
          security: [{ runtimeRegistrationToken: [] }],
          "x-sdar-required-scope": "runtime:register",
          responses: {
            "200": { description: "Idempotent expected-instance registration" },
            "401": { description: "Runtime registration authentication failed" },
            "403": { description: "Token target or scope mismatch" },
            "404": { description: "Expected Runtime instance does not exist" },
            "409": { description: "Registration identity or replay conflict" },
          },
        },
      },
      "/api/v1/runtime-registration/deployments/{deploymentId}/instances/{instanceId}/heartbeat": {
        post: {
          operationId: "heartbeatRuntimeInstance",
          security: [{ runtimeRegistrationToken: [] }],
          "x-sdar-required-scope": "runtime:heartbeat",
          responses: {
            "200": { description: "Ordered idempotent Runtime heartbeat" },
            "401": { description: "Runtime heartbeat authentication failed" },
            "403": { description: "Token target or scope mismatch" },
            "404": { description: "Expected Runtime instance does not exist" },
            "409": { description: "Heartbeat session or sequence conflict" },
          },
        },
      },
      "/api/v1/registry/{environment}/latest": {
        get: {
          operationId: "getLatestRegistrySnapshot",
          responses: {
            "200": { description: "Latest immutable SDAR Registry Snapshot" },
            "304": { description: "The consumer already has this checksum" },
            "404": { description: "No Registry Snapshot has been published" },
          },
        },
      },
      "/api/v1/registry/{environment}/history": {
        get: {
          operationId: "getRegistrySnapshotHistory",
          responses: { "200": { description: "Immutable Registry Snapshot history" } },
        },
      },
      "/api/v1/registry/{environment}/diff": {
        get: {
          operationId: "diffRegistrySnapshots",
          responses: { "200": { description: "Provider projection changes between revisions" } },
        },
      },
      "/api/v1/registry/{environment}/watch": {
        get: {
          operationId: "watchRegistrySnapshots",
          responses: { "200": { description: "SSE revision and checksum hints only" } },
        },
      },
      "/api/v1/registry/{environment}/bootstrap": {
        get: {
          operationId: "bootstrapRegistrySnapshot",
          responses: {
            "200": { description: "Latest LKG or explicit empty safe bootstrap projection" },
          },
        },
      },
      "/api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/latest": {
        get: {
          operationId: "getLatestSdarRegistryProjection",
          parameters: sdarRegistryProjectionPathParameters(),
          responses: sdarRegistryProjectionResponses(),
        },
      },
      "/api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/bootstrap": {
        get: {
          operationId: "bootstrapSdarRegistryProjection",
          parameters: sdarRegistryProjectionPathParameters(),
          responses: sdarRegistryProjectionResponses(),
        },
      },
      "/api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/watch": {
        get: {
          operationId: "watchSdarRegistryProjection",
          parameters: sdarRegistryProjectionPathParameters(),
          responses: {
            "200": {
              description: "SSE revision hints; consumers refetch latest after each hint",
              headers: sdarRegistryProjectionLineageHeaders(),
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
          },
        },
      },
      "/api/v1/audit-events": {
        get: {
          operationId: "listAuditEvents",
          parameters: [
            { name: "subjectType", in: "query", schema: { type: "string" } },
            { name: "subjectId", in: "query", schema: { type: "string" } },
            { name: "correlationId", in: "query", schema: { type: "string" } },
            {
              name: "occurredBefore",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
          ],
          responses: { "200": { description: "Redacted traceable Audit event projections" } },
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
        SdarRegistryProjectionProvider: {
          type: "object",
          required: [
            "externalProviderId",
            "externalServerId",
            "serverEndpoint",
            "catalogRevision",
            "labels",
          ],
          properties: {
            externalProviderId: { type: "string", minLength: 1, maxLength: 256 },
            externalServerId: { type: "string", minLength: 1, maxLength: 256 },
            serverEndpoint: { type: "string", format: "uri", pattern: "^https?://" },
            catalogRevision: { type: "string", pattern: "^[1-9][0-9]*$" },
            labels: {
              type: "object",
              required: ["environment", "protocolMode"],
              properties: {
                environment: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
                protocolMode: { const: "frozen_v1" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        SdarRegistryProjection: {
          type: "object",
          required: ["revision", "checksum", "generatedAt", "expiresAt", "providers"],
          properties: {
            revision: { type: "integer", minimum: 1 },
            checksum: { type: "string", pattern: "^[0-9a-f]{64}$" },
            generatedAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time" },
            providers: {
              type: "array",
              items: { $ref: "#/components/schemas/SdarRegistryProjectionProvider" },
            },
          },
          additionalProperties: false,
        },
      },
      securitySchemes: {
        managementToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-management-token",
          "x-sdar-roles": ["reader", "administrator"],
        },
        runtimeConfigToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-runtime-config-token",
          "x-sdar-scopes": ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
        },
        runtimeRegistrationToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-file-backed-runtime-token",
          "x-sdar-scopes": ["runtime:register", "runtime:heartbeat"],
        },
      },
    },
  };
  applyManagementSecurity(document.paths, managementAuthMode);
  return Object.freeze(document);
}

function sdarRegistryProjectionPathParameters(): readonly Record<string, unknown>[] {
  return [
    {
      name: "environment",
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
    },
    {
      name: "smppSourceId",
      in: "path",
      required: true,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      },
    },
  ];
}

function sdarRegistryProjectionResponses(): Record<string, unknown> {
  return {
    "200": {
      description: "Strict SDAR Registry consumer projection",
      headers: {
        ETag: { schema: { type: "string" } },
        ...sdarRegistryProjectionLineageHeaders(),
      },
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/SdarRegistryProjection" } },
      },
    },
    "304": {
      description: "The consumer already has this projection checksum",
      headers: sdarRegistryProjectionLineageHeaders(),
    },
    "404": {
      description: "No published native Registry LKG is available",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
    },
  };
}

function sdarRegistryProjectionLineageHeaders(): Record<string, unknown> {
  return {
    "X-SMPP-Native-Revision": { schema: { type: "string" } },
    "X-SMPP-Native-Checksum": { schema: { type: "string" } },
    "X-SMPP-Projection-Contract": { schema: { const: "sdar-registry-v1" } },
  };
}

function applyManagementSecurity(
  paths: Record<string, Record<string, Record<string, unknown>>>,
  managementAuthMode: PmsManagementAuthMode,
): void {
  const prefixes = [
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
  for (const [path, operations] of Object.entries(paths)) {
    if (!prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (managementAuthMode === "anonymous_intranet") {
        operation.security = [];
        delete operation["x-sdar-required-role"];
        operation["x-sdar-access-mode"] = "anonymous_intranet";
        continue;
      }
      operation.security = [{ managementToken: [] }];
      operation["x-sdar-required-role"] =
        method === "get" ? "reader_or_administrator" : "administrator";
    }
  }
}

function runtimeDeploymentActionPaths(): Record<string, Record<string, Record<string, unknown>>> {
  return Object.fromEntries(
    ["start", "stop", "restart", "scale", "reconcile"].map((action) => [
      `/api/v1/runtime-deployments/{deploymentId}/${action}`,
      {
        post: {
          operationId: `${action}RuntimeDeployment`,
          parameters: [
            { name: "deploymentId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "202": {
              description: "RuntimeDeployment desired-state operation accepted",
            },
            "409": { description: "Desired revision conflict" },
          },
        },
      },
    ]),
  );
}
