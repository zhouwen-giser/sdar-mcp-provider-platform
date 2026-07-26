import type { FastifyInstance } from "fastify";
import {
  assertRuntimeRegistrationPrincipal,
  parseRuntimeHeartbeatRequest,
  parseRuntimeRegistrationRequest,
  type RuntimeRegistrationAuthorizer,
  type RuntimeRegistrationScope,
  type RuntimeRegistrationService,
} from "../../../packages/runtime-registration/src/index.js";
import { requestContext } from "./context.js";

interface RuntimeRegistrationParameters {
  readonly deploymentId: string;
  readonly instanceId: string;
}

interface RuntimeRegistrationBody {
  readonly providerId: string;
  readonly sessionId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
  readonly configRevision: number;
  readonly readinessState: "ready" | "not_ready";
}

interface RuntimeHeartbeatBody extends RuntimeRegistrationBody {
  readonly sequence: number;
}

export function registerRuntimeRegistrationRoutes(
  app: FastifyInstance,
  service: RuntimeRegistrationService,
  authorizer: RuntimeRegistrationAuthorizer,
): void {
  app.post<{ Params: RuntimeRegistrationParameters; Body: RuntimeRegistrationBody }>(
    "/api/v1/runtime-registration/deployments/:deploymentId/instances/:instanceId/register",
    { schema: registrationSchema(false) },
    async (request) => {
      const runtime = parseRuntimeRegistrationRequest({
        ...request.body,
        deploymentId: request.params.deploymentId,
        instanceId: request.params.instanceId,
      });
      const principal = await authorize(
        authorizer,
        request.headers.authorization,
        request.params,
        "runtime:register",
      );
      assertRuntimeRegistrationPrincipal(principal, runtime, "runtime:register");
      const result = await service.register(runtime, {
        subjectId: principal.subjectId,
        ...requestContext(request),
      });
      return response(result);
    },
  );

  app.post<{ Params: RuntimeRegistrationParameters; Body: RuntimeHeartbeatBody }>(
    "/api/v1/runtime-registration/deployments/:deploymentId/instances/:instanceId/heartbeat",
    { schema: registrationSchema(true) },
    async (request) => {
      const heartbeat = parseRuntimeHeartbeatRequest({
        ...request.body,
        deploymentId: request.params.deploymentId,
        instanceId: request.params.instanceId,
      });
      const principal = await authorize(
        authorizer,
        request.headers.authorization,
        request.params,
        "runtime:heartbeat",
      );
      assertRuntimeRegistrationPrincipal(principal, heartbeat, "runtime:heartbeat");
      const result = await service.heartbeat(heartbeat, {
        subjectId: principal.subjectId,
        ...requestContext(request),
      });
      return response(result);
    },
  );
}

function authorize(
  authorizer: RuntimeRegistrationAuthorizer,
  authorization: string | readonly string[] | undefined,
  target: RuntimeRegistrationParameters,
  scope: RuntimeRegistrationScope,
) {
  return authorizer.authorize(
    typeof authorization === "string" ? { authorization } : {},
    target,
    scope,
  );
}

function response(result: Awaited<ReturnType<RuntimeRegistrationService["register"]>>) {
  return {
    outcome: result.outcome,
    registration: {
      providerId: result.registration.providerId,
      deploymentId: result.registration.deploymentId,
      instanceId: result.registration.instanceId,
      sessionId: result.registration.sessionId,
      runtimeVersion: result.registration.runtimeVersion,
      protocolVersion: result.registration.protocolVersion,
      configRevision: result.registration.configRevision,
      readinessState: result.registration.readinessState,
      heartbeatSequence: result.registration.heartbeatSequence,
      lastHeartbeatAt: result.registration.lastHeartbeatAt.toISOString(),
      expiresAt: result.registration.expiresAt.toISOString(),
      revision: result.registration.revision,
    },
  };
}

function registrationSchema(heartbeat: boolean) {
  const properties = {
    providerId: identifier(),
    sessionId: identifier(),
    runtimeVersion: {
      type: "string",
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$",
    },
    protocolVersion: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
    configRevision: { type: "integer", minimum: 0 },
    readinessState: { enum: ["ready", "not_ready"] },
    ...(heartbeat ? { sequence: { type: "integer", minimum: 0 } } : {}),
  };
  return {
    params: {
      type: "object",
      required: ["deploymentId", "instanceId"],
      properties: { deploymentId: identifier(), instanceId: identifier() },
      additionalProperties: false,
    },
    body: {
      type: "object",
      required: [
        "providerId",
        "sessionId",
        "runtimeVersion",
        "protocolVersion",
        "configRevision",
        "readinessState",
        ...(heartbeat ? ["sequence"] : []),
      ],
      properties,
      additionalProperties: false,
    },
  } as const;
}

function identifier() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  } as const;
}
