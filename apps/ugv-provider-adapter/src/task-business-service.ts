import { createHash } from "node:crypto";
import {
  TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  TaskBusinessOperationProfileSchema,
  type AdapterBusinessEvent,
  type BusinessSnapshotPartSelector,
  type TaskBusinessOperationProfile,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  contextObjectRefs,
  scopeBusinessIdentity,
  type ProviderExecution,
  type ProviderStore,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type { VehicleBusinessReadIdentity } from "../../../packages/provider-adapter-kit/src/vehicle-grpc-server.js";
import {
  BusinessObjectRefSchema,
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  type TaskBusinessIdentity,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  TaskArtifactSchema,
  type TaskArtifact,
} from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  RequiredInputSchema,
  type RequiredInput,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

const businessOperations = new Set(["vehicle_navigate", "vehicle_area_recon"]);

export const UGV_READ_ONLY_BUSINESS_PROFILE = TaskBusinessOperationProfileSchema.parse({
  schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  profileVersion: "1.0-rc2",
  availability: "available",
  source: {
    sourceId: "vehicle.business",
    deliverySemantics: "durable_at_least_once",
    replaySupported: true,
  },
  artifactTypes: [],
  actionTypes: [],
  requiredInputTypes: [],
  interventionTypes: [],
  methods: {
    contextGet: "io.sdar/taskBusiness/context/get",
    snapshotPartGet: "io.sdar/taskBusiness/snapshotParts/get",
    artifactGet: "io.sdar/taskBusiness/artifacts/get",
    eventsListen: "io.sdar/businessEvents/listen",
    contentGet: true,
    inputUpdate: false,
    interventionApply: false,
  },
  semantics: {
    artifact: ["observed"],
    coordinateFrames: [],
    observationClockDomains: ["utc"],
  },
  limits: { maxInlineArtifactBytes: 65_536, maxWaitMs: 300_000, trajectoryMinSamples: 2 },
  policy: {
    visualLockOwner: "disabled",
    decisionMode: "none",
    onExpire: "end_observation",
    onDismiss: "end_observation",
    footprintMode: "disabled",
    coverageMode: "disabled",
  },
  qualification: {
    routeAdoption: "not_supported",
    footprint: "not_supported",
    automaticVisualLock: "not_supported",
    runtimeReplan: "not_supported",
  },
});

export const UGV_NAVIGATION_BUSINESS_PROFILE = TaskBusinessOperationProfileSchema.parse({
  ...UGV_READ_ONLY_BUSINESS_PROFILE,
  artifactTypes: ["navigation.destination", "navigation.waypoints", "navigation.trajectory"],
  semantics: { ...UGV_READ_ONLY_BUSINESS_PROFILE.semantics, artifact: ["requested", "observed"] },
});

export const UGV_RECON_BUSINESS_PROFILE = TaskBusinessOperationProfileSchema.parse({
  ...UGV_READ_ONLY_BUSINESS_PROFILE,
  actionTypes: ["sensor.visual_lock"],
  artifactTypes: [
    "recon.area",
    "recon.coverage_plan",
    "recon.covered_area",
    "target.object",
    "target.track",
  ],
  semantics: {
    ...UGV_READ_ONLY_BUSINESS_PROFILE.semantics,
    artifact: ["requested", "planned", "derived", "observed"],
  },
  policy: { ...UGV_READ_ONLY_BUSINESS_PROFILE.policy, coverageMode: "device_reported" },
});

/** Reuses the admitted Provider execution and its persisted scope for every read. */
export class UgvTaskBusinessContextService {
  constructor(
    readonly executions: Pick<ProviderStore, "getExecution">,
    readonly business: TaskBusinessStore,
    readonly providerId: string,
    readonly resourceId: string,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
  ) {}

  supports(operationName: string): boolean {
    return businessOperations.has(operationName);
  }

  readOnlyProfile(
    operationName: "vehicle_navigate" | "vehicle_area_recon",
  ): TaskBusinessOperationProfile {
    return operationName === "vehicle_navigate"
      ? UGV_NAVIGATION_BUSINESS_PROFILE
      : UGV_RECON_BUSINESS_PROFILE;
  }

  /** Resolve an input from the durable Context rather than inventing one from Execution state. */
  async activeRequiredInput(execution: ProviderExecution): Promise<RequiredInput | undefined> {
    if (execution.operationName !== "vehicle_area_recon" || !execution.taskBusinessContextExpected)
      return undefined;
    const scope = this.scopeFor(execution);
    const context = await this.business.getContext(scope);
    if (context?.summary.status !== "in_progress") return undefined;
    const refs = Object.values(context.activeRefs).filter((ref) => ref.kind === "input_request");
    if (refs.length !== 1) return undefined;
    const ref = refs[0];
    if (ref === undefined) return undefined;
    if (
      context.requiredInputRefs
        .filter((item) => item.id === ref.id)
        .reduce((latest, item) => Math.max(latest, item.revision), 0) !== ref.revision
    )
      return undefined;
    const version = await this.business.getObjectVersion(scope, ref);
    if (version?.kind !== "input_request") return undefined;
    const request = RequiredInputSchema.parse(version.value);
    return request.requestId === ref.id &&
      request.revision === ref.revision &&
      request.state === "pending"
      ? request
      : undefined;
  }

  async ensureForCreatedExecution(taskId: string): Promise<void> {
    const execution = await this.executions.getExecution(taskId);
    if (
      execution?.taskBusinessContextExpected !== true ||
      !this.supports(execution.operationName)
    ) {
      throw new Error("BUSINESS_EXECUTION_NOT_ELIGIBLE");
    }
    const scope = this.scopeFor(execution);
    if (await this.business.getContext(scope)) return;
    const identity = scopeBusinessIdentity(scope);
    const requestedNavigation = requestedNavigationIntent(execution, identity);
    const artifacts = [
      ...(requestedNavigation === undefined ? [] : [requestedNavigation]),
      ...requestedReconArtifacts(execution, identity),
    ];
    const artifactRefs = artifacts.map((artifact) => ({
      kind: "artifact" as const,
      id: artifact.artifactId,
      revision: artifact.revision,
    }));
    const context = TaskBusinessContextSchema.parse({
      schemaVersion: "sdar.task-business-context/1.0-rc2",
      identity,
      contextRevision: 1,
      effectivePlanRevision: 0,
      phase: { code: "execution.accepted", since: execution.createdAt },
      summary: { status: "in_progress" },
      activeRefs: {},
      artifactRefs,
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [],
      updatedAt: execution.createdAt,
    });
    const body = TaskBusinessFeedbackBodySchema.parse({
      schemaVersion: "sdar.task-business-feedback/1.0-rc2",
      kind: "BUSINESS_EVENT",
      contextRevision: 1,
      providerRecordedAt: execution.createdAt,
      payload: {
        eventType: "business.context_initialized",
        severity: "info",
        reasonCode: "BUSINESS_CONTEXT_INITIALIZED",
        description: "Business Context initialized for admitted execution",
        contextDelta: {
          phase: context.phase,
          summary: context.summary,
          activeRefs: {},
          effectivePlanRevision: 0,
        },
      },
    });
    const committed = await this.business.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: null,
        context,
        objects: artifacts.map((artifact) => ({ kind: "artifact" as const, value: artifact })),
      },
      [
        {
          body,
          description: "Business Context initialized",
          reasonCode: "BUSINESS_CONTEXT_INITIALIZED",
          severityHint: "info",
        },
        ...artifacts.map((artifact, index) => {
          const reasonCode =
            artifact.artifactType === "navigation.destination" ||
            artifact.artifactType === "navigation.waypoints"
              ? "NAVIGATION_INTENT_RECORDED"
              : artifact.artifactType === "recon.area"
                ? "RECON_AREA_REQUESTED"
                : artifact.artifactType === "recon.coverage_plan"
                  ? "RECON_SCAN_PLAN_NOT_PRODUCED"
                  : "RECON_COVERAGE_NOT_PRODUCED";
          return {
            body: TaskBusinessFeedbackBodySchema.parse({
              schemaVersion: "sdar.task-business-feedback/1.0-rc2",
              kind: "ARTIFACT_CHANGED",
              contextRevision: 1,
              providerRecordedAt: execution.createdAt,
              payload: { change: "create", artifactRef: artifactRefs[index], reasonCode },
            }),
            description: reasonCode,
            reasonCode,
            severityHint: "info" as const,
          };
        }),
      ],
    );
    for (const event of committed.events) this.notifyCommitted(event);
  }

  /** Archives the business view after the authoritative Provider execution is terminal. */
  async finalizeForTerminalExecution(execution: ProviderExecution): Promise<void> {
    if (
      execution.taskBusinessContextExpected !== true ||
      !this.supports(execution.operationName) ||
      !["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"].includes(execution.state)
    )
      return;
    const scope = this.scopeFor(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized") return;
      const finalizedAt =
        compareIsoTimestamps(execution.terminalAt ?? execution.updatedAt, current.updatedAt) >= 0
          ? (execution.terminalAt ?? execution.updatedAt)
          : current.updatedAt;
      const cancelledInputs: RequiredInput[] = [];
      for (const ref of Object.values(current.activeRefs)) {
        if (ref.kind !== "input_request") continue;
        const version = await this.business.getObjectVersion(scope, ref);
        if (version?.kind !== "input_request" || version.value.state !== "pending") continue;
        cancelledInputs.push(
          RequiredInputSchema.parse({
            ...version.value,
            revision: version.value.revision + 1,
            state: "cancelled",
            reasonCode: "INPUT_EXECUTION_TERMINATED",
            resolvedAt: finalizedAt,
          }),
        );
      }
      const cancelledIds = new Set(cancelledInputs.map((input) => input.requestId));
      const unresolvedRefs = Object.values(current.activeRefs).filter(
        (ref) =>
          ref.kind !== "artifact" && !(ref.kind === "input_request" && cancelledIds.has(ref.id)),
      );
      const summary = {
        ...current.summary,
        status: "finalized" as const,
        resultCode: execution.reasonCode,
        properties: {
          ...current.summary.properties,
          executionState: execution.state,
          unresolvedRefs,
        },
      };
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        phase: {
          code: `execution.${execution.state.toLowerCase()}`,
          since: finalizedAt,
          reasonCode: execution.reasonCode,
        },
        summary,
        activeRefs: {},
        requiredInputRefs: [
          ...current.requiredInputRefs,
          ...cancelledInputs.map((input) => ({
            kind: "input_request" as const,
            id: input.requestId,
            revision: input.revision,
          })),
        ],
        updatedAt: finalizedAt,
        finalizedAt,
      });
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "CONTEXT_FINALIZED",
        contextRevision: context.contextRevision,
        providerRecordedAt: finalizedAt,
        payload: {
          reasonCode: execution.reasonCode,
          finalContextRevision: context.contextRevision,
          summary,
          artifactRefs: context.artifactRefs,
          actionRefs: context.actionRefs,
          finalizedAt,
        },
      });
      const metadataBody = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "BUSINESS_EVENT",
        contextRevision: context.contextRevision,
        providerRecordedAt: finalizedAt,
        payload: {
          eventType: "business.context_finalized",
          severity: execution.state === "SUCCEEDED" ? "info" : "warning",
          reasonCode: execution.reasonCode,
          description: "Business Context terminal metadata",
          contextDelta: {
            phase: context.phase,
            summary: context.summary,
            activeRefs: context.activeRefs,
            effectivePlanRevision: context.effectivePlanRevision,
          },
        },
      });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: cancelledInputs.map((value) => ({ kind: "input_request" as const, value })),
          },
          [
            ...cancelledInputs.map((input) => ({
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "REQUIRED_INPUT_CHANGED",
                contextRevision: context.contextRevision,
                providerRecordedAt: finalizedAt,
                payload: {
                  change: "update",
                  requestRef: {
                    kind: "input_request" as const,
                    id: input.requestId,
                    revision: input.revision,
                  },
                  previousRevision: input.revision - 1,
                  reasonCode: "INPUT_EXECUTION_TERMINATED",
                },
              }),
              description: "INPUT_EXECUTION_TERMINATED",
              reasonCode: "INPUT_EXECUTION_TERMINATED",
              severityHint: "info" as const,
            })),
            {
              body: metadataBody,
              description: "Business Context terminal metadata",
              reasonCode: execution.reasonCode,
              severityHint: execution.state === "SUCCEEDED" ? "info" : "warning",
            },
            {
              body,
              description: "Business Context finalized",
              reasonCode: execution.reasonCode,
              severityHint: execution.state === "SUCCEEDED" ? "info" : "warning",
            },
          ],
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
  }

  async getBusinessContext(
    request: VehicleBusinessReadIdentity,
    maxPageBytes: number,
    pageCursor: string,
  ): Promise<Record<string, unknown>> {
    const scope = await this.boundScope(request);
    const page = await this.business.getContextSnapshotPage(
      scope,
      maxPageBytes,
      pageCursor || undefined,
    );
    if (!page) throw new Error("BUSINESS_CONTEXT_NOT_AVAILABLE");
    return page as unknown as Record<string, unknown>;
  }

  async getBusinessSnapshotPart(
    request: VehicleBusinessReadIdentity,
    selector: BusinessSnapshotPartSelector,
  ): Promise<{
    jsonBytes: Uint8Array;
    totalBytes: number;
    sha256: string;
    nextOffset?: number;
  }> {
    if (
      !Number.isSafeInteger(selector.contextRevision) ||
      selector.contextRevision < 0 ||
      !Number.isSafeInteger(selector.offset) ||
      selector.offset < 0 ||
      !Number.isInteger(selector.maxBytes) ||
      selector.maxBytes < 1 ||
      selector.maxBytes > 1_048_576
    )
      throw new Error("BUSINESS_SNAPSHOT_PART_INVALID");
    const scope = await this.boundScope(request);
    const context = await this.business.getContext(scope);
    if (context?.contextRevision !== selector.contextRevision)
      throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    let value: unknown = context;
    if (selector.objectRef !== undefined) {
      const ref = BusinessObjectRefSchema.safeParse(selector.objectRef);
      if (!ref.success) throw new Error("BUSINESS_SNAPSHOT_PART_INVALID");
      if (
        !contextObjectRefs(context).some(
          (listed) =>
            listed.kind === ref.data.kind &&
            listed.id === ref.data.id &&
            listed.revision === ref.data.revision,
        )
      )
        throw new Error("BUSINESS_SNAPSHOT_REF_NOT_ACTIVE");
      value = await this.business.getObjectVersion(scope, ref.data);
      if (value === undefined) throw new Error("BUSINESS_SNAPSHOT_REF_NOT_FOUND");
    }
    const bytes = Buffer.from(JSON.stringify(value));
    if (selector.offset > bytes.length) throw new Error("BUSINESS_SNAPSHOT_OFFSET_AHEAD");
    const end = Math.min(selector.offset + selector.maxBytes, bytes.length);
    if ((await this.business.getContext(scope))?.contextRevision !== selector.contextRevision)
      throw new Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    return {
      jsonBytes: bytes.subarray(selector.offset, end),
      totalBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(end < bytes.length ? { nextOffset: end } : {}),
    };
  }

  async getBusinessArtifact(
    request: VehicleBusinessReadIdentity,
    artifactId: string,
    revision: number | undefined,
    representationName: string,
    includeContent: boolean,
  ): Promise<{
    artifact: Record<string, unknown>;
    contentBytes?: Uint8Array;
    mediaType?: string;
    sha256?: string;
  }> {
    const scope = await this.boundScope(request);
    const artifact =
      revision === undefined
        ? await this.business.getArtifactLatest(scope, artifactId)
        : await this.business.getArtifactVersion(scope, artifactId, revision);
    if (!artifact) throw new Error("ARTIFACT_REVISION_NOT_FOUND");
    if (
      representationName &&
      artifact.availability === "available" &&
      !artifact.representations?.[representationName]
    ) {
      throw new Error("ARTIFACT_REPRESENTATION_NOT_FOUND");
    }
    if (!includeContent) return { artifact: artifact as unknown as Record<string, unknown> };
    const prepared = await this.business.readArtifactContent(
      scope,
      artifact.artifactId,
      artifact.revision,
      new Date(),
      representationName || undefined,
    );
    if (prepared.kind === "inline")
      return { artifact: artifact as unknown as Record<string, unknown> };
    const stored = await this.business.readArtifactContentBytes(
      scope,
      artifact.artifactId,
      artifact.revision,
      new Date(),
      representationName || undefined,
    );
    return {
      artifact: artifact as unknown as Record<string, unknown>,
      contentBytes: stored.bytes,
      mediaType: stored.mediaType,
      sha256: stored.sha256,
    };
  }

  private async boundScope(request: VehicleBusinessReadIdentity): Promise<BoundExecutionScope> {
    if (!request.taskId || !request.externalExecutionId)
      throw new Error("BUSINESS_EXECUTION_ID_REQUIRED");
    const execution = await this.executions.getExecution(request.taskId);
    if (!execution) throw new Error("BUSINESS_EXECUTION_NOT_FOUND");
    await this.finalizeForTerminalExecution(execution);
    if (execution.taskBusinessContextExpected !== true || !this.supports(execution.operationName)) {
      throw new Error("BUSINESS_CONTEXT_NOT_AVAILABLE");
    }
    if (
      execution.externalExecutionId !== request.externalExecutionId ||
      execution.executionContext.authorizationContextHash !==
        request.executionContext.authorizationContextHash ||
      execution.executionContext.executionMode.replaceAll("-", "_").toUpperCase() !==
        request.executionContext.executionMode.replaceAll("-", "_").toUpperCase() ||
      (execution.executionContext.simulationId || "") !==
        (request.executionContext.simulationId || "")
    ) {
      throw new Error("BUSINESS_READ_SCOPE_MISMATCH");
    }
    const scope = this.scopeFor(execution);
    if (!(await this.business.getContext(scope))) throw new Error("BUSINESS_CONTEXT_NOT_AVAILABLE");
    return scope;
  }

  private scopeFor(execution: ProviderExecution): BoundExecutionScope {
    if (execution.providerId !== this.providerId || execution.resourceId !== this.resourceId) {
      throw new Error("BUSINESS_READ_PROVIDER_MISMATCH");
    }
    return BoundExecutionScope.fromExecution(execution);
  }
}

/** Task arguments are requested intent; they are never promoted to a planner route. */
export function requestedNavigationIntent(
  execution: ProviderExecution,
  identity: TaskBusinessIdentity,
): TaskArtifact | undefined {
  if (execution.operationName !== "vehicle_navigate") return undefined;
  const mission = execution.arguments.mission;
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) return undefined;
  const fields = mission as Record<string, unknown>;
  let geometry: Record<string, unknown>;
  let artifactId: string;
  let artifactType: "navigation.destination" | "navigation.waypoints";
  let properties: Record<string, unknown>;
  if (fields.type === "point") {
    artifactId = "navigation-requested-destination";
    artifactType = "navigation.destination";
    properties = { intent: "requested" };
    geometry = { type: "Point", coordinates: requestedPosition(fields.target) };
  } else if (fields.type === "route") {
    if (!Array.isArray(fields.waypoints)) throw new Error("BUSINESS_NAVIGATION_WAYPOINTS_INVALID");
    artifactId = "navigation-requested-waypoints";
    artifactType = "navigation.waypoints";
    properties = { ordered: true, waypointCount: fields.waypoints.length };
    geometry = { type: "MultiPoint", coordinates: fields.waypoints.map(requestedPosition) };
  } else {
    return undefined;
  }
  return TaskArtifactSchema.parse({
    schemaVersion: "sdar.task-artifact/1.0-rc2",
    artifactId,
    artifactType,
    revision: 1,
    semantics: "requested",
    lifecycle: "active",
    identity,
    source: {
      producer: "provider",
      sourceRecordRef: execution.argumentHash,
      method: "admitted_task_arguments",
    },
    createdAt: execution.createdAt,
    updatedAt: execution.createdAt,
    availability: "available",
    properties,
    content: { kind: "geojson", crs: "OGC:CRS84", geometry },
  });
}

function requestedPosition(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BUSINESS_NAVIGATION_POSITION_INVALID");
  }
  const point = value as Record<string, unknown>;
  return point.altitude === undefined
    ? [point.longitude, point.latitude]
    : [point.longitude, point.latitude, point.altitude];
}

/** Requested region and explicit absences are persisted without inventing a scan or coverage. */
export function requestedReconArtifacts(
  execution: ProviderExecution,
  identity: TaskBusinessIdentity,
): TaskArtifact[] {
  if (execution.operationName !== "vehicle_area_recon") return [];
  const common = {
    schemaVersion: "sdar.task-artifact/1.0-rc2",
    revision: 1,
    lifecycle: "active",
    identity,
    source: {
      producer: "provider",
      sourceRecordRef: execution.argumentHash,
      method: "admitted_task_arguments",
    },
    createdAt: execution.createdAt,
    updatedAt: execution.createdAt,
  };
  const results: TaskArtifact[] = [];
  const scanMode = execution.arguments.scanMode;
  if (scanMode !== "circular" && scanMode !== 2) {
    const area = execution.arguments.area;
    if (!area || typeof area !== "object" || Array.isArray(area))
      throw new Error("BUSINESS_RECON_AREA_INVALID");
    const polygon = (area as Record<string, unknown>).polygon;
    if (!Array.isArray(polygon) || polygon.length < 3)
      throw new Error("BUSINESS_RECON_AREA_INVALID");
    const ring = polygon.map(requestedPosition);
    const first = ring[0];
    if (first === undefined) throw new Error("BUSINESS_RECON_AREA_INVALID");
    const last = ring.at(-1);
    if (last?.length !== first.length || last.some((value, i) => value !== first[i]))
      ring.push([...first]);
    results.push(
      TaskArtifactSchema.parse({
        ...common,
        artifactId: "recon-requested-area",
        artifactType: "recon.area",
        semantics: "requested",
        availability: "available",
        properties: { areaRevision: 1 },
        content: {
          kind: "geojson",
          crs: "OGC:CRS84",
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      }),
    );
  }
  results.push(
    TaskArtifactSchema.parse({
      ...common,
      artifactId: "recon-scan-plan",
      artifactType: "recon.coverage_plan",
      semantics: "planned",
      availability: "not_produced_yet",
      reasonCode: "SCAN_PLAN_NOT_PRODUCED",
    }),
    TaskArtifactSchema.parse({
      ...common,
      artifactId: "recon-covered-area",
      artifactType: "recon.covered_area",
      semantics: "derived",
      availability: "not_produced_yet",
      reasonCode: "COVERAGE_NOT_OBSERVED",
    }),
  );
  return results;
}
