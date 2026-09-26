import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  MemoryTaskBusinessStore,
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
  RequiredInputSchema,
  RuntimeInterventionSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = z
  .object({
    context: TaskBusinessContextSchema,
    artifacts: z.array(TaskArtifactSchema),
    action: BusinessActionSchema,
    requiredInput: RequiredInputSchema,
    intervention: RuntimeInterventionSchema,
  })
  .parse(
    JSON.parse(
      readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
    ) as unknown,
  );
const at = "2026-09-23T00:00:00Z";
const later = "2026-09-23T00:01:00Z";
const contentBytes = Buffer.from(
  JSON.stringify({
    type: "LineString",
    coordinates: [
      [116, 39],
      [116.1, 39.1],
    ],
  }),
);
const execution = (): ProviderExecution => ({
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
    simulationId: "scene-a",
    correlationId: "correlation-a",
  },
  deviceContext: {
    deviceId: "ugv1",
    dataScopeKey: "scene-a",
    bindingId: "binding-a",
    smppServiceKey: "smpp-service-a",
    providerId: catalog.context.identity.providerId,
    resourceId: catalog.context.identity.resourceId,
    sourceSessionKey: "source-session-a",
  },
  downstreamMissionIds: [],
  state: "RUNNING",
  revision: 1,
  reasonCode: "TEST_FIXTURE",
  createdAt: at,
  updatedAt: later,
  evidence: [],
});

function initial() {
  const scope = BoundExecutionScope.fromExecution(execution());
  const store = new MemoryTaskBusinessStore();
  const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
  if (!route) throw new Error("CATALOG_ROUTE_MISSING");
  const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
  const objects: BusinessObjectVersion[] = [
    { kind: "artifact", value: route },
    { kind: "action", value: catalog.action },
    { kind: "input_request", value: catalog.requiredInput },
    { kind: "intervention", value: catalog.intervention },
  ];
  return { scope, store, context, route, objects };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("CATALOG_REF_MISSING");
  return value;
}

describe("memory task business Store port", () => {
  it("rejects a Context revision whose recorded time moves backward", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const earlier = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      updatedAt: at,
    });
    await expect(
      store.commitChangeSet({ scope, expectedContextRevision: 1, context: earlier, objects: [] }),
    ).rejects.toThrow("BUSINESS_CONTEXT_TIME_REGRESSION");
    expect(await store.getContext(scope)).toEqual(context);
    const sameTime = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: sameTime,
      objects: [],
    });
    expect((await store.getContext(scope))?.contextRevision).toBe(2);
  });

  it("rejects malformed published Input and Intervention schemas without a Context or event", async () => {
    for (const kind of ["input_request", "intervention"] as const) {
      const { scope, store, context, objects } = initial();
      const invalid = objects.map((object) =>
        object.kind === kind
          ? {
              ...object,
              value: { ...object.value, inputSchema: { type: "not-a-json-schema-type" } },
            }
          : object,
      ) as BusinessObjectVersion[];
      const draft = {
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "BUSINESS_EVENT",
          contextRevision: 1,
          providerRecordedAt: later,
          payload: {
            eventType: "business.fixture_created",
            severity: "info",
            reasonCode: "TEST",
            description: "Fixture created",
          },
        }),
        description: "Fixture created",
        reasonCode: "TEST",
        severityHint: "info" as const,
      };
      await expect(
        store.commitBusinessChangeSet(
          { scope, expectedContextRevision: null, context, objects: invalid },
          [draft],
        ),
      ).rejects.toThrow(
        kind === "input_request" ? "INVALID_INPUT_SCHEMA" : "INVALID_INTERVENTION_SCHEMA",
      );
      expect(await store.getContext(scope)).toBeUndefined();
      expect(await store.getObjectVersion(scope, first(context.requiredInputRefs))).toBeUndefined();
      expect(await store.getObjectVersion(scope, first(context.interventionRefs))).toBeUndefined();
      const committed = await store.commitBusinessChangeSet(
        { scope, expectedContextRevision: null, context, objects },
        [draft],
      );
      expect(committed.events.map((event) => event.sourceSequence)).toEqual(["1"]);
    }
  });

  it("assigns independent event identities at one Context revision and rejects mismatched feedback before commit", async () => {
    const { scope, store, context, objects } = initial();
    const feedback = (contextRevision: number, eventType: string) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "BUSINESS_EVENT",
        contextRevision,
        providerRecordedAt: later,
        payload: { eventType, severity: "info", reasonCode: "TEST", description: eventType },
      }),
      description: eventType,
      reasonCode: "TEST",
      severityHint: "info" as const,
    });
    await expect(
      store.commitBusinessChangeSet({ scope, expectedContextRevision: null, context, objects }, [
        feedback(2, "test.wrong_revision"),
      ]),
    ).rejects.toThrow("BUSINESS_EVENT_CONTEXT_REVISION_MISMATCH");
    expect(await store.getContext(scope)).toBeUndefined();
    const committed = await store.commitBusinessChangeSet(
      { scope, expectedContextRevision: null, context, objects },
      [feedback(1, "test.first"), feedback(1, "test.second")],
    );
    expect(committed.context).toEqual(context);
    expect(committed.events.map((event) => event.sourceSequence)).toEqual(["1", "2"]);
    expect(new Set(committed.events.map((event) => event.sourceEventId)).size).toBe(2);
  });

  it("rejects inconsistent terminal event facts before committing the final Context", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const finalized = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      summary: { status: "finalized", resultCode: "COMPLETED" },
      activeRefs: {},
      updatedAt: later,
      finalizedAt: later,
    });
    const body = TaskBusinessFeedbackBodySchema.parse({
      schemaVersion: "sdar.task-business-feedback/1.0-rc2",
      kind: "CONTEXT_FINALIZED",
      contextRevision: 2,
      providerRecordedAt: later,
      payload: {
        reasonCode: "COMPLETED",
        finalContextRevision: 2,
        summary: finalized.summary,
        artifactRefs: finalized.artifactRefs,
        actionRefs: finalized.actionRefs,
        finalizedAt: later,
      },
    });
    if (body.kind !== "CONTEXT_FINALIZED") throw new Error("FINALIZATION_FIXTURE_INVALID");
    expect(
      TaskBusinessFeedbackBodySchema.safeParse({
        ...body,
        payload: { ...body.payload, summary: { status: "in_progress" } },
      }).success,
    ).toBe(false);
    const draft = (payload: typeof body.payload) => ({
      body: { ...body, payload },
      description: "Context finalized",
      reasonCode: "COMPLETED",
      severityHint: "info" as const,
    });
    const changeSet = { scope, expectedContextRevision: 1, context: finalized, objects: [] };
    for (const payload of [
      { ...body.payload, finalContextRevision: 3 },
      { ...body.payload, summary: { status: "finalized" as const, resultCode: "WRONG" } },
      { ...body.payload, artifactRefs: [] },
      { ...body.payload, actionRefs: [] },
      { ...body.payload, finalizedAt: at },
    ]) {
      await expect(store.commitBusinessChangeSet(changeSet, [draft(payload)])).rejects.toThrow(
        "BUSINESS_EVENT_FINALIZATION_MISMATCH",
      );
      expect(await store.getContext(scope)).toEqual(context);
    }
    const committed = await store.commitBusinessChangeSet(changeSet, [draft(body.payload)]);
    expect(committed.context).toEqual(finalized);
    expect(committed.events.map((event) => event.sourceSequence)).toEqual(["1"]);
  });

  it("atomically creates Context and several object kinds without requiring a Runtime Task row", async () => {
    const { scope, store, context, route, objects } = initial();
    expect(await store.getContext(scope)).toBeUndefined();
    expect(await store.getArtifactVersion(scope, route.artifactId, 1)).toBeUndefined();
    await expect(
      store.commitChangeSet({ scope, expectedContextRevision: null, context, objects }),
    ).resolves.toEqual(context);
    expect(await store.getContext(scope)).toEqual(context);
    expect(await store.getContextSnapshot(scope)).toMatchObject({ context });
    expect((await store.getContextSnapshot(scope))?.objects).toHaveLength(4);
    expect(await store.getArtifactVersion(scope, route.artifactId, 1)).toEqual(route);
    expect(await store.readArtifactContent(scope, route.artifactId, 1, new Date(at))).toMatchObject(
      {
        kind: "inline",
      },
    );
    expect(await store.getObjectVersion(scope, first(context.actionRefs))).toEqual(objects[1]);
    expect(await store.getObjectVersion(scope, first(context.requiredInputRefs))).toEqual(
      objects[2],
    );
    expect(await store.getObjectVersion(scope, first(context.interventionRefs))).toEqual(
      objects[3],
    );
    const returned = await store.getContext(scope);
    if (!returned) throw new Error("CONTEXT_MISSING");
    const returnedRoute = returned.activeRefs.route;
    if (!returnedRoute) throw new Error("CONTEXT_ROUTE_REF_MISSING");
    returnedRoute.revision = 999;
    expect((await store.getContext(scope))?.activeRefs.route?.revision).toBe(1);
  });

  it("rejects partial writes, duplicate versions and stale Context revisions", async () => {
    const { scope, store, context, route, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const route2 = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const context2 = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      activeRefs: {
        ...context.activeRefs,
        route: { kind: "artifact", id: route.artifactId, revision: 2 },
      },
      artifactRefs: [{ kind: "artifact", id: route.artifactId, revision: 2 }],
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: context2,
        objects: [
          { kind: "artifact", value: route2 },
          { kind: "artifact", value: route2 },
        ],
      }),
    ).rejects.toThrow("BUSINESS_OBJECT_DUPLICATE_IN_CHANGESET");
    expect(await store.getArtifactVersion(scope, route.artifactId, 2)).toBeUndefined();
    expect((await store.getContext(scope))?.contextRevision).toBe(1);

    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: context2,
        objects: [],
      }),
    ).rejects.toThrow("BUSINESS_CONTEXT_REF_NOT_FOUND");
    expect((await store.getContext(scope))?.contextRevision).toBe(1);
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: context2,
      objects: [{ kind: "artifact", value: route2 }],
    });
    expect(await store.getArtifactVersion(scope, route.artifactId, 1)).toEqual(route);
    expect(await store.getArtifactVersion(scope, route.artifactId, 2)).toEqual(route2);
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: { ...context2, contextRevision: 3 },
        objects: [],
      }),
    ).rejects.toThrow("BUSINESS_CONTEXT_REVISION_CONFLICT");
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 2,
        context: { ...context2, contextRevision: 3 },
        objects: [{ kind: "artifact", value: route2 }],
      }),
    ).rejects.toThrow("BUSINESS_OBJECT_REVISION_CONFLICT");
  });

  it("commits route, Action and Input versions under one Context revision", async () => {
    const { scope, store, context, route, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const route2 = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const action2 = BusinessActionSchema.parse({
      ...catalog.action,
      revision: 2,
      state: "active",
      startedAt: later,
    });
    const input2 = RequiredInputSchema.parse({ ...catalog.requiredInput, revision: 2 });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    const actionRef = { kind: "action" as const, id: action2.actionId, revision: 2 };
    const inputRef = { kind: "input_request" as const, id: input2.requestId, revision: 2 };
    const next = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      activeRefs: { ...context.activeRefs, route: routeRef, lock: actionRef, input: inputRef },
      artifactRefs: [routeRef],
      actionRefs: [actionRef],
      requiredInputRefs: [inputRef],
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [
        { kind: "artifact", value: route2 },
        { kind: "action", value: action2 },
        { kind: "input_request", value: input2 },
      ],
    });
    expect(await store.getContext(scope)).toEqual(next);
    expect(await store.getObjectVersion(scope, routeRef)).toEqual({
      kind: "artifact",
      value: route2,
    });
    expect(await store.getObjectVersion(scope, actionRef)).toEqual({
      kind: "action",
      value: action2,
    });
    expect(await store.getObjectVersion(scope, inputRef)).toEqual({
      kind: "input_request",
      value: input2,
    });
  });

  it("does not advance Context when an Input resolution predates its request", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const ref = {
      kind: "input_request" as const,
      id: catalog.requiredInput.requestId,
      revision: 2,
    };
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
        objects: [
          {
            kind: "input_request",
            value: {
              ...catalog.requiredInput,
              revision: 2,
              state: "expired",
              resolvedAt: "2026-09-22T23:59:59Z",
            },
          },
        ],
      }),
    ).rejects.toThrow("INPUT_RESOLUTION_BEFORE_REQUEST");
    expect(await store.getContext(scope)).toEqual(context);
    expect(await store.getObjectVersion(scope, ref)).toBeUndefined();
  });

  it("does not publish a user resolved Input without a claimed reply", async () => {
    for (const resolution of [
      { state: "answered", response: { action: "accept", value: { decision: "continue" } } },
      { state: "declined", response: { action: "decline" } },
      { state: "cancelled", response: { action: "cancel" } },
    ] as const) {
      const { scope, store, context, objects } = initial();
      await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
      const responseCommandId = `reply-${resolution.state}`;
      const input = RequiredInputSchema.parse({
        ...catalog.requiredInput,
        ...resolution,
        revision: 2,
        resolvedAt: later,
        responseCommandId,
      });
      const ref = { kind: "input_request" as const, id: input.requestId, revision: 2 };
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
          objects: [{ kind: "input_request", value: input }],
        }),
      ).rejects.toThrow("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
      expect(await store.getContext(scope)).toEqual(context);
      expect(await store.getObjectVersion(scope, ref)).toBeUndefined();

      const command = BusinessCommandRecordSchema.parse({
        commandId: responseCommandId,
        commandType: "input_response",
        entryKey: `input:${input.requestKey}`,
        runtimeCommandSequence: "91",
        identity: context.identity,
        requestHash: "a".repeat(64),
        responseHash: taskBusinessInputResponseHash(resolution.response),
        state: "accepted",
        createdAt: at,
        updatedAt: at,
      });
      expect(
        BusinessCommandRecordSchema.safeParse({ ...command, responseHash: undefined }).success,
      ).toBe(false);
      const priorRef = context.requiredInputRefs[0];
      if (!priorRef) throw new Error("INPUT_REF_MISSING");
      expect((await store.claimCommand(scope, command, priorRef, new Date(at))).claimed).toBe(true);
      await expect(
        store.commitChangeSet({
          scope,
          expectedContextRevision: 1,
          context: next,
          objects: [
            {
              kind: "input_request",
              value: { ...input, responseCommandId: "different-command" },
            },
          ],
        }),
      ).rejects.toThrow("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
      await expect(
        store.commitChangeSet({
          scope,
          expectedContextRevision: 1,
          context: next,
          objects: [
            {
              kind: "input_request",
              value: { ...input, response: { ...resolution.response, value: { altered: true } } },
            },
          ],
        }),
      ).rejects.toThrow("BUSINESS_INPUT_RESPONSE_MISMATCH");
      if (resolution.state === "answered") {
        await expect(
          store.commitChangeSet({
            scope,
            expectedContextRevision: 1,
            context: next,
            objects: [{ kind: "input_request", value: input }],
            command: {
              ...command,
              responseHash: "f".repeat(64),
              state: "rejected",
              resultCode: "LOCAL_ACTION_FAILED",
              updatedAt: later,
            },
          }),
        ).rejects.toThrow("COMMAND_ID_CONFLICT");
      }
      await store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: next,
        objects: [{ kind: "input_request", value: input }],
        ...(resolution.state === "answered"
          ? {
              command: {
                ...command,
                state: "rejected" as const,
                resultCode: "LOCAL_ACTION_FAILED",
                updatedAt: later,
              },
            }
          : {}),
      });
      expect(await store.getObjectVersion(scope, ref)).toEqual({
        kind: "input_request",
        value: input,
      });
      expect((await store.getCommand(scope, command.commandId))?.state).toBe(
        resolution.state === "answered" ? "rejected" : "accepted",
      );
    }
  });

  it("isolates identical Task/object IDs by authorization, mode, simulation, device and service", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const base = execution();
    const device = base.deviceContext;
    if (!device) throw new Error("CATALOG_DEVICE_CONTEXT_MISSING");
    expect(
      BoundExecutionScope.fromExecution({
        ...base,
        executionContext: { ...base.executionContext, executionMode: "SIMULATION" },
      }).key(),
    ).toBe(scope.key());
    const variants: ProviderExecution[] = [
      {
        ...base,
        executionContext: { ...base.executionContext, authorizationContextHash: "c".repeat(64) },
      },
      { ...base, executionContext: { ...base.executionContext, executionMode: "live" } },
      { ...base, executionContext: { ...base.executionContext, simulationId: "scene-b" } },
      { ...base, deviceContext: { ...device, deviceId: "ugv2" } },
      { ...base, deviceContext: { ...device, smppServiceKey: "other-service" } },
      { ...base, deviceContext: { ...device, sourceSessionKey: "other-session" } },
    ];
    for (const variant of variants) {
      const other = BoundExecutionScope.fromExecution(variant);
      expect(await store.getContext(other)).toBeUndefined();
      expect(await store.getObjectVersion(other, first(context.artifactRefs))).toBeUndefined();
    }
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: {
          ...context,
          contextRevision: 2,
          identity: { ...context.identity, executionId: "forged" },
        },
        objects: [],
      }),
    ).rejects.toThrow("BUSINESS_SCOPE_IDENTITY_MISMATCH");
  });

  it("claims a command once, detects commandId collision and commits its result with object versions", async () => {
    const { scope, store, context, objects, route } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const accepted = BusinessCommandRecordSchema.parse({
      commandId: "command-1",
      commandType: "intervention",
      entryKey: `intervention:${catalog.intervention.interventionId}`,
      identity: context.identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: true, record: accepted });
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: false, record: accepted });
    await expect(
      store.claimCommand(scope, { ...accepted, requestHash: "e".repeat(64) }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    const resultRoute = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const resultRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    const applied = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "applied",
      resultCode: "ROUTE_ADOPTED",
      resultRefs: [resultRef],
      updatedAt: later,
    });
    const falseResult = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      activeRefs: { ...context.activeRefs, route: resultRef },
      artifactRefs: [resultRef],
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: falseResult,
        objects: [{ kind: "artifact", value: resultRoute }],
        command: applied,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(1);
    expect(await store.getArtifactVersion(scope, route.artifactId, 2)).toBeUndefined();
    expect((await store.getCommand(scope, accepted.commandId))?.state).toBe("accepted");

    let current = context;
    for (const [revision, state] of [
      [2, "submitted"],
      [3, "applying"],
    ] as const) {
      const intervention = RuntimeInterventionSchema.parse({
        ...catalog.intervention,
        revision,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = { kind: "intervention" as const, id: intervention.interventionId, revision };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: revision,
        interventionRefs: [ref],
        activeRefs: { ...current.activeRefs, intervention: ref },
      });
      await store.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: intervention }],
      });
      current = next;
    }
    const finalIntervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      revision: 4,
      state: "applied",
      acceptedCommandId: accepted.commandId,
      resultRefs: [resultRef],
    });
    const finalRef = {
      kind: "intervention" as const,
      id: finalIntervention.interventionId,
      revision: finalIntervention.revision,
    };
    const next = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 4,
      effectivePlanRevision: context.effectivePlanRevision + 1,
      activeRefs: {
        ...Object.fromEntries(
          Object.entries(current.activeRefs).filter(([key]) => key !== "intervention"),
        ),
        route: resultRef,
      },
      artifactRefs: [resultRef],
      interventionRefs: [finalRef],
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: TaskBusinessContextSchema.parse({
          ...next,
          effectivePlanRevision: context.effectivePlanRevision,
        }),
        objects: [
          { kind: "artifact", value: resultRoute },
          { kind: "intervention", value: finalIntervention },
        ],
        command: applied,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: next,
        objects: [
          { kind: "artifact", value: resultRoute },
          { kind: "intervention", value: finalIntervention },
        ],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    const candidateRoute = TaskArtifactSchema.parse({
      ...resultRoute,
      properties: { ...resultRoute.properties, adoption: "candidate" },
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: next,
        objects: [
          { kind: "artifact", value: candidateRoute },
          { kind: "intervention", value: finalIntervention },
        ],
        command: applied,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    const oldActiveRoute = context.activeRefs.route;
    if (!oldActiveRoute) throw new Error("OLD_ACTIVE_ROUTE_MISSING");
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: TaskBusinessContextSchema.parse({
          ...next,
          activeRefs: { ...next.activeRefs, route: oldActiveRoute },
          artifactRefs: [oldActiveRoute, resultRef],
        }),
        objects: [
          { kind: "artifact", value: resultRoute },
          { kind: "intervention", value: finalIntervention },
        ],
        command: applied,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    const selfReferenced = RuntimeInterventionSchema.parse({
      ...finalIntervention,
      resultRefs: [finalRef],
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: TaskBusinessContextSchema.parse({
          ...current,
          contextRevision: 4,
          effectivePlanRevision: context.effectivePlanRevision + 1,
          activeRefs: Object.fromEntries(
            Object.entries(current.activeRefs).filter(([key]) => key !== "intervention"),
          ),
          interventionRefs: [finalRef],
        }),
        objects: [{ kind: "intervention", value: selfReferenced }],
        command: BusinessCommandRecordSchema.parse({
          ...applied,
          resultRefs: [finalRef],
        }),
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    const finalChange = {
      scope,
      expectedContextRevision: 3 as const,
      context: next,
      objects: [
        { kind: "artifact" as const, value: resultRoute },
        { kind: "intervention" as const, value: finalIntervention },
      ],
      command: applied,
    };
    await expect(store.commitChangeSet(finalChange)).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: next.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic plan applied",
      reasonCode: "TEST",
      severityHint: "info" as const,
    });
    const metadata = event("BUSINESS_EVENT", {
      eventType: "business.plan_applied",
      severity: "info",
      reasonCode: "TEST",
      description: "Synthetic plan applied",
      contextDelta: {
        activeRefs: next.activeRefs,
        effectivePlanRevision: next.effectivePlanRevision,
      },
    });
    const artifact = event("ARTIFACT_CHANGED", {
      change: "update",
      artifactRef: resultRef,
      previousRevision: 1,
      reasonCode: "TEST",
    });
    const intervention = event("INTERVENTION_CHANGED", {
      change: "update",
      interventionRef: finalRef,
      previousRevision: 3,
      reasonCode: "TEST",
    });
    await expect(store.commitBusinessChangeSet(finalChange, [metadata, artifact])).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    await expect(
      store.commitBusinessChangeSet(finalChange, [
        metadata,
        artifact,
        event("INTERVENTION_CHANGED", {
          change: "create",
          interventionRef: finalRef,
          reasonCode: "TEST",
        }),
      ]),
    ).rejects.toThrow("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
    await expect(
      store.commitBusinessChangeSet(finalChange, [
        metadata,
        artifact,
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: finalRef,
          previousRevision: 2,
          reasonCode: "TEST",
        }),
      ]),
    ).rejects.toThrow("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
    const committed = await store.commitBusinessChangeSet(finalChange, [
      metadata,
      artifact,
      intervention,
    ]);
    expect(committed.events).toHaveLength(3);
    expect(await store.getCommand(scope, accepted.commandId)).toEqual(applied);
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: false, record: applied });
    expect(await store.getArtifactVersion(scope, route.artifactId, 2)).toEqual(resultRoute);
  });

  it("publishes a rejected Intervention as failed without replacing the effective route", async () => {
    const { scope, store, context, route, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const offeredRef = first(context.interventionRefs);
    const accepted = BusinessCommandRecordSchema.parse({
      commandId: "failed-adjustment",
      commandType: "intervention",
      entryKey: `intervention:${offeredRef.id}`,
      identity: context.identity,
      requestHash: "f".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect((await store.claimCommand(scope, accepted, offeredRef, new Date(at))).claimed).toBe(
      true,
    );
    let current = context;
    for (const [revision, state] of [
      [2, "submitted"],
      [3, "applying"],
    ] as const) {
      const version = RuntimeInterventionSchema.parse({
        ...catalog.intervention,
        revision,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = { kind: "intervention" as const, id: version.interventionId, revision };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: revision,
        activeRefs: { ...current.activeRefs, intervention: ref },
        interventionRefs: [ref],
      });
      await store.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: version }],
      });
      current = next;
    }
    const failed = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      revision: 4,
      state: "failed",
      reasonCode: "REPLAN_FAILED",
      acceptedCommandId: accepted.commandId,
    });
    const failedRef = { kind: "intervention" as const, id: failed.interventionId, revision: 4 };
    const finalContext = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 4,
      activeRefs: Object.fromEntries(
        Object.entries(current.activeRefs).filter(([key]) => key !== "intervention"),
      ),
      interventionRefs: [failedRef],
    });
    const rejected = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "rejected",
      resultCode: "REPLAN_FAILED",
      updatedAt: later,
    });
    const finalChange = {
      scope,
      expectedContextRevision: 3 as const,
      context: finalContext,
      objects: [{ kind: "intervention" as const, value: failed }],
      command: rejected,
    };
    await expect(store.commitChangeSet({ ...finalChange, objects: [] })).rejects.toThrow(
      "BUSINESS_CONTEXT_REF_NOT_FOUND",
    );
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: finalContext,
        objects: [{ kind: "intervention", value: failed }],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    await expect(
      store.commitChangeSet({
        ...finalChange,
        context: TaskBusinessContextSchema.parse({
          ...finalContext,
          effectivePlanRevision: current.effectivePlanRevision + 1,
        }),
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    const otherRoute = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const otherRouteRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    await expect(
      store.commitChangeSet({
        ...finalChange,
        context: TaskBusinessContextSchema.parse({
          ...finalContext,
          activeRefs: { ...finalContext.activeRefs, route: otherRouteRef },
          artifactRefs: [...finalContext.artifactRefs, otherRouteRef],
        }),
        objects: [...finalChange.objects, { kind: "artifact", value: otherRoute }],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    await expect(store.commitChangeSet(finalChange)).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: finalContext.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic replan failure",
      reasonCode: "REPLAN_FAILED",
      severityHint: "warning" as const,
    });
    const metadata = event("BUSINESS_EVENT", {
      eventType: "business.plan_failed",
      severity: "warning",
      reasonCode: "REPLAN_FAILED",
      description: "Synthetic replan failure",
      contextDelta: {
        activeRefs: finalContext.activeRefs,
        effectivePlanRevision: finalContext.effectivePlanRevision,
      },
    });
    const changed = event("INTERVENTION_CHANGED", {
      change: "update",
      interventionRef: failedRef,
      previousRevision: 3,
      reasonCode: "REPLAN_FAILED",
    });
    await expect(store.commitBusinessChangeSet(finalChange, [metadata])).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    const committed = await store.commitBusinessChangeSet(finalChange, [metadata, changed]);
    expect(committed.events).toHaveLength(2);
    expect((await store.getContext(scope))?.effectivePlanRevision).toBe(
      context.effectivePlanRevision,
    );
    expect((await store.getContext(scope))?.activeRefs.route).toEqual(context.activeRefs.route);
    expect(await store.getCommand(scope, accepted.commandId)).toEqual(rejected);
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: false, record: rejected });
  });

  it("allows only one accepted plan adjustment across distinct available entries in one scope", async () => {
    const { scope, store, context, objects } = initial();
    const alternate = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      interventionId: "intervention-2",
    });
    const firstRef = first(context.interventionRefs);
    const alternateRef = {
      kind: "intervention" as const,
      id: alternate.interventionId,
      revision: 1,
    };
    const published = TaskBusinessContextSchema.parse({
      ...context,
      interventionRefs: [...context.interventionRefs, alternateRef],
      activeRefs: { ...context.activeRefs, alternateIntervention: alternateRef },
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context: published,
      objects: [...objects, { kind: "intervention", value: alternate }],
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId: "adjustment-a",
      commandType: "intervention",
      entryKey: `intervention:${firstRef.id}`,
      runtimeCommandSequence: "51",
      identity: context.identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    const second = BusinessCommandRecordSchema.parse({
      ...command,
      commandId: "adjustment-b",
      entryKey: `intervention:${alternateRef.id}`,
      runtimeCommandSequence: "52",
    });
    expect((await store.claimCommand(scope, command, firstRef, new Date(at))).claimed).toBe(true);
    expect((await store.claimCommand(scope, command, firstRef, new Date(at))).claimed).toBe(false);
    await expect(store.claimCommand(scope, second, alternateRef, new Date(at))).rejects.toThrow(
      "BUSINESS_CHANGE_IN_PROGRESS",
    );
    expect(await store.getCommand(scope, second.commandId)).toBeUndefined();
    const withdrawn = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      revision: 2,
      state: "withdrawn",
      reasonCode: "ADMISSION_REJECTED",
      acceptedCommandId: command.commandId,
    });
    const withdrawnRef = {
      kind: "intervention" as const,
      id: withdrawn.interventionId,
      revision: 2,
    };
    const next = TaskBusinessContextSchema.parse({
      ...published,
      contextRevision: 2,
      activeRefs: Object.fromEntries(
        Object.entries(published.activeRefs).filter(([key]) => key !== "intervention"),
      ),
      interventionRefs: [withdrawnRef, alternateRef],
    });
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: next.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic admission rejection",
      reasonCode: "ADMISSION_REJECTED",
      severityHint: "warning" as const,
    });
    await store.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: 1,
        context: next,
        objects: [{ kind: "intervention", value: withdrawn }],
        command: BusinessCommandRecordSchema.parse({
          ...command,
          state: "rejected",
          resultCode: "ADMISSION_REJECTED",
          updatedAt: later,
        }),
      },
      [
        event("BUSINESS_EVENT", {
          eventType: "business.plan_rejected",
          severity: "warning",
          reasonCode: "ADMISSION_REJECTED",
          description: "Synthetic admission rejection",
          contextDelta: {
            activeRefs: next.activeRefs,
            effectivePlanRevision: next.effectivePlanRevision,
          },
        }),
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: withdrawnRef,
          previousRevision: 1,
          reasonCode: "ADMISSION_REJECTED",
        }),
      ],
    );
    expect((await store.claimCommand(scope, second, alternateRef, new Date(at))).claimed).toBe(
      true,
    );
  });

  it("rechecks the effective plan inside an Intervention claim after Context changes", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 2,
        effectivePlanRevision: context.effectivePlanRevision + 1,
      }),
      objects: [],
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId: "stale-plan-adjustment",
      commandType: "intervention",
      entryKey: `intervention:${catalog.intervention.interventionId}`,
      runtimeCommandSequence: "53",
      identity: context.identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(
      store.claimCommand(scope, command, first(context.interventionRefs), new Date(at)),
    ).rejects.toThrow("PLAN_REVISION_CONFLICT");
    expect(await store.getCommand(scope, command.commandId)).toBeUndefined();
  });

  it("allows one winner for two simultaneous commits against one Context revision", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const next = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    const outcomes = await Promise.allSettled([
      store.commitChangeSet({ scope, expectedContextRevision: 1, context: next, objects: [] }),
      store.commitChangeSet({ scope, expectedContextRevision: 1, context: next, objects: [] }),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((await store.getContext(scope))?.contextRevision).toBe(2);
  });

  it("reads one exact content reference and reports expired, unavailable and missing versions", async () => {
    const { scope, store, context, objects } = initial();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const referenceFixture = catalog.artifacts.find((item) => item.artifactId === "route-ref");
    const unavailable = catalog.artifacts.find((item) => item.artifactId === "route-unavailable");
    if (
      referenceFixture?.availability !== "available" ||
      referenceFixture.content.kind !== "content_ref" ||
      !unavailable
    )
      throw new Error("CATALOG_ARTIFACT_MISSING");
    const reference = TaskArtifactSchema.parse({
      ...referenceFixture,
      content: {
        ...referenceFixture.content,
        sizeBytes: contentBytes.length,
        sha256: createHash("sha256").update(contentBytes).digest("hex"),
      },
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: { ...context, contextRevision: 2 },
      objects: [
        { kind: "artifact", value: reference },
        { kind: "artifact", value: unavailable },
      ],
      contents: [
        {
          artifactId: reference.artifactId,
          revision: 1,
          handle: "route-ref_1",
          bytes: contentBytes,
        },
      ],
    });
    expect(
      await store.readArtifactContent(scope, reference.artifactId, 1, new Date(at)),
    ).toMatchObject({ kind: "stored", handle: "route-ref_1" });
    expect(
      (await store.readArtifactContentBytes(scope, reference.artifactId, 1, new Date(at))).bytes,
    ).toEqual(Uint8Array.from(contentBytes));
    expect(await store.getArtifactLatest(scope, reference.artifactId)).toEqual(reference);
    await expect(
      store.readArtifactContent(scope, reference.artifactId, 1, new Date("2026-09-24T00:00:00Z")),
    ).rejects.toThrow("ARTIFACT_CONTENT_EXPIRED");
    await expect(
      store.readArtifactContent(scope, unavailable.artifactId, 1, new Date(at)),
    ).rejects.toThrow("ARTIFACT_NOT_AVAILABLE");
    await expect(
      store.readArtifactContent(scope, reference.artifactId, 2, new Date(at)),
    ).rejects.toThrow("ARTIFACT_REVISION_NOT_FOUND");
  });

  it("requires matching content bytes in the same commit and reads named representations", async () => {
    const { scope, store, context, route, objects } = initial();
    const referenceFixture = catalog.artifacts.find((item) => item.artifactId === "route-ref");
    if (
      referenceFixture?.availability !== "available" ||
      referenceFixture.content.kind !== "content_ref"
    ) {
      throw new Error("CATALOG_REFERENCE_MISSING");
    }
    const reference = TaskArtifactSchema.parse({
      ...referenceFixture,
      content: {
        ...referenceFixture.content,
        sizeBytes: contentBytes.length,
        sha256: createHash("sha256").update(contentBytes).digest("hex"),
      },
    });
    if (reference.availability !== "available" || reference.content.kind !== "content_ref") {
      throw new Error("REFERENCE_INVALID");
    }
    const change = {
      scope,
      expectedContextRevision: null,
      context,
      objects: [...objects, { kind: "artifact" as const, value: reference }],
    };
    await expect(store.commitChangeSet(change)).rejects.toThrow("ARTIFACT_CONTENT_BYTES_REQUIRED");
    await expect(
      store.commitChangeSet({
        ...change,
        contents: [
          {
            artifactId: reference.artifactId,
            revision: 1,
            handle: "route-ref_1",
            bytes: Buffer.from("bad"),
          },
        ],
      }),
    ).rejects.toThrow("ARTIFACT_CONTENT_SIZE_MISMATCH");
    expect(await store.getContext(scope)).toBeUndefined();
    await store.commitChangeSet({
      ...change,
      contents: [
        {
          artifactId: reference.artifactId,
          revision: 1,
          handle: "route-ref_1",
          bytes: contentBytes,
        },
      ],
    });
    const read = await store.readArtifactContentBytes(scope, reference.artifactId, 1, new Date(at));
    expect(read.bytes).toEqual(Uint8Array.from(contentBytes));
    read.bytes[0] = 0;
    expect(
      (await store.readArtifactContentBytes(scope, reference.artifactId, 1, new Date(at))).bytes,
    ).toEqual(Uint8Array.from(contentBytes));
    await expect(
      store.readArtifactContentBytes(
        scope,
        reference.artifactId,
        1,
        new Date("2026-09-24T00:00:00Z"),
      ),
    ).rejects.toThrow("ARTIFACT_CONTENT_EXPIRED");

    const route2 = TaskArtifactSchema.parse({
      ...route,
      revision: 2,
      representations: {
        download: {
          ...reference.content,
          artifactId: route.artifactId,
          revision: 2,
          handle: "route-representation-2",
        },
      },
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: { ...context, contextRevision: 2 },
      objects: [{ kind: "artifact", value: route2 }],
      contents: [
        {
          artifactId: route.artifactId,
          revision: 2,
          handle: "route-representation-2",
          bytes: contentBytes,
        },
      ],
    });
    expect(
      (await store.readArtifactContentBytes(scope, route.artifactId, 2, new Date(at), "download"))
        .bytes,
    ).toEqual(Uint8Array.from(contentBytes));
    await expect(
      store.readArtifactContent(scope, route.artifactId, 2, new Date(at), "missing"),
    ).rejects.toThrow("ARTIFACT_REPRESENTATION_NOT_FOUND");
  });

  it("pages oversized snapshots at one Context revision and retains exact versions after finalization", async () => {
    const { scope, store, context, route, objects } = initial();
    const oversized = TaskArtifactSchema.parse({
      ...route,
      representations: { large: { kind: "structured", value: { data: "x".repeat(1_100_000) } } },
    });
    const extra = Array.from({ length: 20 }, (_, index) =>
      TaskArtifactSchema.parse({
        ...route,
        artifactId: `route-extra-${index}`,
      }),
    );
    const fullContext = TaskBusinessContextSchema.parse({
      ...context,
      artifactRefs: [
        ...context.artifactRefs,
        ...extra.map((artifact) => ({
          kind: "artifact" as const,
          id: artifact.artifactId,
          revision: 1,
        })),
      ],
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context: fullContext,
      objects: [
        { kind: "artifact", value: oversized },
        ...objects.slice(1),
        ...extra.map((value) => ({ kind: "artifact" as const, value })),
      ],
    });
    await expect(store.getContextSnapshot(scope)).rejects.toThrow("BUSINESS_SNAPSHOT_TOO_LARGE");
    const seen = new Set<string>();
    let cursor: string | undefined;
    let staleCursor: string | undefined;
    do {
      const page = await store.getContextSnapshotPage(scope, 1_024, cursor);
      if (!page) throw new Error("SNAPSHOT_PAGE_MISSING");
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1_024);
      expect(page.contextRevision).toBe(1);
      for (const item of page.objects) {
        const ref =
          item.kind === "artifact"
            ? item.value.artifactId
            : item.kind === "action"
              ? item.value.actionId
              : item.kind === "input_request"
                ? item.value.requestId
                : item.value.interventionId;
        seen.add(`${item.kind}:${ref}`);
      }
      for (const descriptor of page.objectDescriptors) {
        seen.add(`${descriptor.ref.kind}:${descriptor.ref.id}`);
        expect(await store.getObjectVersion(scope, descriptor.ref)).toBeDefined();
      }
      staleCursor ??= page.nextCursor;
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(24);
    expect(staleCursor).toBeDefined();

    const finalized = TaskBusinessContextSchema.parse({
      ...fullContext,
      contextRevision: 2,
      summary: { status: "finalized", resultCode: "ARCHIVED" },
      activeRefs: {},
      finalizedAt: later,
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: finalized,
      objects: [],
    });
    await expect(store.getContextSnapshotPage(scope, 1_024, staleCursor)).rejects.toThrow(
      "BUSINESS_SNAPSHOT_REVISION_CHANGED",
    );
    expect((await store.getContext(scope))?.activeRefs).toEqual({});
    expect(await store.getObjectVersion(scope, first(context.actionRefs))).toEqual(objects[1]);
    expect(await store.getArtifactVersion(scope, route.artifactId, 1)).toEqual(oversized);
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 2,
        context: { ...finalized, contextRevision: 3 },
        objects: [],
      }),
    ).rejects.toThrow("BUSINESS_CONTEXT_FINALIZED");
  });
});
