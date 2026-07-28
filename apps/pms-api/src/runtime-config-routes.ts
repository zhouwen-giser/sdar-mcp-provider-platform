import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  RuntimeConfigAcknowledgementService,
  RuntimeConfigClientAuthorizer,
  RuntimeConfigQueryService,
  RuntimeConfigClientIdentity,
  RuntimeConfigClientRequest,
  RuntimeConfigWatchSubscription,
} from "../../../packages/configuration-center/src/index.js";
import type { JsonObject } from "../../../packages/pms-domain/src/index.js";
import {
  auditAuthenticationRejection,
  type AuthenticationRejectionAuditPort,
} from "./authorization.js";
import type { RuntimeConfigScope } from "./config.js";

export interface RuntimeConfigWatchPort {
  subscribe(request: RuntimeConfigClientRequest): RuntimeConfigWatchSubscription;
}

interface ScopedRuntimeConfigClientAuthorizer extends RuntimeConfigClientAuthorizer {
  authorizeForScope(
    credentials: { readonly authorization?: string },
    target: RuntimeConfigClientRequest,
    requiredScope: RuntimeConfigScope,
  ): Promise<RuntimeConfigClientIdentity>;
}

interface RuntimeConfigParameters {
  readonly deploymentId: string;
  readonly instanceId: string;
}

interface RuntimeConfigQuery {
  readonly environment: string;
  readonly configGroup: string;
  readonly dataId: string;
}

interface RuntimeConfigAckParameters extends RuntimeConfigParameters {
  readonly revisionId: string;
}

interface RuntimeConfigAckBody {
  readonly status: "applied" | "rejected" | "restart_required" | "stale" | "unavailable";
  readonly appliedChecksum?: string;
  readonly reasonCode?: string;
  readonly details?: JsonObject;
}

export function registerRuntimeConfigRoutes(
  app: FastifyInstance,
  query: RuntimeConfigQueryService,
  authorizer: RuntimeConfigClientAuthorizer,
  watch?: RuntimeConfigWatchPort,
  acknowledgements?: RuntimeConfigAcknowledgementService,
  authenticationAudit?: AuthenticationRejectionAuditPort,
): void {
  app.get<{ Params: RuntimeConfigParameters; Querystring: RuntimeConfigQuery }>(
    "/api/v1/runtime-config/deployments/:deploymentId/instances/:instanceId/latest",
    {
      schema: {
        params: {
          type: "object",
          required: ["deploymentId", "instanceId"],
          properties: {
            deploymentId: identifier(),
            instanceId: identifier(),
          },
          additionalProperties: false,
        },
        querystring: {
          type: "object",
          required: ["environment", "configGroup", "dataId"],
          properties: {
            environment: {
              type: "string",
              pattern: "^[a-z][a-z0-9-]{0,62}$",
            },
            configGroup: {
              type: "string",
              pattern: "^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
            },
            dataId: identifier(),
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const target = {
        environment: request.query.environment,
        deploymentId: request.params.deploymentId,
        instanceId: request.params.instanceId,
        configGroup: request.query.configGroup,
        dataId: request.query.dataId,
      };
      const identity = await authorizeRuntimeConfig(
        authorizer,
        request,
        target,
        "runtime:config:read",
        authenticationAudit,
      );
      const latest = await query.latest(target, identity);
      const etag = `"${latest.checksum}"`;
      void reply.header("etag", etag).header("cache-control", "private, no-cache");
      if (etagMatches(request.headers["if-none-match"], latest.checksum)) {
        return reply.status(304).send();
      }
      return reply.send(latest);
    },
  );
  if (watch !== undefined) {
    registerWatchRoute(app, query, authorizer, watch, authenticationAudit);
  }
  if (acknowledgements !== undefined) {
    registerAcknowledgementRoute(app, authorizer, acknowledgements, authenticationAudit);
  }
}

function registerWatchRoute(
  app: FastifyInstance,
  query: RuntimeConfigQueryService,
  authorizer: RuntimeConfigClientAuthorizer,
  watch: RuntimeConfigWatchPort,
  authenticationAudit?: AuthenticationRejectionAuditPort,
): void {
  app.get<{ Params: RuntimeConfigParameters; Querystring: RuntimeConfigQuery }>(
    "/api/v1/runtime-config/deployments/:deploymentId/instances/:instanceId/watch",
    { schema: runtimeTargetSchema() },
    async (request, reply) => {
      const target = targetFromRequest(request.params, request.query);
      const identity = await authorizeRuntimeConfig(
        authorizer,
        request,
        target,
        "runtime:config:watch",
        authenticationAudit,
      );
      const subscription = watch.subscribe(target);
      let latest;
      try {
        latest = await query.latest(target, identity);
      } catch (error) {
        subscription.close();
        throw error;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      let lastChecksum = latest.checksum;
      reply.raw.write(`retry: 3000\n${sseHint(latest)}\n`);
      const close = () => subscription.close();
      reply.raw.once("close", close);
      reply.raw.once("error", close);
      while (!reply.raw.destroyed) {
        const hint = await subscription.next();
        if (hint === null) break;
        if (hint.checksum === lastChecksum) continue;
        lastChecksum = hint.checksum;
        reply.raw.write(`${sseHint(hint)}\n`);
      }
      return reply;
    },
  );
}

function registerAcknowledgementRoute(
  app: FastifyInstance,
  authorizer: RuntimeConfigClientAuthorizer,
  acknowledgements: RuntimeConfigAcknowledgementService,
  authenticationAudit?: AuthenticationRejectionAuditPort,
): void {
  app.post<{
    Params: RuntimeConfigAckParameters;
    Querystring: RuntimeConfigQuery;
    Body: RuntimeConfigAckBody;
  }>(
    "/api/v1/runtime-config/deployments/:deploymentId/instances/:instanceId/revisions/:revisionId/acks",
    {
      schema: {
        ...runtimeTargetSchema(),
        params: {
          ...runtimeTargetSchema().params,
          required: ["deploymentId", "instanceId", "revisionId"],
          properties: {
            ...runtimeTargetSchema().params.properties,
            revisionId: {
              type: "string",
              pattern:
                "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
            },
          },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              enum: ["applied", "rejected", "restart_required", "stale", "unavailable"],
            },
            appliedChecksum: { type: "string", pattern: "^[0-9a-f]{64}$" },
            reasonCode: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,127}$" },
            details: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const target = targetFromRequest(request.params, request.query);
      const identity = await authorizeRuntimeConfig(
        authorizer,
        request,
        target,
        "runtime:config:ack",
        authenticationAudit,
      );
      return acknowledgements.acknowledge(target, identity, {
        revisionId: request.params.revisionId,
        status: request.body.status,
        ...(request.body.appliedChecksum === undefined
          ? {}
          : { appliedChecksum: request.body.appliedChecksum }),
        ...(request.body.reasonCode === undefined ? {} : { reasonCode: request.body.reasonCode }),
        ...(request.body.details === undefined ? {} : { details: request.body.details }),
      });
    },
  );
}

async function authorizeRuntimeConfig(
  authorizer: RuntimeConfigClientAuthorizer,
  request: FastifyRequest,
  target: RuntimeConfigClientRequest,
  scope: RuntimeConfigScope,
  authenticationAudit: AuthenticationRejectionAuditPort | undefined,
): Promise<RuntimeConfigClientIdentity> {
  try {
    const scoped = scopedAuthorizer(authorizer);
    return scoped === undefined
      ? await authorizer.authorize(credentials(request.headers.authorization), target)
      : await scoped.authorizeForScope(credentials(request.headers.authorization), target, scope);
  } catch (error) {
    await auditAuthenticationRejection(authenticationAudit, request, error, target);
    throw error;
  }
}

function scopedAuthorizer(
  authorizer: RuntimeConfigClientAuthorizer,
): ScopedRuntimeConfigClientAuthorizer | undefined {
  return "authorizeForScope" in authorizer && typeof authorizer.authorizeForScope === "function"
    ? (authorizer as ScopedRuntimeConfigClientAuthorizer)
    : undefined;
}

function identifier() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  } as const;
}

function runtimeTargetSchema() {
  return {
    params: {
      type: "object",
      required: ["deploymentId", "instanceId"],
      properties: {
        deploymentId: identifier(),
        instanceId: identifier(),
      },
      additionalProperties: false,
    },
    querystring: {
      type: "object",
      required: ["environment", "configGroup", "dataId"],
      properties: {
        environment: { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" },
        configGroup: {
          type: "string",
          pattern: "^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        },
        dataId: identifier(),
      },
      additionalProperties: false,
    },
  } as const;
}

function targetFromRequest(parameters: RuntimeConfigParameters, query: RuntimeConfigQuery) {
  return {
    environment: query.environment,
    deploymentId: parameters.deploymentId,
    instanceId: parameters.instanceId,
    configGroup: query.configGroup,
    dataId: query.dataId,
  };
}

function credentials(authorization: string | readonly string[] | undefined) {
  return typeof authorization === "string" ? { authorization } : {};
}

function sseHint(hint: {
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
}): string {
  return `id: ${hint.checksum}\nevent: revision\ndata: ${JSON.stringify({
    revisionId: hint.revisionId,
    revision: hint.revision,
    checksum: hint.checksum,
  })}\n`;
}

function etagMatches(value: string | readonly string[] | undefined, checksum: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === `"${checksum}"` || normalized === checksum;
  });
}
