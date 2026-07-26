import type { FastifyInstance } from "fastify";
import type {
  RuntimeConfigClientAuthorizer,
  RuntimeConfigQueryService,
} from "../../../packages/configuration-center/src/index.js";

interface RuntimeConfigParameters {
  readonly deploymentId: string;
  readonly instanceId: string;
}

interface RuntimeConfigQuery {
  readonly environment: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export function registerRuntimeConfigRoutes(
  app: FastifyInstance,
  query: RuntimeConfigQueryService,
  authorizer: RuntimeConfigClientAuthorizer,
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
      const identity = await authorizer.authorize(
        {
          ...(typeof request.headers.authorization === "string"
            ? { authorization: request.headers.authorization }
            : {}),
        },
        target,
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
}

function identifier() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  } as const;
}

function etagMatches(value: string | readonly string[] | undefined, checksum: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === `"${checksum}"` || normalized === checksum;
  });
}
