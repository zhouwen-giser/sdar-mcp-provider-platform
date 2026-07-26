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
export function climateManifest(providerId: string, version: string): Record<string, unknown> {
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
    providerType: "home_assistant.climate",
    providerVersion: version,
    inventoryMode: "RUNTIME_VISIBLE",
    operations: [
      {
        name: "climate_get_state",
        description: "Read normalized state for a configured Home Assistant climate entity.",
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
            hvacMode: { type: ["string", "null"] },
            currentTemperature: { type: ["number", "null"] },
            targetTemperature: { type: ["number", "null"] },
            temperatureUnit: { type: "string" },
            observedAt: { type: "string", format: "date-time" },
          },
          required: [
            "resourceId",
            "power",
            "reachable",
            "hvacMode",
            "currentTemperature",
            "targetTemperature",
            "temperatureUnit",
            "observedAt",
          ],
          additionalProperties: false,
        }),
        capabilities: caps(false, false),
        resourceBinding: binding,
      },
      {
        name: "climate_set_power",
        description: "Set and confirm climate power.",
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
        name: "climate_set_hvac_mode",
        description: "Set and confirm an allowed HVAC mode.",
        execution: "TASK_REQUIRED",
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: {
            resourceId: rid,
            hvacMode: { type: "string", minLength: 1, maxLength: 64 },
          },
          required: ["resourceId", "hvacMode"],
          additionalProperties: false,
        }),
        outputSchema: terminal({ hvacMode: { type: "string" } }, ["hvacMode"]),
        capabilities: caps(true, true),
        resourceBinding: binding,
      },
      {
        name: "climate_set_temperature",
        description: "Set and confirm target temperature.",
        execution: "TASK_REQUIRED",
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: {
            resourceId: rid,
            targetTemperature: { type: "number", minimum: -50, maximum: 100 },
          },
          required: ["resourceId", "targetTemperature"],
          additionalProperties: false,
        }),
        outputSchema: terminal({ targetTemperature: { type: "number" } }, ["targetTemperature"]),
        capabilities: caps(true, true),
        resourceBinding: binding,
      },
    ],
  };
}
