import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bootstrapTaskBusinessReducer,
  reduceTaskBusinessFeedback,
  unresolvedTaskBusinessRefs,
  type PublicTaskBusinessFeedback,
} from "../../packages/mcp-protocol/src/index.js";
import {
  parseTaskBusinessFeedbackBody,
  TaskBusinessContextSchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  context: unknown;
  feedback: unknown[];
  optionalExtension: unknown;
  artifacts: Record<string, unknown>[];
  action: Record<string, unknown>;
  requiredInput: Record<string, unknown>;
  intervention: Record<string, unknown>;
};
const context = TaskBusinessContextSchema.parse(catalog.context);
const route = catalog.artifacts.find((artifact) => artifact.artifactId === "route-line");
if (!route) throw new Error("TEST_ROUTE_MISSING");
const snapshotObjects = [
  { kind: "artifact", value: route },
  { kind: "action", value: catalog.action },
  { kind: "input_request", value: catalog.requiredInput },
  { kind: "intervention", value: catalog.intervention },
];
const streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1008";
const resumeFrom = { streamId, afterSequence: "10" };

function snapshot() {
  return bootstrapTaskBusinessReducer(
    [
      {
        contextRevision: 4,
        context,
        objects: snapshotObjects.slice(0, 2),
        objectDescriptors: [],
        nextCursor: "page-2",
      },
      { contextRevision: 4, context, objects: snapshotObjects.slice(2), objectDescriptors: [] },
    ],
    resumeFrom,
  );
}

function feedback(
  index: number,
  publicSequence: number,
  contextRevision = 5,
): PublicTaskBusinessFeedback {
  const raw = catalog.feedback[index];
  if (!raw || typeof raw !== "object") throw new Error("TEST_FEEDBACK_MISSING");
  const body = parseTaskBusinessFeedbackBody({ ...raw, contextRevision });
  return {
    ...body,
    ...(index === 5
      ? {
          payload: {
            ...(body.payload as Record<string, unknown>),
            finalContextRevision: contextRevision,
          },
        }
      : {}),
    identity: context.identity,
    messageId: `public-message-${publicSequence}`,
    resumeFrom: { streamId, afterSequence: String(publicSequence) },
    sourceCursor: {
      sourceId: "vehicle.business",
      sourceStreamId,
      sourceSequence: String(publicSequence - 10),
    },
    sourceEventId: `source-${publicSequence}`,
    occurredAt: "2026-09-23T00:01:00Z",
  } as PublicTaskBusinessFeedback;
}

describe("pure public TaskBusiness reducer", () => {
  it("advances its public resume cursor without rolling back on delayed events", () => {
    const initial = snapshot();
    const advanced = reduceTaskBusinessFeedback(initial, feedback(0, 13, 5));
    expect(advanced.resumeFrom).toEqual({ streamId, afterSequence: "13" });
    const delayed = reduceTaskBusinessFeedback(advanced, feedback(0, 11, 4));
    expect(delayed.resumeFrom).toEqual(advanced.resumeFrom);
    expect(initial.resumeFrom).toEqual(resumeFrom);
  });

  it("applies every distinct message at one Context revision and leaves the input immutable", () => {
    const initial = snapshot();
    const event = feedback(0, 11);
    const changed = {
      ...event,
      payload: {
        ...(event.payload as Record<string, unknown>),
        contextDelta: {
          phase: { code: "recon.locking", since: "2026-09-23T00:02:00Z" },
          activeRefs: {},
          effectivePlanRevision: 3,
        },
      },
    } as PublicTaskBusinessFeedback;
    let state = reduceTaskBusinessFeedback(initial, changed);
    expect(state.context.phase?.code).toBe("recon.locking");
    expect(state.context.activeRefs).toEqual({});
    for (let index = 1; index <= 4; index += 1) {
      state = reduceTaskBusinessFeedback(state, feedback(index, index + 11));
    }
    expect(state.seenMessageIds.size).toBe(5);
    expect(state.context.contextRevision).toBe(5);
    expect(state.context.artifactRefs).toHaveLength(1);
    expect(state.context.actionRefs).toHaveLength(1);
    expect(state.context.requiredInputRefs).toHaveLength(1);
    expect(state.context.interventionRefs).toHaveLength(1);
    expect(reduceTaskBusinessFeedback(state, feedback(4, 15))).toBe(state);
    expect(initial.context.phase?.code).toBe("recon.scanning");
    expect(initial.seenMessageIds.size).toBe(0);
  });

  it("keeps snapshot and newer metadata ahead of delayed old phase", () => {
    let state = snapshot();
    state = reduceTaskBusinessFeedback(state, feedback(0, 11, 4));
    expect(state.context.phase?.code).toBe("recon.scanning");
    const newer = feedback(0, 12, 6);
    state = reduceTaskBusinessFeedback(state, {
      ...newer,
      payload: {
        ...(newer.payload as Record<string, unknown>),
        contextDelta: { phase: { code: "recon.complete", since: "2026-09-23T00:03:00Z" } },
      },
    } as PublicTaskBusinessFeedback);
    state = reduceTaskBusinessFeedback(state, feedback(0, 13, 5));
    expect(state.context.phase?.code).toBe("recon.complete");
    expect(state.metadataRevision).toBe(6);
  });

  it("uses object revision to prevent an older ref from replacing a newer one", () => {
    const original = feedback(1, 11);
    const ref = context.artifactRefs[0];
    if (!ref) throw new Error("TEST_ARTIFACT_REF_MISSING");
    const revisionTwo = {
      ...original,
      payload: {
        ...(original.payload as Record<string, unknown>),
        artifactRef: { ...ref, revision: 2 },
      },
    } as PublicTaskBusinessFeedback;
    const initial = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: 4,
          context,
          objects: snapshotObjects,
          objectDescriptors: [],
        },
      ],
      resumeFrom,
    );
    expect(initial.objects.size).toBe(4);
    let state = reduceTaskBusinessFeedback(initial, revisionTwo);
    expect(state.context.artifactRefs[0]?.revision).toBe(2);
    expect(state.objects.has(`artifact\0${ref.id}`)).toBe(false);
    expect(unresolvedTaskBusinessRefs(state)).toContainEqual({ ...ref, revision: 2 });
    state = reduceTaskBusinessFeedback(state, feedback(1, 12, 6));
    expect(state.context.artifactRefs[0]?.revision).toBe(2);
  });

  it("keeps newer Context facts ahead of a delayed event with a higher object revision", () => {
    const ref = context.artifactRefs[0];
    if (!ref) throw new Error("TEST_ARTIFACT_REF_MISSING");
    const advanced = feedback(1, 11, 6);
    let state = reduceTaskBusinessFeedback(snapshot(), {
      ...advanced,
      payload: {
        ...(advanced.payload as Record<string, unknown>),
        artifactRef: { ...ref, revision: 2 },
      },
    } as PublicTaskBusinessFeedback);
    expect(state.context.contextRevision).toBe(6);
    expect(state.context.artifactRefs[0]?.revision).toBe(2);
    const delayed = feedback(1, 12, 5);
    state = reduceTaskBusinessFeedback(state, {
      ...delayed,
      payload: {
        ...(delayed.payload as Record<string, unknown>),
        artifactRef: { ...ref, revision: 3 },
      },
    } as PublicTaskBusinessFeedback);
    const staleMetadata = feedback(0, 13, 5);
    state = reduceTaskBusinessFeedback(state, {
      ...staleMetadata,
      payload: {
        ...(staleMetadata.payload as Record<string, unknown>),
        contextDelta: { phase: { code: "recon.old", since: "2026-09-23T00:02:00Z" } },
      },
    } as PublicTaskBusinessFeedback);
    expect(state.context.contextRevision).toBe(6);
    expect(state.context.artifactRefs[0]?.revision).toBe(2);
    expect(state.context.phase?.code).toBe("recon.scanning");
    expect(state.objectRevisions.get(`artifact\0${ref.id}`)).toBe(2);
    expect(state.seenMessageIds.size).toBe(3);
  });

  it("keeps finalization immutable while still accepting its same-revision metadata pair", () => {
    const ref = context.artifactRefs[0];
    if (!ref) throw new Error("TEST_ARTIFACT_REF_MISSING");
    const terminalMetadata = feedback(0, 11, 6);
    let state = reduceTaskBusinessFeedback(snapshot(), {
      ...terminalMetadata,
      payload: {
        ...(terminalMetadata.payload as Record<string, unknown>),
        contextDelta: {
          phase: { code: "execution.succeeded", since: "2026-09-23T00:03:00Z" },
          summary: { status: "finalized", resultCode: "COMPLETED" },
          activeRefs: {},
        },
      },
    } as PublicTaskBusinessFeedback);
    expect(state.context.finalizedAt).toBeUndefined();
    state = reduceTaskBusinessFeedback(state, feedback(5, 12, 6));
    expect(state.context.finalizedAt).toBeDefined();
    const afterFinalization = state.context;
    const lateObject = feedback(1, 13, 6);
    state = reduceTaskBusinessFeedback(state, {
      ...lateObject,
      payload: {
        ...(lateObject.payload as Record<string, unknown>),
        artifactRef: { ...ref, revision: 3 },
      },
    } as PublicTaskBusinessFeedback);
    const lateMetadata = feedback(0, 14, 7);
    state = reduceTaskBusinessFeedback(state, {
      ...lateMetadata,
      payload: {
        ...(lateMetadata.payload as Record<string, unknown>),
        contextDelta: {
          phase: { code: "recon.scanning", since: "2026-09-23T00:04:00Z" },
          summary: { status: "in_progress" },
        },
      },
    } as PublicTaskBusinessFeedback);
    expect(state.context).toEqual(afterFinalization);
    expect(state.seenMessageIds.size).toBe(4);
  });

  it("keeps both exact versions when Context references the same object twice", () => {
    const original = context.artifactRefs[0];
    if (!original) throw new Error("TEST_ARTIFACT_REF_MISSING");
    const newer = { ...original, revision: original.revision + 1 };
    const twoVersionContext = {
      ...context,
      artifactRefs: [newer],
      activeRefs: { ...context.activeRefs, previousRoute: original },
    };
    const state = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: 4,
          context: twoVersionContext,
          objects: [
            ...snapshotObjects,
            { kind: "artifact", value: { ...route, revision: newer.revision } },
          ],
          objectDescriptors: [],
        },
      ],
      resumeFrom,
    );
    expect(state.objectVersions.size).toBe(5);
    expect(state.objects.size).toBe(4);
    expect(unresolvedTaskBusinessRefs(state)).toEqual([]);
  });

  it("retains unknown optional data without creating a command and applies final summary", () => {
    const initial = snapshot();
    const body = parseTaskBusinessFeedbackBody(catalog.optionalExtension);
    const optional = {
      ...feedback(0, 11),
      ...body,
      messageId: "opaque-1",
    } as PublicTaskBusinessFeedback;
    let state = reduceTaskBusinessFeedback(initial, optional);
    expect(state.opaqueDiagnostics).toMatchObject([{ messageId: "opaque-1" }]);
    expect(state.context).toEqual(initial.context);
    expect(() =>
      reduceTaskBusinessFeedback(state, {
        ...optional,
        messageId: "invalid-required",
        required: true,
      } as unknown as PublicTaskBusinessFeedback),
    ).toThrow("BUSINESS_PAYLOAD_INVALID");
    state = reduceTaskBusinessFeedback(state, feedback(5, 12, 6));
    expect(state.context.summary.status).toBe("finalized");
    expect(state.context.finalizedAt).toBeDefined();
    expect(state.context.activeRefs).toEqual({});
    expect(state.context.phase).toBeNull();
    expect(() =>
      reduceTaskBusinessFeedback(state, {
        ...feedback(1, 13),
        identity: { ...context.identity, taskId: "other-task" },
      }),
    ).toThrow("BUSINESS_EVENT_TASK_BINDING_INVALID");
  });

  it("keeps terminal metadata when finalization follows at the same revision", () => {
    const initial = snapshot();
    const metadata = {
      ...feedback(0, 11, 6),
      payload: {
        eventType: "business.context_finalized",
        severity: "info",
        reasonCode: "COMPLETED",
        description: "Business Context terminal metadata",
        contextDelta: {
          phase: { code: "execution.succeeded", since: "2026-09-23T00:03:00Z" },
          summary: { status: "finalized", resultCode: "COMPLETED" },
          activeRefs: {},
          effectivePlanRevision: 2,
        },
      },
    } as PublicTaskBusinessFeedback;
    const afterMetadata = reduceTaskBusinessFeedback(initial, metadata);
    const final = reduceTaskBusinessFeedback(afterMetadata, feedback(5, 12, 6));
    expect(final.context.phase?.code).toBe("execution.succeeded");
    expect(final.context.activeRefs).toEqual({});
    expect(final.context.summary.status).toBe("finalized");
    expect(final.context.effectivePlanRevision).toBe(2);
    expect(final.metadataRevision).toBe(6);
  });

  it("does not keep an unrelated same-revision phase after legacy finalization", () => {
    const initial = snapshot();
    const unrelated = {
      ...feedback(0, 11, 6),
      payload: {
        eventType: "recon.lock_observed",
        severity: "info",
        reasonCode: "LOCK_OBSERVED",
        description: "Lock observed",
        contextDelta: {
          phase: { code: "recon.locking", since: "2026-09-23T00:02:00Z" },
        },
      },
    } as PublicTaskBusinessFeedback;
    const final = reduceTaskBusinessFeedback(
      reduceTaskBusinessFeedback(initial, unrelated),
      feedback(5, 12, 6),
    );
    expect(final.context.summary.status).toBe("finalized");
    expect(final.context.phase).toBeNull();
    expect(final.context.activeRefs).toEqual({});
  });

  it("accepts a bound event simulationId when the compatible Context omits it", () => {
    const initial = snapshot();
    expect(initial.context.identity.simulationId).toBeUndefined();
    const changed = reduceTaskBusinessFeedback(initial, {
      ...feedback(0, 11),
      identity: { ...context.identity, simulationId: "bound-simulation" },
    });
    expect(changed.seenMessageIds.has("public-message-11")).toBe(true);
  });

  it("rejects finalization when its declared Context revision differs from the event", () => {
    const final = feedback(5, 11, 6);
    expect(() =>
      reduceTaskBusinessFeedback(snapshot(), {
        ...final,
        payload: { ...(final.payload as Record<string, unknown>), finalContextRevision: 5 },
      } as PublicTaskBusinessFeedback),
    ).toThrow("BUSINESS_EVENT_FINAL_REVISION_INVALID");
  });

  it("rejects incomplete, mixed-revision and descriptor snapshots", () => {
    expect(() =>
      bootstrapTaskBusinessReducer(
        [{ contextRevision: 4, context, objects: [], objectDescriptors: [], nextCursor: "next" }],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_INCOMPLETE");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [{ contextRevision: 5, context, objects: [], objectDescriptors: [] }],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [{ contextRevision: 4, context, objects: [], objectDescriptors: [{}] }],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: snapshotObjects.slice(0, 3),
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_INCOMPLETE");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: snapshotObjects.slice(0, 2),
            objectDescriptors: [],
          },
          { contextRevision: 4, context, objects: snapshotObjects.slice(2), objectDescriptors: [] },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_INCOMPLETE");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: [...snapshotObjects, snapshotObjects[0]],
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: [...snapshotObjects, { kind: "artifact", value: { ...route, revision: 2 } }],
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: [
              { kind: "artifact", value: { ...route, content: { kind: "invalid" } } },
              ...snapshotObjects.slice(1),
            ],
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: [
              {
                kind: "artifact",
                value: { ...route, identity: { ...context.identity, taskId: "other-task" } },
              },
              ...snapshotObjects.slice(1),
            ],
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    expect(() =>
      bootstrapTaskBusinessReducer(
        [
          {
            contextRevision: 4,
            context,
            objects: [
              {
                kind: "artifact",
                value: {
                  ...route,
                  identity: { ...context.identity, simulationId: "foreign-scene" },
                },
              },
              ...snapshotObjects.slice(1),
            ],
            objectDescriptors: [],
          },
        ],
        resumeFrom,
      ),
    ).toThrow("BUSINESS_SNAPSHOT_OBJECT_INVALID");
  });
});
