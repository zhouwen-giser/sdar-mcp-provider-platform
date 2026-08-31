import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const contractDir = fileURLToPath(new URL("../../protocol/smpp-diagnostics/", import.meta.url));

const files = [
  "external-capability.schema.json",
  "task-execution-binding.schema.json",
  "dispatch-uncertainty.schema.json",
  "reconciliation-result.schema.json",
  "business-terminal.schema.json",
  "provider-evidence-ref.schema.json",
  "mission-relation.schema.json",
] as const;

describe("frozen SMPP diagnostic contracts", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);

  it.each(files)("compiles %s as JSON Schema 2020-12", (file) => {
    const schema = JSON.parse(readFileSync(`${contractDir}/${file}`, "utf8"));
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it("freezes the seven provider-independent capability identities", () => {
    const schema = JSON.parse(
      readFileSync(`${contractDir}/external-capability.schema.json`, "utf8"),
    ) as { properties: { capabilityId: { enum: string[] } } };
    expect(schema.properties.capabilityId.enum).toEqual([
      "SMPP-TASK-IDENTITY-CLOSURE",
      "SMPP-TASK-IDEMPOTENCY",
      "SMPP-DISPATCH-UNCERTAINTY",
      "SMPP-TASK-RECONCILIATION",
      "SMPP-PROVIDER-EVIDENCE",
      "SMPP-BUSINESS-TERMINAL",
      "SMPP-MISSION-RELATION",
    ]);
  });

  it("does not authorize Benchmark or Goal verdict fields", () => {
    for (const file of files) {
      const text = readFileSync(`${contractDir}/${file}`, "utf8");
      expect(text).not.toMatch(/benchmarkPass|goalAchieved|caseId|score/i);
    }
  });

  it("forbids redispatch for a durable uncertainty document", () => {
    const schema = JSON.parse(
      readFileSync(`${contractDir}/dispatch-uncertainty.schema.json`, "utf8"),
    );
    const validate = ajv.getSchema("sdar.smpp-dispatch-uncertainty/v1") ?? ajv.compile(schema);
    expect(
      validate({
        schemaVersion: "sdar.smpp-dispatch-uncertainty/v1",
        taskId: "task-1",
        operationName: "navigate",
        argumentHash: "a".repeat(64),
        uncertaintyClass: "adapter_transport_ambiguous",
        redispatchAllowed: true,
        occurredAt: "2026-08-28T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
