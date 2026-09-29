import { describe, expect, it } from "vitest";
import { FootprintBusinessProcessor } from "../../apps/ugv-provider-adapter/src/footprint-business-processor.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { TaskBusinessFeedbackBodySchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const at = "2026-09-24T00:00:00Z";

function execution(): ProviderExecution {
  return {
    taskId: "task-footprint",
    externalExecutionId: "execution-footprint",
    operationName: "vehicle_area_recon",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "scene-a",
      correlationId: "correlation-a",
    },
    taskBusinessContextExpected: true,
    downstreamMissionIds: ["mission-1"],
    state: "RUNNING",
    revision: 2,
    reasonCode: "UGV_RECON_RUNNING",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function observedFact() {
  return {
    schemaVersion: "ugv.recon-footprint-fact/1",
    missionId: "mission-1",
    areaRevision: 1,
    sourceRecordId: "camera-footprint-1",
    sourceRevision: 1,
    observedAt: at,
    state: "active",
    quality: "observed",
    sourceKind: "device_reported",
    content: {
      kind: "geojson",
      crs: "OGC:CRS84",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [116, 39],
            [116.01, 39],
            [116.01, 39.01],
            [116, 39],
          ],
        ],
      },
    },
  };
}

async function setup(run = execution()) {
  const executions = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  await executions.putExecution(run);
  await new UgvTaskBusinessContextService(
    executions,
    business,
    run.providerId ?? "provider-a",
    run.resourceId,
    () => undefined,
  ).ensureForCreatedExecution(run.taskId);
  const events: unknown[] = [];
  return {
    run,
    business,
    events,
    scope: BoundExecutionScope.fromExecution(run),
    processor: new FootprintBusinessProcessor(business, (event) => events.push(event)),
  };
}

describe("UGV footprint port (synthetic source geometry)", () => {
  it("binds footprint facts to the effective area and clears the old view on adoption", async () => {
    const run = {
      ...execution(),
      arguments: {
        resourceId: "vehicle:ugv1",
        scanMode: "area",
        area: {
          polygon: [
            { longitude: 116, latitude: 39 },
            { longitude: 117, latitude: 39 },
            { longitude: 117, latitude: 40 },
          ],
        },
      },
    };
    const { business, processor, events, scope } = await setup(run);
    const initial = await business.getContext(scope);
    const requested = await business.getArtifactLatest(scope, "recon-requested-area");
    if (!initial || requested?.availability !== "available") {
      throw new Error("SYNTHETIC_REQUESTED_AREA_MISSING");
    }
    const candidate = TaskArtifactSchema.parse({
      ...requested,
      revision: 2,
      semantics: "planned",
      updatedAt: "2026-09-24T00:00:01Z",
      properties: { areaRevision: 2 },
    });
    await business.commitChangeSet({
      scope,
      expectedContextRevision: initial.contextRevision,
      context: {
        ...initial,
        contextRevision: initial.contextRevision + 1,
        artifactRefs: [
          ...initial.artifactRefs,
          { kind: "artifact", id: candidate.artifactId, revision: candidate.revision },
        ],
        updatedAt: candidate.updatedAt,
      },
      objects: [{ kind: "artifact", value: candidate }],
    });
    const footprint = observedFact();
    expect(await processor.apply(run, footprint)).toBe("committed");
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toMatchObject({
      properties: { areaRevision: 1 },
    });
    expect((await business.getContext(scope))?.updatedAt).toBe(candidate.updatedAt);
    await expect(
      processor.apply(run, {
        ...footprint,
        areaRevision: 2,
        sourceRevision: 2,
        sourceRecordId: "candidate-footprint",
        observedAt: "2026-09-24T00:00:03Z",
      }),
    ).rejects.toThrow("FOOTPRINT_AREA_REVISION_MISMATCH");
    expect((await business.getArtifactLatest(scope, "recon-current-footprint"))?.revision).toBe(1);
    expect(events).toHaveLength(1);

    const beforeAdoption = await business.getContext(scope);
    const previousCoverage = await business.getArtifactLatest(scope, "recon-covered-area");
    if (!beforeAdoption || !previousCoverage) {
      throw new Error("SYNTHETIC_AREA_ADOPTION_STATE_MISSING");
    }
    const adoptedAt = "2026-09-24T00:00:04Z";
    const adopted = TaskArtifactSchema.parse({
      ...candidate,
      revision: 3,
      updatedAt: adoptedAt,
    });
    const reset = TaskArtifactSchema.parse({
      ...previousCoverage,
      revision: previousCoverage.revision + 1,
      updatedAt: adoptedAt,
      availability: "not_produced_yet",
      reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
    });
    const adoptedRef = { kind: "artifact" as const, id: adopted.artifactId, revision: 3 };
    const resetRef = { kind: "artifact" as const, id: reset.artifactId, revision: reset.revision };
    const next = {
      ...beforeAdoption,
      contextRevision: beforeAdoption.contextRevision + 1,
      effectivePlanRevision: beforeAdoption.effectivePlanRevision + 1,
      activeRefs: { ...beforeAdoption.activeRefs, reconEffectiveArea: adoptedRef },
      artifactRefs: [...beforeAdoption.artifactRefs, adoptedRef, resetRef],
      updatedAt: adoptedAt,
    };
    const areaEvents = (activeRefs: typeof beforeAdoption.activeRefs) => {
      const reasonCode = "RECON_AREA_ADOPTED";
      const artifactEvent = (ref: typeof adoptedRef | typeof resetRef) => ({
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "ARTIFACT_CHANGED",
          contextRevision: next.contextRevision,
          providerRecordedAt: adoptedAt,
          payload: {
            change: "update",
            artifactRef: ref,
            previousRevision: ref.revision - 1,
            reasonCode,
          },
        }),
        description: reasonCode,
        reasonCode,
        severityHint: "info" as const,
      });
      return [
        artifactEvent(adoptedRef),
        artifactEvent(resetRef),
        {
          body: TaskBusinessFeedbackBodySchema.parse({
            schemaVersion: "sdar.task-business-feedback/1.0-rc2",
            kind: "BUSINESS_EVENT",
            contextRevision: next.contextRevision,
            providerRecordedAt: adoptedAt,
            payload: {
              eventType: "recon.area_adopted",
              severity: "info",
              reasonCode,
              description: "Synthetic area adoption",
              subjects: [adoptedRef, resetRef],
              contextDelta: {
                activeRefs,
                effectivePlanRevision: next.effectivePlanRevision,
                summary: next.summary,
              },
            },
          }),
          description: reasonCode,
          reasonCode,
          severityHint: "info" as const,
        },
      ];
    };
    const changeSet = {
      scope,
      expectedContextRevision: beforeAdoption.contextRevision,
      context: next,
      objects: [
        { kind: "artifact" as const, value: adopted },
        { kind: "artifact" as const, value: reset },
      ],
    };
    await expect(
      business.commitBusinessChangeSet(changeSet, areaEvents(next.activeRefs)),
    ).rejects.toThrow("RECON_AREA_ADOPTION_FOOTPRINT_STALE");
    expect(await business.getContext(scope)).toEqual(beforeAdoption);
    const cleared = { ...next, activeRefs: { reconEffectiveArea: adoptedRef } };
    await business.commitBusinessChangeSet(
      { ...changeSet, context: cleared },
      areaEvents(cleared.activeRefs),
    );
    expect((await business.getContext(scope))?.activeRefs.currentFootprint).toBeUndefined();
    expect(await business.getArtifactVersion(scope, "recon-current-footprint", 1)).toBeDefined();
    await expect(
      processor.apply(run, {
        ...footprint,
        sourceRevision: 2,
        sourceRecordId: "old-area-late",
        observedAt: "2026-09-24T00:00:05Z",
      }),
    ).rejects.toThrow("FOOTPRINT_AREA_REVISION_MISMATCH");
    expect(
      await processor.apply(run, {
        ...footprint,
        areaRevision: 2,
        sourceRevision: 2,
        sourceRecordId: "new-area-footprint",
        observedAt: "2026-09-24T00:00:05Z",
      }),
    ).toBe("committed");
    expect((await business.getContext(scope))?.activeRefs.currentFootprint).toMatchObject({
      revision: 2,
    });
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toMatchObject({
      properties: { areaRevision: 2 },
    });
  });

  it("rejects a prior mission or pre-execution footprint without replacing current geometry", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = { ...run, downstreamMissionIds: ["mission-1", "mission-2"] };
    const current = { ...observedFact(), missionId: "mission-2" };
    const before = await business.getContext(scope);
    await expect(processor.apply(replacement, observedFact())).rejects.toThrow(
      "FOOTPRINT_EXECUTION_BINDING_INVALID",
    );
    await expect(
      processor.apply(replacement, { ...current, observedAt: "2026-09-23T23:59:59Z" }),
    ).rejects.toThrow("FOOTPRINT_EXECUTION_BINDING_INVALID");
    expect(await business.getContext(scope)).toEqual(before);
    expect(events).toHaveLength(0);
    expect(await processor.apply(replacement, current)).toBe("committed");
  });

  it("preserves observed revisions, aggregates rapid updates, and invalidates on pause", async () => {
    const { run, business, processor, events, scope } = await setup();
    const first = observedFact();
    expect(await processor.apply(run, first)).toBe("committed");
    expect(await processor.apply(run, first)).toBe("duplicate");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 2,
      activeRefs: {
        currentFootprint: { kind: "artifact", id: "recon-current-footprint", revision: 1 },
      },
    });
    const rotated = {
      ...first,
      sourceRecordId: "camera-footprint-2",
      sourceRevision: 2,
      observedAt: "2026-09-24T00:00:00.100Z",
      content: {
        ...first.content,
        geometry: {
          ...first.content.geometry,
          coordinates: [
            [
              [116, 39],
              [116.02, 39],
              [116.02, 39.02],
              [116, 39],
            ],
          ],
        },
      },
    };
    expect(await processor.apply(run, rotated)).toBe("duplicate");
    expect(await processor.apply(run, { ...rotated, observedAt: "2026-09-24T00:00:01Z" })).toBe(
      "committed",
    );
    const originalFootprint = await business.getArtifactVersion(
      scope,
      "recon-current-footprint",
      1,
    );
    const latestFootprint = await business.getArtifactLatest(scope, "recon-current-footprint");
    expect(originalFootprint?.availability).toBe("available");
    expect(latestFootprint?.availability).toBe("available");
    if (
      originalFootprint?.availability !== "available" ||
      latestFootprint?.availability !== "available"
    )
      throw new Error("FOOTPRINT_AVAILABLE_VERSION_MISSING");
    expect(originalFootprint.content).toEqual(first.content);
    expect(latestFootprint.content).toEqual(rotated.content);
    expect(
      await processor.apply(run, {
        schemaVersion: "ugv.recon-footprint-fact/1",
        missionId: "mission-1",
        areaRevision: 1,
        sourceRecordId: "camera-paused-3",
        sourceRevision: 3,
        observedAt: "2026-09-24T00:00:01.100Z",
        state: "paused",
      }),
    ).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 4,
      activeRefs: {},
    });
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toMatchObject({
      revision: 3,
      lifecycle: "invalidated",
      availability: "unavailable",
      reasonCode: "FOOTPRINT_PAUSED",
    });
    expect(events).toHaveLength(3);
  });

  it("does not let an older pause invalidate a newer observed footprint", async () => {
    const { run, business, processor, events, scope } = await setup();
    const visible = {
      ...observedFact(),
      sourceRecordId: "camera-active-2",
      sourceRevision: 2,
      observedAt: "2026-09-24T00:00:02Z",
    };
    expect(await processor.apply(run, visible)).toBe("committed");
    const before = await business.getContext(scope);
    const artifact = await business.getArtifactLatest(scope, "recon-current-footprint");
    const stalePause = {
      schemaVersion: "ugv.recon-footprint-fact/1",
      missionId: "mission-1",
      areaRevision: 1,
      sourceRecordId: "camera-pause-3",
      sourceRevision: 3,
      observedAt: "2026-09-24T00:00:01Z",
      state: "paused",
    };

    expect(await processor.apply(run, stalePause)).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(before);
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toEqual(artifact);
    expect(events).toHaveLength(1);

    expect(
      await processor.apply(run, {
        ...stalePause,
        sourceRevision: 4,
        sourceRecordId: "camera-pause-4",
        observedAt: "2026-09-24T00:00:02.100Z",
      }),
    ).toBe("committed");
    expect((await business.getContext(scope))?.activeRefs.currentFootprint).toBeUndefined();
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toMatchObject({
      revision: 2,
      lifecycle: "invalidated",
      reasonCode: "FOOTPRINT_PAUSED",
    });
  });

  it("requires model provenance and declared local frame; rejects unbound or uncalibrated input", async () => {
    const { run, business, processor, events, scope } = await setup();
    const first = observedFact();
    await expect(processor.apply(run, { ...first, missionId: "other" })).rejects.toThrow(
      "FOOTPRINT_EXECUTION_BINDING_INVALID",
    );
    await expect(
      processor.apply(run, { ...first, quality: "nominal", sourceKind: "calibrated_model" }),
    ).rejects.toThrow();
    await expect(
      processor.apply(run, {
        ...first,
        quality: "nominal",
        sourceKind: "calibrated_model",
        modelRef: "camera-model-v1",
        content: {
          kind: "local_geometry",
          frameId: "vehicle-local",
          unit: "m",
          axisConvention: "forward_left",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [5, 0],
                [5, 3],
                [0, 0],
              ],
            ],
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      processor.apply(run, {
        ...first,
        content: {
          kind: "geojson",
          crs: "OGC:CRS84",
          geometry: { type: "Point", coordinates: [116, 39] },
        },
      }),
    ).rejects.toThrow();
    expect(
      await processor.apply(run, {
        ...first,
        quality: "nominal",
        sourceKind: "calibrated_model",
        modelRef: "camera-model-v1",
        content: {
          kind: "local_geometry",
          frameId: "vehicle-local",
          unit: "m",
          axisConvention: "forward_left",
          transformRef: "camera-transform-v1",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [5, 0],
                [5, 3],
                [0, 0],
              ],
            ],
          },
        },
      }),
    ).toBe("committed");
    expect(await business.getArtifactLatest(scope, "recon-current-footprint")).toMatchObject({
      semantics: "derived",
      properties: { quality: "nominal", model: "camera-model-v1" },
      content: {
        kind: "local_geometry",
        frameId: "vehicle-local",
        transformRef: "camera-transform-v1",
      },
    });
    expect(events).toHaveLength(1);
  });
});
