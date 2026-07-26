import type { FastifyInstance } from "fastify";
import { RuntimeProcessQueryService } from "../../../packages/pms-application/src/index.js";
import type {
  RuntimeObservedHealth,
  RuntimeProcessState,
} from "../../../packages/runtime-deployment/src/index.js";

interface RuntimeProcessParameters {
  readonly instanceId: string;
}

interface RuntimeProcessScopeQuery {
  readonly providerId: string;
}

interface RuntimeProcessListRequestQuery extends RuntimeProcessScopeQuery {
  readonly deploymentId: string;
  readonly processState?: RuntimeProcessState;
  readonly observedHealth?: RuntimeObservedHealth;
  readonly limit?: number;
  readonly cursor?: string;
}

const PROCESS_STATES: readonly RuntimeProcessState[] = [
  "missing",
  "starting",
  "online",
  "stopping",
  "stopped",
  "errored",
];

const OBSERVED_HEALTH: readonly RuntimeObservedHealth[] = [
  "STOPPED",
  "STARTING",
  "NOT_READY",
  "STALE",
  "DEGRADED",
  "FAILED",
  "READY",
];

export function registerRuntimeProcessRoutes(
  app: FastifyInstance,
  service: RuntimeProcessQueryService,
): void {
  app.get<{ Querystring: RuntimeProcessListRequestQuery }>(
    "/api/v1/runtime-processes",
    {
      schema: {
        querystring: objectSchema(
          {
            providerId: identifierSchema(),
            deploymentId: identifierSchema(),
            processState: { enum: PROCESS_STATES },
            observedHealth: { enum: OBSERVED_HEALTH },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            cursor: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
          },
          ["providerId", "deploymentId"],
        ),
      },
    },
    (request) =>
      service.list({
        providerId: request.query.providerId,
        deploymentId: request.query.deploymentId,
        limit: request.query.limit ?? 100,
        ...(request.query.processState === undefined
          ? {}
          : { processState: request.query.processState }),
        ...(request.query.observedHealth === undefined
          ? {}
          : { observedHealth: request.query.observedHealth }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      }),
  );

  app.get<{ Params: RuntimeProcessParameters; Querystring: RuntimeProcessScopeQuery }>(
    "/api/v1/runtime-processes/:instanceId",
    {
      schema: {
        params: instanceParams(),
        querystring: objectSchema({ providerId: identifierSchema() }, ["providerId"]),
      },
    },
    (request) => service.get(request.query.providerId, request.params.instanceId),
  );

  app.get<{ Params: RuntimeProcessParameters; Querystring: RuntimeProcessScopeQuery }>(
    "/api/v1/runtime-processes/:instanceId/logs",
    {
      schema: {
        params: instanceParams(),
        querystring: objectSchema({ providerId: identifierSchema() }, ["providerId"]),
      },
    },
    async (request) => {
      const process = await service.get(request.query.providerId, request.params.instanceId);
      return { logReference: process.logReference };
    },
  );
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
) {
  return { type: "object", properties, required, additionalProperties: false };
}

function identifierSchema() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  };
}

function instanceParams() {
  return objectSchema({ instanceId: identifierSchema() }, ["instanceId"]);
}
