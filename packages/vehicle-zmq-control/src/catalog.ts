import { nativeOutputSchema } from "./result-schemas.js";
import { z } from "zod";
import {
  jsonToProtoStruct,
  TaskBusinessOperationProfileSchema,
} from "../../adapter-protocol/src/index.js";
import { zmqConsoleTool } from "../../vehicle-zmq-contract/src/console-contract.js";
import { EoRequest } from "../../vehicle-zmq-contract/src/index.js";
import { VehicleObservationStateV2 } from "../../vehicle-zmq-observer/src/state.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/types.js";
import { Operation } from "./model.js";
import { operationFromConsoleCandidate } from "./console-candidate.js";

export const ZMQ_PROVIDER_TOOLS = [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_zmq_navigate",
  "vehicle_zmq_area_recon",
  "vehicle_zmq_circular_recon",
  "vehicle_zmq_camera",
  "vehicle_zmq_inspect_area",
  "simulation_apply_effect",
  "vehicle_get_inspection_result",
  "simulation_get_effect_result",
] as const;
export const ZMQ_CONTROL_TOOLS = new Set<string>(ZMQ_PROVIDER_TOOLS.slice(4, 10));
export const ZMQ_BUSINESS_PROFILE = TaskBusinessOperationProfileSchema.parse({
  schemaVersion: "sdar.task-business-operation-profile/1.0-rc2",
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
  semantics: { artifact: ["observed"], coordinateFrames: [], observationClockDomains: ["utc"] },
  limits: { maxInlineArtifactBytes: 65536, maxWaitMs: 300000, trajectoryMinSamples: 2 },
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
const json = (schema: z.ZodType) => {
  const { $schema, ...value } = z.toJSONSchema(schema);
  void $schema;
  return value;
};
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const output = (schemaVersion: string) => ({
  type: "object",
  properties: { schemaVersion: { const: schemaVersion } },
  required: ["schemaVersion"],
  additionalProperties: true,
});
/** Explicit separate catalog. Its presence grants no field qualification. */
export function zmqTool(name: string, resourceId: string) {
  if (!(ZMQ_PROVIDER_TOOLS as readonly string[]).includes(name))
    throw Error("ZMQ_TOOL_UNPUBLISHED");
  const control = ZMQ_CONTROL_TOOLS.has(name),
    lifecycle = control && name !== "simulation_apply_effect";
  let inputSchema: Record<string, unknown>, extension: Record<string, unknown>;
  const resourceIdSchema = { type: "string", const: resourceId };
  if (
    [
      "vehicle_zmq_inspect_area",
      "simulation_apply_effect",
      "vehicle_get_inspection_result",
      "simulation_get_effect_result",
    ].includes(name)
  ) {
    const candidate = zmqConsoleTool(name, resourceId);
    inputSchema = candidate.inputSchema;
    extension = candidate._meta["io.sdar/ugvZmq"];
  } else if (name === "vehicle_zmq_area_recon") {
    inputSchema = zmqConsoleTool("vehicle_zmq_inspect_area", resourceId).inputSchema;
    extension = { consoleContract: "ugv.zmq-console/1", operation: name, protocol: "2.2" };
  } else {
    const properties: Record<string, unknown> = { resourceId: resourceIdSchema };
    if (name === "vehicle_zmq_navigate")
      properties.operation = json(
        z.union([Operation.options[0], Operation.options[1], Operation.options[2]]),
      );
    if (name === "vehicle_zmq_camera")
      properties.operation = json(
        z.union([Operation.options[7], Operation.options[8], Operation.options[9]]),
      );
    if (name === "vehicle_zmq_circular_recon") {
      // Request union is validated again by the frozen EO parser before native dispatch.
      const request = EoRequest.options.find((r) => r.shape.method.value === "CircularSearch");
      if (!request) throw Error("ZMQ_CIRCULAR_CONTRACT_MISSING");
      properties.params = json(request.shape.params);
    }
    if (name === "vehicle_get_state")
      properties.include = {
        type: "array",
        items: { enum: ["chassis", "payload", "health", "targets"] },
        uniqueItems: true,
      };
    inputSchema = object(
      properties,
      Object.keys(properties).filter((p) => p !== "include"),
    );
    extension = { consoleContract: "ugv.zmq-provider/1", operation: name, protocol: "native-v1" };
  }
  const outputSchema =
    name === "vehicle_get_state" ||
    name === "vehicle_get_payload_status" ||
    name === "vehicle_get_targets"
      ? json(VehicleObservationStateV2)
      : name === "vehicle_get_capabilities"
        ? output("ugv.zmq-provider-capabilities/1")
        : nativeOutputSchema(name);
  return {
    name,
    inputSchema,
    outputSchema,
    _meta: {
      "io.sdar/tool-execution-semantics": {
        effect: control ? "side_effecting" : "read_only",
        execution: control ? "task_required" : "synchronous",
        cancellation: lifecycle ? "task_cancel" : "unsupported",
        idempotency: "server_managed",
        replay: control ? "forbidden" : "allowed",
      },
      "io.sdar/ugvZmq": extension,
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: control ? "task_required" : "synchronous_only",
        availability: "dynamic",
        supportsScheduling: control,
        supportsMaxElapsed: control,
        supportsCancellation: lifecycle,
        supportsPauseResume: lifecycle,
        supportsObservations: control,
        supportsInputRequired: false,
        idempotency: "server_managed",
      },
      "io.sdar/resourceBinding": {
        mode: "ARGUMENT_REFERENCE",
        resourceIdJsonPointer: "/resourceId",
      },
      ...(control ? { "io.sdar/taskBusiness": ZMQ_BUSINESS_PROFILE } : {}),
    },
  };
}
export function zmqProviderManifest(providerId: string, resourceId: string, store: ProviderStore) {
  return {
    adapterProtocolVersion: "1.0",
    providerId,
    providerType: "isr.vehicle.ugv.zmq",
    providerVersion: "1.0.0",
    inventoryMode: "RUNTIME_VISIBLE",
    businessEventSources: store.businessEventSources(),
    operations: ZMQ_PROVIDER_TOOLS.map((name) => {
      const t = zmqTool(name, resourceId),
        p = t._meta["io.sdar/taskExecution"];
      return {
        name,
        description: `ZMQ v1 ${name}; isolated simulator qualification; no complete source history or field control claim.`,
        execution: ZMQ_CONTROL_TOOLS.has(name) ? "TASK_REQUIRED" : "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct(t.inputSchema),
        outputSchema: jsonToProtoStruct(t.outputSchema),
        resourceBinding: t._meta["io.sdar/resourceBinding"],
        capabilities: {
          availability: true,
          scheduling: p.supportsScheduling,
          maxElapsed: p.supportsMaxElapsed,
          cancel: p.supportsCancellation,
          pauseResume: p.supportsPauseResume,
          inputRequired: false,
          idempotency: true,
          observations: p.supportsObservations,
        },
        ...(ZMQ_CONTROL_TOOLS.has(name)
          ? { businessFeedbackProfile: jsonToProtoStruct(ZMQ_BUSINESS_PROFILE) }
          : {}),
      };
    }),
  };
}
export function zmqOperation(name: string, args: Record<string, unknown>) {
  if (name === "vehicle_zmq_inspect_area" || name === "simulation_apply_effect")
    return operationFromConsoleCandidate(name, args);
  if (name === "vehicle_zmq_area_recon") {
    const result = operationFromConsoleCandidate("vehicle_zmq_inspect_area", args);
    return { ...result, operation: Operation.parse({ ...result.operation, name: "recon.area" }) };
  }
  const value = z
    .object({
      resourceId: z.string().min(1),
      operation: z.unknown().optional(),
      params: z.unknown().optional(),
    })
    .strict()
    .parse(args);
  const operation = Operation.parse(
    name === "vehicle_zmq_circular_recon"
      ? { name: "recon.circular", params: value.params }
      : value.operation,
  );
  if (
    (name === "vehicle_zmq_navigate" && !operation.name.startsWith("navigation.")) ||
    (name === "vehicle_zmq_camera" && !operation.name.startsWith("camera.")) ||
    !["vehicle_zmq_navigate", "vehicle_zmq_camera", "vehicle_zmq_circular_recon"].includes(name)
  )
    throw Error("ZMQ_OPERATION_BINDING_INVALID");
  return { resourceId: value.resourceId, operation };
}
