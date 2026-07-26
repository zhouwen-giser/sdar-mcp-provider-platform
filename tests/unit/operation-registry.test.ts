import { describe, expect, it } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";

function manifest(): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "test-provider",
    providerType: "test",
    providerVersion: "1.0.0",
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "echo_sync",
        description: "Echo",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({ type: "object", additionalProperties: false }),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: true,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}

describe("Operation Registry", () => {
  it("normalizes schemas and emits stable Tool metadata/hash", () => {
    const registry = new OperationRegistry();
    const first = registry.validate(manifest());
    const second = registry.validate(manifest());
    expect(first.manifestHash).toBe(second.manifestHash);
    expect(first.operations[0]?.tool.name).toBe("echo_sync");
    expect(first.operations[0]?.tool._meta).toMatchObject({
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: "synchronous_only",
        supportsScheduling: false,
        idempotency: "server_managed",
      },
    });
    expect(first.operations[0]?.tool._meta).not.toHaveProperty("io.sdar/taskExecution.execution");
    expect(first.operations[0]?.tool._meta).not.toHaveProperty(
      "io.sdar/taskExecution.supportsCancel",
    );
    expect(first.operations[0]?.tool._meta).not.toHaveProperty(
      "io.sdar/taskExecution.supportsIdempotency",
    );
  });

  it("accepts the frozen SDAR Tool Name subset including dot and slash", () => {
    for (const name of ["embodied.move", "vehicle/patrol", "light_set_power", "A-1"] as const) {
      const value = manifest();
      const operation = value.operations[0];
      if (operation === undefined) throw new Error("fixture operation missing");
      operation.name = name;
      expect(new OperationRegistry().validate(value).operations[0]?.name).toBe(name);
    }

    for (const name of [".leading", "slash\\name", "space name", "x".repeat(65)] as const) {
      const value = manifest();
      const operation = value.operations[0];
      if (operation === undefined) throw new Error("fixture operation missing");
      operation.name = name;
      expect(() => new OperationRegistry().validate(value)).toThrow("INVALID_OPERATION_NAME");
    }
  });

  it("rejects duplicate operations and synchronous scheduling", () => {
    const duplicate = manifest();
    const duplicateOperation = duplicate.operations[0];
    if (duplicateOperation === undefined) throw new Error("fixture operation missing");
    duplicate.operations.push(duplicateOperation);
    expect(() => new OperationRegistry().validate(duplicate)).toThrow("DUPLICATE_OPERATION_NAME");
    const invalid = manifest();
    const invalidOperation = invalid.operations[0];
    if (invalidOperation === undefined) throw new Error("fixture operation missing");
    invalidOperation.capabilities.scheduling = true;
    expect(() => new OperationRegistry().validate(invalid)).toThrow(
      "SYNCHRONOUS_SCHEDULING_CONFLICT",
    );
  });

  it("rejects excessive schema depth", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 40; index += 1) schema = { allOf: [schema] };
    const invalid = manifest();
    const invalidOperation = invalid.operations[0];
    if (invalidOperation === undefined) throw new Error("fixture operation missing");
    invalidOperation.inputSchema = jsonToProtoStruct(schema);
    expect(() => new OperationRegistry().validate(invalid)).toThrow("MANIFEST_SCHEMA_TOO_DEEP");
  });

  it("retains the Adapter output validator and enforces result JSON limits", () => {
    const value = manifest();
    const operation = value.operations[0];
    if (operation === undefined) throw new Error("fixture operation missing");
    operation.outputSchema = jsonToProtoStruct({
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    });
    const validated = new OperationRegistry().validate(value).operations[0];
    if (validated === undefined) throw new Error("validated operation missing");

    expect(() => validated.validateOutput({ message: "valid" })).not.toThrow();
    expect(() => validated.validateOutput({ message: 42 })).toThrow(
      "ADAPTER_OUTPUT_SCHEMA_MISMATCH",
    );
    expect(() => validated.validateOutput({ message: "x".repeat(1_048_576) })).toThrow(
      "ADAPTER_RESULT_TOO_LARGE",
    );
  });
});
