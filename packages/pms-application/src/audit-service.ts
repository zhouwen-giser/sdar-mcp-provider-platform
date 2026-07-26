import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  type AuditEvent,
  type AuditRepository,
  type JsonObject,
} from "../../pms-domain/src/index.js";

export interface AuditContext {
  readonly actorId: string;
  readonly correlationId: string;
}

export interface RecordAuditInput {
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly metadata?: JsonObject;
}

export interface AuditServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class AuditService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    private readonly repository: AuditRepository,
    options: AuditServiceOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async record(context: AuditContext, input: RecordAuditInput): Promise<AuditEvent> {
    requireAuditContext(context);
    const event = createAuditEvent({
      auditEventId: auditEventId(this.#newId()),
      action: input.action,
      actorId: context.actorId,
      correlationId: context.correlationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      occurredAt: this.#now(),
      metadata: input.metadata ?? {},
    });
    await this.repository.append(event);
    return event;
  }
}

export function requireAuditContext(context: AuditContext): void {
  if (context.actorId.trim().length === 0 || context.correlationId.trim().length === 0) {
    throw new RangeError("PMS_AUDIT_CONTEXT_INVALID");
  }
}
