import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  jsonToProtoStruct,
  protoStructToJson,
  validateBusinessEventSourceCapability,
} from "../../adapter-protocol/src/index.js";
import type {
  BusinessEventSourceCapability,
  OperationDefinition,
  ProviderManifest,
} from "../../adapter-protocol/src/index.js";
import { AdapterContractError, InvalidParamsError } from "../../domain/src/index.js";

const OPERATION_NAME = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ValidatedOperation extends Omit<
  OperationDefinition,
  "inputSchema" | "outputSchema"
> {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  manifestHash: string;
  definition: Record<string, unknown>;
  validateArguments(value: unknown): void;
  validateOutput(value: unknown): void;
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    _meta: Record<string, unknown>;
  };
}

const BUSINESS_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    outcome: { type: "string", minLength: 1 },
    reasonCode: { type: "string", minLength: 1 },
    retryable: { type: "boolean" },
    completedAt: { type: "string", format: "date-time" },
  },
  required: ["outcome", "reasonCode", "retryable", "completedAt"],
  additionalProperties: true,
};

export interface ValidatedManifest {
  providerId: string;
  providerVersion: string;
  providerType: string;
  manifestHash: string;
  operations: ValidatedOperation[];
  businessEventSources: BusinessEventSourceCapability[];
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

function assertComplexity(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error("MANIFEST_SCHEMA_TOO_DEEP");
  if (Array.isArray(value)) {
    if (value.length > 1_024) throw new Error("MANIFEST_SCHEMA_TOO_COMPLEX");
    for (const item of value) assertComplexity(item, depth + 1);
  } else if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length > 1_024) throw new Error("MANIFEST_SCHEMA_TOO_COMPLEX");
    for (const [key, item] of entries) {
      if (key === "pattern" && typeof item === "string" && item.length > 512) {
        throw new Error("MANIFEST_REGEX_TOO_LARGE");
      }
      assertComplexity(item, depth + 1);
    }
  }
}

function assertOutputLimits(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new AdapterContractError("ADAPTER_RESULT_NOT_JSON", { cause: error });
  }
  if (Buffer.byteLength(serialized) > 1_048_576) {
    throw new AdapterContractError("ADAPTER_RESULT_TOO_LARGE");
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000) throw new AdapterContractError("ADAPTER_RESULT_TOO_COMPLEX");
    if (depth > 32) throw new AdapterContractError("ADAPTER_RESULT_TOO_DEEP");
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

export class OperationRegistry {
  readonly #ajv: Ajv2020;

  constructor() {
    this.#ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true });
    this.#ajv.addFormat("date-time", (value: string) => !Number.isNaN(Date.parse(value)));
  }

  validate(manifest: ProviderManifest): ValidatedManifest {
    if (manifest.adapterProtocolVersion !== "1.0") throw new Error("UNSUPPORTED_ADAPTER_PROTOCOL");
    if (!PROVIDER_ID.test(manifest.providerId)) throw new Error("INVALID_PROVIDER_ID");
    if (manifest.operations.length === 0 || manifest.operations.length > 128) {
      throw new Error("INVALID_OPERATION_COUNT");
    }

    const names = new Set<string>();
    const sourceIds = new Set<string>();
    const businessEventSources = [...(manifest.businessEventSources ?? [])]
      .sort((left, right) =>
        left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0,
      )
      .map((source) => {
        validateBusinessEventSourceCapability(source);
        if (sourceIds.has(source.sourceId)) throw new Error("DUPLICATE_BUSINESS_EVENT_SOURCE_ID");
        sourceIds.add(source.sourceId);
        return source;
      });
    if (businessEventSources.length > 16) throw new Error("INVALID_BUSINESS_EVENT_SOURCE_COUNT");
    const normalized = manifest.operations.map((operation) => {
      if (!OPERATION_NAME.test(operation.name)) throw new Error("INVALID_OPERATION_NAME");
      if (names.has(operation.name)) throw new Error("DUPLICATE_OPERATION_NAME");
      names.add(operation.name);
      if (operation.execution === "SYNCHRONOUS" && operation.capabilities.scheduling) {
        throw new Error("SYNCHRONOUS_SCHEDULING_CONFLICT");
      }
      const inputSchema = protoStructToJson(operation.inputSchema);
      const outputSchema = protoStructToJson(operation.outputSchema);
      for (const schema of [inputSchema, outputSchema]) {
        const bytes = Buffer.byteLength(JSON.stringify(schema));
        if (bytes > 262_144) throw new Error("MANIFEST_SCHEMA_TOO_LARGE");
        assertComplexity(schema);
      }
      const validateInput = this.#ajv.compile(inputSchema);
      const validateOutput = this.#ajv.compile(outputSchema);
      return { ...operation, inputSchema, outputSchema, validateInput, validateOutput };
    });

    const manifestDefinition = {
      adapterProtocolVersion: manifest.adapterProtocolVersion,
      providerId: manifest.providerId,
      providerType: manifest.providerType,
      providerVersion: manifest.providerVersion,
      inventoryMode: manifest.inventoryMode,
      operations: normalized.map(({ validateInput, validateOutput, ...operation }) => {
        void validateInput;
        void validateOutput;
        return operation;
      }),
      ...(businessEventSources.length === 0 ? {} : { businessEventSources }),
    };
    const manifestHash = createHash("sha256")
      .update(canonicalize(manifestDefinition))
      .digest("hex");
    const operations = normalized.map(
      ({ validateInput, validateOutput, ...operation }): ValidatedOperation => {
        const definition = { ...operation } as unknown as Record<string, unknown>;
        return {
          ...operation,
          manifestHash,
          definition,
          validateArguments(value: unknown): void {
            if (!validateInput(value)) throw new InvalidParamsError("INVALID_TOOL_ARGUMENTS");
          },
          validateOutput(value: unknown): void {
            assertOutputLimits(value);
            if (!validateOutput(value)) {
              throw new AdapterContractError("ADAPTER_OUTPUT_SCHEMA_MISMATCH");
            }
          },
          tool: {
            name: operation.name,
            description: operation.description,
            inputSchema: operation.inputSchema,
            outputSchema: {
              type: "object",
              anyOf: [operation.outputSchema, BUSINESS_RESULT_SCHEMA],
            },
            _meta: {
              "io.sdar/taskExecution": {
                profileVersion: "1.0",
                taskBehavior: taskBehavior(operation.execution),
                availability: operation.capabilities.availability ? "dynamic" : "not_supported",
                supportsScheduling: operation.capabilities.scheduling,
                supportsMaxElapsed: operation.capabilities.maxElapsed,
                supportsObservations: operation.capabilities.observations,
                supportsInputRequired: operation.capabilities.inputRequired,
                idempotency: operation.capabilities.idempotency ? "server_managed" : "none",
              },
            },
          },
        };
      },
    );
    return {
      providerId: manifest.providerId,
      providerType: manifest.providerType,
      providerVersion: manifest.providerVersion,
      manifestHash,
      operations,
      businessEventSources,
    };
  }

  validateStoredDefinition(
    definition: Record<string, unknown>,
    metadata: { providerId: string; providerVersion: string; manifestHash: string },
  ): ValidatedOperation {
    const inputSchema = definition.inputSchema;
    const outputSchema = definition.outputSchema;
    if (
      typeof inputSchema !== "object" ||
      inputSchema === null ||
      Array.isArray(inputSchema) ||
      typeof outputSchema !== "object" ||
      outputSchema === null ||
      Array.isArray(outputSchema)
    ) {
      throw new Error("INVALID_OPERATION_SNAPSHOT_SCHEMA");
    }
    const operation = {
      ...definition,
      inputSchema: jsonToProtoStruct(inputSchema as Record<string, unknown>),
      outputSchema: jsonToProtoStruct(outputSchema as Record<string, unknown>),
    } as unknown as OperationDefinition;
    const resolved = this.validate({
      adapterProtocolVersion: "1.0",
      providerId: metadata.providerId,
      providerType: "operation-snapshot",
      providerVersion: metadata.providerVersion,
      inventoryMode: "OPAQUE",
      operations: [operation],
    }).operations[0];
    if (resolved === undefined) throw new Error("INVALID_OPERATION_SNAPSHOT");
    return { ...resolved, manifestHash: metadata.manifestHash, definition };
  }
}

function taskBehavior(
  execution: OperationDefinition["execution"],
): "synchronous_only" | "server_directed" | "task_required" {
  switch (execution) {
    case "SYNCHRONOUS":
      return "synchronous_only";
    case "TASK_CAPABLE":
      return "server_directed";
    case "TASK_REQUIRED":
      return "task_required";
  }
}
