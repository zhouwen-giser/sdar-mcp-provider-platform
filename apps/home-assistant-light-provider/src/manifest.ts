import {
  ADAPTER_PROTOCOL_VERSION,
  jsonToProtoStruct,
} from "../../../packages/adapter-protocol/src/index.js";

const rid = { type: "string", minLength: 1, maxLength: 128 };
const binding = { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" };
const caps = (schedule: boolean, observe: boolean) => ({
  availability: true,
  scheduling: schedule,
  maxElapsed: false,
  cancel: false,
  pauseResume: false,
  inputRequired: false,
  idempotency: true,
  observations: observe,
});

export function lightManifest(providerId: string, version: string): Record<string, unknown> {
  const terminal = (properties: Record<string, unknown>, required: string[]) =>
    jsonToProtoStruct({
      type: "object",
      properties: {
        resourceId: { type: "string" },
        ...properties,
        confirmed: { type: "boolean", const: true },
        observedAt: { type: "string", format: "date-time" },
      },
      required: ["resourceId", ...required, "confirmed", "observedAt"],
      additionalProperties: false,
    });
  return {
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerId,
    providerType: "home_assistant.light",
    providerVersion: version,
    inventoryMode: "RUNTIME_VISIBLE",
    operations: [
      {
        name: "light_get_state",
        description: "Read normalized state for a configured Home Assistant light entity.",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: { resourceId: rid },
          required: ["resourceId"],
          additionalProperties: false,
        }),
        outputSchema: jsonToProtoStruct({
          type: "object",
          properties: {
            resourceId: { type: "string" },
            power: { type: "string", enum: ["on", "off", "unknown", "unavailable"] },
            reachable: { type: "boolean" },
            brightnessPercent: { type: ["number", "null"] },
            observedAt: { type: "string", format: "date-time" },
          },
          required: ["resourceId", "power", "reachable", "brightnessPercent", "observedAt"],
          additionalProperties: false,
        }),
        capabilities: caps(false, false),
        resourceBinding: binding,
      },
      {
        name: "light_set_power",
        description: "Set and confirm light power.",
        execution: "TASK_REQUIRED",
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: { resourceId: rid, power: { type: "string", enum: ["on", "off"] } },
          required: ["resourceId", "power"],
          additionalProperties: false,
        }),
        outputSchema: terminal({ power: { type: "string", enum: ["on", "off"] } }, ["power"]),
        capabilities: caps(true, true),
        resourceBinding: binding,
      },
      {
        name: "light_set_brightness",
        description: "Set and confirm supported light brightness.",
        execution: "TASK_REQUIRED",
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: {
            resourceId: rid,
            brightnessPercent: { type: "number", minimum: 0, maximum: 100 },
          },
          required: ["resourceId", "brightnessPercent"],
          additionalProperties: false,
        }),
        outputSchema: terminal(
          { brightnessPercent: { type: "number", minimum: 0, maximum: 100 } },
          ["brightnessPercent"],
        ),
        capabilities: caps(true, true),
        resourceBinding: binding,
      },
    ],
  };
}
