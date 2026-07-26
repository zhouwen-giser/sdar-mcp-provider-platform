import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AuthorizationContext, ExecutionMode } from "../../domain/src/index.js";

export type AuthenticationOptions =
  | { mode: "development" }
  | { mode: "trusted_headers" }
  | {
      mode: "jwt_hs256";
      secret: string;
      issuer?: string;
      audience?: string;
    };

export type AuthorizationResolver = (request: IncomingMessage) => AuthorizationContext;

export function createAuthorizationResolver(options: AuthenticationOptions): AuthorizationResolver {
  return (request) => {
    const identity =
      options.mode === "jwt_hs256"
        ? jwtIdentity(request, options)
        : trustedIdentity(request, options.mode === "development");
    const modeHeader = header(request, "x-sdar-execution-mode") ?? "live";
    if (!isExecutionMode(modeHeader)) throw new Error("INVALID_EXECUTION_MODE");
    const simulationId = header(request, "x-sdar-simulation-id") ?? null;
    if ((modeHeader === "live") !== (simulationId === null)) {
      throw new Error("INVALID_SIMULATION_CONTEXT");
    }
    return {
      hash: createHash("sha256")
        .update(`${identity.tenant}\u0000${identity.subject}`)
        .digest("hex"),
      executionMode: modeHeader,
      simulationId,
      correlationId: correlationId(request),
    };
  };
}

function trustedIdentity(
  request: IncomingMessage,
  allowDevelopmentAnonymous: boolean,
): { subject: string; tenant: string } {
  const subject = header(request, "x-sdar-subject");
  const tenant = header(request, "x-sdar-tenant");
  if (!allowDevelopmentAnonymous && (subject === undefined || tenant === undefined)) {
    throw new Error("AUTHENTICATION_REQUIRED");
  }
  return {
    subject: subject ?? "development-anonymous",
    tenant: tenant ?? "default",
  };
}

function jwtIdentity(
  request: IncomingMessage,
  options: Extract<AuthenticationOptions, { mode: "jwt_hs256" }>,
): { subject: string; tenant: string } {
  const authorization = header(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("AUTHENTICATION_REQUIRED");
  }
  const token = authorization.slice(7);
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("INVALID_BEARER_TOKEN");
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];
  const tokenHeader = parseSegment(encodedHeader);
  if (tokenHeader.alg !== "HS256" || tokenHeader.typ !== "JWT") {
    throw new Error("UNSUPPORTED_JWT_ALGORITHM");
  }
  const expected = createHmac("sha256", options.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const signature = decodeCanonicalBase64Url(encodedSignature);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new Error("INVALID_BEARER_TOKEN");
  }
  const claims = parseSegment(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("JWT_EXPIRED");
  if (typeof claims.nbf === "number" && claims.nbf > now) throw new Error("JWT_NOT_ACTIVE");
  if (options.issuer !== undefined && claims.iss !== options.issuer) {
    throw new Error("INVALID_JWT_ISSUER");
  }
  if (options.audience !== undefined && !matchesAudience(claims.aud, options.audience)) {
    throw new Error("INVALID_JWT_AUDIENCE");
  }
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 256) {
    throw new Error("INVALID_JWT_SUBJECT");
  }
  const tenant = claims.tenant;
  if (typeof tenant !== "string" || tenant.length < 1 || tenant.length > 256) {
    throw new Error("INVALID_JWT_TENANT");
  }
  return { subject: claims.sub, tenant };
}

function parseSegment(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decodeCanonicalBase64Url(segment).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_BEARER_TOKEN");
  }
}

function decodeCanonicalBase64Url(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("INVALID_BEARER_TOKEN");
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment) throw new Error("INVALID_BEARER_TOKEN");
  return decoded;
}

function matchesAudience(claim: unknown, expected: string): boolean {
  return claim === expected || (Array.isArray(claim) && claim.includes(expected));
}

function correlationId(request: IncomingMessage): string {
  const supplied = header(request, "x-correlation-id");
  if (supplied === undefined) return randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) throw new Error("INVALID_CORRELATION_ID");
  return supplied;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isExecutionMode(value: string): value is ExecutionMode {
  return value === "live" || value === "simulation" || value === "historical-replay";
}
