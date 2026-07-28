import { randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  type AuditRepository,
} from "../../pms-domain/src/index.js";
import type {
  RuntimeRegistrationAuditEvent,
  RuntimeRegistrationAuditPort,
} from "../../runtime-registration/src/index.js";

/**
 * Maps registration audits to PMS AuditEvent without copying request credentials,
 * session IDs, secret references, or request payloads into durable metadata.
 */
export class PostgresRuntimeRegistrationAudit implements RuntimeRegistrationAuditPort {
  constructor(
    private readonly audit: AuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(event: RuntimeRegistrationAuditEvent): Promise<void> {
    return this.audit.append(
      createAuditEvent({
        auditEventId: auditEventId(randomUUID()),
        action: event.action,
        actorId: event.subjectId,
        correlationId: event.correlationId,
        subjectType: "runtime_registration",
        subjectId: `${event.deploymentId}:${event.instanceId}`,
        occurredAt: this.now(),
        metadata: Object.freeze({
          providerId: event.providerId,
          deploymentId: event.deploymentId,
          instanceId: event.instanceId,
          requestId: event.requestId,
          outcome: event.outcome,
          ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
          ...(event.revision === undefined ? {} : { revision: event.revision }),
        }),
      }),
    );
  }
}
