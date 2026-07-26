import type { AuditEvent } from "../entities.js";
import type { Page, PageRequest } from "./common.js";

export interface AuditQuery extends PageRequest {
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly correlationId?: string;
  readonly occurredBefore?: Date;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(query: AuditQuery): Promise<Page<AuditEvent>>;
}
