import {
  siteControlTool,
  siteControlOperation,
  siteControlOutputSchema,
  SITE_CONTROL_PROFILE,
  SITE_TOOLS,
} from "../../../packages/vehicle-zmq-control/src/site-control-catalog.js";
import {
  SITE_CONTROL_V13_PROFILE,
  siteControlV13Tool,
  siteControlV13Operation,
  siteControlV13OutputSchema,
  resolveRegionArguments,
} from "../../../packages/vehicle-zmq-control/src/site-control-v13.js";
import { PLAN_ROUTE } from "../../../packages/vehicle-zmq-control/src/site-catalog.js";
import type { SiteReadonlyRuntime } from "./site-runtime.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import AjvImport, { type Options, type ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";
import { z } from "zod";
import { RESERVED_RESULT_FIELDS } from "../../../packages/domain/src/index.js";
import { nativeDtoOutputSchema } from "../../../packages/vehicle-zmq-control/src/result-schemas.js";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import type { AvailabilityDecision } from "../../../packages/vehicle-provider-core/src/index.js";
import type {
  VehicleAdapterRuntime,
  StartVehicleOperation,
  VehicleCommandIdentity,
  VehicleBusinessReadIdentity,
  VehicleTaskTiming,
  ProviderExecution,
  ExecutionContextRecord,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  type ZmqControlEngine,
  isZmqExecution,
  assertIdentity,
  StartControl,
  resultIdentity,
  type ZmqExecution,
} from "../../../packages/vehicle-zmq-control/src/index.js";
import {
  ZMQ_PROVIDER_TOOLS,
  ZMQ_CONTROL_TOOLS,
  zmqOperation,
  zmqTool,
} from "../../../packages/vehicle-zmq-control/src/catalog.js";
import {
  canonical,
  sha256,
  type ZmqObservationObserver,
} from "../../../packages/vehicle-zmq-observer/src/index.js";
import type { zmqBusiness } from "./business.js";
const Ajv = AjvImport as unknown as new (options: Options) => {
  compile(schema: object): ValidateFunction;
};
const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
const query = z
  .object({
    resourceId: z.string(),
    taskId: z.string(),
    executionId: z.string(),
    afterRevision: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(8),
  })
  .strict();
export const protoTime = (iso: string) => {
  const ms = Date.parse(iso);
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1000000 };
};
export function nativeTiming(
  t: VehicleTaskTiming | undefined,
  now = Date.now(),
): z.infer<typeof StartControl>["timing"] {
  const mode = t?.start?.mode;
  if (mode !== undefined && mode !== "IMMEDIATE" && mode !== "SCHEDULED")
    throw Error("ZMQ_TIMING_MODE_INVALID");
  const scheduled = t?.start?.scheduledAt;
  const at = scheduled ? Number(scheduled.seconds) * 1000 + (scheduled.nanos ?? 0) / 1e6 : now;
  if (mode === "SCHEDULED" && !scheduled) throw Error("ZMQ_SCHEDULED_TIME_REQUIRED");
  const max = Number(t?.maxElapsedMs ?? 300000);
  const value = StartControl.shape.timing.parse({
    startAt: new Date(at).toISOString(),
    startToleranceMs: Number(t?.start?.startToleranceMs ?? 60000),
    maxElapsedMs: max,
    parentDeadlineAt: new Date(at + max).toISOString(),
  });
  if (now > at + value.startToleranceMs || now >= at + max)
    throw Error("ZMQ_START_OR_DEADLINE_EXPIRED");
  return value;
}
/** Formal protocol adapter. Device dispatch lives exclusively in the native engine. */
export class ZmqProviderRuntime implements VehicleAdapterRuntime<
  ReturnType<ZmqObservationObserver["snapshot"]>
> {
  readonly events = new EventEmitter();
  readonly validators = new Map<string, ValidateFunction>();
  readonly resultValidators = new Map<string, ValidateFunction>();
  readonly historicalResultValidators = new Map<string, ValidateFunction>();
  readonly legacySiteResultValidators = new Map<string, ValidateFunction>();
  constructor(
    readonly engine: ZmqControlEngine,
    readonly observer: ZmqObservationObserver,
    readonly business: ReturnType<typeof zmqBusiness>,
    readonly siteReads?: SiteReadonlyRuntime,
  ) {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const name of this.siteReads ? SITE_TOOLS : ZMQ_PROVIDER_TOOLS)
      this.validators.set(
        name,
        ajv.compile(
          (this.v13 ? siteControlV13Tool : this.siteReads ? siteControlTool : zmqTool)(
            name,
            this.resourceId,
          ).inputSchema,
        ),
      );
    for (const name of ZMQ_PROVIDER_TOOLS.slice(4))
      this.resultValidators.set(
        name,
        ajv.compile(
          this.v13
            ? siteControlV13OutputSchema(name, true)
            : this.siteReads
              ? siteControlOutputSchema(name, true)
              : nativeDtoOutputSchema(name),
        ),
      );
    for (const name of ZMQ_PROVIDER_TOOLS.slice(4))
      this.historicalResultValidators.set(name, ajv.compile(nativeDtoOutputSchema(name)));
    for (const name of ZMQ_PROVIDER_TOOLS.slice(4))
      this.legacySiteResultValidators.set(name, ajv.compile(siteControlOutputSchema(name, true)));
    engine.events.on("execution", (e: ZmqExecution) =>
      this.events.emit(e.taskId, this.executionSnapshot(e)),
    );
  }
  get resourceId() {
    return this.engine.scope.profile.providerBinding.resourceId ?? "";
  }
  get v13() {
    return this.engine.scope.settings.catalogProfile === SITE_CONTROL_V13_PROFILE;
  }
  get catalogProfile() {
    return this.v13
      ? SITE_CONTROL_V13_PROFILE
      : this.siteReads
        ? SITE_CONTROL_PROFILE
        : "zmq_v1_0_1_12";
  }
  snapshot() {
    return this.observer.snapshot();
  }
  context(value?: ExecutionContextRecord) {
    const c = StartControl.shape.executionContext.parse({
      ...value,
      executionMode: value?.executionMode.toLowerCase(),
    });
    if (
      (c.simulationId || null) !== this.engine.scope.profile.executionDomain.simulationId ||
      c.executionMode !== this.engine.scope.profile.executionDomain.mode
    )
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return c;
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
    timing?: VehicleTaskTiming,
  ): Promise<AvailabilityDecision> {
    const result = (available: boolean, reasonCode: string): AvailabilityDecision => ({
      availability: available ? "AVAILABLE" : "DISABLED",
      riskLevel: ZMQ_CONTROL_TOOLS.has(name) ? "MEDIUM" : "LOW",
      reasonCode,
      description: reasonCode,
    });
    try {
      this.validate(name, args);
      const c =
        this.siteReads && !ZMQ_CONTROL_TOOLS.has(name)
          ? this.siteReads.context(context)
          : this.context(context);
      if (!ZMQ_CONTROL_TOOLS.has(name)) {
        if (name.endsWith("_result")) await this.read(name, args, c);
        return result(true, "ZMQ_READ_AVAILABLE");
      }
      nativeTiming(timing);
      const a = await this.engine.checkAvailability(
        (this.v13 ? siteControlV13Operation : this.siteReads ? siteControlOperation : zmqOperation)(
          name,
          args,
        ).operation,
        c,
      );
      return result(a.available, a.reasonCode);
    } catch (e) {
      return result(
        false,
        e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
          ? e.message
          : "ZMQ_PARAMETERS_OR_IDENTITY_INVALID",
      );
    }
  }
  checkAvailability(
    name: string,
    args: Record<string, unknown>,
    context?: ExecutionContextRecord,
    timing?: VehicleTaskTiming,
  ) {
    return this.availability(name, args, context, timing);
  }
  async start(input: StartVehicleOperation) {
    this.validate(input.operationName, input.arguments);
    if (sha256(canonical(input.arguments)) !== input.argumentHash)
      throw Error("ZMQ_ARGUMENT_HASH_MISMATCH");
    const c =
      this.siteReads && !ZMQ_CONTROL_TOOLS.has(input.operationName)
        ? this.siteReads.context(input.executionContext)
        : this.context(input.executionContext);
    if (input.signal?.aborted) throw Error("ZMQ_ADMISSION_CANCELLED");
    const previous = await this.engine.repository.store.getExecution(input.taskId);
    if (previous) {
      this.match(previous, { ...input, executionContext: c });
      return {
        externalExecutionId: previous.externalExecutionId,
        initialSnapshot: this.executionSnapshot(previous),
      };
    }
    let e: ProviderExecution;
    if (ZMQ_CONTROL_TOOLS.has(input.operationName)) {
      const native = (
        this.v13 ? siteControlV13Operation : this.siteReads ? siteControlOperation : zmqOperation
      )(input.operationName, input.arguments);
      e = await this.engine.start(
        {
          taskId: input.taskId,
          commandId: input.taskId,
          resourceId: native.resourceId,
          operation: native.operation,
          executionContext: c,
          timing: nativeTiming(input.timing),
          admission: {
            operationName: input.operationName,
            argumentHash: input.argumentHash,
            arguments: input.arguments,
            ...(this.v13
              ? {
                  catalogProfile: SITE_CONTROL_V13_PROFILE,
                  ...(resolveRegionArguments(input.operationName, input.arguments)
                    .parameterResolution
                    ? {
                        parameterResolution: resolveRegionArguments(
                          input.operationName,
                          input.arguments,
                        ).parameterResolution,
                      }
                    : {}),
                }
              : {}),
          },
        },
        input.signal,
      );
    } else {
      const result = await this.read(input.operationName, input.arguments, c),
        at = new Date().toISOString();
      e = {
        taskId: input.taskId,
        externalExecutionId: randomUUID(),
        providerId: this.engine.scope.profile.providerBinding.providerId ?? "",
        operationName: input.operationName,
        argumentHash: input.argumentHash,
        resourceId: this.resourceId,
        tracks: [],
        arguments: input.arguments,
        executionContext: c,
        downstreamMissionIds: [],
        state: "SUCCEEDED",
        revision: 1,
        reasonCode: "ZMQ_READ_COMPLETED",
        result,
        createdAt: at,
        updatedAt: at,
        terminalAt: at,
        evidence: [],
      };
      if (!this.siteReads) await this.engine.repository.store.putExecution(e);
    }
    return {
      externalExecutionId: e.externalExecutionId,
      initialSnapshot: this.executionSnapshot(e),
    };
  }
  private async read(
    name: string,
    args: Record<string, unknown>,
    context: ExecutionContextRecord,
  ): Promise<Record<string, unknown>> {
    if (name === "vehicle_get_capabilities" && this.siteReads) {
      const readings = this.siteReads.capabilities();
      return {
        ...readings,
        schemaVersion: "ugv.zmq-site-capabilities/2",
        qualification: "site_control",
        catalogProfile: this.catalogProfile,
        executionDomain: this.engine.scope.profile.executionDomain,
        controlAdmission: "per_operation",
        controlAvailable: true,
        controlScopeHash: this.engine.scope.hash,
        controllerSystemId: this.engine.scope.profile.components.chassis.controllerSystemId,
        tools: SITE_TOOLS.map((name) => ({
          name,
          available: !ZMQ_CONTROL_TOOLS.has(name),
          blockers: [],
          requiresParameters: ZMQ_CONTROL_TOOLS.has(name),
        })),
      };
    }
    if (this.siteReads && name === PLAN_ROUTE) return this.siteReads.read(name, args, context);
    if (name === "vehicle_get_capabilities")
      return {
        schemaVersion: "ugv.zmq-provider-capabilities/1",
        qualification: "isolated_simulator_only",
        catalogProfile: "zmq_v1_0_1_12",
        resourceId: this.resourceId,
        executionMode: "simulation",
        simulationId: context.simulationId,
        controlScopeHash: this.engine.scope.hash,
        tools: ZMQ_PROVIDER_TOOLS,
        unsupported: [
          "distance_navigation",
          "relative_gimbal",
          "arbitrary_target_coordinates",
          "laser_range",
          "external_mission_stop",
          "navigation_planner_7879",
        ],
        completeSpatialEvidence: false,
      };
    if (this.siteReads && name === "vehicle_get_targets")
      return {
        ...this.snapshot(),
        effectCandidates: await this.engine.currentEffectCandidates(context),
      };
    if (["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"].includes(name))
      return this.snapshot();
    if (this.siteReads) return this.siteReads.read(name, args, context);
    const q = query.parse(args),
      e = await this.engine.get(q.taskId, context);
    if (e?.externalExecutionId !== q.executionId || e.resourceId !== q.resourceId)
      throw Error("ZMQ_RESULT_NOT_FOUND");
    return name === "vehicle_get_inspection_result"
      ? await this.engine.inspectionResults(resultIdentity(e), context, q.afterRevision, q.limit)
      : await this.engine.effectResults(resultIdentity(e), context, q.afterRevision, q.limit);
  }
  private match(
    e: ProviderExecution,
    input: Pick<StartVehicleOperation, "operationName" | "argumentHash" | "executionContext">,
  ) {
    if (
      e.providerId !== this.engine.scope.profile.providerBinding.providerId ||
      e.resourceId !== this.resourceId ||
      e.operationName !== input.operationName ||
      e.argumentHash !== input.argumentHash
    )
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    if (isZmqExecution(e)) assertIdentity(e, this.context(input.executionContext));
    else if (canonical(e.executionContext) !== canonical(this.context(input.executionContext)))
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
  }
  async get(taskId: string, identity?: VehicleBusinessReadIdentity) {
    if (!identity) throw Error("ZMQ_EXECUTION_IDENTITY_REQUIRED");
    if (this.siteReads) return this.siteReads.get(taskId, identity);
    const e = await this.engine.repository.store.getExecution(taskId);
    if (!e) return undefined;
    this.match(e, {
      operationName: e.operationName,
      argumentHash: e.argumentHash,
      executionContext: identity.executionContext,
    });
    if (identity.externalExecutionId !== e.externalExecutionId)
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return e;
  }
  async reconcile(input: StartVehicleOperation & { externalExecutionId?: string }) {
    const e = await this.engine.repository.store.getExecution(input.taskId);
    if (!e) return { status: "NOT_FOUND" };
    this.match(e, input);
    if (input.externalExecutionId && e.externalExecutionId !== input.externalExecutionId)
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return {
      status: "FOUND",
      externalExecutionId: e.externalExecutionId,
      snapshot: this.executionSnapshot(e),
    };
  }
  async command(action: "pause" | "resume" | "cancel", identity: VehicleCommandIdentity) {
    const e = await this.get(identity.taskId, identity);
    if (!e || !isZmqExecution(e)) throw Error("ZMQ_TASK_NOT_FOUND");
    this.match(e, identity);
    const next = await this.engine.control(action, {
      taskId: e.taskId,
      externalExecutionId: e.externalExecutionId,
      commandId: sha256(canonical({ identity, action })),
      executionContext: this.context(identity.executionContext),
    });
    return {
      accepted: true,
      reasonCode: next.reasonCode,
      message: next.reasonCode,
      commandSequence: identity.commandSequence,
      identity: {
        ...identity,
        executionContext: {
          ...this.context(identity.executionContext),
          executionMode: this.engine.scope.settings.mode === "site_control" ? "LIVE" : "SIMULATION",
        },
      },
    };
  }
  updateFire(): Promise<Record<string, unknown>> {
    return Promise.reject(Error("ZMQ_INPUT_UNSUPPORTED"));
  }
  getBusinessContext(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessContext"]>
  ) {
    args[0] = {
      ...args[0],
      executionContext: this.siteReads
        ? this.siteReads.context(args[0].executionContext)
        : this.context(args[0].executionContext),
    };
    return (this.siteReads?.business.service ?? this.business.service).getBusinessContext(...args);
  }
  getBusinessSnapshotPart(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessSnapshotPart"]>
  ) {
    args[0] = {
      ...args[0],
      executionContext: this.siteReads
        ? this.siteReads.context(args[0].executionContext)
        : this.context(args[0].executionContext),
    };
    return (this.siteReads?.business.service ?? this.business.service).getBusinessSnapshotPart(
      ...args,
    );
  }
  getBusinessArtifact(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessArtifact"]>
  ) {
    args[0] = {
      ...args[0],
      executionContext: this.siteReads
        ? this.siteReads.context(args[0].executionContext)
        : this.context(args[0].executionContext),
    };
    return (this.siteReads?.business.service ?? this.business.service).getBusinessArtifact(...args);
  }
  executionSnapshot(e: ProviderExecution): Record<string, unknown> {
    const validate = (
      e.executionContext.executionMode === "simulation"
        ? this.historicalResultValidators
        : isZmqExecution(e) && e.zmqAdmission?.catalogProfile === SITE_CONTROL_V13_PROFILE
          ? this.resultValidators
          : this.legacySiteResultValidators
    ).get(e.operationName);
    if (e.result && validate && !validate(e.result))
      throw Error("ZMQ_INTERNAL_RESULT_CONTRACT_INVALID");
    const publicResult = e.result
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
      // Attests this persisted report, including its gaps; it does not attest complete device coverage.
      evidence:
        publicResult && e.terminalAt
          ? [
              {
                evidenceId: sha256(
                  canonical({
                    taskId: e.taskId,
                    executionId: e.externalExecutionId,
                    operation: e.operationName,
                    resourceId: e.resourceId,
                    context: e.executionContext,
                    result: publicResult,
                  }),
                ),
                evidenceType: "ugv.zmq.retained_report",
                observedAt: e.terminalAt,
                subjectRef: e.resourceId,
                payloadRef: { kind: "structured_content", jsonPointer: "" },
                producer: [e.providerId, "ugv-zmq-provider-adapter"],
              },
            ]
          : e.evidence,
      ...(publicResult ? { result: jsonToProtoStruct(publicResult) } : {}),
    };
  }
}
