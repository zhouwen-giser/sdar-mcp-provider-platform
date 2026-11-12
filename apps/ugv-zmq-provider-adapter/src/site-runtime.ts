import {
  siteV151Tool,
  SITE_READONLY_V151_PROFILE,
} from "../../../packages/vehicle-zmq-control/src/site-v151.js";
import {
  siteV15Tool,
  SITE_V15_TOOLS,
  SITE_READONLY_V15_PROFILE,
} from "../../../packages/vehicle-zmq-control/src/site-v15.js";
import {
  FRAME_TOOL,
  FrameInput,
  type FrameService,
} from "../../../packages/vehicle-zmq-frames/src/index.js";
import { VIEW_TOOL } from "../../../packages/vehicle-zmq-control/src/simulation-view-contract.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import AjvImport, { type Options, type ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";
import { z } from "zod";
import type { ControlDeploymentProfile as DeploymentProfile } from "../../../packages/vehicle-zmq-contract/src/interop-profile.js";
import type { ZmqObservationObserver } from "../../../packages/vehicle-zmq-observer/src/index.js";
import { canonical, sha256 } from "../../../packages/vehicle-zmq-observer/src/index.js";
import { metadataPredicate } from "../../../packages/vehicle-zmq-control/src/metadata-scope.js";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import { RESERVED_RESULT_FIELDS } from "../../../packages/domain/src/index.js";
import type {
  VehicleAdapterRuntime,
  StartVehicleOperation,
  PostgresProviderStore,
  ProviderExecution,
  ExecutionContextRecord,
  VehicleBusinessReadIdentity,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { ZMQ_CONTROL_TOOLS } from "../../../packages/vehicle-zmq-control/src/catalog.js";
import { isZmqExecution } from "../../../packages/vehicle-zmq-control/src/model.js";
import {
  resultIdentity,
  resultPage,
  type ResultRecord,
} from "../../../packages/vehicle-zmq-control/src/results.js";
import {
  SITE_PROFILE,
  SITE_TOOLS,
  SITE_READONLY_REASON,
  PLAN_ROUTE,
  siteTool,
} from "../../../packages/vehicle-zmq-control/src/site-catalog.js";
import {
  foldInspection,
  inspectionReport,
} from "../../../packages/vehicle-zmq-control/src/inspection.js";
const protoTime = (iso: string) => {
  const ms = Date.parse(iso);
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1000000 };
};
import type { zmqBusiness } from "./business.js";
import type { SiteRoutePlanner } from "./site-planner.js";

const Ajv = AjvImport as unknown as new (options: Options) => {
  compile(schema: object): ValidateFunction;
};
const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
const contextSchema = z
  .object({
    authorizationContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionMode: z.enum(["live", "simulation"]),
    simulationId: z.string(),
    correlationId: z.string(),
  })
  .strict();
const query = z
  .object({
    resourceId: z.string(),
    taskId: z.string(),
    executionId: z.string(),
    afterRevision: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(8),
  })
  .strict();

/** No engine, native command transport, writer claim or recovery loop exists in this facade. */
export class SiteReadonlyRuntime implements VehicleAdapterRuntime<
  ReturnType<ZmqObservationObserver["snapshot"]>
> {
  readonly events = new EventEmitter();
  readonly validators = new Map<string, ValidateFunction>();
  constructor(
    readonly profile: DeploymentProfile,
    readonly observer: ZmqObservationObserver,
    readonly store: PostgresProviderStore,
    readonly business: Pick<ReturnType<typeof zmqBusiness>, "service">,
    readonly planner?: SiteRoutePlanner,
    readonly frames?: FrameService,
  ) {
    if (!profile.providerBinding.providerId || !profile.providerBinding.resourceId)
      throw Error("ZMQ_READONLY_LOGICAL_BINDING_REQUIRED");
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const name of this.toolNames)
      this.validators.set(
        name,
        ajv.compile(
          (this.v15
            ? (this.v151 ? siteV151Tool : siteV15Tool)(name, this.resourceId, true)
            : siteTool(name, this.resourceId)
          ).inputSchema,
        ),
      );
  }
  get v151() {
    return this.profile.schemaVersion === "ugv.zmq-site-deployment/3";
  }
  get v15() {
    return this.profile.components.eo.protocolVersion === "2.3";
  }
  get toolNames() {
    return this.v15 ? SITE_V15_TOOLS : SITE_TOOLS;
  }
  get catalogProfile() {
    return this.v151
      ? SITE_READONLY_V151_PROFILE
      : this.v15
        ? SITE_READONLY_V15_PROFILE
        : SITE_PROFILE;
  }
  isControl(name: string) {
    return ZMQ_CONTROL_TOOLS.has(name) || name === VIEW_TOOL;
  }
  get resourceId() {
    return this.profile.providerBinding.resourceId ?? "";
  }
  snapshot() {
    return this.observer.snapshot();
  }
  context(value?: ExecutionContextRecord) {
    return contextSchema.parse({ ...value, executionMode: value?.executionMode.toLowerCase() });
  }
  validate(name: string, args: Record<string, unknown>) {
    const fn = this.validators.get(name);
    if (!fn) throw Error("ZMQ_TOOL_UNPUBLISHED");
    if (!fn(args)) throw Error("ZMQ_TOOL_ARGUMENTS_INVALID");
  }
  async availability(
    name: string,
    args: Record<string, unknown>,
    context?: ExecutionContextRecord,
  ) {
    try {
      this.validate(name, args);
      if (this.isControl(name)) return this.decision(false, SITE_READONLY_REASON);
      this.context(context);
      if (name === FRAME_TOOL) {
        FrameInput.parse(args);
        if (!this.frames) return this.decision(false, "ZMQ_FRAME_ENDPOINT_UNCONFIGURED");
        this.frames.check(args, this.context(context));
      }
      if (name === PLAN_ROUTE && !this.planner)
        return this.decision(false, "UGV_PLANNER_FRAME_OR_POLICY_UNCONFIRMED");
      if (name.endsWith("_result")) await this.read(name, args, this.context(context));
      return this.decision(true, "ZMQ_SITE_READ_AVAILABLE");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return this.decision(
        false,
        /^[A-Z][A-Z0-9_]+$/.test(code) ? code : "ZMQ_PARAMETERS_OR_IDENTITY_INVALID",
      );
    }
  }
  checkAvailability(...args: Parameters<SiteReadonlyRuntime["availability"]>) {
    return this.availability(...args);
  }
  private decision(available: boolean, reasonCode: string) {
    return {
      availability: available ? ("AVAILABLE" as const) : ("DISABLED" as const),
      riskLevel: "LOW" as const,
      reasonCode,
      description: reasonCode,
    };
  }
  capabilities() {
    const blockers = (name: string) => {
      if (!this.isControl(name))
        return name === FRAME_TOOL && !this.frames
          ? ["ZMQ_FRAME_ENDPOINT_UNCONFIGURED"]
          : name === PLAN_ROUTE && !this.planner
            ? ["UGV_PLANNER_FRAME_OR_POLICY_UNCONFIRMED"]
            : [];
      const reasons = [SITE_READONLY_REASON, "SOURCE_RESTART_RECONCILIATION_UNAVAILABLE"];
      if (name === "vehicle_zmq_navigate") {
        reasons.push("CHASSIS_FEEDBACK_UNCORRELATED");
        if (this.profile.components.chassis.controllerSystemId === null)
          reasons.push("ZMQ_CHASSIS_CONTROL_SENDER_UNSPECIFIED");
      }
      if (name === "vehicle_zmq_inspect_area")
        reasons.push("INSPECTION_SOURCE_STREAM_NOT_RECOVERABLE");
      if (this.profile.executionDomain.simulationId === null)
        reasons.push("SIMULATION_ID_UNCONFIRMED");
      for (const [key, value] of Object.entries(this.profile.evidence))
        if (!value) reasons.push(`EVIDENCE_${key.toUpperCase()}_MISSING`);
      return reasons;
    };
    return {
      schemaVersion: "ugv.zmq-site-capabilities/1",
      qualification: "site_readonly",
      catalogProfile: this.catalogProfile,
      resourceId: this.resourceId,
      observationAdmission: "diagnostic_readonly",
      controlAdmission: "disabled",
      controlAvailable: false,
      executionDomain: this.profile.executionDomain,
      deploymentBinding: "unqualified_diagnostic",
      sourceProducerEpoch: null,
      ...(this.v151
        ? {
            chassisWire: {
              publicationFraming:
                "publicationFraming" in this.profile.components.chassis
                  ? this.profile.components.chassis.publicationFraming
                  : "prefix_wire_length_crc",
              commandFraming: "prefix_wire_length_crc",
              baseBusinessProtocol: "2.1",
              standard21Conformance:
                "publicationFraming" in this.profile.components.chassis &&
                this.profile.components.chassis.publicationFraming === "prefix_wire_length_crc",
            },
          }
        : {}),
      completeSpatialEvidence: false,
      tools: this.toolNames.map((name) => ({
        name,
        available: !blockers(name).length,
        blockers: blockers(name),
      })),
      planner: {
        policy: this.profile.planner.policy,
        available: !!this.planner,
        correlation: this.v151
          ? "request_id_epoch_context_and_geometry"
          : "geometry_only_no_request_id",
        ...(this.v151
          ? {
              coordinateFrame: "map_enu",
              entityId: "entityId" in this.profile.planner ? this.profile.planner.entityId : null,
              mapReference:
                "mapReference" in this.profile.planner ? this.profile.planner.mapReference : null,
            }
          : {}),
        adoption: "preview_only",
      },
    };
  }
  async start(input: StartVehicleOperation) {
    if (this.isControl(input.operationName)) throw Error(SITE_READONLY_REASON);
    this.validate(input.operationName, input.arguments);
    if (sha256(canonical(input.arguments)) !== input.argumentHash)
      throw Error("ZMQ_ARGUMENT_HASH_MISMATCH");
    const context = this.context(input.executionContext);
    if (input.signal?.aborted) throw Error("ZMQ_ADMISSION_CANCELLED");
    const result = await this.read(input.operationName, input.arguments, context, input.signal),
      at = new Date().toISOString();
    // Synchronous responses have no provider_task/ugv_execution row, native task or recovery state.
    const e: ProviderExecution = {
      taskId: input.taskId,
      externalExecutionId: randomUUID(),
      providerId: this.profile.providerBinding.providerId ?? "",
      resourceId: this.resourceId,
      operationName: input.operationName,
      argumentHash: input.argumentHash,
      arguments: input.arguments,
      executionContext: context,
      tracks: [],
      downstreamMissionIds: [],
      state: "SUCCEEDED",
      revision: 1,
      reasonCode: "ZMQ_SITE_READ_COMPLETED",
      result,
      createdAt: at,
      updatedAt: at,
      terminalAt: at,
      evidence: [],
    };
    return {
      externalExecutionId: e.externalExecutionId,
      initialSnapshot: this.executionSnapshot(e),
    };
  }
  async read(
    name: string,
    args: Record<string, unknown>,
    context: ExecutionContextRecord,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (name === "vehicle_get_capabilities") return this.capabilities();
    if (["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"].includes(name))
      return this.snapshot();
    if (name === FRAME_TOOL) {
      if (!this.frames) throw Error("ZMQ_FRAME_ENDPOINT_UNCONFIGURED");
      return this.frames.read(args, context, signal);
    }
    if (name === PLAN_ROUTE) {
      if (!this.planner) throw Error("UGV_PLANNER_FRAME_OR_POLICY_UNCONFIRMED");
      return this.planner.plan(args, signal);
    }
    const q = query.parse(args),
      e = await this.store.getExecution(q.taskId);
    if (
      !e ||
      !isZmqExecution(e) ||
      e.externalExecutionId !== q.executionId ||
      (name === "vehicle_get_inspection_result"
        ? e.operationName !== "vehicle_zmq_inspect_area"
        : e.operationName !== "simulation_apply_effect")
    )
      throw Error("ZMQ_RESULT_NOT_FOUND");
    this.match(e, context);
    const identity = resultIdentity(e);
    const retainedPage = async (after: number, limit: number) => {
      const rows = await this.store.pool.query<{ snapshot: ResultRecord }>(
        `SELECT snapshot FROM ugv_state_snapshot WHERE (${metadataPredicate(this.store.pool)}) AND snapshot->>'schemaVersion' IN ('ugv.zmq-result-record/1','ugv.zmq-result-record/2') AND snapshot->'identity'=$1::jsonb AND (snapshot->>'revision')::bigint>$2 ORDER BY (snapshot->>'revision')::bigint LIMIT $3`,
        [JSON.stringify(identity), after, limit + 1],
      );
      return resultPage(
        identity,
        rows.rows.map((r) => r.snapshot),
        after,
        limit,
      );
    };
    const page = await retainedPage(q.afterRevision, q.limit);
    let after = e.zmqInspection?.lastRevision ?? e.zmqEffect?.lastRevision ?? 0,
      pending = false;
    // Rebuild only an in-memory view. Finalized Context and stored execution remain unchanged.
    for (let n = 0; n < 32; n++) {
      const head = await retainedPage(after, 8);
      for (const record of head.records) {
        if (e.zmqInspection) foldInspection(e.zmqInspection, record);
        if (e.zmqEffect && record.kind === "effect") {
          e.zmqEffect.lastRevision = record.revision;
          e.zmqEffect.latest = record.content;
          const task = record.content.nativeTask;
          e.zmqEffect.executionFinished =
            task !== null &&
            typeof task === "object" &&
            "execution_finished" in task &&
            task.execution_finished === true;
        }
      }
      pending = head.hasMore;
      if (!head.hasMore) break;
      after = head.nextRevision;
    }
    if (e.zmqInspection) {
      if (pending) e.zmqInspection.missingEvidence.push("LOCAL_SUMMARY_REBUILD_LIMIT_USE_PAGES");
      return {
        ...inspectionReport(e.zmqInspection, pending),
        ...(e.zmqAdmission?.parameterResolution
          ? { parameterResolution: structuredClone(e.zmqAdmission.parameterResolution) }
          : {}),
        schemaVersion:
          identity.executionMode === "live"
            ? "ugv.zmq-inspection-result/2"
            : "ugv.zmq-inspection-result/1",
        identity,
        page,
      };
    }
    if (!e.zmqEffect) throw Error("ZMQ_SIMULATION_EFFECT_TASK_REQUIRED");
    if (pending) throw Error("ZMQ_RESULT_SUMMARY_REBUILD_LIMIT_USE_PAGES");
    const missing = new Set(e.zmqControl.missingEvidence);
    if (e.zmqEffect.executionFinished === true) {
      missing.delete("SIMULATION_EXECUTION_NOT_CONFIRMED_FINISHED");
      if (e.zmqControl.occupancy === "held") missing.add("SIMULATION_IDLE_STATE_UNCONFIRMED");
    }
    if (!e.zmqEffect.latest) missing.add("NATIVE_EFFECT_TASK_REPORT_MISSING");
    const native = e.zmqEffect.latest?.nativeTask;
    if (
      native !== null &&
      typeof native === "object" &&
      "effect" in native &&
      native.effect === "unknown"
    )
      missing.add("SIMULATION_EFFECT_UNKNOWN");
    return {
      schemaVersion:
        identity.executionMode === "live" ? "ugv.zmq-effect-query/2" : "ugv.zmq-effect-query/1",
      identity,
      originalTask: {
        state: e.state,
        reasonCode: e.reasonCode,
        terminalAt: e.terminalAt ?? null,
        result: e.result ?? null,
      },
      latestRevision: e.zmqEffect.lastRevision,
      latest: e.zmqEffect.latest,
      occupancy: e.zmqControl.occupancy,
      executionFinished: e.zmqEffect.executionFinished,
      missingEvidence: [...missing],
      page,
    };
  }

  private match(e: ProviderExecution, c: ExecutionContextRecord) {
    if (
      e.providerId !== this.profile.providerBinding.providerId ||
      e.resourceId !== this.resourceId ||
      e.executionContext.authorizationContextHash !== c.authorizationContextHash ||
      e.executionContext.executionMode.toLowerCase() !== c.executionMode ||
      e.executionContext.simulationId !== c.simulationId
    )
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
  }
  async get(taskId: string, identity?: VehicleBusinessReadIdentity) {
    if (!identity) throw Error("ZMQ_EXECUTION_IDENTITY_REQUIRED");
    const e = await this.store.getExecution(taskId);
    if (!e) return undefined;
    this.match(e, this.context(identity.executionContext));
    if (e.externalExecutionId !== identity.externalExecutionId)
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return e;
  }
  async reconcile(input: StartVehicleOperation & { externalExecutionId?: string }) {
    const e = await this.store.getExecution(input.taskId);
    if (!e) return { status: "NOT_FOUND" };
    this.match(e, this.context(input.executionContext));
    if (
      e.operationName !== input.operationName ||
      e.argumentHash !== input.argumentHash ||
      (input.externalExecutionId && e.externalExecutionId !== input.externalExecutionId)
    )
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return {
      status: "FOUND",
      externalExecutionId: e.externalExecutionId,
      snapshot: this.executionSnapshot(e),
    };
  }
  command(
    ..._args: Parameters<VehicleAdapterRuntime["command"]>
  ): Promise<Record<string, unknown>> {
    void _args;
    return Promise.reject(Error(SITE_READONLY_REASON));
  }
  updateFire(
    ..._args: Parameters<VehicleAdapterRuntime["updateFire"]>
  ): Promise<Record<string, unknown>> {
    void _args;
    return Promise.reject(Error(SITE_READONLY_REASON));
  }
  applyIntervention(): Promise<Record<string, unknown>> {
    return Promise.reject(Error(SITE_READONLY_REASON));
  }
  private async historyIdentity(identity: VehicleBusinessReadIdentity) {
    await this.get(identity.taskId, identity);
    return { ...identity, executionContext: this.context(identity.executionContext) };
  }
  async getBusinessContext(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessContext"]>
  ) {
    args[0] = await this.historyIdentity(args[0]);
    return this.business.service.getBusinessContext(...args);
  }
  async getBusinessSnapshotPart(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessSnapshotPart"]>
  ) {
    args[0] = await this.historyIdentity(args[0]);
    return this.business.service.getBusinessSnapshotPart(...args);
  }
  async getBusinessArtifact(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessArtifact"]>
  ) {
    args[0] = await this.historyIdentity(args[0]);
    return this.business.service.getBusinessArtifact(...args);
  }
  executionSnapshot(e: ProviderExecution): Record<string, unknown> {
    const result = e.result
      ? Object.fromEntries(
          Object.entries(e.result).filter(
            ([key]) => !RESERVED_RESULT_FIELDS.some((reserved) => reserved === key),
          ),
        )
      : undefined;
    return {
      taskId: e.taskId,
      externalExecutionId: e.externalExecutionId,
      operationName: e.operationName,
      argumentHash: e.argumentHash,
      executionContext: {
        ...e.executionContext,
        executionMode: e.executionContext.executionMode.toUpperCase(),
      },
      state: e.state === "STARTING" ? "ACCEPTED" : e.state,
      revision: String(e.revision),
      reasonCode: e.reasonCode,
      message: e.reasonCode,
      retryable: false,
      observedAt: protoTime(e.updatedAt),
      // Attest the returned report content, including its declared gaps. This
      // synchronous read supplies no physical coverage or terminal-action proof.
      evidence:
        result && e.terminalAt
          ? [
              {
                evidenceId: sha256(
                  canonical({
                    taskId: e.taskId,
                    executionId: e.externalExecutionId,
                    operation: e.operationName,
                    resourceId: e.resourceId,
                    context: e.executionContext,
                    result,
                  }),
                ),
                evidenceType:
                  e.operationName === FRAME_TOOL
                    ? "ugv.zmq.frame_chunk"
                    : "ugv.zmq.retained_report",
                observedAt: e.terminalAt,
                subjectRef: e.resourceId,
                payloadRef: { kind: "structured_content", jsonPointer: "" },
                producer: [e.providerId, "ugv-zmq-provider-adapter"],
              },
            ]
          : e.evidence,
      ...(result ? { result: jsonToProtoStruct(result) } : {}),
    };
  }
}
