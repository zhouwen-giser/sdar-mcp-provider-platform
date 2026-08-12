import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  AuditContext,
  CreateRuntimeDeploymentInput,
  RuntimeDeploymentCommandInput,
} from "../../../packages/pms-application/src/index.js";
import { RuntimeDeploymentApplicationError } from "../../../packages/pms-application/src/index.js";
import { PmsDomainError } from "../../../packages/pms-domain/src/index.js";
import type {
  RuntimeDeploymentAuthority,
  RuntimeDeploymentDesiredState,
  RuntimeDeploymentStatus,
} from "../../../packages/runtime-deployment/src/index.js";
import { requestContext } from "./context.js";

interface RuntimeDeploymentViewBase {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly desiredState: RuntimeDeploymentDesiredState;
  readonly desiredReplicas: number;
  readonly runtimeVersion: string;
  readonly adapterEndpoint?: string;
  readonly runtimeAuthority: RuntimeDeploymentAuthority;
  readonly status: RuntimeDeploymentStatus;
  readonly desiredRevision: number;
  readonly observedRevision: number;
}

export type RuntimeDeploymentView = RuntimeDeploymentViewBase &
  (
    | {
        readonly runtimeAuthority: "platform_managed";
        readonly databaseProfileId: string;
        readonly configProfileId: string;
        readonly directContainer?: never;
      }
    | {
        readonly runtimeAuthority: "direct_container";
        readonly adapterEndpoint: string;
        readonly databaseProfileId?: never;
        readonly configProfileId?: never;
        readonly directContainer: {
          readonly instanceId: string;
          readonly controlEndpoint: string;
          readonly advertisedEndpoint: string;
        };
      }
  );

export interface RuntimeDeploymentListQuery {
  readonly providerId: string;
  readonly environment?: string;
  readonly status?: RuntimeDeploymentStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface RuntimeDeploymentListResult {
  readonly items: readonly RuntimeDeploymentView[];
  readonly nextCursor?: string;
}

export interface RuntimeDeploymentManagementPort {
  create(
    input: CreateRuntimeDeploymentInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentView>;
  command(
    input: RuntimeDeploymentCommandInput,
    context: AuditContext,
  ): Promise<RuntimeDeploymentView>;
  get(providerId: string, deploymentId: string): Promise<RuntimeDeploymentView | null>;
  list(query: RuntimeDeploymentListQuery): Promise<RuntimeDeploymentListResult>;
}

interface DeploymentParameters {
  readonly deploymentId: string;
}

interface ProviderScopeQuery {
  readonly providerId: string;
}

interface DeploymentListRequestQuery extends ProviderScopeQuery {
  readonly environment?: string;
  readonly status?: RuntimeDeploymentStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

interface DeploymentActionBody {
  readonly providerId: string;
  readonly expectedDesiredRevision: number;
  readonly desiredReplicas?: number;
}

const DEPLOYMENT_STATUSES: readonly RuntimeDeploymentStatus[] = [
  "REQUESTED",
  "DATABASE_PROVISIONING",
  "MIGRATING",
  "CONFIG_PREPARING",
  "STARTING",
  "HEALTH_CHECKING",
  "DISCOVERING",
  "ACTIVE",
  "STOPPED",
  "DRAINING",
  "DEGRADED",
  "FAILED",
];

const ACTIONS = ["start", "stop", "restart", "scale", "reconcile"] as const;
type DeploymentAction = (typeof ACTIONS)[number];

export function registerRuntimeDeploymentRoutes(
  app: FastifyInstance,
  service: RuntimeDeploymentManagementPort,
): void {
  app.post<{ Body: CreateRuntimeDeploymentInput }>(
    "/api/v1/runtime-deployments",
    {
      schema: {
        body: createDeploymentSchema(),
      },
    },
    async (request, reply) => {
      const context = writeAudit(request);
      const deployment = await service.create(request.body, context);
      void reply.status(202);
      return intentResponse(deployment, context.correlationId);
    },
  );

  app.get<{ Querystring: DeploymentListRequestQuery }>(
    "/api/v1/runtime-deployments",
    {
      schema: {
        querystring: objectSchema(
          {
            providerId: identifierSchema(),
            environment: environmentSchema(),
            status: { enum: DEPLOYMENT_STATUSES },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            cursor: { type: "string", pattern: "^[0-9]+$" },
          },
          ["providerId"],
        ),
      },
    },
    (request) =>
      service.list({
        providerId: request.query.providerId,
        limit: request.query.limit ?? 100,
        ...(request.query.environment === undefined
          ? {}
          : { environment: request.query.environment }),
        ...(request.query.status === undefined ? {} : { status: request.query.status }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      }),
  );

  app.get<{ Params: DeploymentParameters; Querystring: ProviderScopeQuery }>(
    "/api/v1/runtime-deployments/:deploymentId",
    {
      schema: {
        params: deploymentParams(),
        querystring: objectSchema({ providerId: identifierSchema() }, ["providerId"]),
      },
    },
    async (request) => {
      const deployment = await service.get(request.query.providerId, request.params.deploymentId);
      if (deployment === null) {
        throw new RuntimeDeploymentApplicationError(
          "RUNTIME_DEPLOYMENT_NOT_FOUND",
          "RuntimeDeployment does not exist in Provider scope",
        );
      }
      return deployment;
    },
  );

  for (const action of ACTIONS) registerAction(app, service, action);
}

function registerAction(
  app: FastifyInstance,
  service: RuntimeDeploymentManagementPort,
  action: DeploymentAction,
): void {
  app.post<{ Params: DeploymentParameters; Body: DeploymentActionBody }>(
    `/api/v1/runtime-deployments/:deploymentId/${action}`,
    {
      schema: {
        params: deploymentParams(),
        body: objectSchema(
          {
            providerId: identifierSchema(),
            expectedDesiredRevision: { type: "integer", minimum: 0 },
            ...(action === "scale" ? { desiredReplicas: replicaSchema() } : {}),
          },
          action === "scale"
            ? ["providerId", "expectedDesiredRevision", "desiredReplicas"]
            : ["providerId", "expectedDesiredRevision"],
        ),
      },
    },
    async (request, reply) => {
      const context = writeAudit(request);
      const deployment = await service.command(
        {
          providerId: request.body.providerId,
          deploymentId: request.params.deploymentId,
          command: action,
          expectedDesiredRevision: request.body.expectedDesiredRevision,
          ...(action === "scale"
            ? { desiredReplicas: requireDesiredReplicas(request.body.desiredReplicas) }
            : {}),
        },
        context,
      );
      void reply.status(202);
      return intentResponse(deployment, context.correlationId);
    },
  );
}

function requireDesiredReplicas(value: number | undefined): number {
  if (value === undefined) {
    throw new TypeError("desiredReplicas is required for scale");
  }
  return value;
}

function intentResponse(deployment: RuntimeDeploymentView, operationId: string) {
  return { operationId, deployment };
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

function environmentSchema() {
  return { type: "string", minLength: 1, maxLength: 63, pattern: "^[a-z][a-z0-9-]{0,62}$" };
}

function replicaSchema() {
  return { type: "integer", minimum: 0, maximum: 1 };
}

function createDeploymentSchema() {
  const base = objectSchema(
    {
      deploymentId: identifierSchema(),
      providerId: identifierSchema(),
      environment: environmentSchema(),
      runtimeVersion: { type: "string", minLength: 1, maxLength: 128 },
      adapterEndpoint: { type: "string", minLength: 1, maxLength: 512 },
      desiredReplicas: replicaSchema(),
      runtimeAuthority: { enum: ["platform_managed", "direct_container"] },
      databaseProfileId: identifierSchema(),
      configProfileId: identifierSchema(),
      directContainer: objectSchema(
        {
          instanceId: identifierSchema(),
          controlEndpoint: baseEndpointSchema(),
          advertisedEndpoint: baseEndpointSchema(),
        },
        ["instanceId", "controlEndpoint", "advertisedEndpoint"],
      ),
    },
    ["deploymentId", "providerId", "environment", "runtimeVersion"],
  );
  return {
    ...base,
    allOf: [
      {
        if: {
          required: ["runtimeAuthority"],
          properties: { runtimeAuthority: { const: "direct_container" } },
        },
        then: {
          required: ["adapterEndpoint", "directContainer"],
          not: {
            anyOf: [{ required: ["databaseProfileId"] }, { required: ["configProfileId"] }],
          },
        },
        else: {
          required: ["databaseProfileId", "configProfileId"],
          not: { required: ["directContainer"] },
        },
      },
    ],
  };
}

function baseEndpointSchema() {
  return { type: "string", minLength: 8, maxLength: 2_048, pattern: "^https?://[^/?#]+/?$" };
}

function deploymentParams() {
  return objectSchema({ deploymentId: identifierSchema() }, ["deploymentId"]);
}
