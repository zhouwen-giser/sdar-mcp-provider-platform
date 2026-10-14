import { describe, expect, it, vi } from "vitest";
import {
  parseInspectionInput,
  inspectionReconArguments,
  inspectionPointInArea,
  inspectionSchemas,
} from "../../packages/vehicle-provider-core/src/inspection.js";
import {
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  BoundExecutionScope,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import {
  UgvTaskBusinessContextService,
  UGV_RECON_BUSINESS_PROFILE,
} from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { TargetBusinessProcessor } from "../../apps/ugv-provider-adapter/src/target-business-processor.js";
import { buildInspectionResult } from "../../apps/ugv-provider-adapter/src/inspection-report.js";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import {
  UgvOperationQualificationService,
  mockUgvToolContracts,
  startDeviceCalls,
  buildUgvStartFollowupCall,
  controlDeviceCalls,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import { TrackArbiter } from "../../packages/vehicle-provider-core/src/index.js";

const at = "2026-10-14T00:00:00.000Z";
const area = {
  boundary: [
    { x: 116, y: 39 },
    { x: 117, y: 39 },
    { x: 117, y: 40 },
    { x: 116, y: 40 },
  ],
};
const input = { resourceId: "vehicle:ugv1", area };
const contracts = mockUgvToolContracts(at);
function execution(): ProviderExecution {
  return {
    taskId: "inspection-task",
    externalExecutionId: "inspection-execution",
    operationName: "vehicle_inspect_area",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: input.resourceId,
    tracks: ["eo"],
    arguments: input,
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "inspection-isolated",
      correlationId: "inspection-correlation",
    },
    taskBusinessContextExpected: true,
    downstreamMissionIds: ["71"],
    state: "RUNNING",
    revision: 2,
    reasonCode: "UGV_RECON_RUNNING",
    createdAt: at,
    updatedAt: at,
    evidence: [],
    inspectionEvidence: { version: 1, deadlineAt: "2026-10-14T00:05:00.000Z", missingEvidence: [] },
  };
}
async function fixture() {
  const run = execution(),
    executions = new MemoryProviderStore(),
    business = new MemoryTaskBusinessStore();
  await executions.putExecution(run);
  const service = new UgvTaskBusinessContextService(
    executions,
    business,
    "provider-a",
    input.resourceId,
    () => undefined,
  );
  await service.ensureForCreatedExecution(run.taskId);
  return { run, executions, business, service };
}
function complete(run: ProviderExecution) {
  run.state = "SUCCEEDED";
  run.updatedAt = "2026-10-14T00:00:02.000Z";
  run.result = { status: "completed", observedAt: run.updatedAt };
  requiredInspection(run).targetReport = {
    cursor: "targets-1",
    observedAt: "2026-10-14T00:00:01.000Z",
    missionId: "71",
    correlation: "STRICT_CORRELATED",
    count: 0,
    complete: true,
  };
  requiredInspection(run).coverageReport = {
    cursor: "coverage-1",
    observedAt: "2026-10-14T00:00:01.000Z",
    missionId: "71",
    correlation: "STRICT_CORRELATED",
    coverage: { coveragePercent: 100, incomplete: false },
  };
}
describe("UGV inspection boundary and native EO contract", () => {
  it("keeps longitude/latitude order and fixes exactly one area scan", () => {
    expect(inspectionReconArguments(input)).toMatchObject({
      scanCount: 1,
      scanMode: "area",
      area: {
        polygon: [
          { longitude: 116, latitude: 39 },
          { longitude: 117, latitude: 39 },
          { longitude: 117, latitude: 40 },
          { longitude: 116, latitude: 40 },
        ],
      },
    });
    const calls = startDeviceCalls("vehicle_inspect_area", input);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "ugv_area_recon_configure",
      arguments: { scan_num: 1, scan_mode: 1 },
    });
    expect(buildUgvStartFollowupCall("vehicle_inspect_area", 71)).toEqual({
      name: "ugv_area_recon_control",
      arguments: { cmd_type: 1, mission_id: 71 },
    });
    expect(controlDeviceCalls("vehicle_inspect_area", "cancel", 71)).toEqual([
      { name: "ugv_area_recon_control", arguments: { cmd_type: 4, mission_id: 71 } },
    ]);
  });
  it.each([
    {
      boundary: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    },
    {
      boundary: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
    },
    {
      boundary: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    },
    {
      boundary: [
        { x: 181, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
      ],
    },
    {
      boundary: [
        { x: 1, y: 91 },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
      ],
    },
    {
      boundary: [
        { x: NaN, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 2 },
      ],
    },
  ])("rejects invalid geometry before creating a device call", (bad) => {
    expect(() =>
      startDeviceCalls("vehicle_inspect_area", { resourceId: input.resourceId, area: bad }),
    ).toThrow("UGV_INSPECTION_AREA_INVALID");
  });
  it("rejects local frames and unresolved exclusions and accepts an explicitly closed WGS84 ring", () => {
    expect(() =>
      parseInspectionInput({ ...input, area: { ...area, frame: "carla_world" } }),
    ).toThrow("UGV_INSPECTION_CRS_UNSUPPORTED");
    expect(() =>
      parseInspectionInput({ ...input, area: { ...area, excludedZones: ["runway"] } }),
    ).toThrow("UGV_INSPECTION_EXCLUSIONS_UNRESOLVED");
    expect(
      parseInspectionInput({
        ...input,
        area: { ...area, frame: "EPSG:4326", boundary: [...area.boundary, area.boundary[0]] },
      }).area.boundary,
    ).toHaveLength(4);
    expect(inspectionPointInArea(parseInspectionInput(input), { x: 116.5, y: 39.5 })).toBe(true);
    expect(inspectionPointInArea(parseInspectionInput(input), { x: 115, y: 39.5 })).toBe(false);
  });
  it("qualifies original southbound phases and competes for the same EO track", () => {
    const q = new UgvOperationQualificationService();
    for (const phase of ["start", "pause", "resume", "cancel"] as const)
      expect(
        q.qualify({
          operationName: "vehicle_inspect_area",
          arguments: input,
          phase,
          contracts,
          executionMode: "simulation",
        }).qualified,
      ).toBe(true);
    const arbiter = new TrackArbiter();
    expect(arbiter.acquire("a", "vehicle_inspect_area").accepted).toBe(true);
    expect(arbiter.acquire("b", "vehicle_area_recon")).toMatchObject({
      accepted: false,
      reasonCode: "UGV_EO_TRACK_BUSY",
    });
    arbiter.release("a");
    expect(arbiter.acquire("b", "vehicle_area_recon").accepted).toBe(true);
  });
  it("publishes only with opt-in, qualified EO tools and a business profile", () => {
    const store = new MemoryProviderStore();
    const qualification = { contracts, executionMode: "simulation" as const };
    const operations = (flag: boolean, profile: boolean) =>
      ugvManifest(
        "provider-a",
        "1",
        store,
        input.resourceId,
        qualification,
        profile ? { vehicle_inspect_area: UGV_RECON_BUSINESS_PROFILE } : undefined,
        undefined,
        flag,
      ).operations as { name: string }[];
    expect(operations(false, true).some((o) => o.name === "vehicle_inspect_area")).toBe(false);
    expect(operations(true, false).some((o) => o.name === "vehicle_inspect_area")).toBe(false);
    expect(operations(true, true).some((o) => o.name === "vehicle_inspect_area")).toBe(true);
    expect(inspectionSchemas(input.resourceId).result.required).toContain("anomalies");
  });
});

describe("UGV inspection durable task-scoped findings", () => {
  it("does not attribute counters without an area revision to an adopted area", async () => {
    const { run, business } = await fixture();
    complete(run);
    const context = await business.getContext(BoundExecutionScope.fromExecution(run));
    if (!context) throw Error("TEST_CONTEXT_REQUIRED");
    const read = vi.spyOn(business, "getContext").mockResolvedValue({
      ...context,
      activeRefs: {
        ...context.activeRefs,
        reconEffectiveArea: { kind: "artifact", id: "effective-area", revision: 2 },
      },
    });
    const result = await buildInspectionResult(run, business);
    expect(result).toMatchObject({
      coverage: null,
      inspectionReport: { completion: "partial", coverageState: "unknown" },
    });
    expect(result.missingEvidence).toContain("INSPECTION_EFFECTIVE_AREA_CHANGED");
    read.mockRestore();
  });
  it("cannot treat an absent target stream as an empty successful report", async () => {
    const { run, business } = await fixture();
    run.state = "SUCCEEDED";
    const result = await buildInspectionResult(run, business);
    expect(result.anomalies).toEqual([]);
    expect(result.inspectionReport).toMatchObject({
      completion: "unavailable",
      targetReportComplete: false,
    });
    expect(result.missingEvidence).toContain("INSPECTION_TARGET_REPORT_MISSING");
  });
  it("accepts a qualified explicit empty report and preserves independent coverage quality", async () => {
    const { run, business } = await fixture();
    complete(run);
    expect(await buildInspectionResult(run, business)).toMatchObject({
      anomalies: [],
      missingEvidence: [],
      inspectionReport: { completion: "complete", findingCount: 0 },
    });
    requiredInspectionCoverage(run).coverage = { coveragePercent: 50, incomplete: true };
    expect(await buildInspectionResult(run, business)).toMatchObject({
      inspectionReport: { completion: "partial", coverageState: "partial" },
      missingEvidence: ["INSPECTION_COVERAGE_INCOMPLETE"],
    });
  });
  it("archives source discoveries, deduplicates versions and preserves them after terminal finalization", async () => {
    const { run, business, service, executions } = await fixture();
    const processor = new TargetBusinessProcessor(business, () => undefined);
    const fact = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "71",
      observationSessionId: "71",
      sensorId: "sensor-a",
      sourceTargetId: "target-a",
      sourceRevision: "100",
      observedAt: "2026-10-14T00:00:01.000Z",
      visibility: "visible",
      trackingState: "unlocked",
      targetType: "vehicle",
      location: { longitude: 116.5, latitude: 39.5 },
    };
    expect(await processor.apply(run, fact)).toBe("committed");
    expect(await processor.apply(run, fact)).toBe("duplicate");
    await expect(
      processor.apply(run, { ...fact, location: { longitude: 116.6, latitude: 39.5 } }),
    ).rejects.toThrow("TARGET_SOURCE_VERSION_CONFLICT");
    complete(run);
    run.result = await buildInspectionResult(run, business);
    await executions.putExecution(run);
    await service.finalizeForTerminalExecution(run);
    const retained = await executions.getExecution(run.taskId);
    expect(retained?.result).toMatchObject({
      anomalies: [{ targetId: "target-a", sourceRevision: "100", x: 116.5, y: 39.5 }],
      inspectionReport: { completion: "complete", findingCount: 1 },
    });
    expect(
      (await business.getContextSnapshot(BoundExecutionScope.fromExecution(run)))?.context.summary
        .status,
    ).toBe("finalized");
  });
  it("rejects another mission/session and never counts outside positions as inside findings", async () => {
    const { run, business } = await fixture();
    const processor = new TargetBusinessProcessor(business, () => undefined);
    const fact = {
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "71",
      observationSessionId: "71",
      sensorId: "sensor-a",
      sourceTargetId: "target-a",
      sourceRevision: "100",
      observedAt: "2026-10-14T00:00:01.000Z",
      visibility: "visible",
      trackingState: "unlocked",
      location: { longitude: 115, latitude: 39.5 },
    };
    await expect(processor.apply(run, { ...fact, missionId: "72" })).rejects.toThrow(
      "TARGET_EXECUTION_SESSION_BINDING_INVALID",
    );
    await expect(processor.apply(run, { ...fact, observationSessionId: "other" })).rejects.toThrow(
      "TARGET_EXECUTION_SESSION_BINDING_INVALID",
    );
    await processor.apply(run, fact);
    complete(run);
    expect((await buildInspectionResult(run, business)).anomalies).toEqual([]);
    expect(
      (await business.getContextSnapshot(BoundExecutionScope.fromExecution(run)))?.objects.some(
        (o) => o.kind === "artifact" && o.value.artifactType === "target.object",
      ),
    ).toBe(true);
  });
  it("bounds large event reports by bytes and retains every event in the durable Context", async () => {
    const { run, business, service, executions } = await fixture();
    complete(run);
    const state = requiredInspection(run);
    const exceptions = Array.from({ length: 30 }, (_, i) => ({
      cursor: "event-" + String(i),
      sourceVersion: String(i),
      observedAt: at,
      missionId: "71",
      correlation: "STRICT_CORRELATED" as const,
      kind: "recon_exception" as const,
      errorCode: 1,
      reason: "x".repeat(16000),
    }));
    state.exceptions = [
      ...exceptions,
      {
        cursor: "outside",
        sourceVersion: "outside",
        observedAt: at,
        missionId: "71",
        correlation: "STRICT_CORRELATED",
        kind: "recon_exception",
        errorCode: 2,
        reason: "outside",
        longitude: 115,
        latitude: 39.5,
      },
    ];
    const result = await buildInspectionResult(run, business);
    expect(result.inspectionReport).toMatchObject({
      findingCount: 30,
      truncated: true,
      completion: "partial",
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(262144);
    run.result = result;
    await executions.putExecution(run);
    await service.finalizeForTerminalExecution(run);
    const context = await business.getContext(BoundExecutionScope.fromExecution(run));
    expect(context?.summary.properties?.inspectionExceptions).toHaveLength(31);
  });
  it("bounds the inline result at 256 while retaining all scoped business objects", async () => {
    const { run, business } = await fixture();
    const processor = new TargetBusinessProcessor(business, () => undefined);
    for (let i = 0; i < 260; i++)
      await processor.apply(run, {
        schemaVersion: "ugv.recon-target-fact/1",
        missionId: "71",
        observationSessionId: "71",
        sensorId: "sensor-a",
        sourceTargetId: `target-${String(i)}`,
        sourceRevision: "100",
        observedAt: "2026-10-14T00:00:01.000Z",
        visibility: "visible",
        trackingState: "unlocked",
      });
    complete(run);
    const result = await buildInspectionResult(run, business);
    expect(result.anomalies).toHaveLength(256);
    expect(result.inspectionReport).toMatchObject({
      findingCount: 260,
      truncated: true,
      completion: "partial",
    });
    expect(result.missingEvidence).toContain("INSPECTION_INLINE_REPORT_TRUNCATED");
    run.state = "BUSINESS_FAILED";
    const failed = await buildInspectionResult(run, business);
    expect(Buffer.byteLength(JSON.stringify(failed), "utf8")).toBeLessThan(60 * 1024);
    expect(failed.inspectionReport).toMatchObject({
      findingCount: 260,
      truncated: true,
      completion: "partial",
    });
    expect(failed.missingEvidence).toContain("INSPECTION_SCAN_NOT_COMPLETED");
    const snapshot = await business.getContextSnapshot(BoundExecutionScope.fromExecution(run));
    expect(
      snapshot?.objects.filter(
        (o) => o.kind === "artifact" && o.value.artifactType === "target.object",
      ),
    ).toHaveLength(260);
  });
});

function requiredInspection(run: ProviderExecution) {
  if (!run.inspectionEvidence) throw Error("TEST_INSPECTION_REQUIRED");
  return run.inspectionEvidence;
}
function requiredInspectionCoverage(run: ProviderExecution) {
  const evidence = requiredInspection(run);
  if (!evidence.coverageReport) throw Error("TEST_INSPECTION_COVERAGE_REQUIRED");
  return evidence.coverageReport;
}
