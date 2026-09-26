import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { FinalizedBusinessEvent } from "../../packages/persistence-postgres/src/index.js";
import {
  projectTaskBusinessFeedback,
  TASK_BUSINESS_EVENT_TYPE,
  TASK_BUSINESS_SOURCE_ID,
} from "../../packages/mcp-protocol/src/task-business-feedback.js";
import { TaskBusinessFeedbackBodySchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const identity = {
  taskId: "33333333-3333-4333-8333-333333333333",
  executionId: "execution-1",
  providerId: "isr.vehicle.ugv.ugv1",
  resourceId: "vehicle:ugv1",
  operationName: "vehicle_area_recon",
};
const sourceSchema = z.object({
  sourceId: z.literal(TASK_BUSINESS_SOURCE_ID),
  sourceEventId: z.string(),
  sourceSequence: z.string(),
  sourceStreamId: z.string(),
  scope: z.literal("task"),
  externalExecutionId: z.string(),
  occurredAt: z.iso.datetime(),
  eventType: z.literal(TASK_BUSINESS_EVENT_TYPE),
  rawPayload: TaskBusinessFeedbackBodySchema,
});
const source = sourceSchema.parse(
  JSON.parse(readFileSync("protocol/task-business/v1/examples/source-action-changed.json", "utf8")),
);

function finalized(): FinalizedBusinessEvent {
  return {
    providerId: identity.providerId,
    streamId: "22222222-2222-4222-8222-222222222222",
    sequence: "23",
    eventId: "ppppppppppppppppppppppppppppppppppppppppppp",
    sourceId: source.sourceId,
    sourceStreamId: source.sourceStreamId,
    sourceEventId: source.sourceEventId,
    sourceSequence: source.sourceSequence,
    eventType: source.eventType,
    occurredAt: new Date(source.occurredAt),
    scope: "task",
    description: "Camera lock observed",
    taskId: identity.taskId,
    resourceRef: null,
    candidateRelatedTaskCount: 1,
    severityHint: null,
    reasonCode: null,
    rawPayload: source.rawPayload,
  };
}

describe("task business source/public projection", () => {
  it("uses Runtime public sequence for resumption and source sequence only for provenance", () => {
    const projected = projectTaskBusinessFeedback(finalized(), identity);
    const expected: unknown = JSON.parse(
      readFileSync("protocol/task-business/v1/examples/public-action-changed.json", "utf8"),
    );
    expect(projected).toEqual(expected);
    expect(projected.resumeFrom.afterSequence).not.toBe(projected.sourceCursor.sourceSequence);
  });

  it("refuses unrelated task/provider identity and legacy source events", () => {
    expect(() =>
      projectTaskBusinessFeedback(finalized(), { ...identity, taskId: "other-task" }),
    ).toThrow("BUSINESS_EVENT_TASK_BINDING_INVALID");
    expect(() =>
      projectTaskBusinessFeedback({ ...finalized(), sourceId: "vehicle.execution" }, identity),
    ).toThrow("BUSINESS_EVENT_NOT_TASK_BUSINESS");
  });

  it("refuses source payloads that self-claim a public identity or contain a crossed kind", () => {
    expect(() =>
      projectTaskBusinessFeedback(
        { ...finalized(), rawPayload: { ...source.rawPayload, taskId: "forged" } },
        identity,
      ),
    ).toThrow("BUSINESS_PAYLOAD_INVALID");
    expect(() =>
      projectTaskBusinessFeedback(
        { ...finalized(), rawPayload: { ...source.rawPayload, kind: "ARTIFACT_CHANGED" } },
        identity,
      ),
    ).toThrow("BUSINESS_PAYLOAD_INVALID");
  });

  it("preserves an unknown optional kind as opaque data and rejects an unknown required kind", () => {
    const optional = {
      schemaVersion: source.rawPayload.schemaVersion,
      kind: "FUTURE_OPTIONAL_SENSOR_HINT",
      required: false,
      contextRevision: 3,
      providerRecordedAt: source.rawPayload.providerRecordedAt,
      payload: { hint: "display only" },
    };
    const projected = projectTaskBusinessFeedback(
      { ...finalized(), rawPayload: optional },
      identity,
    );
    expect(projected).toMatchObject(optional);
    expect(projected.messageId).toBe(finalized().eventId);
    expect(() =>
      projectTaskBusinessFeedback(
        { ...finalized(), rawPayload: { ...optional, required: true } },
        identity,
      ),
    ).toThrow("BUSINESS_PAYLOAD_INVALID");
    expect(() =>
      projectTaskBusinessFeedback(
        { ...finalized(), rawPayload: { ...optional, schemaVersion: "future-major" } },
        identity,
      ),
    ).toThrow("UNSUPPORTED_BUSINESS_SCHEMA_VERSION");
    expect(() =>
      projectTaskBusinessFeedback(
        { ...finalized(), rawPayload: { ...optional, kind: "ACTION_CHANGED" } },
        identity,
      ),
    ).toThrow("BUSINESS_PAYLOAD_INVALID");
  });
});
