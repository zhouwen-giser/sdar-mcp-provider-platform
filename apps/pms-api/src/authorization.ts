import type { FastifyRequest } from "fastify";
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

function isProtectedManagementPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? "";
  if (!path.startsWith("/api/v1/") || path.startsWith("/api/v1/runtime-config/")) return false;
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
