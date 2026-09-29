import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  BusinessActionSchema,
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
  TASK_BUSINESS_ACTION_SCHEMA_VERSION,
  TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION,
  TASK_BUSINESS_INPUT_SCHEMA_VERSION,
  TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION,
  TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION,
  assertActionTransition,
  assertInterventionCommand,
  assertInterventionTransition,
  assertRequiredInputTransition,
  assessRequiredInputResponse,
  taskBusinessInteractionJsonSchemas,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { TASK_BUSINESS_PROFILE_VERSION } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const at = "2026-09-23T00:00:00Z";
const later = "2026-09-23T00:00:01Z";
const identity = {
  taskId: "task-1",
  executionId: "execution-1",
  providerId: "provider-1",
  resourceId: "vehicle:ugv1",
  operationName: "vehicle_area_recon",
};
const subjectBinding = {
  kind: "visual_lock",
  targetId: "target-1",
  lockSessionId: "lock-session-1",
  actionRef: { kind: "action", id: "lock-1", revision: 2 },
} as const;
const pending = RequiredInputSchema.parse({
  schemaVersion: TASK_BUSINESS_INPUT_SCHEMA_VERSION,
  requestId: "request-1",
  requestKey: "request-key-1",
  inputType: "target.disposition_decision",
  identity,
  revision: 2,
  blocking: true,
  state: "pending",
  requiredResponder: "user",
  subjectBinding,
  waitingPolicy: "pause_execution",
  onExpire: "release_and_resume_scan",
  onDismiss: "release_and_resume_scan",
  onDecline: "end_observation",
  title: "Choose target disposition",
  inputSchema: { type: "object", required: ["decision"] },
  reasonCode: "USER_DECISION_REQUIRED",
  requestedAt: at,
});
const inputCommand = RequiredInputResponseCommandSchema.parse({
  schemaVersion: TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION,
  commandId: "command-1",
  taskId: identity.taskId,
  executionId: identity.executionId,
  requestId: pending.requestId,
  requestKey: pending.requestKey,
  guard: { mode: "semantic", expectedRequestRevision: 2 },
  result: { action: "accept", value: { decision: "continue_observation" } },
});
const verifiedUser = {
  source: "runtime_authorization_context" as const,
  actorType: "user" as const,
  verified: true,
};
const intervention = RuntimeInterventionSchema.parse({
  schemaVersion: TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION,
  interventionId: "adjust-1",
  interventionType: "navigation.adjust_plan",
  identity,
  revision: 2,
  effectivePlanRevision: 5,
  blocking: false,
  state: "available",
  title: "Adjust route",
  inputSchema: { type: "object", properties: { viaPoints: { type: "array" } } },
  appliesTo: [{ kind: "artifact", id: "route-1", revision: 3 }],
  reasonCode: "ROUTE_ADJUSTMENT_SUPPORTED",
  createdAt: at,
});
const interventionCommand = RuntimeInterventionCommandSchema.parse({
  schemaVersion: TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION,
  commandId: "adjust-command-1",
  taskId: identity.taskId,
  executionId: identity.executionId,
  interventionId: intervention.interventionId,
  guard: {
    mode: "semantic",
    expectedInterventionRevision: 2,
    expectedEffectivePlanRevision: 5,
  },
  input: { viaPoints: [[116, 39]] },
});

describe("task business interactions", () => {
  it("requires an exact command ID on a caller-resolved Input", () => {
    expect(
      RequiredInputSchema.safeParse({
        ...pending,
        state: "answered",
        revision: 3,
        resolvedAt: later,
        response: { action: "accept", value: { decision: "continue_observation" } },
      }).success,
    ).toBe(false);
    expect(
      RequiredInputSchema.safeParse({
        ...pending,
        state: "answered",
        revision: 3,
        resolvedAt: later,
        responseCommandId: inputCommand.commandId,
        response: { action: "accept", value: { decision: "continue_observation" } },
      }).success,
    ).toBe(true);
  });

  it("generates Action/Input/Intervention and Command JSON Schemas", () => {
    expect(
      JSON.parse(readFileSync("protocol/task-business/v1/interaction.schema.json", "utf8")),
    ).toEqual({
      profileVersion: TASK_BUSINESS_PROFILE_VERSION,
      source: "packages/vehicle-provider-core/src/task-business-interaction.ts",
      schemas: taskBusinessInteractionJsonSchemas(),
    });
  });

  it("keeps visual lock requested, active and failed distinct", () => {
    const requested = BusinessActionSchema.parse({
      schemaVersion: TASK_BUSINESS_ACTION_SCHEMA_VERSION,
      actionId: "lock-1",
      actionType: "sensor.visual_lock",
      identity,
      revision: 1,
      state: "requested",
      actor: { type: "device" },
      triggerOrigin: "device_automatic",
      reasonCode: "LOCK_REQUESTED",
      requestedAt: at,
    });
    const active = BusinessActionSchema.parse({
      ...requested,
      revision: 2,
      state: "active",
      reasonCode: "LOCK_CONFIRMED",
      startedAt: later,
    });
    expect(() => assertActionTransition(requested, active)).not.toThrow();
    const lost = BusinessActionSchema.parse({
      ...active,
      revision: 3,
      state: "failed",
      reasonCode: "VISUAL_LOCK_LOST",
      endReason: "VISUAL_LOCK_LOST",
      endedAt: "2026-09-23T00:00:02Z",
    });
    expect(() => assertActionTransition(active, lost)).not.toThrow();
    expect(() => assertActionTransition(lost, { ...lost, revision: 4 })).toThrow(
      "ACTION_STATE_TRANSITION_INVALID",
    );
    expect(BusinessActionSchema.safeParse({ ...lost, state: "completed" }).success).toBe(false);
    const firstObservedActive = BusinessActionSchema.parse({
      ...active,
      revision: 1,
      requestedAt: undefined,
      actor: { type: "device" },
      triggerOrigin: "unknown",
    });
    expect(firstObservedActive.requestedAt).toBeUndefined();
    expect(
      BusinessActionSchema.safeParse({
        ...firstObservedActive,
        actor: { type: "provider" },
      }).success,
    ).toBe(false);
  });

  it("uses request revision and subject binding despite unrelated Context updates", () => {
    expect(
      assessRequiredInputResponse(
        pending,
        inputCommand,
        verifiedUser,
        99,
        subjectBinding,
        new Date(at),
      ),
    ).toEqual({ outcome: "accept", nextDisposition: "await_result" });
    expect(() =>
      assessRequiredInputResponse(
        pending,
        { ...inputCommand, guard: { mode: "semantic", expectedRequestRevision: 1 } },
        verifiedUser,
        99,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("REQUEST_REVISION_CONFLICT");
    expect(() =>
      assessRequiredInputResponse(
        pending,
        inputCommand,
        verifiedUser,
        99,
        { ...subjectBinding, lockSessionId: "new-session" },
        new Date(at),
      ),
    ).toThrow("SUBJECT_NO_LONGER_VALID");
    expect(() =>
      assessRequiredInputResponse(
        pending,
        { ...inputCommand, guard: { mode: "legacy_strict", expectedContextRevision: 2 } },
        verifiedUser,
        99,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("CONTEXT_REVISION_CONFLICT");
  });

  it("requires Runtime-verified human identity and rejects self-claimed actor fields", () => {
    expect(
      RequiredInputResponseCommandSchema.safeParse({
        ...inputCommand,
        respondedBy: { type: "user", actorId: "forged" },
      }).success,
    ).toBe(false);
    expect(() =>
      assessRequiredInputResponse(
        pending,
        inputCommand,
        { ...verifiedUser, verified: false },
        3,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("RESPONDER_NOT_AUTHORIZED");
    expect(() =>
      assessRequiredInputResponse(
        pending,
        inputCommand,
        { ...verifiedUser, actorType: "agent" },
        3,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("RESPONDER_NOT_AUTHORIZED");
  });

  it("validates an accepted Input value against its persisted request schema", () => {
    expect(() =>
      assessRequiredInputResponse(
        pending,
        { ...inputCommand, result: { action: "accept", value: {} } },
        verifiedUser,
        3,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("INVALID_INPUT_RESPONSE");
    expect(() =>
      assessRequiredInputResponse(
        { ...pending, inputSchema: { type: "not-a-json-schema-type" } },
        inputCommand,
        verifiedUser,
        3,
        subjectBinding,
        new Date(at),
      ),
    ).toThrow("INVALID_INPUT_SCHEMA");
    expect(() =>
      assessRequiredInputResponse(
        pending,
        { ...inputCommand, result: { action: "cancel" } },
        verifiedUser,
        3,
        subjectBinding,
        new Date(at),
      ),
    ).not.toThrow();
  });

  it("maps input cancel to its explicit dismiss policy and preserves request identity", () => {
    expect(
      assessRequiredInputResponse(
        pending,
        { ...inputCommand, result: { action: "cancel" } },
        verifiedUser,
        3,
        subjectBinding,
        new Date(at),
      ),
    ).toEqual({ outcome: "cancel", nextDisposition: "release_and_resume_scan" });
    const cancelled = RequiredInputSchema.parse({
      ...pending,
      revision: 3,
      state: "cancelled",
      resolvedAt: later,
      responseCommandId: inputCommand.commandId,
      response: { action: "cancel" },
    });
    expect(() => assertRequiredInputTransition(pending, cancelled)).not.toThrow();
    expect(
      RequiredInputSchema.safeParse({
        ...pending,
        revision: 3,
        state: "cancelled",
        resolvedAt: later,
      }).success,
    ).toBe(true);
    expect(() =>
      assertRequiredInputTransition(pending, { ...cancelled, requestKey: "reused-other-key" }),
    ).toThrow("INPUT_IDENTITY_CHANGED");
    expect(() =>
      assertRequiredInputTransition(pending, {
        ...cancelled,
        inputSchema: { type: "object", required: ["different"] },
      }),
    ).toThrow("NEW_REQUEST_REQUIRED");
  });

  it("keeps an Input request's creation time and an Intervention entry's expiry immutable", () => {
    const answered = RequiredInputSchema.parse({
      ...pending,
      revision: 3,
      state: "answered",
      resolvedAt: later,
      responseCommandId: inputCommand.commandId,
      response: { action: "accept", value: { decision: "continue_observation" } },
    });
    expect(() => assertRequiredInputTransition(pending, answered)).not.toThrow();
    expect(() =>
      assertRequiredInputTransition(pending, { ...answered, requestedAt: later }),
    ).toThrow("NEW_REQUEST_REQUIRED");

    const bounded = RuntimeInterventionSchema.parse({ ...intervention, validUntil: later });
    const submitted = RuntimeInterventionSchema.parse({
      ...bounded,
      revision: 3,
      state: "submitted",
      acceptedCommandId: interventionCommand.commandId,
    });
    expect(() => assertInterventionTransition(bounded, submitted)).not.toThrow();
    expect(() =>
      assertInterventionTransition(bounded, {
        ...submitted,
        validUntil: "2026-09-23T00:00:02Z",
      }),
    ).toThrow("NEW_INTERVENTION_REQUIRED");
    expect(() =>
      assertInterventionTransition(bounded, {
        ...submitted,
        createdAt: "2026-09-22T00:00:00Z",
      }),
    ).toThrow("NEW_INTERVENTION_REQUIRED");
  });

  it("rejects an Input resolution recorded before its request", () => {
    const resolvedBeforeRequest = "2026-09-22T23:59:59Z";
    for (const resolved of [
      {
        state: "answered",
        response: { action: "accept", value: { decision: "continue_observation" } },
      },
      { state: "expired" },
    ]) {
      const result = RequiredInputSchema.safeParse({
        ...pending,
        ...resolved,
        resolvedAt: resolvedBeforeRequest,
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.message)).toContain(
          "INPUT_RESOLUTION_BEFORE_REQUEST",
        );
    }
    expect(
      RequiredInputSchema.safeParse({
        ...pending,
        state: "expired",
        resolvedAt: pending.requestedAt,
      }).success,
    ).toBe(true);
  });

  it("orders interaction timestamps at their declared submillisecond precision", () => {
    const first = "2026-09-23T00:00:00.000001Z";
    const second = "2026-09-23T00:00:00.000002Z";
    const action = {
      schemaVersion: TASK_BUSINESS_ACTION_SCHEMA_VERSION,
      actionId: "precision-lock",
      actionType: "sensor.visual_lock",
      identity,
      revision: 1,
      state: "active",
      actor: { type: "device" },
      triggerOrigin: "device_automatic",
      reasonCode: "LOCK_CONFIRMED",
      requestedAt: first,
      startedAt: second,
    };
    expect(BusinessActionSchema.safeParse(action).success).toBe(true);
    expect(
      BusinessActionSchema.safeParse({ ...action, requestedAt: second, startedAt: first }).success,
    ).toBe(false);
    expect(
      BusinessActionSchema.safeParse({
        ...action,
        state: "completed",
        endReason: "LOCK_COMPLETE",
        endedAt: first,
      }).success,
    ).toBe(false);
    expect(
      RequiredInputSchema.safeParse({ ...pending, requestedAt: first, deadlineAt: second }).success,
    ).toBe(true);
    expect(
      RequiredInputSchema.safeParse({ ...pending, requestedAt: second, deadlineAt: first }).success,
    ).toBe(false);
    expect(
      RequiredInputSchema.safeParse({
        ...pending,
        requestedAt: second,
        state: "expired",
        resolvedAt: first,
      }).success,
    ).toBe(false);
    expect(
      RuntimeInterventionSchema.safeParse({ ...intervention, createdAt: first, validUntil: second })
        .success,
    ).toBe(true);
    expect(
      RuntimeInterventionSchema.safeParse({ ...intervention, createdAt: second, validUntil: first })
        .success,
    ).toBe(false);
    expect(
      RuntimeInterventionSchema.safeParse({
        ...intervention,
        createdAt: "2026-09-23T08:00:00.000001+08:00",
        validUntil: second,
      }).success,
    ).toBe(true);
  });

  it("rejects a new response or adjustment at the exact expiry instant", () => {
    const boundedInput = RequiredInputSchema.parse({ ...pending, deadlineAt: later });
    expect(() =>
      assessRequiredInputResponse(
        boundedInput,
        inputCommand,
        verifiedUser,
        3,
        subjectBinding,
        new Date(later),
      ),
    ).toThrow("INPUT_DEADLINE_EXPIRED");
    const boundedIntervention = RuntimeInterventionSchema.parse({
      ...intervention,
      validUntil: later,
    });
    expect(() =>
      assertInterventionCommand(boundedIntervention, interventionCommand, 3, 5, new Date(later)),
    ).toThrow("INTERVENTION_EXPIRED");
  });

  it("guards intervention on its own revision and effective plan, not trajectory Context changes", () => {
    expect(() =>
      assertInterventionCommand(intervention, interventionCommand, 99, 5, new Date(at)),
    ).not.toThrow();
    expect(() =>
      assertInterventionCommand(intervention, interventionCommand, 99, 6, new Date(at)),
    ).toThrow("PLAN_REVISION_CONFLICT");
    expect(() =>
      assertInterventionCommand(
        intervention,
        {
          ...interventionCommand,
          guard: {
            mode: "semantic",
            expectedInterventionRevision: 1,
            expectedEffectivePlanRevision: 5,
          },
        },
        99,
        5,
        new Date(at),
      ),
    ).toThrow("INTERVENTION_REVISION_CONFLICT");
    expect(() =>
      assertInterventionCommand(
        intervention,
        { ...interventionCommand, guard: { mode: "legacy_strict", expectedContextRevision: 2 } },
        99,
        5,
        new Date(at),
      ),
    ).toThrow("CONTEXT_REVISION_CONFLICT");
  });

  it("validates Intervention input before accepting a plan adjustment", () => {
    expect(() =>
      assertInterventionCommand(
        intervention,
        { ...interventionCommand, input: { viaPoints: "not-an-array" } },
        3,
        5,
        new Date(at),
      ),
    ).toThrow("INVALID_INTERVENTION_INPUT");
    expect(() =>
      assertInterventionCommand(
        { ...intervention, inputSchema: { type: "not-a-json-schema-type" } },
        interventionCommand,
        3,
        5,
        new Date(at),
      ),
    ).toThrow("INVALID_INTERVENTION_SCHEMA");
  });

  it("does not consume an intervention on a rejected command and permits one accepted command", () => {
    expect(() =>
      assertInterventionCommand(
        intervention,
        { ...interventionCommand, interventionId: "wrong-entry" },
        3,
        5,
        new Date(at),
      ),
    ).toThrow("INTERVENTION_BINDING_INVALID");
    expect(intervention.state).toBe("available");
    const submitted = RuntimeInterventionSchema.parse({
      ...intervention,
      revision: 3,
      state: "submitted",
      acceptedCommandId: interventionCommand.commandId,
    });
    expect(() => assertInterventionTransition(intervention, submitted)).not.toThrow();
    expect(() =>
      assertInterventionTransition(submitted, {
        ...submitted,
        revision: 4,
        state: "applying",
        acceptedCommandId: "different-command",
      }),
    ).toThrow("INTERVENTION_COMMAND_CHANGED");
    const failed = RuntimeInterventionSchema.parse({
      ...submitted,
      revision: 4,
      state: "failed",
      reasonCode: "DEVICE_APPLY_FAILED",
    });
    expect(() => assertInterventionTransition(submitted, failed)).not.toThrow();
    expect(RuntimeInterventionSchema.safeParse({ ...submitted, state: "applied" }).success).toBe(
      false,
    );
  });

  it("rejects a claimed actor in generated Command JSON Schema too", () => {
    const ajv = new Ajv2020({ strict: true });
    addFormatsImport.default(ajv);
    const commandSchema = taskBusinessInteractionJsonSchemas().inputCommand;
    if (!commandSchema) throw new Error("INPUT_COMMAND_SCHEMA_MISSING");
    const validate = ajv.compile(commandSchema);
    expect(validate(inputCommand)).toBe(true);
    expect(validate({ ...inputCommand, respondedBy: { type: "user" } })).toBe(false);
  });
});
