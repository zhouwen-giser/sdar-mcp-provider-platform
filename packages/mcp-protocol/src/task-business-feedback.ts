import { parseBusinessEventSequence } from "../../adapter-protocol/src/index.js";
import type { FinalizedBusinessEvent } from "../../persistence-postgres/src/index.js";
import {
  RuntimeBusinessCursorSchema,
  SourceBusinessCursorSchema,
  parseTaskBusinessFeedbackBody,
  type OptionalTaskBusinessExtension,
  type RuntimeBusinessCursor,
  type SourceBusinessCursor,
  type TaskBusinessFeedbackBody,
  type TaskBusinessIdentity,
} from "../../vehicle-provider-core/src/task-business-contract.js";

export const TASK_BUSINESS_SOURCE_ID = "vehicle.business";
export const TASK_BUSINESS_EVENT_TYPE = "vehicle.business.changed";

export type PublicTaskBusinessFeedback = (
  TaskBusinessFeedbackBody | OptionalTaskBusinessExtension
) & {
  messageId: string;
  identity: TaskBusinessIdentity;
  resumeFrom: RuntimeBusinessCursor;
  sourceCursor: SourceBusinessCursor;
  sourceEventId: string;
  occurredAt: string;
};

/**
 * Project only an already finalized, authorized Runtime event. The caller obtains
 * identity from the Task/Execution binding, never from the source payload.
 */
export function projectTaskBusinessFeedback(
  event: FinalizedBusinessEvent,
  identity: TaskBusinessIdentity,
): PublicTaskBusinessFeedback {
  if (event.sourceId !== TASK_BUSINESS_SOURCE_ID || event.eventType !== TASK_BUSINESS_EVENT_TYPE) {
    throw new Error("BUSINESS_EVENT_NOT_TASK_BUSINESS");
  }
  if (
    event.scope !== "task" ||
    event.taskId !== identity.taskId ||
    event.providerId !== identity.providerId
  ) {
    throw new Error("BUSINESS_EVENT_TASK_BINDING_INVALID");
  }
  parseBusinessEventSequence(event.sequence);
  parseBusinessEventSequence(event.sourceSequence);
  const body = parseTaskBusinessFeedbackBody(event.rawPayload);
  const resumeFrom = RuntimeBusinessCursorSchema.parse({
    streamId: event.streamId,
    afterSequence: event.sequence,
  });
  const sourceCursor = SourceBusinessCursorSchema.parse({
    sourceId: event.sourceId,
    sourceStreamId: event.sourceStreamId,
    sourceSequence: event.sourceSequence,
  });
  return {
    ...body,
    messageId: event.eventId,
    identity,
    resumeFrom,
    sourceCursor,
    sourceEventId: event.sourceEventId,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/** Parse the public SSE notification using identity supplied by an authorized Task binding. */
export function normalizeTaskBusinessSseNotification(
  notification: unknown,
  identity: TaskBusinessIdentity,
): PublicTaskBusinessFeedback {
  if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
    throw new Error("BUSINESS_EVENT_NOTIFICATION_INVALID");
  }
  const envelope = notification as Record<string, unknown>;
  if (envelope.method !== "notifications/io.sdar/businessEvents") {
    throw new Error("BUSINESS_EVENT_NOTIFICATION_INVALID");
  }
  const params = envelope.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("BUSINESS_EVENT_NOTIFICATION_INVALID");
  }
  const value = params as Record<string, unknown>;
  if (
    value.sourceId !== TASK_BUSINESS_SOURCE_ID ||
    value.eventType !== TASK_BUSINESS_EVENT_TYPE ||
    value.scope !== "task" ||
    value.taskId !== identity.taskId ||
    typeof value.eventId !== "string" ||
    value.eventId.length === 0 ||
    typeof value.sourceEventId !== "string" ||
    value.sourceEventId.length === 0 ||
    typeof value.occurredAt !== "string"
  ) {
    throw new Error("BUSINESS_EVENT_TASK_BINDING_INVALID");
  }
  const resumeFrom = RuntimeBusinessCursorSchema.parse({
    streamId: value.streamId,
    afterSequence: value.sequence,
  });
  const sourceCursor = SourceBusinessCursorSchema.parse({
    sourceId: value.sourceId,
    sourceStreamId: value.sourceStreamId,
    sourceSequence: value.sourceSequence,
  });
  const body = parseTaskBusinessFeedbackBody(value.rawPayload);
  return {
    ...body,
    messageId: value.eventId,
    identity,
    resumeFrom,
    sourceCursor,
    sourceEventId: value.sourceEventId,
    occurredAt: value.occurredAt,
  };
}
