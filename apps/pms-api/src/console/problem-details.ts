import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ConfigurationCenterError } from "../../../../packages/configuration-center/src/index.js";
import {
  RuntimeDeploymentApplicationError,
  RuntimeProcessQueryError,
} from "../../../../packages/pms-application/src/index.js";
import { PmsDomainError, PmsRepositoryError } from "../../../../packages/pms-domain/src/index.js";
import { RuntimeDeploymentError } from "../../../../packages/runtime-deployment/src/index.js";
import { requestContext } from "../context.js";

export type ConsoleProblemCode =
  | "INVALID_REQUEST"
  | "INVALID_JSON"
  | "REQUEST_BODY_TOO_LARGE"
  | "INTERNAL_ERROR"
  | "ROUTE_NOT_FOUND"
  | "INVALID_IDENTIFIER"
  | "INVALID_DOMAIN_VALUE"
  | "INVALID_STATE_TRANSITION"
  | "DUPLICATE_RESOURCE_BINDING"
  | "RESOURCE_BINDING_NOT_FOUND"
  | "ENTITY_ALREADY_EXISTS"
  | "ENTITY_NOT_FOUND"
  | "OPTIMISTIC_CONCURRENCY_CONFLICT"
  | "LEASE_NOT_OWNED"
  | "RUNTIME_DEPLOYMENT_NOT_FOUND"
  | "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE"
  | "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED"
  | "RUNTIME_DEPLOYMENT_REVISION_CONFLICT"
  | "RUNTIME_PROCESS_NOT_FOUND"
  | "CONFIGURATION_DEFINITION_NOT_FOUND"
  | "CONFIGURATION_TARGET_NOT_ALLOWED"
  | "CONFIGURATION_BUSINESS_KEY_CONFLICT"
  | "CONFIGURATION_DRAFT_NOT_FOUND"
  | "CONFIGURATION_DRAFT_VERSION_CONFLICT"
  | "CONFIGURATION_DRAFT_NOT_VALIDATED"
  | "CONFIGURATION_PUBLISH_CONFLICT"
  | "CONFIGURATION_REVISION_NOT_FOUND"
  | "CONFIGURATION_ROLLBACK_TARGET_MISMATCH"
  | "CONFIGURATION_INPUT_INVALID"
  | "REGISTRY_SNAPSHOT_NOT_FOUND";

export interface ConsoleProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ConsoleProblemCode;
  readonly detail?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export class ConsoleApiProblem extends Error {
  constructor(
    readonly statusCode: number,
    readonly problemCode: ConsoleProblemCode,
    message: string,
  ) {
    super(message);
    this.name = "ConsoleApiProblem";
  }
}

export function sendConsoleProblem(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const classified = classifyConsoleError(error);
  sendProblem(classified, request, reply);
}

export function sendConsoleNotFound(request: FastifyRequest, reply: FastifyReply): void {
  sendProblem(
    {
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "The requested Console API route does not exist",
    },
    request,
    reply,
  );
}

function sendProblem(
  classified: {
    readonly statusCode: number;
    readonly code: ConsoleProblemCode;
    readonly message: string;
  },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const context = requestContext(request);
  void reply
    .status(classified.statusCode)
    .type("application/problem+json")
    .send({
      type: `urn:sdar:pms:problem:${classified.code.toLowerCase().replaceAll("_", "-")}`,
      title: title(classified.code),
      status: classified.statusCode,
      code: classified.code,
      detail: classified.message,
      requestId: context.requestId,
      correlationId: context.correlationId,
    } satisfies ConsoleProblemDetails);
}

function classifyConsoleError(error: FastifyError): {
  readonly statusCode: number;
  readonly code: ConsoleProblemCode;
  readonly message: string;
} {
  if (error.validation !== undefined) {
    return problem(400, "INVALID_REQUEST", "Request validation failed");
  }
  if (error instanceof ConsoleApiProblem) {
    return problem(error.statusCode, error.problemCode, error.message);
  }
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return problem(413, "REQUEST_BODY_TOO_LARGE", "Request body exceeds the allowed size");
  }
  if (
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
    error.code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
    (error instanceof SyntaxError && error.statusCode === 400)
  ) {
    return problem(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if (
    error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
    error.code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH"
  ) {
    return problem(400, "INVALID_REQUEST", "Request content type is not supported");
  }
  if (error instanceof PmsDomainError) {
    return problem(
      error.code === "RESOURCE_BINDING_NOT_FOUND" ? 404 : 400,
      error.code,
      error.message,
    );
  }
  if (error instanceof PmsRepositoryError) {
    return problem(error.code === "ENTITY_NOT_FOUND" ? 404 : 409, error.code, error.message);
  }
  if (error instanceof RuntimeDeploymentApplicationError) {
    const status =
      error.code === "RUNTIME_DEPLOYMENT_NOT_FOUND"
        ? 404
        : error.code === "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED"
          ? 400
          : 409;
    return problem(status, error.code, error.message);
  }
  if (error instanceof RuntimeProcessQueryError) {
    return problem(404, "RUNTIME_PROCESS_NOT_FOUND", error.message);
  }
  if (error instanceof ConfigurationCenterError) {
    const code = configurationCode(error.code);
    const status = CONFIGURATION_NOT_FOUND.has(code)
      ? 404
      : CONFIGURATION_CONFLICT.has(code)
        ? 409
        : 400;
    return problem(status, code, error.message);
  }
  if (error instanceof RuntimeDeploymentError) return runtimeDeploymentProblem(error);
  if (error instanceof RangeError || error instanceof TypeError) {
    return problem(400, "INVALID_DOMAIN_VALUE", "A supplied value is invalid");
  }
  return problem(500, "INTERNAL_ERROR", "An internal error occurred");
}

function runtimeDeploymentProblem(error: RuntimeDeploymentError) {
  switch (error.code) {
    case "INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER":
      return problem(400, "INVALID_IDENTIFIER", error.message);
    case "INVALID_RUNTIME_DEPLOYMENT_SPEC":
      return problem(400, "INVALID_DOMAIN_VALUE", error.message);
    case "INVALID_RUNTIME_DEPLOYMENT_TRANSITION":
      return problem(400, "INVALID_STATE_TRANSITION", error.message);
    case "RUNTIME_DEPLOYMENT_STATE_CONFLICT":
    case "RUNTIME_DEPLOYMENT_REVISION_CONFLICT":
      return problem(409, "RUNTIME_DEPLOYMENT_REVISION_CONFLICT", error.message);
    case "RUNTIME_PROCESS_REVISION_CONFLICT":
      return problem(409, "OPTIMISTIC_CONCURRENCY_CONFLICT", error.message);
    case "INVALID_RUNTIME_PROCESS_PROJECTION":
      return problem(500, "INTERNAL_ERROR", "An internal error occurred");
    default:
      return problem(500, "INTERNAL_ERROR", "An internal error occurred");
  }
}

function configurationCode(code: ConfigurationCenterError["code"]): ConsoleProblemCode {
  if (
    code.startsWith("CONFIGURATION_") &&
    !code.includes("PROJECTION") &&
    !code.includes("RUNTIME_CONFIG")
  ) {
    return code as ConsoleProblemCode;
  }
  return "CONFIGURATION_INPUT_INVALID";
}

function problem(
  statusCode: number,
  code: ConsoleProblemCode,
  message: string,
): { readonly statusCode: number; readonly code: ConsoleProblemCode; readonly message: string } {
  return { statusCode, code, message };
}

function title(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const CONFIGURATION_NOT_FOUND = new Set<ConsoleProblemCode>([
  "CONFIGURATION_DEFINITION_NOT_FOUND",
  "CONFIGURATION_DRAFT_NOT_FOUND",
  "CONFIGURATION_REVISION_NOT_FOUND",
]);
const CONFIGURATION_CONFLICT = new Set<ConsoleProblemCode>([
  "CONFIGURATION_BUSINESS_KEY_CONFLICT",
  "CONFIGURATION_DRAFT_VERSION_CONFLICT",
  "CONFIGURATION_DRAFT_NOT_VALIDATED",
  "CONFIGURATION_PUBLISH_CONFLICT",
]);
