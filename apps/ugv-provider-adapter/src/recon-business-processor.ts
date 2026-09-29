import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  type AdapterBusinessEvent,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  scopeBusinessIdentity,
  type ProviderExecution,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { mapReconMotionStatus } from "../../../packages/vehicle-provider-core/src/task-state-mapper.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

const id = z.string().min(1).max(256);
const observedAt = z.iso.datetime({ offset: true });
const sourceCursor = z.string().min(1).max(4096);
const nonnegativeInteger = z.number().int().nonnegative();
const statusFactSchema = z
  .object({
    schemaVersion: z.literal("ugv.recon-status-fact/1"),
    missionId: id,
    sourceCursor,
    observedAt,
    motionStatus: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
      z.literal(11),
      z.literal(12),
      z.literal(13),
      z.literal(99),
    ]),
    lockStage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  })
  .strict();
const coverageObservationSchema = z
  .object({
    runId: nonnegativeInteger.optional(),
    scanMode: z.union([z.literal(1), z.literal(2)]).optional(),
    coveragePercent: z.number().min(0).max(100).optional(),
    coveredCount: nonnegativeInteger.optional(),
    totalCount: nonnegativeInteger.optional(),
    cellSizeM: z.number().positive().optional(),
    coveredCells: z
      .array(z.object({ x: nonnegativeInteger, y: nonnegativeInteger }).strict())
      .max(10_000)
      .optional(),
    sectorWidthDeg: z.number().nonnegative().optional(),
    sectorsTotal: nonnegativeInteger.optional(),
    sectorsCovered: nonnegativeInteger.optional(),
    incomplete: z.boolean().optional(),
    reason: id.optional(),
  })
  .strict();
const gridSchema = z
  .object({
    frameId: id,
    origin: z.tuple([z.number(), z.number()]),
    cellSizeM: z.number().positive(),
    denominatorCellCount: z.number().int().positive(),
    axisConvention: id,
    indexBasis: z.literal("zero_based_cell_index"),
  })
  .strict();
const coverageFactSchema = z
  .object({
    schemaVersion: z.literal("ugv.recon-coverage-fact/1"),
    missionId: id,
    /** Required after an adopted area change; the current status topic does not carry it. */
    areaRevision: z.number().int().positive().optional(),
    sourceCursor,
    observedAt,
    coverage: coverageObservationSchema,
    grid: gridSchema.optional(),
  })
  .strict();
export type ReconStatusFact = z.infer<typeof statusFactSchema>;
export type ReconCoverageFact = z.infer<typeof coverageFactSchema>;

const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Projects mission-bound recon facts; coverage requires caller-proven mission ownership. */
export class ReconBusinessProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getArtifactLatest" | "getObjectVersion" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
  ) {}

  async applyStatus(
    execution: ProviderExecution,
    input: unknown,
  ): Promise<"committed" | "duplicate"> {
    const fact = statusFactSchema.parse(input);
    this.assertExecution(execution, fact.missionId, fact.observedAt);
    const scope = BoundExecutionScope.fromExecution(execution);
    const cursorHash = hash(fact.sourceCursor);
    const statusSignature = hash(
      JSON.stringify([fact.missionId, fact.observedAt, fact.motionStatus, fact.lockStage ?? null]),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("RECON_CONTEXT_UNAVAILABLE");
      const sameMission = current.summary.properties?.reconStatusMissionId === fact.missionId;
      if (current.summary.properties?.reconStatusCursorHash === cursorHash && sameMission) {
        const priorSignature = current.summary.properties.reconStatusSignature;
        if (priorSignature !== undefined && priorSignature !== statusSignature)
          throw new Error("RECON_STATUS_SOURCE_CURSOR_CONFLICT");
        return "duplicate";
      }
      const recordedAt = current.summary.properties?.reconStatusObservedAt;
      const lastObservedAt =
        sameMission && typeof recordedAt === "string"
          ? recordedAt
          : sameMission
            ? current.phase?.since
            : undefined;
      if (
        lastObservedAt !== undefined &&
        compareIsoTimestamps(fact.observedAt, lastObservedAt) <= 0
      )
        return "duplicate";
      const mapped = mapReconMotionStatus(fact.motionStatus, true);
      const lockPhase =
        fact.motionStatus === 5 || fact.motionStatus === 6
          ? fact.lockStage === 2
            ? "recon.locking"
            : fact.lockStage === 3
              ? "recon.observing"
              : fact.lockStage === 4
                ? "recon.lock.stage_4_unqualified"
                : fact.motionStatus === 6
                  ? "recon.resuming"
                  : fact.lockStage === 1
                    ? "recon.scanning"
                    : undefined
          : undefined;
      const phase = {
        code: lockPhase ?? `recon.motion.${fact.motionStatus}`,
        since: fact.observedAt,
        reasonCode: mapped.reasonCode,
      };
      const properties = {
        ...current.summary.properties,
        reconStatusCursorHash: cursorHash,
        reconStatusMissionId: fact.missionId,
        reconStatusObservedAt: fact.observedAt,
        reconStatusSignature: statusSignature,
      };
      if (current.phase?.code === phase.code && sameMission) {
        const context = TaskBusinessContextSchema.parse({
          ...current,
          contextRevision: current.contextRevision + 1,
          summary: { ...current.summary, properties },
          updatedAt:
            compareIsoTimestamps(fact.observedAt, current.updatedAt) >= 0
              ? fact.observedAt
              : current.updatedAt,
        });
        try {
          await this.business.commitBusinessChangeSet(
            { scope, expectedContextRevision: current.contextRevision, context, objects: [] },
            [],
          );
          return "committed";
        } catch (error) {
          if (!retryableRevisionConflict(error, attempt)) throw error;
          continue;
        }
      }
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        phase,
        summary: {
          ...current.summary,
          properties,
        },
        updatedAt:
          compareIsoTimestamps(fact.observedAt, current.updatedAt) >= 0
            ? fact.observedAt
            : current.updatedAt,
      });
      const reasonCode = "RECON_MOTION_STATUS_OBSERVED";
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "BUSINESS_EVENT",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          eventType: "recon.motion_status_observed",
          severity: "info",
          reasonCode,
          description: `Recon motion status ${fact.motionStatus}`,
          data: {
            missionId: fact.missionId,
            motionStatus: fact.motionStatus,
            ...(fact.lockStage === undefined ? {} : { lockStage: fact.lockStage }),
          },
          contextDelta: { phase },
        },
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          { scope, expectedContextRevision: current.contextRevision, context, objects: [] },
          [{ body, description: reasonCode, reasonCode, severityHint: "info" }],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (!retryableRevisionConflict(error, attempt)) throw error;
      }
    }
    throw new Error("RECON_STATUS_RETRY_EXHAUSTED");
  }

  async applyCoverage(
    execution: ProviderExecution,
    input: unknown,
  ): Promise<"committed" | "duplicate" | "suppressed"> {
    const fact = coverageFactSchema.parse(input);
    this.assertExecution(execution, fact.missionId, fact.observedAt);
    const scope = BoundExecutionScope.fromExecution(execution);
    const cursorHash = hash(fact.sourceCursor);
    const coverageSignature = hash(
      canonicalJson({
        missionId: fact.missionId,
        areaRevision: fact.areaRevision ?? null,
        observedAt: fact.observedAt,
        coverage: {
          ...fact.coverage,
          ...(fact.coverage.coveredCells === undefined
            ? {}
            : {
                coveredCells: [...fact.coverage.coveredCells].sort(
                  (left, right) => left.x - right.x || left.y - right.y,
                ),
              }),
        },
        grid: fact.grid ?? null,
      }),
    );
    if (
      fact.coverage.coveragePercent === undefined &&
      fact.coverage.coveredCount === undefined &&
      fact.coverage.coveredCells === undefined &&
      fact.coverage.sectorsCovered === undefined
    )
      throw new Error("RECON_COVERAGE_OBSERVATION_EMPTY");
    assertCoverageCounters(fact);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized")
        throw new Error("RECON_CONTEXT_UNAVAILABLE");
      if (current.activeRefs[`visualLock:${fact.missionId}`] !== undefined) return "suppressed";
      if (
        current.summary.properties?.reconCoverageCursorHash === cursorHash &&
        current.summary.properties.reconCoverageMissionId === fact.missionId
      ) {
        const priorSignature = current.summary.properties.reconCoverageSignature;
        if (priorSignature !== undefined && priorSignature !== coverageSignature)
          throw new Error("RECON_COVERAGE_SOURCE_CURSOR_CONFLICT");
        return "duplicate";
      }
      const effectiveAreaRef = current.activeRefs.reconEffectiveArea;
      if (
        effectiveAreaRef &&
        (effectiveAreaRef.kind !== "artifact" || effectiveAreaRef.id !== "recon-requested-area")
      ) {
        throw new Error("RECON_EFFECTIVE_AREA_REF_INVALID");
      }
      // A newer requested/candidate area is history until adoption explicitly changes this ref.
      const areaVersion = await this.business.getObjectVersion(
        scope,
        effectiveAreaRef ?? { kind: "artifact", id: "recon-requested-area", revision: 1 },
      );
      const effectiveArea =
        areaVersion?.kind === "artifact" &&
        areaVersion.value.artifactType === "recon.area" &&
        areaVersion.value.availability === "available"
          ? areaVersion.value
          : undefined;
      if (
        !effectiveArea &&
        execution.arguments.scanMode !== "circular" &&
        execution.arguments.scanMode !== 2
      ) {
        throw new Error("RECON_EFFECTIVE_AREA_REF_INVALID");
      }
      if (effectiveAreaRef && effectiveArea?.semantics !== "planned") {
        throw new Error("RECON_EFFECTIVE_AREA_REF_INVALID");
      }
      const rawAreaRevision =
        effectiveArea && "areaRevision" in effectiveArea.properties
          ? effectiveArea.properties.areaRevision
          : undefined;
      const areaRevision =
        rawAreaRevision === undefined
          ? 1
          : typeof rawAreaRevision === "number"
            ? rawAreaRevision
            : NaN;
      if (!Number.isInteger(areaRevision) || areaRevision < 1) {
        throw new Error("RECON_AREA_REVISION_INVALID");
      }
      if (fact.areaRevision === undefined && areaRevision !== 1) {
        throw new Error("RECON_COVERAGE_AREA_REVISION_UNBOUND");
      }
      if (fact.areaRevision !== undefined && fact.areaRevision < areaRevision) return "duplicate";
      if (fact.areaRevision !== undefined && fact.areaRevision > areaRevision) {
        throw new Error("RECON_COVERAGE_AREA_REVISION_CONFLICT");
      }
      if (effectiveArea && compareIsoTimestamps(fact.observedAt, effectiveArea.updatedAt) < 0) {
        return "duplicate";
      }
      const previous = await this.business.getArtifactLatest(scope, "recon-covered-area");
      if (!previous) throw new Error("RECON_COVERAGE_ARTIFACT_MISSING");
      if (compareIsoTimestamps(fact.observedAt, previous.updatedAt) < 0) return "duplicate";
      const priorCoverage = current.summary.properties?.reconCoverage;
      if (
        current.summary.properties?.reconCoverageMissionId === fact.missionId &&
        typeof priorCoverage === "object" &&
        priorCoverage !== null &&
        "areaRevision" in priorCoverage &&
        priorCoverage.areaRevision === areaRevision &&
        "sourceObservedAt" in priorCoverage &&
        typeof priorCoverage.sourceObservedAt === "string" &&
        compareIsoTimestamps(fact.observedAt, priorCoverage.sourceObservedAt) <= 0
      )
        return "duplicate";
      const geometry = coverageGeometry(fact);
      const unavailableReason =
        fact.coverage.incomplete === true
          ? "COVERAGE_SOURCE_INCOMPLETE"
          : fact.grid === undefined
            ? "COVERAGE_GRID_FRAME_ORIGIN_UNKNOWN"
            : fact.coverage.coveredCells === undefined || fact.coverage.coveredCells.length === 0
              ? "COVERAGE_CELLS_MISSING"
              : "COVERAGE_GEOMETRY_LIMIT";
      const revision = previous.revision + 1;
      const artifact = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId: previous.artifactId,
        artifactType: "recon.covered_area",
        revision,
        semantics: "derived",
        lifecycle: "active",
        identity: scopeBusinessIdentity(scope),
        source: {
          producer: "device",
          sourceRecordRef: cursorHash,
          method: "mqtt_area_recon_coverage",
        },
        createdAt: previous.createdAt,
        updatedAt: fact.observedAt,
        ...(geometry === undefined
          ? {
              availability: "unavailable",
              reasonCode: unavailableReason,
            }
          : {
              availability: "available",
              properties: {
                areaRevision,
                grid: {
                  frameId: fact.grid?.frameId,
                  origin: fact.grid?.origin,
                  cellSizeM: fact.grid?.cellSizeM,
                  denominatorCellCount: fact.grid?.denominatorCellCount,
                },
                numeratorCellCount: geometry.cellCount,
              },
              content: geometry.content,
            }),
      });
      const ref = { kind: "artifact" as const, id: artifact.artifactId, revision };
      const coverageStats = {
        missionId: fact.missionId,
        areaRevision,
        sourceObservedAt: fact.observedAt,
        ...(fact.coverage.runId === undefined ? {} : { runId: fact.coverage.runId }),
        ...(fact.coverage.scanMode === undefined ? {} : { scanMode: fact.coverage.scanMode }),
        ...(fact.coverage.coveragePercent === undefined
          ? {}
          : { coveragePercent: fact.coverage.coveragePercent }),
        ...(fact.coverage.coveredCount === undefined
          ? {}
          : { coveredCount: fact.coverage.coveredCount }),
        ...(fact.coverage.totalCount === undefined ? {} : { totalCount: fact.coverage.totalCount }),
        geometryAvailability: artifact.availability,
      };
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        summary: {
          ...current.summary,
          properties: {
            ...current.summary.properties,
            reconCoverageCursorHash: cursorHash,
            reconCoverageSignature: coverageSignature,
            reconCoverageMissionId: fact.missionId,
            reconCoverage: coverageStats,
          },
        },
        artifactRefs: [...current.artifactRefs, ref],
        updatedAt:
          compareIsoTimestamps(fact.observedAt, current.updatedAt) >= 0
            ? fact.observedAt
            : current.updatedAt,
      });
      const reasonCode = "RECON_COVERAGE_OBSERVED";
      const artifactBody = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          change: "update",
          artifactRef: ref,
          previousRevision: previous.revision,
          reasonCode,
        },
      });
      const statsBody = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "BUSINESS_EVENT",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          eventType: "recon.coverage_observed",
          severity: "info",
          reasonCode,
          description: "Recon coverage statistics observed",
          subjects: [ref],
          data: coverageStats,
          contextDelta: { summary: context.summary },
        },
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [{ kind: "artifact", value: artifact }],
          },
          [
            { body: artifactBody, description: reasonCode, reasonCode, severityHint: "info" },
            { body: statsBody, description: reasonCode, reasonCode, severityHint: "info" },
          ],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (!retryableRevisionConflict(error, attempt)) throw error;
      }
    }
    throw new Error("RECON_COVERAGE_RETRY_EXHAUSTED");
  }

  private assertExecution(execution: ProviderExecution, missionId: string, factAt: string): void {
    if (
      execution.operationName !== "vehicle_area_recon" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== missionId ||
      compareIsoTimestamps(factAt, execution.createdAt) < 0
    )
      throw new Error("RECON_FACT_EXECUTION_BINDING_INVALID");
    if (terminal.has(execution.state)) throw new Error("RECON_FACT_TASK_TERMINAL");
  }
}

function retryableRevisionConflict(error: unknown, attempt: number): boolean {
  return (
    error instanceof Error && error.message === "BUSINESS_CONTEXT_REVISION_CONFLICT" && attempt < 2
  );
}

function assertCoverageCounters(fact: ReconCoverageFact): void {
  const { coverage, grid } = fact;
  if (
    (coverage.coveredCount !== undefined &&
      coverage.totalCount !== undefined &&
      coverage.coveredCount > coverage.totalCount) ||
    (grid !== undefined &&
      coverage.coveredCount !== undefined &&
      coverage.coveredCount > grid.denominatorCellCount) ||
    (coverage.sectorsCovered !== undefined &&
      coverage.sectorsTotal !== undefined &&
      coverage.sectorsCovered > coverage.sectorsTotal)
  ) {
    throw new Error("RECON_COVERAGE_COUNT_CONFLICT");
  }
  if (
    grid &&
    coverage.totalCount !== undefined &&
    coverage.totalCount !== grid.denominatorCellCount
  ) {
    throw new Error("RECON_COVERAGE_GRID_DENOMINATOR_CONFLICT");
  }
  if (grid && coverage.cellSizeM !== undefined && coverage.cellSizeM !== grid.cellSizeM) {
    throw new Error("RECON_COVERAGE_GRID_CELL_SIZE_CONFLICT");
  }
  if (grid && coverage.coveredCells) {
    const uniqueCells = new Set(coverage.coveredCells.map((cell) => `${cell.x},${cell.y}`));
    if (
      uniqueCells.size !== coverage.coveredCells.length ||
      coverage.coveredCells.length > grid.denominatorCellCount
    ) {
      throw new Error("RECON_COVERAGE_GRID_CELLS_INVALID");
    }
    if (
      coverage.incomplete !== true &&
      coverage.coveredCount !== undefined &&
      coverage.coveredCount !== coverage.coveredCells.length
    ) {
      throw new Error("RECON_COVERAGE_GRID_COUNT_CONFLICT");
    }
  }
  const denominator = coverage.totalCount ?? grid?.denominatorCellCount;
  const numerator =
    coverage.coveredCount ??
    (grid &&
    coverage.incomplete !== true &&
    coverage.coveredCells !== undefined &&
    coverage.coveredCells.length <= 100
      ? coverage.coveredCells.length
      : undefined);
  if (
    coverage.coveragePercent !== undefined &&
    numerator !== undefined &&
    denominator !== undefined &&
    Math.abs(coverage.coveragePercent - (denominator === 0 ? 0 : (numerator / denominator) * 100)) >
      1
  ) {
    throw new Error("RECON_COVERAGE_PERCENT_CONFLICT");
  }
}

function coverageGeometry(fact: ReconCoverageFact):
  | {
      cellCount: number;
      content: {
        kind: "local_geometry";
        frameId: string;
        unit: "m";
        axisConvention: string;
        geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
      };
    }
  | undefined {
  const cells = fact.coverage.coveredCells;
  const grid = fact.grid;
  if (
    fact.coverage.incomplete === true ||
    !grid ||
    !cells ||
    cells.length === 0 ||
    cells.length > 100
  )
    return undefined;
  const coordinates = cells.map((cell) => {
    const x = grid.origin[0] + cell.x * grid.cellSizeM;
    const y = grid.origin[1] + cell.y * grid.cellSizeM;
    const edge = grid.cellSizeM;
    return [
      [
        [x, y],
        [x + edge, y],
        [x + edge, y + edge],
        [x, y + edge],
        [x, y],
      ],
    ];
  });
  return {
    cellCount: cells.length,
    content: {
      kind: "local_geometry",
      frameId: grid.frameId,
      unit: "m",
      axisConvention: grid.axisConvention,
      geometry: { type: "MultiPolygon", coordinates },
    },
  };
}
