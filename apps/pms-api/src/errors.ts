import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  ConfigurationCenterError,
  type ConfigurationCenterErrorCode,
} from "../../../packages/configuration-center/src/index.js";
import {
  RuntimeDeploymentApplicationError,
  RuntimeProcessQueryError,
  type RuntimeDeploymentApplicationErrorCode,
  type RuntimeProcessQueryErrorCode,
} from "../../../packages/pms-application/src/index.js";
import {
  PmsDomainError,
  PmsRepositoryError,
  type PmsDomainErrorCode,
  type PmsRepositoryErrorCode,
} from "../../../packages/pms-domain/src/index.js";
import {
  RuntimeDeploymentError,
  type RuntimeDeploymentErrorCode,
} from "../../../packages/runtime-deployment/src/index.js";
import { requestContext } from "./context.js";
import { PmsApiAuthorizationError, type PmsApiAuthorizationErrorCode } from "./authorization.js";
import {
  RuntimeRegistrationAuthorizationError,
  RuntimeRegistrationError,
  type RuntimeRegistrationAuthorizationErrorCode,
  type RuntimeRegistrationErrorCode,
} from "../../../packages/runtime-registration/src/index.js";

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
  if (error instanceof RuntimeDeploymentApplicationError) {
    return runtimeDeploymentApplicationError(error.code);
  }
  if (error instanceof RuntimeProcessQueryError) return runtimeProcessQueryError(error.code);
  if (error instanceof RuntimeDeploymentError) return runtimeDeploymentError(error.code);
  if (error instanceof PmsRepositoryError) return repositoryError(error.code);
  if (error instanceof ConfigurationCenterError) return configurationError(error);
  if (error instanceof PmsApiAuthorizationError) return authorizationError(error.code);
  if (error instanceof RuntimeRegistrationAuthorizationError) {
    return runtimeRegistrationAuthorizationError(error.code);
  }
  if (error instanceof RuntimeRegistrationError) return runtimeRegistrationError(error.code);
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return {
      statusCode: 413,
      code: "REQUEST_BODY_TOO_LARGE",
      message: "Request body exceeds the allowed size",
    };
  }
  if (
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
    error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
  ) {
    return { statusCode: 400, code: "INVALID_JSON", message: "Request body is not valid JSON" };
  }
  if (error instanceof SyntaxError && error.statusCode === 400) {
    return { statusCode: 400, code: "INVALID_JSON", message: "Request body is not valid JSON" };
  }
  return { statusCode: 500, code: "INTERNAL_ERROR", message: "An internal error occurred" };
}

function runtimeRegistrationAuthorizationError(
  code: RuntimeRegistrationAuthorizationErrorCode,
): PublicError {
  return {
    statusCode: code === "RUNTIME_REGISTRATION_UNAUTHORIZED" ? 401 : 403,
    code,
    message:
      code === "RUNTIME_REGISTRATION_UNAUTHORIZED"
        ? "Runtime registration authentication failed"
        : "Runtime registration token is not authorized for this instance and scope",
  };
}

function runtimeRegistrationError(code: RuntimeRegistrationErrorCode): PublicError {
  const statusCode = code === "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND" ? 404 : 409;
  return {
    statusCode,
    code,
    message:
      code === "RUNTIME_REGISTRATION_EXPECTED_INSTANCE_NOT_FOUND"
        ? "The expected Runtime instance does not exist"
        : "Runtime registration state does not match the expected instance",
  };
}

function runtimeDeploymentApplicationError(
  code: RuntimeDeploymentApplicationErrorCode,
): PublicError {
  const statusCode =
    code === "RUNTIME_DEPLOYMENT_NOT_FOUND"
      ? 404
      : code === "RUNTIME_DEPLOYMENT_REVISION_CONFLICT"
        ? 409
        : code === "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED"
          ? 400
          : 409;
  return { statusCode, code, message: RUNTIME_DEPLOYMENT_APPLICATION_MESSAGES[code] };
}

function runtimeDeploymentError(code: RuntimeDeploymentErrorCode): PublicError {
  const statusCode =
    code === "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" || code === "RUNTIME_DEPLOYMENT_STATE_CONFLICT"
      ? 409
      : 400;
  return { statusCode, code, message: RUNTIME_DEPLOYMENT_MESSAGES[code] };
}

function runtimeProcessQueryError(code: RuntimeProcessQueryErrorCode): PublicError {
  return { statusCode: 404, code, message: RUNTIME_PROCESS_QUERY_MESSAGES[code] };
}

function authorizationError(code: PmsApiAuthorizationErrorCode): PublicError {
  return {
    statusCode: code === "MANAGEMENT_AUTHENTICATION_REQUIRED" ? 401 : 403,
    code,
    message:
      code === "MANAGEMENT_AUTHENTICATION_REQUIRED"
        ? "Management authentication is required"
        : "The authenticated management principal is not authorized",
  };
}

function configurationError(error: ConfigurationCenterError): PublicError {
  const { code } = error;
  const statusCode =
    code === "RUNTIME_CONFIG_UNAUTHORIZED"
      ? runtimeConfigAuthorizationStatus(error)
      : code === "RUNTIME_CONFIG_PROJECTION_INVALID"
        ? 500
        : code === "RUNTIME_CONFIG_IDENTITY_MISMATCH"
          ? 403
          : code === "CONFIGURATION_DEFINITION_NOT_FOUND" ||
              code === "CONFIGURATION_DRAFT_NOT_FOUND" ||
              code === "CONFIGURATION_REVISION_NOT_FOUND" ||
              code === "RUNTIME_CONFIG_NOT_FOUND" ||
              code === "RUNTIME_CONFIG_ACK_REVISION_NOT_FOUND"
            ? 404
            : code === "CONFIGURATION_BUSINESS_KEY_CONFLICT" ||
                code === "CONFIGURATION_DRAFT_VERSION_CONFLICT" ||
                code === "CONFIGURATION_DRAFT_NOT_VALIDATED" ||
                code === "CONFIGURATION_PUBLISH_CONFLICT" ||
                code === "RUNTIME_CONFIG_ACK_CONFLICT"
              ? 409
              : 400;
  return { statusCode, code, message: CONFIGURATION_MESSAGES[code] };
}

function runtimeConfigAuthorizationStatus(error: ConfigurationCenterError): 401 | 403 {
  if (error.code !== "RUNTIME_CONFIG_UNAUTHORIZED") return 401;
  /**
   * The configuration-center contract intentionally shares this code for
   * opaque-token failures and missing scopes. File-backed production
   * credentials keep the scope diagnostic stable, so the HTTP boundary can
   * preserve the distinction without exposing credentials.
   */
  return error.message.includes("does not include required scope") ? 403 : 401;
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

const RUNTIME_DEPLOYMENT_APPLICATION_MESSAGES: Readonly<
  Record<RuntimeDeploymentApplicationErrorCode, string>
> = {
  RUNTIME_DEPLOYMENT_NOT_FOUND: "The RuntimeDeployment does not exist in Provider scope",
  RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE:
    "The Provider prerequisite is unavailable for this RuntimeDeployment",
  RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE:
    "The configuration prerequisite is unavailable for this RuntimeDeployment",
  RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE:
    "The database prerequisite is unavailable for this RuntimeDeployment",
  RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED:
    "The requested Runtime replica count is unsupported",
  RUNTIME_DEPLOYMENT_COMMAND_UNSUPPORTED:
    "The requested lifecycle command is not supported by this Runtime authority",
  RUNTIME_DEPLOYMENT_REVISION_CONFLICT:
    "The RuntimeDeployment desired revision changed; reload and retry",
};

const RUNTIME_DEPLOYMENT_MESSAGES: Readonly<Record<RuntimeDeploymentErrorCode, string>> = {
  INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER: "A RuntimeDeployment identifier is invalid",
  INVALID_RUNTIME_DEPLOYMENT_SPEC: "The RuntimeDeployment specification is invalid",
  INVALID_RUNTIME_DEPLOYMENT_TRANSITION: "The RuntimeDeployment transition is invalid",
  INVALID_RUNTIME_PROCESS_PROJECTION: "The Runtime process projection is invalid",
  RUNTIME_DEPLOYMENT_STATE_CONFLICT: "The RuntimeDeployment state changed; reload and retry",
  RUNTIME_DEPLOYMENT_REVISION_CONFLICT:
    "The RuntimeDeployment desired revision changed; reload and retry",
  RUNTIME_PROCESS_REVISION_CONFLICT: "The Runtime process revision changed; reload and retry",
};

const RUNTIME_PROCESS_QUERY_MESSAGES: Readonly<Record<RuntimeProcessQueryErrorCode, string>> = {
  RUNTIME_PROCESS_NOT_FOUND: "The Runtime process does not exist in Provider scope",
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
  RUNTIME_CONFIG_ACK_INVALID: "Runtime configuration acknowledgement is invalid",
  RUNTIME_CONFIG_ACK_CONFLICT:
    "The Runtime instance already acknowledged this revision differently",
  RUNTIME_CONFIG_ACK_REVISION_NOT_FOUND:
    "The acknowledged Runtime configuration revision does not exist",
  CONFIGURATION_INPUT_INVALID: "A configuration input is invalid",
};
