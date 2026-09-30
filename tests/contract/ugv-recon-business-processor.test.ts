import { describe, expect, it, vi } from "vitest";
import { ReconBusinessProcessor } from "../../apps/ugv-provider-adapter/src/recon-business-processor.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  assertInterventionAppliedFacts,
  assertInterventionRejectedFacts,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { RuntimeInterventionSchema } from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const at = "2026-09-24T00:00:00Z";

function execution(): ProviderExecution {
  return {
    taskId: "task-recon",
    externalExecutionId: "execution-recon",
    operationName: "vehicle_area_recon",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
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

async function setup() {
  const run = execution();
  const executions = new MemoryProviderStore();
  const business = new MemoryTaskBusinessStore();
  await executions.putExecution(run);
  const service = new UgvTaskBusinessContextService(
    executions,
    business,
    run.providerId ?? "provider-a",
    run.resourceId,
    () => undefined,
  );
  await service.ensureForCreatedExecution(run.taskId);
  const events: unknown[] = [];
  const processor = new ReconBusinessProcessor(business, (event) => events.push(event));
  const scope = BoundExecutionScope.fromExecution(run);
  return { run, executions, business, service, processor, events, scope };
}

describe("UGV recon business projection (synthetic mission-bound facts)", () => {
  it("projects signed display centres while retaining the independent precision-grid percentage", async () => {
    const { run, business, processor, scope } = await setup();
    const fact = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "display-cells-1",
      observedAt: "2026-09-24T00:00:01Z",
      displayGrid: "isr.airport.display-centres/v1",
      coverage: {
        scanMode: 1,
        cellSizeM: 3,
        coveragePercent: 73,
        coveredCount: 2,
        totalCount: 2,
        coveredCells: [
          { x: -6.5, y: -3.5 },
          { x: -3.5, y: -3.5 },
        ],
      },
    };
    expect(await processor.applyCoverage(run, fact)).toBe("committed");
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toMatchObject({
      availability: "available",
      semantics: "derived",
      source: { method: "airport_display_cell_centres" },
      content: { kind: "geojson", geometry: { type: "MultiPolygon" } },
    });
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
      coveragePercent: 73,
      coveredCount: 2,
      totalCount: 2,
    });
    await expect(
      processor.applyCoverage(run, {
        ...fact,
        sourceCursor: "invalid-count",
        observedAt: "2026-09-24T00:00:02Z",
        coverage: { ...fact.coverage, coveredCount: 1 },
      }),
    ).rejects.toThrow("RECON_DISPLAY_GRID_INVALID");
    await expect(
      processor.applyCoverage(run, {
        ...fact,
        sourceCursor: "invalid-duplicate",
        observedAt: "2026-09-24T00:00:02Z",
        coverage: {
          ...fact.coverage,
          coveredCells: [
            { x: -6.5, y: -3.5 },
            { x: -6.5, y: -3.5 },
          ],
        },
      }),
    ).rejects.toThrow("RECON_COVERAGE_GRID_CELLS_INVALID");
  });
  it("requires an applied area adjustment to return both effective area and reset coverage", async () => {
    const { business, scope } = await setup();
    const previous = await business.getContext(scope);
    const requested = await business.getArtifactLatest(scope, "recon-requested-area");
    const coverage = await business.getArtifactLatest(scope, "recon-covered-area");
    if (!previous || requested?.availability !== "available" || !coverage) {
      throw new Error("SYNTHETIC_RECON_FACTS_MISSING");
    }
    const adopted = TaskArtifactSchema.parse({
      ...requested,
      revision: 2,
      semantics: "planned",
      properties: { areaRevision: 2 },
      updatedAt: "2026-09-24T00:00:01Z",
    });
    const reset = TaskArtifactSchema.parse({
      ...coverage,
      revision: 2,
      reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
      updatedAt: adopted.updatedAt,
    });
    const areaRef = { kind: "artifact" as const, id: adopted.artifactId, revision: 2 };
    const resetRef = { kind: "artifact" as const, id: reset.artifactId, revision: 2 };
    const commandId = "synthetic-recon-adjust-command";
    const terminalIntervention = RuntimeInterventionSchema.parse({
      schemaVersion: "sdar.runtime-intervention/1.0-rc2",
      interventionId: "synthetic-recon-adjust",
      interventionType: "recon.adjust_area",
      identity: previous.identity,
      revision: 2,
      effectivePlanRevision: previous.effectivePlanRevision,
      blocking: false,
      state: "applied",
      title: "Adjust area",
      inputSchema: { type: "object" },
      reasonCode: "RECON_AREA_ADOPTED",
      createdAt: at,
      acceptedCommandId: commandId,
      resultRefs: [areaRef, resetRef],
    });
    const interventionRef = {
      kind: "intervention" as const,
      id: terminalIntervention.interventionId,
      revision: 2,
    };
    const next = TaskBusinessContextSchema.parse({
      ...previous,
      contextRevision: previous.contextRevision + 1,
      effectivePlanRevision: previous.effectivePlanRevision + 1,
      activeRefs: { ...previous.activeRefs, reconEffectiveArea: areaRef },
      artifactRefs: [...previous.artifactRefs, areaRef, resetRef],
      interventionRefs: [...previous.interventionRefs, interventionRef],
      updatedAt: adopted.updatedAt,
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId,
      commandType: "intervention",
      entryKey: `intervention:${terminalIntervention.interventionId}`,
      identity: previous.identity,
      requestHash: "c".repeat(64),
      state: "applied",
      resultCode: "RECON_AREA_ADOPTED",
      resultRefs: [areaRef, resetRef],
      createdAt: at,
      updatedAt: adopted.updatedAt,
    });
    const versions = [
      { kind: "artifact" as const, value: adopted },
      { kind: "artifact" as const, value: reset },
      { kind: "intervention" as const, value: terminalIntervention },
    ];
    expect(() => assertInterventionAppliedFacts(previous, next, versions, command)).not.toThrow();
    const omitted = RuntimeInterventionSchema.parse({
      ...terminalIntervention,
      resultRefs: [resetRef],
    });
    expect(() =>
      assertInterventionAppliedFacts(
        previous,
        next,
        [...versions.slice(0, 2), { kind: "intervention", value: omitted }],
        BusinessCommandRecordSchema.parse({ ...command, resultRefs: [resetRef] }),
      ),
    ).toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    const failed = RuntimeInterventionSchema.parse({
      ...terminalIntervention,
      state: "failed",
      resultRefs: [],
    });
    const rejected = BusinessCommandRecordSchema.parse({
      ...command,
      state: "rejected",
      resultCode: "RECON_AREA_FAILED",
      resultRefs: [],
    });
    expect(() =>
      assertInterventionRejectedFacts(
        previous,
        TaskBusinessContextSchema.parse({
          ...next,
          effectivePlanRevision: previous.effectivePlanRevision,
        }),
        [{ kind: "intervention", value: failed }],
        rejected,
      ),
    ).toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
  });

  it("keeps candidate-area coverage on the old basis and fences unbound observations after adoption", async () => {
    const { run, business, processor, events, scope } = await setup();
    const previousContext = await business.getContext(scope);
    const priorArea = await business.getArtifactLatest(scope, "recon-requested-area");
    if (!previousContext || priorArea?.availability !== "available") {
      throw new Error("SYNTHETIC_RECON_AREA_MISSING");
    }
    const candidateArea = TaskArtifactSchema.parse({
      ...priorArea,
      revision: 2,
      updatedAt: "2026-09-24T00:00:01Z",
      properties: { areaRevision: 2 },
    });
    const candidateRef = { kind: "artifact" as const, id: priorArea.artifactId, revision: 2 };
    await business.commitChangeSet({
      scope,
      expectedContextRevision: previousContext.contextRevision,
      context: {
        ...previousContext,
        contextRevision: previousContext.contextRevision + 1,
        artifactRefs: [...previousContext.artifactRefs, candidateRef],
        updatedAt: candidateArea.updatedAt,
      },
      objects: [{ kind: "artifact", value: candidateArea }],
    });
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-with-candidate-area",
      observedAt: "2026-09-24T00:00:02Z",
      coverage: {
        coveredCount: 2,
        totalCount: 10,
        coveredCells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      grid: {
        frameId: "sim-local-map",
        origin: [100, 200],
        cellSizeM: 2,
        denominatorCellCount: 10,
        axisConvention: "east_north",
        indexBasis: "zero_based_cell_index",
      },
    };
    expect(await processor.applyCoverage(run, coverage)).toBe("committed");
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
      areaRevision: 1,
    });
    expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.availability).toBe(
      "available",
    );
    const candidateContext = await business.getContext(scope);
    if (!candidateContext) throw new Error("SYNTHETIC_CANDIDATE_CONTEXT_MISSING");
    const adoptedArea = TaskArtifactSchema.parse({
      ...candidateArea,
      revision: 3,
      semantics: "planned",
      source: {
        producer: "provider",
        sourceRecordRef: "synthetic-area-adoption",
        method: "test_double",
      },
      updatedAt: "2026-09-24T00:00:03Z",
      properties: { areaRevision: 2 },
    });
    const adoptedRef = { kind: "artifact" as const, id: priorArea.artifactId, revision: 3 };
    const previousCoverage = await business.getArtifactLatest(scope, "recon-covered-area");
    if (!previousCoverage) throw new Error("SYNTHETIC_COVERAGE_MISSING");
    const resetCoverage = TaskArtifactSchema.parse({
      schemaVersion: "sdar.task-artifact/1.0-rc2",
      artifactId: previousCoverage.artifactId,
      artifactType: "recon.covered_area",
      revision: previousCoverage.revision + 1,
      semantics: "derived",
      lifecycle: "active",
      identity: previousCoverage.identity,
      source: {
        producer: "provider",
        sourceRecordRef: "synthetic-area-adoption",
        method: "test_double",
      },
      createdAt: previousCoverage.createdAt,
      updatedAt: adoptedArea.updatedAt,
      availability: "not_produced_yet",
      reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
    });
    const resetRef = {
      kind: "artifact" as const,
      id: resetCoverage.artifactId,
      revision: resetCoverage.revision,
    };
    const adoptedContext = {
      ...candidateContext,
      contextRevision: candidateContext.contextRevision + 1,
      effectivePlanRevision: candidateContext.effectivePlanRevision + 1,
      activeRefs: { ...candidateContext.activeRefs, reconEffectiveArea: adoptedRef },
      artifactRefs: [...candidateContext.artifactRefs, adoptedRef, resetRef],
      summary: {
        ...candidateContext.summary,
        properties: { ...candidateContext.summary.properties },
      },
      updatedAt: adoptedArea.updatedAt,
    };
    delete adoptedContext.summary.properties.reconCoverage;
    delete adoptedContext.summary.properties.reconCoverageCursorHash;
    delete adoptedContext.summary.properties.reconCoverageSignature;
    delete adoptedContext.summary.properties.reconCoverageMissionId;
    await expect(
      business.commitChangeSet({
        scope,
        expectedContextRevision: candidateContext.contextRevision,
        context: { ...adoptedContext, summary: candidateContext.summary },
        objects: [
          { kind: "artifact", value: adoptedArea },
          { kind: "artifact", value: resetCoverage },
        ],
      }),
    ).rejects.toThrow("RECON_AREA_ADOPTION_FACTS_INCOMPLETE");
    expect(await business.getContext(scope)).toEqual(candidateContext);
    await expect(
      business.commitChangeSet({
        scope,
        expectedContextRevision: candidateContext.contextRevision,
        context: adoptedContext,
        objects: [
          { kind: "artifact", value: adoptedArea },
          { kind: "artifact", value: resetCoverage },
        ],
      }),
    ).rejects.toThrow("RECON_AREA_ADOPTION_PUBLIC_EVENTS_REQUIRED");
    expect(await business.getContext(scope)).toEqual(candidateContext);
    const reasonCode = "RECON_AREA_ADOPTED";
    const artifactEvent = (ref: typeof adoptedRef | typeof resetRef) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: adoptedContext.contextRevision,
        providerRecordedAt: adoptedArea.updatedAt,
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
    const adoptionEvents = [
      artifactEvent(adoptedRef),
      artifactEvent(resetRef),
      {
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "BUSINESS_EVENT",
          contextRevision: adoptedContext.contextRevision,
          providerRecordedAt: adoptedArea.updatedAt,
          payload: {
            eventType: "recon.area_adopted",
            severity: "info",
            reasonCode,
            description: "Verified area adoption in synthetic test",
            subjects: [adoptedRef, resetRef],
            contextDelta: {
              activeRefs: adoptedContext.activeRefs,
              effectivePlanRevision: adoptedContext.effectivePlanRevision,
              summary: adoptedContext.summary,
            },
          },
        }),
        description: reasonCode,
        reasonCode,
        severityHint: "info" as const,
      },
    ];
    await expect(
      business.commitBusinessChangeSet(
        {
          scope,
          expectedContextRevision: candidateContext.contextRevision,
          context: adoptedContext,
          objects: [
            {
              kind: "artifact",
              value: TaskArtifactSchema.parse({
                ...adoptedArea,
                properties: { areaRevision: 1 },
              }),
            },
            { kind: "artifact", value: resetCoverage },
          ],
        },
        adoptionEvents,
      ),
    ).rejects.toThrow("RECON_AREA_REVISION_NOT_ADVANCED");
    expect(await business.getContext(scope)).toEqual(candidateContext);
    await business.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: candidateContext.contextRevision,
        context: adoptedContext,
        objects: [
          { kind: "artifact", value: adoptedArea },
          { kind: "artifact", value: resetCoverage },
        ],
      },
      adoptionEvents,
    );
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toBeUndefined();
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toMatchObject({
      availability: "not_produced_yet",
      reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
    });
    const afterAdoption = {
      ...coverage,
      sourceCursor: "coverage-after-area-adoption",
      observedAt: "2026-09-24T00:00:04Z",
    };
    const before = await business.getContext(scope);
    await expect(processor.applyCoverage(run, afterAdoption)).rejects.toThrow(
      "RECON_COVERAGE_AREA_REVISION_UNBOUND",
    );
    expect(await business.getContext(scope)).toEqual(before);
    expect(await processor.applyCoverage(run, { ...afterAdoption, areaRevision: 1 })).toBe(
      "duplicate",
    );
    expect(await business.getContext(scope)).toEqual(before);
    await expect(
      processor.applyCoverage(run, { ...afterAdoption, areaRevision: 3 }),
    ).rejects.toThrow("RECON_COVERAGE_AREA_REVISION_CONFLICT");
    expect(await business.getContext(scope)).toEqual(before);
    expect(events).toHaveLength(2);
    expect(await processor.applyCoverage(run, { ...afterAdoption, areaRevision: 2 })).toBe(
      "committed",
    );
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
      areaRevision: 2,
      coveredCount: 2,
      totalCount: 10,
    });
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toMatchObject({
      availability: "available",
      properties: { areaRevision: 2, grid: { denominatorCellCount: 10 } },
    });
    expect(await business.getArtifactVersion(scope, "recon-covered-area", 2)).toMatchObject({
      properties: { areaRevision: 1 },
    });
    expect(events).toHaveLength(4);
  });

  it("projects a new mission even when phase and source cursor repeat", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = { ...run, downstreamMissionIds: ["mission-1", "mission-2"] };
    const status = {
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-1",
      sourceCursor: "status-1",
      observedAt: "2026-09-24T00:00:01Z",
      motionStatus: 5,
    };
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-1",
      observedAt: "2026-09-24T00:00:02Z",
      coverage: { coveragePercent: 20 },
    };
    expect(await processor.applyStatus(run, status)).toBe("committed");
    expect(
      await processor.applyStatus(run, {
        ...status,
        sourceCursor: "older-status",
        observedAt: "2026-09-24T00:00:00.500Z",
        motionStatus: 6,
      }),
    ).toBe("duplicate");
    expect(await processor.applyCoverage(run, coverage)).toBe("committed");
    expect(
      await processor.applyStatus(replacement, {
        ...status,
        missionId: "mission-2",
        observedAt: "2026-09-24T00:00:03Z",
      }),
    ).toBe("committed");
    expect(
      await processor.applyCoverage(replacement, {
        ...coverage,
        missionId: "mission-2",
        observedAt: "2026-09-24T00:00:04Z",
      }),
    ).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 5,
      phase: { code: "recon.motion.5", since: "2026-09-24T00:00:03Z" },
      summary: {
        properties: {
          reconStatusMissionId: "mission-2",
          reconCoverageMissionId: "mission-2",
          reconCoverage: { missionId: "mission-2" },
        },
      },
    });
    expect(events).toHaveLength(6);
  });

  it("keeps Context updatedAt monotonic across delayed status and coverage facts", async () => {
    const { run, business, processor, scope } = await setup();
    const status = (cursor: string, observedAt: string, motionStatus: 5 | 6) => ({
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-1",
      sourceCursor: cursor,
      observedAt,
      motionStatus,
    });
    const coverage = (cursor: string, observedAt: string, coveragePercent: number) => ({
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: cursor,
      observedAt,
      coverage: { coveragePercent },
    });
    expect(await processor.applyStatus(run, status("status-1", "2026-09-24T00:00:01Z", 5))).toBe(
      "committed",
    );
    expect(
      await processor.applyCoverage(run, coverage("coverage-3", "2026-09-24T00:00:03Z", 20)),
    ).toBe("committed");
    expect(await processor.applyStatus(run, status("status-2", "2026-09-24T00:00:02Z", 6))).toBe(
      "committed",
    );
    expect(await business.getContext(scope)).toMatchObject({
      updatedAt: "2026-09-24T00:00:03Z",
      phase: { since: "2026-09-24T00:00:02Z" },
    });
    expect(await processor.applyStatus(run, status("status-5", "2026-09-24T00:00:05Z", 5))).toBe(
      "committed",
    );
    expect(
      await processor.applyCoverage(run, coverage("coverage-4", "2026-09-24T00:00:04Z", 30)),
    ).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      updatedAt: "2026-09-24T00:00:05Z",
      summary: { properties: { reconCoverage: { sourceObservedAt: "2026-09-24T00:00:04Z" } } },
    });
  });

  it("retains the newest same-phase status clock before considering a delayed phase change", async () => {
    const { run, business, processor, events, scope } = await setup();
    const status = (cursor: string, second: number, motionStatus: 5 | 6) => ({
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-1",
      sourceCursor: cursor,
      observedAt: `2026-09-24T00:00:0${second}Z`,
      motionStatus,
    });
    expect(await processor.applyStatus(run, status("status-1", 1, 5))).toBe("committed");
    expect(await processor.applyStatus(run, status("status-3", 3, 5))).toBe("committed");
    expect(await business.getContext(scope)).toMatchObject({
      phase: { code: "recon.motion.5", since: "2026-09-24T00:00:01Z" },
      summary: { properties: { reconStatusObservedAt: "2026-09-24T00:00:03Z" } },
    });
    expect(events).toHaveLength(1);
    expect(await processor.applyStatus(run, status("status-2", 2, 6))).toBe("duplicate");
    await expect(processor.applyStatus(run, status("status-3", 4, 6))).rejects.toThrow(
      "RECON_STATUS_SOURCE_CURSOR_CONFLICT",
    );
    expect(await processor.applyStatus(run, status("status-4", 4, 6))).toBe("committed");
    expect((await business.getContext(scope))?.phase).toMatchObject({
      code: "recon.resuming",
      since: "2026-09-24T00:00:04Z",
    });
    expect(events).toHaveLength(2);
  });

  it("keeps prior-mission and pre-execution observations out of the current recon Context", async () => {
    const { run, business, processor, events, scope } = await setup();
    const replacement = { ...run, downstreamMissionIds: ["mission-1", "mission-2"] };
    const status = {
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-2",
      sourceCursor: "current-status",
      observedAt: "2026-09-24T00:00:02Z",
      motionStatus: 5,
    };
    expect(await processor.applyStatus(replacement, status)).toBe("committed");
    const context = await business.getContext(scope);
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-2",
      sourceCursor: "current-coverage",
      observedAt: "2026-09-24T00:00:03Z",
      coverage: { coveragePercent: 20 },
    };
    for (const prior of [
      { ...status, missionId: "mission-1", sourceCursor: "prior-status" },
      { ...status, observedAt: "2026-09-23T23:59:59Z" },
    ]) {
      await expect(processor.applyStatus(replacement, prior)).rejects.toThrow(
        "RECON_FACT_EXECUTION_BINDING_INVALID",
      );
    }
    for (const prior of [
      { ...coverage, missionId: "mission-1", sourceCursor: "prior-coverage" },
      { ...coverage, observedAt: "2026-09-23T23:59:59Z" },
    ]) {
      await expect(processor.applyCoverage(replacement, prior)).rejects.toThrow(
        "RECON_FACT_EXECUTION_BINDING_INVALID",
      );
    }
    expect(await business.getContext(scope)).toEqual(context);
    expect(events).toHaveLength(1);
    expect(await processor.applyCoverage(replacement, coverage)).toBe("committed");
  });

  it("maps observed scan, lock, observe and resume phases without interpreting stage 4 as loss", async () => {
    const { run, business, processor, scope } = await setup();
    for (const [second, motionStatus, lockStage, phase] of [
      [1, 5, 1, "recon.scanning"],
      [2, 5, 2, "recon.locking"],
      [3, 5, 3, "recon.observing"],
      [4, 5, 4, "recon.lock.stage_4_unqualified"],
      [5, 6, 1, "recon.resuming"],
    ] as const) {
      await processor.applyStatus(run, {
        schemaVersion: "ugv.recon-status-fact/1",
        missionId: "mission-1",
        sourceCursor: `status-${second}`,
        observedAt: `2026-09-24T00:00:0${second}Z`,
        motionStatus,
        lockStage,
      });
      expect((await business.getContext(scope))?.phase?.code).toBe(phase);
    }
  });

  it("does not order different recon phases that share one observation time", async () => {
    const { run, business, processor, scope, events } = await setup();
    const status = (cursor: string, second: number, lockStage: 1 | 3 | 4) => ({
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-1",
      sourceCursor: cursor,
      observedAt: `2026-09-24T00:00:0${second}Z`,
      motionStatus: 5,
      lockStage,
    });
    expect(await processor.applyStatus(run, status("stage-4", 4, 4))).toBe("committed");
    const unqualified = await business.getContext(scope);
    const firstEventCount = events.length;
    expect(await processor.applyStatus(run, status("stage-3-tie", 4, 3))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(unqualified);
    expect(events).toHaveLength(firstEventCount);
    expect(await processor.applyStatus(run, status("stage-3", 5, 3))).toBe("committed");
    const observing = await business.getContext(scope);
    expect(observing?.phase?.code).toBe("recon.observing");
    const observingEventCount = events.length;
    expect(await processor.applyStatus(run, status("stage-1-tie", 5, 1))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(observing);
    expect(events).toHaveLength(observingEventCount);
  });

  it("projects an exact mission status topic through the UGV runtime poll wire", async () => {
    const { run, executions, business, service, scope } = await setup();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    let observationClock = Date.parse("2026-09-24T00:00:00Z");
    ingress.onSnapshot((_snapshot, _topic, applied) => {
      if (applied) observationClock = Math.max(observationClock, Date.parse(applied.observedAt));
    });
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
        freshness: {
          chassis: 3_000,
          mission: 3_000,
          health: 5_000,
          target: 3_000,
          payload: 3_000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        now: () => new Date(observationClock),
      },
      executions,
      ingress,
      new MockUgvDeviceMcpClient(),
      new UgvBusinessEventHub(executions),
      new UgvTelemetry({
        providerId: run.providerId ?? "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    try {
      await runtime.initializeLocal();
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(JSON.stringify({ mission_id: "mission-1", status: 5 })),
        false,
        "2026-09-24T00:00:01Z",
      );
      await runtime.pollActive();
      expect(await business.getContext(scope)).toMatchObject({
        contextRevision: 2,
        phase: { code: "recon.motion.5" },
      });
      await runtime.pollActive();
      expect((await business.getContext(scope))?.contextRevision).toBe(2);
      await executions.putExecution({
        ...run,
        revision: run.revision + 1,
        downstreamMissionIds: ["mission-1", "mission-2"],
      });
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(JSON.stringify({ mission_id: "mission-1", status: 6 })),
        false,
        "2026-09-24T00:00:02Z",
      );
      await runtime.pollActive();
      expect((await business.getContext(scope))?.contextRevision).toBe(2);
    } finally {
      await runtime.close();
    }
  });

  it("carries scan and unqualified lock stages through MQTT ingress without a lock Tool call", async () => {
    const { run, executions, business, service, scope } = await setup();
    const device = new MockUgvDeviceMcpClient();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    let observationClock = Date.parse("2026-09-24T00:00:00Z");
    ingress.onSnapshot((_snapshot, _topic, applied) => {
      if (applied) observationClock = Math.max(observationClock, Date.parse(applied.observedAt));
    });
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
        freshness: {
          chassis: 3_000,
          mission: 3_000,
          health: 5_000,
          target: 3_000,
          payload: 3_000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        now: () => new Date(observationClock),
      },
      executions,
      ingress,
      device,
      new UgvBusinessEventHub(executions),
      new UgvTelemetry({
        providerId: run.providerId ?? "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    try {
      await runtime.initializeLocal();
      const status = (stage: 1 | 2 | 3 | 4) =>
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            status: 5,
            lock: { stage, ...(stage === 3 || stage === 4 ? { target_id: "7" } : {}) },
          }),
        );
      expect(
        ingress.handle("/ugv/area_recon/status", status(1), false, "2026-09-24T00:00:04Z")
          .olderObservation,
      ).toBe(false);
      await vi.waitFor(async () => {
        expect((await business.getContext(scope))?.summary.properties).toMatchObject({
          nativeLockMissionId: "mission-1",
          nativeLockObservedAt: "2026-09-24T00:00:04Z",
        });
      });
      expect((await business.getContext(scope))?.actionRefs).toHaveLength(0);
      expect(
        ingress.handle("/ugv/area_recon/status", status(3), false, "2026-09-24T00:00:02Z")
          .olderObservation,
      ).toBe(true);
      expect((await business.getContext(scope))?.actionRefs).toHaveLength(0);
      ingress.handle("/ugv/area_recon/status", status(3), false, "2026-09-24T00:00:05Z");
      await vi.waitFor(async () => {
        expect((await business.getContext(scope))?.actionRefs).toHaveLength(1);
      });
      expect((await business.getContext(scope))?.summary.properties).toMatchObject({
        nativeLockObservedAt: "2026-09-24T00:00:05Z",
      });
      const active = await business.getContext(scope);
      ingress.handle("/ugv/area_recon/status", status(4), false, "2026-09-24T00:00:06Z");
      await vi.waitFor(async () => {
        expect((await business.getContext(scope))?.summary.properties).toMatchObject({
          nativeLockObservedAt: "2026-09-24T00:00:06Z",
        });
      });
      await runtime.pollActive();
      const afterUnqualified = await business.getContext(scope);
      expect(afterUnqualified?.actionRefs).toEqual(active?.actionRefs);
      expect(afterUnqualified?.phase?.code).toBe("recon.lock.stage_4_unqualified");
      expect(
        ingress.handle("/ugv/area_recon/status", status(3), false, "2026-09-24T00:00:06Z")
          .olderObservation,
      ).toBe(false);
      await runtime.pollActive();
      expect(await business.getContext(scope)).toEqual(afterUnqualified);
      expect(
        ingress.handle("/ugv/area_recon/status", status(3), false, "2026-09-24T00:00:05.500Z")
          .olderObservation,
      ).toBe(true);
      ingress.handle("/ugv/area_recon/status", status(2), false, "2026-09-24T00:00:07Z");
      await vi.waitFor(async () => {
        expect((await business.getContext(scope))?.summary.properties).toMatchObject({
          nativeLockObservedAt: "2026-09-24T00:00:07Z",
        });
      });
      await runtime.pollActive();
      const afterTargetless = await business.getContext(scope);
      expect(afterTargetless?.actionRefs).toEqual(active?.actionRefs);
      expect(
        ingress.handle("/ugv/area_recon/status", status(1), false, "2026-09-24T00:00:07Z")
          .olderObservation,
      ).toBe(false);
      await runtime.pollActive();
      expect(await business.getContext(scope)).toEqual(afterTargetless);
      expect(
        ingress.handle("/ugv/area_recon/status", status(3), false, "2026-09-24T00:00:06.500Z")
          .olderObservation,
      ).toBe(true);
      expect(device.calls.filter((call) => call.name === "ugv_area_recon_lock")).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  it("projects only coverage carried by the exact mission status message", async () => {
    const { run, executions, business, service, scope } = await setup();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65_536,
      maxDepth: 16,
      maxNodes: 4_096,
      maxStringBytes: 16_384,
    });
    let observationClock = Date.parse("2026-09-24T00:00:00Z");
    ingress.onSnapshot((_snapshot, _topic, applied) => {
      if (applied) observationClock = Math.max(observationClock, Date.parse(applied.observedAt));
    });
    const runtime = new UgvProviderRuntime(
      {
        providerId: run.providerId ?? "provider-a",
        resourceId: run.resourceId,
        freshness: {
          chassis: 3_000,
          mission: 3_000,
          health: 5_000,
          target: 3_000,
          payload: 3_000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        now: () => new Date(observationClock),
      },
      executions,
      ingress,
      new MockUgvDeviceMcpClient(),
      new UgvBusinessEventHub(executions),
      new UgvTelemetry({
        providerId: run.providerId ?? "provider-a",
        enabled: false,
        endpoint: "127.0.0.1:7002",
        tlsMode: "disabled",
      }),
      service,
    );
    try {
      await runtime.initializeLocal();
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            status: 5,
            coverage: 20,
            coverage_covered: 2,
            coverage_total: 10,
          }),
        ),
        false,
        "2026-09-24T00:00:01Z",
      );
      await vi.waitFor(async () => {
        expect(await business.getContext(scope)).toMatchObject({
          contextRevision: 3,
          phase: { code: "recon.motion.5" },
          summary: {
            properties: {
              reconCoverage: { coveragePercent: 20, geometryAvailability: "unavailable" },
            },
          },
        });
      });
      expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.availability).toBe(
        "unavailable",
      );
      ingress.handle(
        "/ugv/area_recon/coverage",
        Buffer.from(JSON.stringify({ run_id: 7, coverage: 90, covered_n: 9, total: 10 })),
        false,
        "2026-09-24T00:00:02Z",
      );
      await runtime.pollActive();
      expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
        coveragePercent: 20,
      });
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            status: 5,
            lock: { stage: 2, target_id: 7 },
            coverage: 80,
            coverage_covered: 8,
            coverage_total: 10,
          }),
        ),
        false,
        "2026-09-24T00:00:03Z",
      );
      await runtime.pollActive();
      expect((await business.getContext(scope))?.activeRefs["visualLock:mission-1"]).toBeDefined();
      expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
        coveragePercent: 20,
      });
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(
          JSON.stringify({
            mission_id: "mission-1",
            status: 6,
            lock: { stage: 1 },
            coverage: 30,
            coverage_covered: 3,
            coverage_total: 10,
          }),
        ),
        false,
        "2026-09-24T00:00:04Z",
      );
      await runtime.pollActive();
      expect(
        (await business.getContext(scope))?.activeRefs["visualLock:mission-1"],
      ).toBeUndefined();
      expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
        coveragePercent: 30,
      });
      const beforeAdoption = await business.getContext(scope);
      const initialArea = await business.getArtifactLatest(scope, "recon-requested-area");
      const covered = await business.getArtifactLatest(scope, "recon-covered-area");
      if (!beforeAdoption || initialArea?.availability !== "available" || !covered) {
        throw new Error("SYNTHETIC_RECON_ADOPTION_FIXTURE_MISSING");
      }
      const adoptedAt = "2026-09-24T00:00:04.500Z";
      const adopted = TaskArtifactSchema.parse({
        ...initialArea,
        revision: 2,
        semantics: "planned",
        properties: { areaRevision: 2 },
        updatedAt: adoptedAt,
      });
      const reset = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId: covered.artifactId,
        artifactType: "recon.covered_area",
        revision: covered.revision + 1,
        semantics: "derived",
        lifecycle: "active",
        identity: covered.identity,
        source: { producer: "provider", method: "test_double" },
        createdAt: covered.createdAt,
        updatedAt: adoptedAt,
        availability: "not_produced_yet",
        reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
      });
      const areaRef = {
        kind: "artifact" as const,
        id: adopted.artifactId,
        revision: adopted.revision,
      };
      const resetRef = {
        kind: "artifact" as const,
        id: reset.artifactId,
        revision: reset.revision,
      };
      const properties = { ...beforeAdoption.summary.properties };
      delete properties.reconCoverage;
      delete properties.reconCoverageCursorHash;
      delete properties.reconCoverageSignature;
      delete properties.reconCoverageMissionId;
      const adoptedContext = TaskBusinessContextSchema.parse({
        ...beforeAdoption,
        contextRevision: beforeAdoption.contextRevision + 1,
        effectivePlanRevision: beforeAdoption.effectivePlanRevision + 1,
        activeRefs: { ...beforeAdoption.activeRefs, reconEffectiveArea: areaRef },
        artifactRefs: [...beforeAdoption.artifactRefs, areaRef, resetRef],
        summary: { ...beforeAdoption.summary, properties },
        updatedAt: adoptedAt,
      });
      const reasonCode = "RECON_AREA_ADOPTED";
      const changed = (ref: typeof areaRef) => ({
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "ARTIFACT_CHANGED",
          contextRevision: adoptedContext.contextRevision,
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
      await business.commitBusinessChangeSet(
        {
          scope,
          expectedContextRevision: beforeAdoption.contextRevision,
          context: adoptedContext,
          objects: [
            { kind: "artifact", value: adopted },
            { kind: "artifact", value: reset },
          ],
        },
        [
          changed(areaRef),
          changed(resetRef),
          {
            body: TaskBusinessFeedbackBodySchema.parse({
              schemaVersion: "sdar.task-business-feedback/1.0-rc2",
              kind: "BUSINESS_EVENT",
              contextRevision: adoptedContext.contextRevision,
              providerRecordedAt: adoptedAt,
              payload: {
                eventType: "recon.area_adopted",
                severity: "info",
                reasonCode,
                description: "Synthetic area adoption",
                contextDelta: {
                  activeRefs: adoptedContext.activeRefs,
                  effectivePlanRevision: adoptedContext.effectivePlanRevision,
                  summary: adoptedContext.summary,
                },
              },
            }),
            description: reasonCode,
            reasonCode,
            severityHint: "info",
          },
        ],
      );
      const coverageSpy = vi.spyOn(ReconBusinessProcessor.prototype, "applyCoverage");
      ingress.handle(
        "/ugv/area_recon/status",
        Buffer.from(JSON.stringify({ mission_id: "mission-1", status: 7, coverage: 40 })),
        false,
        "2026-09-24T00:00:05Z",
      );
      await runtime.pollActive();
      expect(coverageSpy).not.toHaveBeenCalled();
      coverageSpy.mockRestore();
      expect((await business.getContext(scope))?.phase?.code).toBe("recon.motion.7");
      expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toBeUndefined();
      expect(await business.getArtifactLatest(scope, "recon-covered-area")).toEqual(reset);
    } finally {
      await runtime.close();
    }
  });

  it("uses motionStatus for phase and keeps unlocated coverage as statistics without geometry", async () => {
    const { run, business, processor, events, scope } = await setup();
    const status = {
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "mission-1",
      sourceCursor: "status-cursor-1",
      observedAt: at,
      motionStatus: 5,
    };
    expect(await processor.applyStatus(run, status)).toBe("committed");
    expect(await processor.applyStatus(run, status)).toBe("duplicate");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 2,
      phase: { code: "recon.motion.5", reasonCode: "UGV_RECON_RUNNING" },
    });
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-cursor-1",
      observedAt: at,
      coverage: {
        runId: 7,
        coveragePercent: 20,
        coveredCount: 2,
        totalCount: 10,
        cellSizeM: 2,
        coveredCells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    };
    expect(await processor.applyCoverage(run, coverage)).toBe("committed");
    expect(await processor.applyCoverage(run, coverage)).toBe("duplicate");
    expect(await business.getContext(scope)).toMatchObject({
      contextRevision: 3,
      summary: {
        properties: {
          reconCoverage: {
            areaRevision: 1,
            coveragePercent: 20,
            coveredCount: 2,
            totalCount: 10,
            geometryAvailability: "unavailable",
          },
        },
      },
      activeRefs: {},
    });
    expect((await business.getArtifactVersion(scope, "recon-covered-area", 2))?.availability).toBe(
      "unavailable",
    );
    expect((await business.getArtifactVersion(scope, "recon-covered-area", 1))?.availability).toBe(
      "not_produced_yet",
    );
    expect(events).toHaveLength(3);
  });

  it("rejects changed coverage behind a reused mission source cursor", async () => {
    const { run, business, processor, events, scope } = await setup();
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-source-1",
      observedAt: "2026-09-24T00:00:01Z",
      coverage: { coveragePercent: 20 },
    };
    expect(await processor.applyCoverage(run, coverage)).toBe("committed");
    expect(await processor.applyCoverage(run, coverage)).toBe("duplicate");
    const context = await business.getContext(scope);
    const artifact = await business.getArtifactLatest(scope, "recon-covered-area");
    await expect(
      processor.applyCoverage(run, { ...coverage, coverage: { coveragePercent: 30 } }),
    ).rejects.toThrow("RECON_COVERAGE_SOURCE_CURSOR_CONFLICT");
    expect(await business.getContext(scope)).toEqual(context);
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toEqual(artifact);
    expect(events).toHaveLength(2);
  });

  it("does not replace coverage from a distinct cursor at the same source time", async () => {
    const { run, business, processor, events, scope } = await setup();
    const coverage = (cursor: string, second: number, coveragePercent: number) => ({
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: cursor,
      observedAt: `2026-09-24T00:00:0${second}Z`,
      coverage: { coveragePercent },
    });
    expect(await processor.applyCoverage(run, coverage("coverage-1", 1, 20))).toBe("committed");
    const first = await business.getContext(scope);
    const firstArtifact = await business.getArtifactLatest(scope, "recon-covered-area");
    const firstEventCount = events.length;
    expect(await processor.applyCoverage(run, coverage("coverage-1-tie", 1, 30))).toBe("duplicate");
    expect(await business.getContext(scope)).toEqual(first);
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toEqual(firstArtifact);
    expect(events).toHaveLength(firstEventCount);
    expect(await processor.applyCoverage(run, coverage("coverage-2", 2, 30))).toBe("committed");
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
      sourceObservedAt: "2026-09-24T00:00:02Z",
      coveragePercent: 30,
    });
  });

  it("uses explicitly framed cell indices for local covered geometry and retains prior statistics", async () => {
    const { run, business, processor, events, scope } = await setup();
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-grid-1",
      observedAt: at,
      coverage: {
        coveragePercent: 20,
        coveredCount: 2,
        totalCount: 10,
        coveredCells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      grid: {
        frameId: "sim-local-map",
        origin: [100, 200],
        cellSizeM: 2,
        denominatorCellCount: 10,
        axisConvention: "east_north",
        indexBasis: "zero_based_cell_index",
      },
    };
    expect(await processor.applyCoverage(run, coverage)).toBe("committed");
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toMatchObject({
      availability: "available",
      properties: {
        areaRevision: 1,
        numeratorCellCount: 2,
        grid: {
          frameId: "sim-local-map",
          origin: [100, 200],
          denominatorCellCount: 10,
        },
      },
      content: {
        kind: "local_geometry",
        frameId: "sim-local-map",
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [100, 200],
                [102, 200],
                [102, 202],
                [100, 202],
                [100, 200],
              ],
            ],
            [
              [
                [102, 200],
                [104, 200],
                [104, 202],
                [102, 202],
                [102, 200],
              ],
            ],
          ],
        },
      },
    });
    expect(
      await processor.applyCoverage(run, {
        ...coverage,
        coverage: {
          ...coverage.coverage,
          coveredCells: [...coverage.coverage.coveredCells].reverse(),
        },
      }),
    ).toBe("duplicate");
    await expect(
      processor.applyCoverage(run, {
        ...coverage,
        coverage: {
          ...coverage.coverage,
          coveredCells: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      }),
    ).rejects.toThrow("RECON_COVERAGE_SOURCE_CURSOR_CONFLICT");
    expect((await business.getContext(scope))?.contextRevision).toBe(2);
    expect(
      await processor.applyCoverage(run, { ...coverage, sourceCursor: "coverage-grid-2" }),
    ).toBe("duplicate");
    expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.revision).toBe(2);
    expect(
      await processor.applyCoverage(run, {
        ...coverage,
        sourceCursor: "coverage-grid-2",
        observedAt: "2026-09-24T00:00:01Z",
      }),
    ).toBe("committed");
    expect(await business.getArtifactVersion(scope, "recon-covered-area", 2)).toBeDefined();
    expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.revision).toBe(3);
    expect(events).toHaveLength(4);
  });

  it("rejects unbound mission and inconsistent grid/count instead of fabricating coverage", async () => {
    const { run, business, processor, events, scope } = await setup();
    const coverage = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-grid-invalid",
      observedAt: at,
      coverage: { coveredCount: 2, totalCount: 10, coveredCells: [{ x: 0, y: 0 }] },
      grid: {
        frameId: "sim-local-map",
        origin: [100, 200],
        cellSizeM: 2,
        denominatorCellCount: 10,
        axisConvention: "east_north",
        indexBasis: "zero_based_cell_index",
      },
    };
    await expect(processor.applyCoverage(run, { ...coverage, missionId: "other" })).rejects.toThrow(
      "RECON_FACT_EXECUTION_BINDING_INVALID",
    );
    await expect(processor.applyCoverage(run, coverage)).rejects.toThrow(
      "RECON_COVERAGE_GRID_COUNT_CONFLICT",
    );
    await expect(processor.applyCoverage({ ...run, state: "SUCCEEDED" }, coverage)).rejects.toThrow(
      "RECON_FACT_TASK_TERMINAL",
    );
    expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.revision).toBe(1);
    expect(events).toHaveLength(0);
  });

  it("rejects contradictory source coverage counters and grid observations", async () => {
    const { run, business, processor, events, scope } = await setup();
    const grid = {
      frameId: "sim-local-map",
      origin: [100, 200],
      cellSizeM: 2,
      denominatorCellCount: 10,
      axisConvention: "east_north",
      indexBasis: "zero_based_cell_index",
    };
    const observation = {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "mission-1",
      sourceCursor: "coverage-counts-invalid",
      observedAt: at,
      coverage: { coveragePercent: 20, coveredCount: 2, totalCount: 10 },
    };
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        coverage: { ...observation.coverage, coveredCount: 11 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_COUNT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        coverage: { ...observation.coverage, coveragePercent: 80 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_PERCENT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        coverage: { coveredCount: 2, totalCount: 0 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_COUNT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        coverage: { sectorsCovered: 4, sectorsTotal: 3 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_COUNT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid: {
          frameId: "sim-local-map",
          origin: [100, 200],
          cellSizeM: 2,
          denominatorCellCount: 11,
          axisConvention: "east_north",
          indexBasis: "zero_based_cell_index",
        },
      }),
    ).rejects.toThrow("RECON_COVERAGE_GRID_DENOMINATOR_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid,
        coverage: { coveragePercent: 80, coveredCount: 2 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_PERCENT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid,
        coverage: { coveredCount: 11 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_COUNT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid: { ...grid, denominatorCellCount: 100 },
        coverage: { coveredCells: Array.from({ length: 101 }, (_, x) => ({ x, y: 0 })) },
      }),
    ).rejects.toThrow("RECON_COVERAGE_GRID_CELLS_INVALID");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid,
        coverage: { coveredCount: 2, cellSizeM: 4 },
      }),
    ).rejects.toThrow("RECON_COVERAGE_GRID_CELL_SIZE_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid: { ...grid, denominatorCellCount: 200 },
        coverage: {
          coveredCount: 102,
          coveredCells: Array.from({ length: 101 }, (_, x) => ({ x, y: 0 })),
        },
      }),
    ).rejects.toThrow("RECON_COVERAGE_GRID_COUNT_CONFLICT");
    await expect(
      processor.applyCoverage(run, {
        ...observation,
        grid: {
          frameId: "sim-local-map",
          origin: [100, 200],
          cellSizeM: 2,
          denominatorCellCount: 10,
          axisConvention: "east_north",
          indexBasis: "zero_based_cell_index",
        },
        coverage: {
          coveragePercent: 80,
          coveredCells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      }),
    ).rejects.toThrow("RECON_COVERAGE_PERCENT_CONFLICT");
    expect((await business.getArtifactLatest(scope, "recon-covered-area"))?.revision).toBe(1);
    expect((await business.getContext(scope))?.contextRevision).toBe(1);
    expect(events).toHaveLength(0);
    expect(
      await processor.applyCoverage(run, {
        ...observation,
        sourceCursor: "coverage-counts-rounded",
        coverage: { coveragePercent: 31, coveredCount: 133, totalCount: 424 },
      }),
    ).toBe("committed");
    expect((await business.getContext(scope))?.summary.properties?.reconCoverage).toMatchObject({
      coveragePercent: 31,
      coveredCount: 133,
      totalCount: 424,
    });
    expect(
      await processor.applyCoverage(run, {
        ...observation,
        sourceCursor: "coverage-cells-rounded",
        observedAt: "2026-09-24T00:00:01Z",
        grid,
        coverage: {
          coveragePercent: 20,
          coveredCells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      }),
    ).toBe("committed");
    expect(await business.getArtifactLatest(scope, "recon-covered-area")).toMatchObject({
      availability: "available",
      properties: { numeratorCellCount: 2 },
    });
  });
});
