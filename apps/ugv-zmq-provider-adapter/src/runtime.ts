import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import AjvImport, { type ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";
import { z } from "zod";
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
const Ajv = AjvImport as unknown as typeof AjvImport.default;
const addFormats = addFormatsImport as unknown as typeof addFormatsImport.default;
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
  constructor(
    readonly engine: ZmqControlEngine,
    readonly observer: ZmqObservationObserver,
    readonly business: ReturnType<typeof zmqBusiness>,
  ) {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const name of ZMQ_PROVIDER_TOOLS)
      this.validators.set(name, ajv.compile(zmqTool(name, this.resourceId).inputSchema));
    engine.events.on("execution", (e: ZmqExecution) =>
      this.events.emit(e.taskId, this.executionSnapshot(e)),
    );
  }
  get resourceId() {
    return this.engine.scope.profile.providerBinding.resourceId ?? "";
  }
  snapshot() {
    return this.observer.snapshot();
  }
  context(value?: ExecutionContextRecord) {
    const c = StartControl.shape.executionContext.parse({
      ...value,
      executionMode: value?.executionMode.toLowerCase(),
    });
    if (c.simulationId !== this.engine.scope.profile.executionDomain.simulationId)
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
      const c = this.context(context);
      if (!ZMQ_CONTROL_TOOLS.has(name)) {
        if (name.endsWith("_result")) await this.read(name, args, c);
        return result(true, "ZMQ_READ_AVAILABLE");
      }
      nativeTiming(timing);
      const a = await this.engine.checkAvailability(zmqOperation(name, args).operation, c);
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
    const c = this.context(input.executionContext);
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
      const native = zmqOperation(input.operationName, input.arguments);
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
      await this.engine.repository.store.putExecution(e);
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
    if (name === "vehicle_get_capabilities")
      return {
        schemaVersion: "ugv.zmq-provider-capabilities/1",
        qualification: "isolated_simulator_only",
        catalogProfile: "zmq_v1_12",
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
    if (["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"].includes(name))
      return this.snapshot();
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
          executionMode: "SIMULATION",
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
    args[0] = { ...args[0], executionContext: this.context(args[0].executionContext) };
    return this.business.service.getBusinessContext(...args);
  }
  getBusinessSnapshotPart(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessSnapshotPart"]>
  ) {
    args[0] = { ...args[0], executionContext: this.context(args[0].executionContext) };
    return this.business.service.getBusinessSnapshotPart(...args);
  }
  getBusinessArtifact(
    ...args: Parameters<ReturnType<typeof zmqBusiness>["service"]["getBusinessArtifact"]>
  ) {
    args[0] = { ...args[0], executionContext: this.context(args[0].executionContext) };
    return this.business.service.getBusinessArtifact(...args);
  }
  executionSnapshot(e: ProviderExecution): Record<string, unknown> {
    return {
      taskId: e.taskId,
      externalExecutionId: e.externalExecutionId,
      operationName: e.operationName,
      argumentHash: e.argumentHash,
      executionContext: { ...e.executionContext, executionMode: "SIMULATION" },
      state: e.state === "STARTING" ? "ACCEPTED" : e.state,
      revision: String(e.revision),
      reasonCode: e.reasonCode,
      message: e.reasonCode,
      retryable: false,
      observedAt: protoTime(e.updatedAt),
      evidence: e.evidence,
      ...(e.result ? { result: jsonToProtoStruct(e.result) } : {}),
    };
  }
}
