import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  type AuditRepository,
} from "../../../packages/pms-domain/src/index.js";
import { requestContext } from "./context.js";

export type PmsApiRole = "reader" | "administrator";

export interface PmsApiPrincipal {
  readonly subjectId: string;
  readonly roles: readonly PmsApiRole[];
}

export interface PmsApiRoleAuthorizer {
  authenticate(credentials: { readonly authorization?: string }): Promise<PmsApiPrincipal>;
}

export type PmsApiAuthorizationErrorCode =
  "MANAGEMENT_AUTHENTICATION_REQUIRED" | "MANAGEMENT_AUTHORIZATION_DENIED";

export class PmsApiAuthorizationError extends Error {
  readonly code: PmsApiAuthorizationErrorCode;

  constructor(code: PmsApiAuthorizationErrorCode) {
    super(code);
    this.name = "PmsApiAuthorizationError";
    this.code = code;
  }
}

export class DenyPmsApiRoleAuthorizer implements PmsApiRoleAuthorizer {
  authenticate(): Promise<PmsApiPrincipal> {
    return Promise.reject(new PmsApiAuthorizationError("MANAGEMENT_AUTHENTICATION_REQUIRED"));
  }
}

export interface AuthenticationRejectionAuditEvent {
  readonly requestId: string;
  readonly correlationId: string;
  readonly deploymentId?: string;
  readonly instanceId?: string;
  readonly reasonCode: string;
  readonly sourceIp?: string;
}

export interface AuthenticationRejectionAuditPort {
  append(event: AuthenticationRejectionAuditEvent): Promise<void>;
}

/**
 * Deliberately records only correlation-safe authentication facts. In
 * particular, raw credentials, credential paths, request bodies, and database
 * details never become Audit metadata.
 */
export class PmsApiAuthenticationRejectionAudit implements AuthenticationRejectionAuditPort {
  constructor(
    private readonly audit: Pick<AuditRepository, "append">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(event: AuthenticationRejectionAuditEvent): Promise<void> {
    return this.audit.append(
      createAuditEvent({
        auditEventId: auditEventId(randomUUID()),
        action: "authentication.rejected",
        actorId: "unauthenticated",
        correlationId: event.correlationId,
        subjectType: "authentication",
        subjectId:
          event.deploymentId === undefined
            ? "management"
            : `${event.deploymentId}:${event.instanceId ?? "unknown"}`,
        occurredAt: this.now(),
        metadata: Object.freeze({
          requestId: event.requestId,
          correlationId: event.correlationId,
          ...(event.deploymentId === undefined ? {} : { deploymentId: event.deploymentId }),
          ...(event.instanceId === undefined ? {} : { instanceId: event.instanceId }),
          reasonCode: event.reasonCode,
          ...(event.sourceIp === undefined ? {} : { sourceIp: event.sourceIp }),
        }),
      }),
    );
  }
}

export async function authorizeManagementRequest(
  request: FastifyRequest,
  authorizer: PmsApiRoleAuthorizer,
): Promise<void> {
  if (!isProtectedManagementPath(request.url)) return;
  const principal = await authorizer.authenticate({
    ...(typeof request.headers.authorization === "string"
      ? { authorization: request.headers.authorization }
      : {}),
  });
  const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const allowed = write
    ? principal.roles.includes("administrator")
    : principal.roles.includes("reader") || principal.roles.includes("administrator");
  if (!allowed || principal.subjectId.trim().length === 0) {
    throw new PmsApiAuthorizationError("MANAGEMENT_AUTHORIZATION_DENIED");
  }
  if (write && requestContext(request).actorId !== principal.subjectId) {
    throw new PmsApiAuthorizationError("MANAGEMENT_AUTHORIZATION_DENIED");
  }
}

export async function auditAuthenticationRejection(
  audit: AuthenticationRejectionAuditPort | undefined,
  request: FastifyRequest,
  error: unknown,
  target: {
    readonly deploymentId?: string;
    readonly instanceId?: string;
  } = {},
): Promise<void> {
  if (audit === undefined) return;
  const context = requestContext(request);
  const reasonCode =
    error instanceof PmsApiAuthorizationError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? safeReasonCode((error as { readonly code?: unknown }).code)
        : "AUTHORIZATION_FAILED";
  await audit
    .append({
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(target.deploymentId === undefined ? {} : { deploymentId: target.deploymentId }),
      ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
      reasonCode,
      ...(request.ip.length === 0 ? {} : { sourceIp: request.ip }),
    })
    .catch(() => undefined);
}

function isProtectedManagementPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? "";
  if (
    !path.startsWith("/api/v1/") ||
    path.startsWith("/api/v1/runtime-config/") ||
    path.startsWith("/api/v1/runtime-registration/")
  )
    return false;
  return [
    "/api/v1/provider-packages",
    "/api/v1/provider-types",
    "/api/v1/providers",
    "/api/v1/resources",
    "/api/v1/config-drafts",
    "/api/v1/runtime-deployments",
    "/api/v1/runtime-processes",
    "/api/v1/registry",
    "/api/v1/audit-events",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function safeReasonCode(value: unknown): string {
  if (typeof value !== "string") return "AUTHORIZATION_FAILED";
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : "AUTHORIZATION_FAILED";
}
