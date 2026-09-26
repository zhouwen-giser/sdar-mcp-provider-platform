import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  TASK_BUSINESS_CONTEXT_SCHEMA_VERSION,
  TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION,
  TASK_BUSINESS_PROFILE_VERSION,
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  taskBusinessCoreJsonSchemas,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const when = "2026-09-23T00:00:00Z";
const addFormats = addFormatsImport.default;
const common = {
  schemaVersion: TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION,
  contextRevision: 2,
  providerRecordedAt: when,
};

describe("task business core contract", () => {
  it("generates its JSON Schema from the same canonical Zod source", () => {
    const generated: unknown = JSON.parse(
      readFileSync("protocol/task-business/v1/core.schema.json", "utf8"),
    );
    expect(generated).toEqual({
      profileVersion: TASK_BUSINESS_PROFILE_VERSION,
      source: "packages/vehicle-provider-core/src/task-business-contract.ts",
      schemas: taskBusinessCoreJsonSchemas(),
    });
  });

  it("binds each kind to its own payload and rejects crossed object types", () => {
    const action = {
      ...common,
      kind: "ACTION_CHANGED",
      payload: {
        change: "create",
        actionRef: { kind: "action", id: "lock-1", revision: 1 },
        reasonCode: "LOCK_OBSERVED",
      },
    };
    expect(TaskBusinessFeedbackBodySchema.safeParse(action).success).toBe(true);
    expect(
      TaskBusinessFeedbackBodySchema.safeParse({ ...action, kind: "ARTIFACT_CHANGED" }).success,
    ).toBe(false);
    expect(
      TaskBusinessFeedbackBodySchema.safeParse({
        ...action,
        payload: {
          ...action.payload,
          actionRef: { kind: "artifact", id: "lock-1", revision: 1 },
        },
      }).success,
    ).toBe(false);
  });

  it("enforces the same discriminant through generated JSON Schema", () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const validate = ajv.compile(taskBusinessCoreJsonSchemas().feedbackBody);
    const action = {
      ...common,
      kind: "ACTION_CHANGED",
      payload: {
        change: "create",
        actionRef: { kind: "action", id: "lock-1", revision: 1 },
        reasonCode: "LOCK_OBSERVED",
      },
    };
    expect(validate(action)).toBe(true);
    expect(validate({ ...action, kind: "ARTIFACT_CHANGED" })).toBe(false);
  });

  it("can publish phase, summary and active refs as structured incremental metadata", () => {
    const activeRefs = { route: { kind: "artifact", id: "route-1", revision: 3 } };
    const summary = { status: "in_progress" };
    const phase = { code: "navigating", since: when };
    const event = {
      ...common,
      kind: "BUSINESS_EVENT",
      payload: {
        eventType: "navigation.route_adopted",
        severity: "info",
        reasonCode: "ROUTE_ADOPTED",
        description: "Route adoption observed",
        contextDelta: { phase, summary, activeRefs, effectivePlanRevision: 2 },
      },
    };
    expect(TaskBusinessFeedbackBodySchema.safeParse(event).success).toBe(true);
    expect(
      TaskBusinessContextSchema.safeParse({
        schemaVersion: TASK_BUSINESS_CONTEXT_SCHEMA_VERSION,
        identity: {
          taskId: "task-1",
          executionId: "execution-1",
          providerId: "provider-1",
          resourceId: "vehicle:ugv1",
          operationName: "vehicle_navigate",
        },
        contextRevision: 2,
        effectivePlanRevision: 2,
        phase,
        summary,
        activeRefs,
        artifactRefs: [activeRefs.route],
        actionRefs: [],
        requiredInputRefs: [],
        interventionRefs: [],
        updatedAt: when,
      }).success,
    ).toBe(true);
    expect(
      TaskBusinessFeedbackBodySchema.safeParse({
        ...event,
        payload: { ...event.payload, contextDelta: { phase: null, activeRefs: {} } },
      }).success,
    ).toBe(true);
  });
});
