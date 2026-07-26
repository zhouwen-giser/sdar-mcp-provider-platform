import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  ConfigurationCenterError,
  type ConfigurationCenterErrorCode,
} from "../../../packages/configuration-center/src/index.js";
import {
  PmsDomainError,
  PmsRepositoryError,
  type PmsDomainErrorCode,
  type PmsRepositoryErrorCode,
} from "../../../packages/pms-domain/src/index.js";
import { requestContext } from "./context.js";

export interface PmsErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
  };
}

interface PublicError {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
}

export function sendPmsError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const context = requestContext(request);
  const publicError = classifyError(error);
  void reply.status(publicError.statusCode).send({
    error: {
      code: publicError.code,
      message: publicError.message,
      requestId: context.requestId,
      correlationId: context.correlationId,
    },
  } satisfies PmsErrorEnvelope);
}

export function notFoundError(request: FastifyRequest, reply: FastifyReply): void {
  const context = requestContext(request);
  void reply.status(404).send({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "The requested API route does not exist",
      requestId: context.requestId,
      correlationId: context.correlationId,
    },
  } satisfies PmsErrorEnvelope);
}

function classifyError(error: FastifyError): PublicError {
  if (error.validation !== undefined) {
    return { statusCode: 400, code: "INVALID_REQUEST", message: "Request validation failed" };
  }
  if (error instanceof PmsDomainError) return domainError(error.code);
  if (error instanceof PmsRepositoryError) return repositoryError(error.code);
  if (error instanceof ConfigurationCenterError) return configurationError(error.code);
  return { statusCode: 500, code: "INTERNAL_ERROR", message: "An internal error occurred" };
}

function configurationError(code: ConfigurationCenterErrorCode): PublicError {
  const statusCode =
    code === "RUNTIME_CONFIG_UNAUTHORIZED"
      ? 401
      : code === "RUNTIME_CONFIG_PROJECTION_INVALID"
        ? 500
        : code === "RUNTIME_CONFIG_IDENTITY_MISMATCH"
          ? 403
          : code === "CONFIGURATION_DEFINITION_NOT_FOUND" ||
              code === "CONFIGURATION_DRAFT_NOT_FOUND" ||
              code === "CONFIGURATION_REVISION_NOT_FOUND" ||
              code === "RUNTIME_CONFIG_NOT_FOUND"
            ? 404
            : code === "CONFIGURATION_BUSINESS_KEY_CONFLICT" ||
                code === "CONFIGURATION_DRAFT_VERSION_CONFLICT" ||
                code === "CONFIGURATION_DRAFT_NOT_VALIDATED" ||
                code === "CONFIGURATION_PUBLISH_CONFLICT"
              ? 409
              : 400;
  return { statusCode, code, message: CONFIGURATION_MESSAGES[code] };
}

function domainError(code: PmsDomainErrorCode): PublicError {
  return {
    statusCode: code === "RESOURCE_BINDING_NOT_FOUND" ? 404 : 400,
    code,
    message: DOMAIN_MESSAGES[code],
  };
}

function repositoryError(code: PmsRepositoryErrorCode): PublicError {
  const statusCode = code === "ENTITY_NOT_FOUND" ? 404 : code === "LEASE_NOT_OWNED" ? 409 : 409;
  return { statusCode, code, message: REPOSITORY_MESSAGES[code] };
}

const DOMAIN_MESSAGES: Readonly<Record<PmsDomainErrorCode, string>> = {
  INVALID_IDENTIFIER: "A supplied identifier is invalid",
  INVALID_DOMAIN_VALUE: "A supplied value is invalid",
  INVALID_STATE_TRANSITION: "The requested state transition is invalid",
  DUPLICATE_RESOURCE_BINDING: "The resource binding already exists",
  RESOURCE_BINDING_NOT_FOUND: "The resource binding does not exist",
};

const REPOSITORY_MESSAGES: Readonly<Record<PmsRepositoryErrorCode, string>> = {
  ENTITY_ALREADY_EXISTS: "The entity already exists",
  ENTITY_NOT_FOUND: "The entity does not exist",
  OPTIMISTIC_CONCURRENCY_CONFLICT: "The entity changed; reload and retry",
  LEASE_NOT_OWNED: "The lease is stale or is not owned",
};

const CONFIGURATION_MESSAGES: Readonly<Record<ConfigurationCenterErrorCode, string>> = {
  CONFIGURATION_DEFINITION_NOT_FOUND: "The configuration definition does not exist",
  CONFIGURATION_TARGET_NOT_ALLOWED: "The configuration target is not allowed",
  CONFIGURATION_BUSINESS_KEY_CONFLICT: "A draft already exists for this configuration target",
  CONFIGURATION_DRAFT_NOT_FOUND: "The configuration draft does not exist",
  CONFIGURATION_DRAFT_VERSION_CONFLICT: "The draft changed; reload and retry",
  CONFIGURATION_DRAFT_NOT_VALIDATED: "The draft must pass validation before publication",
  CONFIGURATION_PUBLISH_CONFLICT: "The published configuration changed; reload and retry",
  CONFIGURATION_REVISION_NOT_FOUND: "The configuration revision does not exist",
  CONFIGURATION_ROLLBACK_TARGET_MISMATCH:
    "The rollback source belongs to a different configuration target",
  RUNTIME_CONFIG_UNAUTHORIZED: "Runtime Config client authentication failed",
  RUNTIME_CONFIG_IDENTITY_MISMATCH:
    "The Runtime Config client is not authorized for the requested target",
  RUNTIME_CONFIG_NOT_FOUND: "No published Runtime configuration exists for this target",
  RUNTIME_CONFIG_PROJECTION_INVALID: "Published Runtime configuration cannot be projected safely",
  CONFIGURATION_INPUT_INVALID: "A configuration input is invalid",
};
