import { describe, expect, it } from "vitest";
import { NavigationBusinessProcessor } from "../../apps/ugv-provider-adapter/src/navigation-business-processor.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";

const at = "2026-09-24T00:00:00Z";
const coordinates = [
  [116, 39],
  [116.2, 39.2],
];

function execution(): ProviderExecution {
  return {
    taskId: "task-planner",
    externalExecutionId: "execution-planner",
    operationName: "vehicle_navigate",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: {
      resourceId: "vehicle:ugv1",
      mission: { type: "point", target: { longitude: 116.2, latitude: 39.2 } },
    },
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
    reasonCode: "UGV_MISSION_STARTED",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function planFact(adoption: "candidate" | "adopted", routeRevision = 1) {
  return {
    schemaVersion: "ugv.navigation-plan-fact/1",
    routeId: "route-1",
    routePlanId: "plan-1",
    routeRevision,
    missionId: "mission-1",
    sourceRecordId: `planner-record-${routeRevision}`,
    routeSource: "ugv_planner_v1",
    adoption,
    observedAt: at,
    content: {
      kind: "geojson",
      crs: "OGC:CRS84",
      geometry: { type: "LineString", coordinates },
    },
  };
}

async function setup() {
  const run = execution();
  const executions = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  await executions.putExecution(run);
  const contextService = new UgvTaskBusinessContextService(
    executions,
    business,
    run.providerId ?? "provider-a",
    run.resourceId,
    () => undefined,
  );
  await contextService.ensureForCreatedExecution(run.taskId);
  const events: unknown[] = [];
  const processor = new NavigationBusinessProcessor(business, (event) => events.push(event));
  const scope = BoundExecutionScope.fromExecution(run);
  return { run, business, processor, events, scope };
}

describe("UGV navigation business projection (synthetic source facts)", () => {
  it("keeps a candidate separate, adopts only on an adoption fact, and retains old route versions", async () => {
    const { run, business, processor, events, scope } = await setup();
    expect(await processor.apply(run, planFact("candidate"))).toBe("committed");
    const candidate = await business.getContext(scope);
    expect(candidate).toMatchObject({
      contextRevision: 2,
      effectivePlanRevision: 0,
      activeRefs: {},
    });
    expect((await business.getArtifactLatest(scope, "route-1"))?.revision).toBe(1);
    expect(await processor.apply(run, planFact("candidate"))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(candidate);

    expect(await processor.apply(run, planFact("adopted"))).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 3,
      effectivePlanRevision: 1,
      activeRefs: { route: { kind: "artifact", id: "route-1", revision: 2 } },
    });
    expect((await business.getArtifactVersion(scope, "route-1", 1))?.properties).toMatchObject({
      adoption: "candidate",
    });
    expect((await business.getArtifactVersion(scope, "route-1", 2))?.properties).toMatchObject({
      adoption: "adopted",
      routePlanId: "plan-1",
      routeSource: "ugv_planner_v1",
    });
    expect(await processor.apply(run, planFact("adopted"))).toBe("duplicate");
    expect(events).toHaveLength(3);

    const revisedCandidate = planFact("candidate", 2);
    revisedCandidate.content.geometry.coordinates = [
      [116, 39],
      [116.3, 39.3],
    ];
    expect(await processor.apply(run, revisedCandidate)).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 4,
      effectivePlanRevision: 1,
      activeRefs: { route: { kind: "artifact", id: "route-1", revision: 2 } },
    });
    expect((await business.getArtifactVersion(scope, "route-1", 2))?.source.sourceRevision).toBe(
      "1",
    );
    expect((await business.getArtifactLatest(scope, "route-1"))?.source.sourceRevision).toBe("2");
    expect(events).toHaveLength(4);
  });

  it("rejects an unbound mission, source-version conflict, malformed route, and terminal task", async () => {
    const { run, business, processor, events, scope } = await setup();
    const fact = planFact("candidate");
    await expect(processor.apply(run, { ...fact, missionId: "other-mission" })).rejects.toThrow(
      "NAVIGATION_PLAN_EXECUTION_BINDING_INVALID",
    );
    await expect(
      processor.apply(run, {
        ...fact,
        content: {
          kind: "geojson",
          crs: "OGC:CRS84",
          geometry: { type: "Point", coordinates: [116, 39] },
        },
      }),
    ).rejects.toThrow();
    expect(await processor.apply(run, fact)).toBe("committed");
    await expect(
      processor.apply(run, { ...fact, sourceRecordId: "different-planner-record" }),
    ).rejects.toThrow("NAVIGATION_PLAN_SOURCE_VERSION_CONFLICT");
    await expect(
      processor.apply({ ...run, state: "SUCCEEDED" }, planFact("adopted", 2)),
    ).rejects.toThrow("NAVIGATION_PLAN_TASK_TERMINAL");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 2,
      effectivePlanRevision: 0,
      activeRefs: {},
    });
    expect(events).toHaveLength(1);
  });

  it("rejects a newer source version that moves the same route backward in time", async () => {
    const { run, business, processor, events, scope } = await setup();
    const first = {
      ...planFact("candidate"),
      observedAt: "2026-09-24T00:00:10Z",
    };
    expect(await processor.apply(run, first)).toBe("committed");
    const before = await business.getContext(scope);
    const laterRevision = {
      ...planFact("candidate", 2),
      observedAt: "2026-09-24T00:00:05Z",
    };
    await expect(processor.apply(run, laterRevision)).rejects.toThrow(
      "NAVIGATION_PLAN_SOURCE_TIME_REGRESSION",
    );
    await expect(
      processor.apply(run, { ...first, adoption: "adopted", observedAt: laterRevision.observedAt }),
    ).rejects.toThrow("NAVIGATION_PLAN_SOURCE_TIME_REGRESSION");
    expect(await business.getContext(scope)).toEqual(before);
    expect((await business.getArtifactLatest(scope, first.routeId))?.source.sourceRevision).toBe(
      "1",
    );
    expect(events).toHaveLength(1);
  });

  it("does not let a delayed prior mission or pre-execution route adopt over the current mission", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = {
      ...run,
      downstreamMissionIds: ["mission-1", "mission-2"],
    };
    const current = {
      ...planFact("adopted"),
      routeId: "route-current",
      routePlanId: "plan-current",
      missionId: "mission-2",
    };
    expect(await processor.apply(replacement, current)).toBe("committed");
    const adopted = await business.getContext(scope);
    expect(adopted).toMatchObject({
      effectivePlanRevision: 1,
      activeRefs: { route: { id: "route-current", revision: 1 } },
    });
    await expect(
      processor.apply(replacement, {
        ...planFact("adopted"),
        routeId: "route-prior",
        routePlanId: "plan-prior",
      }),
    ).rejects.toThrow("NAVIGATION_PLAN_EXECUTION_BINDING_INVALID");
    await expect(
      processor.apply(replacement, {
        ...current,
        routeId: "route-before-task",
        observedAt: "2026-09-23T23:59:59Z",
      }),
    ).rejects.toThrow("NAVIGATION_PLAN_EXECUTION_BINDING_INVALID");
    expect(await business.getContext(scope)).toEqual(adopted);
    expect(await business.getArtifactLatest(scope, "route-prior")).toBeUndefined();
    expect(await business.getArtifactLatest(scope, "route-before-task")).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it("keeps a delayed same-mission route as history after a newer route was adopted", async () => {
    const { run, business, processor, scope } = await setup();
    const current = {
      ...planFact("adopted"),
      routeId: "route-current",
      routePlanId: "plan-current",
      observedAt: "2026-09-24T00:00:10Z",
    };
    expect(await processor.apply(run, current)).toBe("committed");
    const late = {
      ...planFact("candidate"),
      routeId: "route-late",
      routePlanId: "plan-late",
      observedAt: "2026-09-24T00:00:05Z",
    };
    expect(await processor.apply(run, late)).toBe("committed");
    const beforeLateAdoption = await business.getContext(scope);
    await expect(processor.apply(run, { ...late, adoption: "adopted" })).rejects.toThrow(
      "NAVIGATION_PLAN_STALE_ADOPTION",
    );
    expect(beforeLateAdoption).toMatchObject({
      effectivePlanRevision: 1,
      activeRefs: { route: { id: "route-current", revision: 1 } },
      updatedAt: current.observedAt,
    });
    expect(await business.getContext(scope)).toEqual(beforeLateAdoption);
    expect((await business.getArtifactLatest(scope, late.routeId))?.properties).toMatchObject({
      adoption: "candidate",
    });

    const newer = {
      ...planFact("candidate"),
      routeId: "route-newer",
      routePlanId: "plan-newer",
      observedAt: "2026-09-24T00:00:20Z",
    };
    expect(await processor.apply(run, newer)).toBe("committed");
    expect(await processor.apply(run, { ...newer, adoption: "adopted" })).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      effectivePlanRevision: 2,
      activeRefs: { route: { id: "route-newer", revision: 2 } },
    });
    expect((await business.getArtifactLatest(scope, late.routeId))?.revision).toBe(1);
  });
});
