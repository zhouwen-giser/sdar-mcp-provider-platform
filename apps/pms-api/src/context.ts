import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface PmsRequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly actorId?: string;
}

const contexts = new WeakMap<FastifyRequest, PmsRequestContext>();
const SAFE_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function attachRequestContext(request: FastifyRequest, reply: FastifyReply): void {
  const requestId = normalizeHeader(request.headers["x-request-id"]) ?? request.id;
  const correlationId = normalizeHeader(request.headers["x-correlation-id"]) ?? randomUUID();
  const actorId = normalizeHeader(request.headers["x-actor-id"]);
  const context = Object.freeze({
    requestId,
    correlationId,
    ...(actorId === undefined ? {} : { actorId }),
  });
  contexts.set(request, context);
  void reply.header("x-request-id", requestId).header("x-correlation-id", correlationId);
}

export function requestContext(request: FastifyRequest): PmsRequestContext {
  const context = contexts.get(request);
  if (context === undefined) throw new Error("PMS_REQUEST_CONTEXT_MISSING");
  return context;
}

function normalizeHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value !== "string" || !SAFE_CONTEXT_ID.test(value)) return undefined;
  return value;
}
