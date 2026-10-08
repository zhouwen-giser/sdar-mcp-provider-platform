import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { protoStructToJson } from "../../packages/adapter-protocol/src/index.js";
import {
  bootstrapTaskBusinessReducer,
  reduceTaskBusinessFeedback,
  unresolvedTaskBusinessRefs,
  type PublicTaskBusinessFeedback,
} from "../../packages/mcp-protocol/src/index.js";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  MemoryTaskBusinessStore,
  TaskBusinessCommandService,
  taskBusinessCommandRequestHash,
  taskBusinessInputResponseHash,
  type BusinessObjectVersion,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  BusinessActionSchema,
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = z
  .object({
    context: TaskBusinessContextSchema,
    artifacts: z.array(TaskArtifactSchema),
    action: BusinessActionSchema,
    requiredInput: RequiredInputSchema,
    intervention: RuntimeInterventionSchema,
    inputCommand: RequiredInputResponseCommandSchema,
    interventionCommand: RuntimeInterventionCommandSchema,
  })
  .parse(
    JSON.parse(
      readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
    ) as unknown,
  );
const at = "2026-09-23T00:00:00Z";
const later = "2026-09-23T00:01:00Z";
const responder = {
  source: "runtime_authorization_context",
  actorType: "user",
  verified: true,
} as const;

function execution(simulationId = "scene-a"): ProviderExecution {
  return {
    taskId: catalog.context.identity.taskId,
    externalExecutionId: catalog.context.identity.executionId,
    operationName: catalog.context.identity.operationName,
    argumentHash: "b".repeat(64),
    providerId: catalog.context.identity.providerId,
    resourceId: catalog.context.identity.resourceId,
    tracks: [],
    arguments: {},
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "simulation",
      simulationId,
      correlationId: "correlation-a",
    },
    downstreamMissionIds: [],
    state: "RUNNING",
    revision: 1,
    reasonCode: "TEST",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

async function fixture(
  simulationId = "scene-a",
  existing?: MemoryTaskBusinessStore,
  intervention = catalog.intervention,
) {
  const scope = BoundExecutionScope.fromExecution(execution(simulationId));
  const store = existing ?? new MemoryTaskBusinessStore();
  const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
  if (!route) throw new Error("CATALOG_ROUTE_MISSING");
  const objects: BusinessObjectVersion[] = [
    { kind: "artifact", value: route },
    { kind: "action", value: catalog.action },
    { kind: "input_request", value: catalog.requiredInput },
    { kind: "intervention", value: intervention },
  ];
  const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
  await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
  const service = new TaskBusinessCommandService(store, () => new Date(at));
  return { scope, store, service, context };
}

describe("task-business command ledger", () => {
  it("publishes an accepted Intervention as submitted with the Context and source events", async () => {
    const { scope, store, service, context } = await fixture("scene-submitted");
    const before = await store.getContextSnapshot(scope);
    if (!before) throw new Error("SUBMISSION_SNAPSHOT_MISSING");
    const initialReadModel = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: before.context.contextRevision,
          context: before.context,
          objects: before.objects,
          objectDescriptors: [],
        },
      ],
      { streamId: "submission-public-test", afterSequence: "0" },
    );
    const accepted = await service.submitIntervention({
      scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "20",
    });
    expect(accepted.claimed).toBe(true);
    expect(accepted.record.state).toBe("accepted");
    const current = await store.getContext(scope);
    expect(current?.contextRevision).toBe(2);
    expect(current?.effectivePlanRevision).toBe(context.effectivePlanRevision);
    expect(current?.activeRefs.route).toEqual(context.activeRefs.route);
    const ref = current?.activeRefs.intervention;
    expect(ref).toEqual({
      kind: "intervention",
      id: catalog.intervention.interventionId,
      revision: 2,
    });
    const version = ref ? await store.getObjectVersion(scope, ref) : undefined;
    expect(version).toMatchObject({
      kind: "intervention",
      value: { state: "submitted", acceptedCommandId: accepted.record.commandId, revision: 2 },
    });
    expect(accepted.events).toHaveLength(2);
    const bodies = accepted.events?.map((event) => protoStructToJson(event.rawPayload));
    expect(bodies).toMatchObject([
      {
        kind: "BUSINESS_EVENT",
        contextRevision: 2,
        payload: {
          contextDelta: {
            activeRefs: current?.activeRefs,
            effectivePlanRevision: context.effectivePlanRevision,
          },
        },
      },
      {
        kind: "INTERVENTION_CHANGED",
        contextRevision: 2,
        payload: { change: "update", interventionRef: ref, previousRevision: 1 },
      },
    ]);
    const testWrappedPublicEvents = (accepted.events ?? []).map(
      (event, index) =>
        ({
          ...TaskBusinessFeedbackBodySchema.parse(protoStructToJson(event.rawPayload)),
          identity: context.identity,
          messageId: `submission-public-${String(index + 1)}`,
          resumeFrom: { streamId: "submission-public-test", afterSequence: String(index + 1) },
          sourceCursor: {
            sourceId: "vehicle.business",
            sourceStreamId: event.sourceStreamId,
            sourceSequence: event.sourceSequence,
          },
          sourceEventId: event.sourceEventId,
          occurredAt: at,
        }) satisfies PublicTaskBusinessFeedback,
    );
    const readModel = testWrappedPublicEvents.reduce(reduceTaskBusinessFeedback, initialReadModel);
    expect(readModel.context.activeRefs).toEqual(current?.activeRefs);
    expect(readModel.context.interventionRefs).toEqual(current?.interventionRefs);
    expect(unresolvedTaskBusinessRefs(readModel)).toContainEqual(ref);
    const replay = await service.submitIntervention({
      scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "20",
    });
    expect(replay).toEqual({ claimed: false, record: accepted.record });
    expect((await store.getContext(scope))?.contextRevision).toBe(2);
  });

  it("persists an immutable recoverable intervention request bound to its semantic hash", async () => {
    const { scope, store, service } = await fixture();
    const accepted = await service.submitIntervention({
      scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "21",
    });
    expect(accepted.record.interventionRequest).toEqual(catalog.interventionCommand);
    expect(
      (await store.getCommand(scope, catalog.interventionCommand.commandId))?.interventionRequest,
    ).toEqual(catalog.interventionCommand);
    for (const change of [
      { input: { unexpected: true } },
      { taskId: "other-task" },
      { executionId: "other-execution" },
      { commandId: "other-command" },
    ])
      expect(
        BusinessCommandRecordSchema.safeParse({
          ...accepted.record,
          interventionRequest: { ...catalog.interventionCommand, ...change },
        }).success,
      ).toBe(false);
  });

  it("does not reserve an Input or Intervention entry for schema-invalid command content", async () => {
    const { scope, store, service } = await fixture();
    await expect(
      service.submitInputResponse({
        scope,
        command: { ...catalog.inputCommand, result: { action: "accept", value: {} } },
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "21",
      }),
    ).rejects.toThrow("INVALID_INPUT_RESPONSE");
    expect(await store.getCommand(scope, catalog.inputCommand.commandId)).toBeUndefined();
    expect(
      (
        await service.submitInputResponse({
          scope,
          command: catalog.inputCommand,
          responder,
          currentSubjectBinding: catalog.requiredInput.subjectBinding,
          runtimeCommandSequence: "21",
        })
      ).claimed,
    ).toBe(true);

    await expect(
      service.submitIntervention({
        scope,
        command: { ...catalog.interventionCommand, input: { viaPoints: "not-an-array" } },
        responder,
        runtimeCommandSequence: "22",
      }),
    ).rejects.toThrow("INVALID_INTERVENTION_INPUT");
    expect(await store.getCommand(scope, catalog.interventionCommand.commandId)).toBeUndefined();
    expect(
      (
        await service.submitIntervention({
          scope,
          command: catalog.interventionCommand,
          responder,
          runtimeCommandSequence: "22",
        })
      ).claimed,
    ).toBe(true);
  });

  it("replays the applied result before checking a now unavailable Input and rejects changed content", async () => {
    const { scope, store, service, context } = await fixture();
    const first = await service.submitInputResponse({
      scope,
      command: catalog.inputCommand,
      responder,
      currentSubjectBinding: catalog.requiredInput.subjectBinding,
      runtimeCommandSequence: "11",
    });
    expect(first.claimed).toBe(true);
    expect(first.record.responseHash).toBe(
      taskBusinessInputResponseHash(catalog.inputCommand.result),
    );
    expect(
      await store.getAcceptedInputCommand(scope, catalog.inputCommand.requestKey),
    ).toMatchObject({
      commandId: first.record.commandId,
      inputResponse: catalog.inputCommand.result,
      responder,
    });
    expect(first.nextDisposition).toBe("await_result");
    const answered = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      revision: 2,
      state: "answered",
      resolvedAt: later,
      responseCommandId: first.record.commandId,
      response: catalog.inputCommand.result,
    });
    const ref = { kind: "input_request" as const, id: answered.requestId, revision: 2 };
    const next = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      requiredInputRefs: [ref],
      activeRefs: { ...context.activeRefs, input: ref },
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: next,
        objects: [{ kind: "input_request", value: answered }],
        command: {
          ...first.record,
          state: "applied",
          responder: {
            source: "runtime_development_policy",
            actorType: "development_anonymous",
            verified: false,
          },
          resultCode: "APPLIED",
          resultRefs: [ref],
          updatedAt: later,
        },
      }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [{ kind: "input_request", value: answered }],
      command: {
        ...first.record,
        state: "applied",
        resultCode: "APPLIED",
        resultRefs: [ref],
        updatedAt: later,
      },
    });
    expect(
      await store.getAcceptedInputCommand(scope, catalog.inputCommand.requestKey),
    ).toBeUndefined();
    const replay = await service.submitInputResponse({
      scope,
      command: catalog.inputCommand,
      responder,
      currentSubjectBinding: catalog.requiredInput.subjectBinding,
      runtimeCommandSequence: "11",
    });
    expect(replay).toMatchObject({
      claimed: false,
      record: { state: "applied", resultRefs: [ref] },
    });
    await expect(
      service.submitInputResponse({
        scope,
        command: { ...catalog.inputCommand, result: { action: "decline" } },
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "11",
      }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    await expect(
      service.submitInputResponse({
        scope,
        command: catalog.inputCommand,
        responder: { ...responder, verified: false },
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "11",
      }),
    ).rejects.toThrow("RESPONDER_NOT_AUTHORIZED");
  });

  it("allows semantic Input guard after unrelated Context change and fences competing commands", async () => {
    const { scope, store, service, context } = await fixture();
    const advanced = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: advanced,
      objects: [],
    });
    const first = await service.submitInputResponse({
      scope,
      command: catalog.inputCommand,
      responder,
      currentSubjectBinding: catalog.requiredInput.subjectBinding,
      runtimeCommandSequence: "12",
    });
    expect(first.claimed).toBe(true);
    await expect(
      service.submitInputResponse({
        scope,
        command: { ...catalog.inputCommand, commandId: "competing-input" },
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "13",
      }),
    ).rejects.toThrow("BUSINESS_ENTRY_ALREADY_CLAIMED");
    await expect(
      store.claimCommand(scope, {
        ...first.record,
        commandId: "duplicate-runtime-sequence",
        entryKey: "input:other-key",
      }),
    ).rejects.toThrow("RUNTIME_COMMAND_SEQUENCE_CONFLICT");
    await expect(
      service.submitInputResponse({
        scope,
        command: {
          ...catalog.inputCommand,
          commandId: "legacy-command",
          guard: { mode: "legacy_strict", expectedContextRevision: 1 },
        },
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "14",
      }),
    ).rejects.toThrow("CONTEXT_REVISION_CONFLICT");
  });

  it("rechecks legacy strict Context revision when Context advances between preflight and claim", async () => {
    for (const kind of ["input", "intervention"] as const) {
      const { scope, store, service, context } = await fixture(`scene-strict-race-${kind}`);
      const originalClaim = store.claimCommand.bind(store);
      let advanced = false;
      store.claimCommand = async (...args: Parameters<MemoryTaskBusinessStore["claimCommand"]>) => {
        if (!advanced) {
          advanced = true;
          await store.commitChangeSet({
            scope,
            expectedContextRevision: 1,
            context: TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 }),
            objects: [],
          });
        }
        return originalClaim(...args);
      };
      if (kind === "input") {
        await expect(
          service.submitInputResponse({
            scope,
            command: {
              ...catalog.inputCommand,
              guard: { mode: "legacy_strict", expectedContextRevision: 1 },
            },
            responder,
            currentSubjectBinding: catalog.requiredInput.subjectBinding,
            runtimeCommandSequence: "61",
          }),
        ).rejects.toThrow("CONTEXT_REVISION_CONFLICT");
        expect(await store.getCommand(scope, catalog.inputCommand.commandId)).toBeUndefined();
      } else {
        await expect(
          service.submitIntervention({
            scope,
            command: {
              ...catalog.interventionCommand,
              guard: { mode: "legacy_strict", expectedContextRevision: 1 },
            },
            responder,
            runtimeCommandSequence: "62",
          }),
        ).rejects.toThrow("CONTEXT_REVISION_CONFLICT");
        expect(
          await store.getCommand(scope, catalog.interventionCommand.commandId),
        ).toBeUndefined();
      }
    }
  });

  it("rejects new expired entries while replaying a previously accepted command", async () => {
    const current = await fixture("scene-expired-input");
    const deadline = catalog.requiredInput.deadlineAt;
    if (!deadline) throw new Error("CATALOG_DEADLINE_MISSING");
    const afterDeadline = new TaskBusinessCommandService(current.store, () => new Date(deadline));
    await expect(
      afterDeadline.submitInputResponse({
        scope: current.scope,
        command: catalog.inputCommand,
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "51",
      }),
    ).rejects.toThrow("INPUT_DEADLINE_EXPIRED");
    expect(
      await current.store.getCommand(current.scope, catalog.inputCommand.commandId),
    ).toBeUndefined();
    const inputRef = current.context.requiredInputRefs[0];
    if (!inputRef) throw new Error("INPUT_REF_MISSING");
    const directInput = BusinessCommandRecordSchema.parse({
      commandId: "direct-expired-input",
      commandType: "input_response",
      entryKey: `input:${catalog.requiredInput.requestKey}`,
      runtimeCommandSequence: "50",
      identity: current.context.identity,
      requestHash: taskBusinessCommandRequestHash(catalog.inputCommand),
      responseHash: taskBusinessInputResponseHash(catalog.inputCommand.result),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(
      current.store.claimCommand(current.scope, directInput, inputRef, new Date(deadline)),
    ).rejects.toThrow("INPUT_DEADLINE_EXPIRED");

    const accepted = await current.service.submitInputResponse({
      scope: current.scope,
      command: catalog.inputCommand,
      responder,
      currentSubjectBinding: catalog.requiredInput.subjectBinding,
      runtimeCommandSequence: "51",
    });
    expect(accepted.claimed).toBe(true);
    const replay = await afterDeadline.submitInputResponse({
      scope: current.scope,
      command: catalog.inputCommand,
      responder,
      currentSubjectBinding: catalog.requiredInput.subjectBinding,
      runtimeCommandSequence: "51",
    });
    expect(replay).toMatchObject({
      claimed: false,
      record: { commandId: accepted.record.commandId },
    });

    const boundedIntervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      validUntil: later,
    });
    const adjustment = await fixture("scene-expired-adjustment", undefined, boundedIntervention);
    const afterValidUntil = new TaskBusinessCommandService(adjustment.store, () => new Date(later));
    await expect(
      afterValidUntil.submitIntervention({
        scope: adjustment.scope,
        command: catalog.interventionCommand,
        responder,
        runtimeCommandSequence: "52",
      }),
    ).rejects.toThrow("INTERVENTION_EXPIRED");
    expect(
      await adjustment.store.getCommand(adjustment.scope, catalog.interventionCommand.commandId),
    ).toBeUndefined();
    const interventionRef = adjustment.context.interventionRefs[0];
    if (!interventionRef) throw new Error("INTERVENTION_REF_MISSING");
    const directIntervention = BusinessCommandRecordSchema.parse({
      commandId: "direct-expired-intervention",
      commandType: "intervention",
      entryKey: `intervention:${catalog.intervention.interventionId}`,
      runtimeCommandSequence: "53",
      identity: adjustment.context.identity,
      requestHash: taskBusinessCommandRequestHash(catalog.interventionCommand),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(
      adjustment.store.claimCommand(
        adjustment.scope,
        directIntervention,
        interventionRef,
        new Date(later),
      ),
    ).rejects.toThrow("INTERVENTION_EXPIRED");
  });

  it("rejects a new Input response against a cancelled latest revision kept in Context history", async () => {
    const { scope, store, service, context } = await fixture();
    const cancelled = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      revision: 2,
      state: "cancelled",
      resolvedAt: later,
    });
    const ref = { kind: "input_request" as const, id: cancelled.requestId, revision: 2 };
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 2,
        requiredInputRefs: [...context.requiredInputRefs, ref],
        activeRefs: Object.fromEntries(
          Object.entries(context.activeRefs).filter(([key]) => key !== "input"),
        ),
      }),
      objects: [{ kind: "input_request", value: cancelled }],
    });
    await expect(
      service.submitInputResponse({
        scope,
        command: catalog.inputCommand,
        responder,
        currentSubjectBinding: catalog.requiredInput.subjectBinding,
        runtimeCommandSequence: "31",
      }),
    ).rejects.toThrow("INPUT_NOT_PENDING");
    expect(await store.getCommand(scope, catalog.inputCommand.commandId)).toBeUndefined();
  });

  it("rejects a new Intervention command against a submitted latest revision kept in Context history", async () => {
    const { scope, store, service, context } = await fixture();
    const submitted = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      revision: 2,
      state: "submitted",
      acceptedCommandId: "earlier-command",
    });
    const ref = { kind: "intervention" as const, id: submitted.interventionId, revision: 2 };
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 2,
        interventionRefs: [...context.interventionRefs, ref],
        activeRefs: Object.fromEntries(
          Object.entries(context.activeRefs).filter(([key]) => key !== "intervention"),
        ),
      }),
      objects: [{ kind: "intervention", value: submitted }],
    });
    await expect(
      service.submitIntervention({
        scope,
        command: catalog.interventionCommand,
        responder,
        runtimeCommandSequence: "32",
      }),
    ).rejects.toThrow("INTERVENTION_NOT_AVAILABLE");
    expect(await store.getCommand(scope, catalog.interventionCommand.commandId)).toBeUndefined();
  });

  it("fences a claim against an entry changed after preflight while allowing unrelated Context revisions", async () => {
    const { scope, store, context } = await fixture();
    const ref = context.requiredInputRefs[0];
    if (!ref) throw new Error("INPUT_REF_MISSING");
    const unrelated = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: unrelated,
      objects: [],
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId: "claim-before-invalidation",
      commandType: "input_response",
      entryKey: `input:${catalog.requiredInput.requestKey}`,
      runtimeCommandSequence: "41",
      identity: context.identity,
      requestHash: taskBusinessCommandRequestHash(catalog.inputCommand),
      responseHash: taskBusinessInputResponseHash(catalog.inputCommand.result),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect((await store.claimCommand(scope, command, ref, new Date(at))).claimed).toBe(true);
    const cancelled = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      revision: 2,
      state: "cancelled",
      resolvedAt: later,
    });
    const cancelledRef = { kind: "input_request" as const, id: cancelled.requestId, revision: 2 };
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 2,
      context: TaskBusinessContextSchema.parse({
        ...unrelated,
        contextRevision: 3,
        requiredInputRefs: [...unrelated.requiredInputRefs, cancelledRef],
        activeRefs: { ...unrelated.activeRefs, input: cancelledRef },
      }),
      objects: [{ kind: "input_request", value: cancelled }],
    });
    const stale = {
      ...command,
      commandId: "claim-after-invalidation",
      runtimeCommandSequence: "42",
    };
    await expect(store.claimCommand(scope, stale, ref, new Date(at))).rejects.toThrow(
      "BUSINESS_ENTRY_NOT_CURRENT",
    );
    expect(await store.getCommand(scope, stale.commandId)).toBeUndefined();
  });

  it("isolates command IDs by bound simulation and hashes only semantic request fields", async () => {
    const store = new MemoryTaskBusinessStore();
    const a = await fixture("scene-a", store);
    const b = await fixture("scene-b", store);
    const first = await a.service.submitIntervention({
      scope: a.scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "21",
    });
    const second = await b.service.submitIntervention({
      scope: b.scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "21",
    });
    expect(first.claimed && second.claimed).toBe(true);
    expect(taskBusinessCommandRequestHash(catalog.interventionCommand)).toBe(
      taskBusinessCommandRequestHash({ ...catalog.interventionCommand, commandId: "another-id" }),
    );
    expect(taskBusinessCommandRequestHash(catalog.interventionCommand)).not.toBe(
      taskBusinessCommandRequestHash({
        ...catalog.interventionCommand,
        input: { viaPoints: [[117, 40]] },
      }),
    );
  });
});
