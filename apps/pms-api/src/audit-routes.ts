import type { FastifyInstance } from "fastify";
import type { AuditRepository } from "../../../packages/pms-domain/src/index.js";

interface AuditListQuery {
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly correlationId?: string;
  readonly occurredBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export function registerAuditRoutes(
  app: FastifyInstance,
  repository: Pick<AuditRepository, "list">,
): void {
  app.get<{ Querystring: AuditListQuery }>(
    "/api/v1/audit-events",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            subjectType: identifier(),
            subjectId: identifier(),
            correlationId: identifier(),
            occurredBefore: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            cursor: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const result = await repository.list({
        limit: request.query.limit ?? 100,
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.subjectType === undefined
          ? {}
          : { subjectType: request.query.subjectType }),
        ...(request.query.subjectId === undefined ? {} : { subjectId: request.query.subjectId }),
        ...(request.query.correlationId === undefined
          ? {}
          : { correlationId: request.query.correlationId }),
        ...(request.query.occurredBefore === undefined
          ? {}
          : { occurredBefore: new Date(request.query.occurredBefore) }),
      });
      return {
        items: result.items.map((event) => ({
          auditEventId: event.auditEventId,
          action: event.action,
          actorId: event.actorId,
          correlationId: event.correlationId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          occurredAt: event.occurredAt.toISOString(),
        })),
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    },
  );
}

function identifier() {
  return { type: "string", minLength: 1, maxLength: 128 };
}
