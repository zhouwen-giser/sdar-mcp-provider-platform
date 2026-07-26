import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
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
  return { statusCode: 500, code: "INTERNAL_ERROR", message: "An internal error occurred" };
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
