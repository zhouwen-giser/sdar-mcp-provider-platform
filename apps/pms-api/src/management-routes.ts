import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  PmsDomainError,
  type JsonObject,
  type ProviderStatus,
  type ProviderTypeStatus,
  type ResourceStatus,
} from "../../../packages/pms-domain/src/index.js";
import type {
  AuditContext,
  ProviderManagementService,
} from "../../../packages/pms-application/src/index.js";
import { requestContext } from "./context.js";

interface PageQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

interface ProviderTypeListQuery extends PageQuery {
  readonly status?: ProviderTypeStatus;
}

interface ProviderTypeBody {
  readonly providerTypeId: string;
  readonly displayName: string;
}

interface ProviderTypeParameters {
  readonly providerTypeId: string;
}

interface StatusBody<T> {
  readonly status: T;
  readonly expectedUpdatedAt: string;
}

interface ProviderListQuery extends PageQuery {
  readonly status?: ProviderStatus;
}

interface ProviderBody {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode?: "vendor_managed" | "platform_managed";
  readonly adapterEndpoint?: string;
}

interface ProviderParameters {
  readonly providerId: string;
}

interface ResourceListQuery extends PageQuery {
  readonly environment: string;
  readonly status?: ResourceStatus;
}

interface ResourceBody {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly metadata?: JsonObject;
}

interface ResourceParameters {
  readonly environment: string;
  readonly resourceId: string;
}

interface BindingBody {
  readonly environment: string;
  readonly resourceId: string;
}

const pageProperties = {
  limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  cursor: { type: "string", pattern: "^[0-9]+$" },
} as const;

export function registerManagementRoutes(
  app: FastifyInstance,
  service: ProviderManagementService,
): void {
  registerProviderTypeRoutes(app, service);
  registerProviderRoutes(app, service);
  registerResourceRoutes(app, service);
  registerBindingRoutes(app, service);
}

function registerProviderTypeRoutes(
  app: FastifyInstance,
  service: ProviderManagementService,
): void {
  app.post<{ Body: ProviderTypeBody }>(
    "/api/v1/provider-types",
    {
      schema: {
        body: objectSchema(
          {
            providerTypeId: identifierSchema(),
            displayName: { type: "string", minLength: 1, maxLength: 256 },
          },
          ["providerTypeId", "displayName"],
        ),
      },
    },
    async (request, reply) => {
      const result = await service.createProviderType(request.body, writeAudit(request));
      void reply.status(201);
      return result;
    },
  );
  app.get<{ Querystring: ProviderTypeListQuery }>(
    "/api/v1/provider-types",
    {
      schema: {
        querystring: objectSchema({
          ...pageProperties,
          status: { enum: ["active", "deprecated"] },
        }),
      },
    },
    (request) => service.listProviderTypes(page(request.query), request.query.status),
  );
  app.get<{ Params: ProviderTypeParameters }>(
    "/api/v1/provider-types/:providerTypeId",
    { schema: { params: idParams("providerTypeId") } },
    (request) => service.getProviderType(request.params.providerTypeId),
  );
  app.patch<{
    Params: ProviderTypeParameters;
    Body: StatusBody<ProviderTypeStatus>;
  }>(
    "/api/v1/provider-types/:providerTypeId/status",
    {
      schema: {
        params: idParams("providerTypeId"),
        body: statusSchema(["active", "deprecated"]),
      },
    },
    (request) =>
      service.updateProviderTypeStatus(
        request.params.providerTypeId,
        request.body.status,
        timestamp(request.body.expectedUpdatedAt),
        writeAudit(request),
      ),
  );
}

function registerProviderRoutes(app: FastifyInstance, service: ProviderManagementService): void {
  app.post<{ Body: ProviderBody }>(
    "/api/v1/providers",
    {
      schema: {
        body: objectSchema(
          {
            providerId: identifierSchema(),
            providerTypeId: identifierSchema(),
            packageId: identifierSchema(),
            packageVersion: { type: "string", minLength: 1, maxLength: 64 },
            hostingMode: { enum: ["vendor_managed", "platform_managed"] },
            adapterEndpoint: {
              type: "string",
              minLength: 3,
              maxLength: 320,
              pattern: "^(?:[A-Za-z0-9.-]+|\\[[0-9A-Fa-f:]+\\]):[0-9]{1,5}$",
            },
          },
          ["providerId", "providerTypeId"],
        ),
      },
    },
    async (request, reply) => {
      if (request.body.adapterEndpoint !== undefined) {
        assertSafeAdapterEndpoint(request.body.adapterEndpoint);
      }
      const result = await service.createProvider(request.body, writeAudit(request));
      void reply.status(201);
      return result;
    },
  );
  app.get<{ Querystring: ProviderListQuery }>(
    "/api/v1/providers",
    {
      schema: {
        querystring: objectSchema({
          ...pageProperties,
          status: { enum: ["draft", "active", "degraded", "disabled", "retired"] },
        }),
      },
    },
    (request) => service.listProviders(page(request.query), request.query.status),
  );
  app.get<{ Params: ProviderParameters }>(
    "/api/v1/providers/:providerId",
    { schema: { params: idParams("providerId") } },
    (request) => service.getProvider(request.params.providerId),
  );
  app.patch<{ Params: ProviderParameters; Body: StatusBody<ProviderStatus> }>(
    "/api/v1/providers/:providerId/status",
    {
      schema: {
        params: idParams("providerId"),
        body: statusSchema(["draft", "active", "degraded", "disabled", "retired"]),
      },
    },
    (request) =>
      service.updateProviderStatus(
        request.params.providerId,
        request.body.status,
        timestamp(request.body.expectedUpdatedAt),
        writeAudit(request),
      ),
  );
}

function assertSafeAdapterEndpoint(value: string): void {
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Adapter endpoint port is invalid", {
      field: "adapterEndpoint",
    });
  }
}

function registerResourceRoutes(app: FastifyInstance, service: ProviderManagementService): void {
  app.post<{ Body: ResourceBody }>(
    "/api/v1/resources",
    {
      schema: {
        body: objectSchema(
          {
            environment: identifierSchema(),
            resourceId: identifierSchema(),
            resourceType: { type: "string", minLength: 1, maxLength: 128 },
            metadata: { type: "object", additionalProperties: true },
          },
          ["environment", "resourceId", "resourceType"],
        ),
      },
    },
    async (request, reply) => {
      const result = await service.createResource(
        { ...request.body, metadata: request.body.metadata ?? {} },
        writeAudit(request),
      );
      void reply.status(201);
      return result;
    },
  );
  app.get<{ Querystring: ResourceListQuery }>(
    "/api/v1/resources",
    {
      schema: {
        querystring: objectSchema(
          {
            ...pageProperties,
            environment: identifierSchema(),
            status: { enum: ["available", "unavailable", "retired"] },
          },
          ["environment"],
        ),
      },
    },
    (request) =>
      service.listResources(request.query.environment, page(request.query), request.query.status),
  );
  app.get<{ Params: ResourceParameters }>(
    "/api/v1/resources/:environment/:resourceId",
    { schema: { params: resourceParams() } },
    (request) => service.getResource(request.params),
  );
  app.patch<{ Params: ResourceParameters; Body: StatusBody<ResourceStatus> }>(
    "/api/v1/resources/:environment/:resourceId/status",
    {
      schema: {
        params: resourceParams(),
        body: statusSchema(["available", "unavailable", "retired"]),
      },
    },
    (request) =>
      service.updateResourceStatus(
        request.params,
        request.body.status,
        timestamp(request.body.expectedUpdatedAt),
        writeAudit(request),
      ),
  );
}

function registerBindingRoutes(app: FastifyInstance, service: ProviderManagementService): void {
  app.post<{ Params: ProviderParameters; Body: BindingBody }>(
    "/api/v1/providers/:providerId/resource-bindings",
    {
      schema: {
        params: idParams("providerId"),
        body: objectSchema({ environment: identifierSchema(), resourceId: identifierSchema() }, [
          "environment",
          "resourceId",
        ]),
      },
    },
    async (request, reply) => {
      const result = await service.bindResource(
        { providerId: request.params.providerId, ...request.body },
        writeAudit(request),
      );
      void reply.status(201);
      return result;
    },
  );
  app.get<{ Params: ProviderParameters }>(
    "/api/v1/providers/:providerId/resource-bindings",
    { schema: { params: idParams("providerId") } },
    async (request) => ({
      items: await service.listProviderResources(request.params.providerId),
    }),
  );
  app.delete<{ Params: ProviderParameters & ResourceParameters }>(
    "/api/v1/providers/:providerId/resource-bindings/:environment/:resourceId",
    {
      schema: {
        params: objectSchema(
          {
            providerId: identifierSchema(),
            environment: identifierSchema(),
            resourceId: identifierSchema(),
          },
          ["providerId", "environment", "resourceId"],
        ),
      },
    },
    async (request, reply) => {
      await service.unbindResource(request.params, writeAudit(request));
      void reply.status(204).send();
    },
  );
}

function writeAudit(request: FastifyRequest): AuditContext {
  const context = requestContext(request);
  if (context.actorId === undefined) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Actor header is required", {
      field: "x-actor-id",
    });
  }
  return { actorId: context.actorId, correlationId: context.correlationId };
}

function page(query: PageQuery): { limit: number; cursor?: string } {
  return {
    limit: query.limit ?? 100,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  };
}

function timestamp(source: string): Date {
  const value = new Date(source);
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== source) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Invalid optimistic timestamp", {
      field: "expectedUpdatedAt",
    });
  }
  return value;
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
) {
  return { type: "object", properties, required, additionalProperties: false };
}

function identifierSchema() {
  return { type: "string", minLength: 1, maxLength: 128 };
}

function idParams(name: string) {
  return objectSchema({ [name]: identifierSchema() }, [name]);
}

function resourceParams() {
  return objectSchema({ environment: identifierSchema(), resourceId: identifierSchema() }, [
    "environment",
    "resourceId",
  ]);
}

function statusSchema(statuses: readonly string[]) {
  return objectSchema(
    {
      status: { enum: statuses },
      expectedUpdatedAt: { type: "string", format: "date-time" },
    },
    ["status", "expectedUpdatedAt"],
  );
}
