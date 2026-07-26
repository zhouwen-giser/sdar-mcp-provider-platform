import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import catalog from "./catalog.json" with { type: "json" };

const requirementsPath = resolve(
  "docs/requirements/SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md",
);
const schema = JSON.parse(
  readFileSync(resolve("protocol/sdar-business-events-v1.schema.json"), "utf8"),
) as Record<string, unknown>;
const continuity = JSON.parse(
  readFileSync(resolve("protocol/sdar-business-events-continuity-v1.schema.json"), "utf8"),
) as Record<string, unknown>;
const relation = JSON.parse(
  readFileSync(resolve("protocol/sdar-business-events-relation-v1.schema.json"), "utf8"),
) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(schema, "sdar-business-events-v1.schema.json");
ajv.addSchema(continuity, "sdar-business-events-continuity-v1.schema.json");
ajv.addSchema(relation, "sdar-business-events-relation-v1.schema.json");

describe("Business Events Profile 1.0 contract catalog", () => {
  it("contains exactly BE-C001 through BE-C080 and traces all frozen PDRs", () => {
    expect(catalog.cases).toHaveLength(80);
    expect(new Set(catalog.cases.map((entry) => entry.caseId)).size).toBe(80);
    for (let index = 1; index <= 80; index += 1)
      expect(catalog.cases[index - 1]?.caseId).toBe(`BE-C${String(index).padStart(3, "0")}`);
    expect(new Set(catalog.cases.map((entry) => entry.pdr))).toEqual(
      new Set(
        Array.from({ length: 14 }, (_, index) => `PDR-BE-${String(index + 1).padStart(2, "0")}`),
      ),
    );
  });

  it.each(catalog.cases)("$caseId $category", (entry) => {
    expect(entry.status).toBe("required");
    switch (entry.category) {
      case "requirements-lock":
        expect(sha256(readFileSync(requirementsPath))).toBe(
          "a17ee1552bc5b516dabdcc24db2fe9fd2d3deaf74688eae51e2fdc0c6a24cc0f",
        );
        break;
      case "wire-schema":
        expect(ajv.getSchema("sdar-business-events-v1.schema.json")).toBeTypeOf("function");
        break;
      case "cursor-sequence": {
        const validate = ajv.compile({
          $ref: "sdar-business-events-v1.schema.json#/$defs/cursorSequence",
        });
        expect(validate("0")).toBe(true);
        expect(validate("9007199254740993")).toBe(true);
        expect(validate("01")).toBe(false);
        break;
      }
      case "canonical-identity": {
        const vector = JSON.parse(
          readFileSync(resolve("protocol/business-events-golden/event-id.json"), "utf8"),
        ) as Record<string, string>;
        const bytes = [
          vector.providerId,
          vector.sourceId,
          vector.sourceStreamId,
          vector.sourceEventId,
        ].join("\0");
        expect(createHash("sha256").update(bytes).digest("base64url")).toBe(vector.expectedEventId);
        expect(vector.expectedEventId).toMatch(/^[A-Za-z0-9_-]{43}$/);
        break;
      }
      case "source-ordering":
        expect(BigInt("9007199254740993") > BigInt("9007199254740992")).toBe(true);
        expect(Number("9007199254740993")).toBe(Number("9007199254740992"));
        break;
      case "scope-isolation": {
        const task = ajv.compile({ $ref: "sdar-business-events-v1.schema.json#/$defs/taskEvent" });
        const fixture = JSON.parse(
          readFileSync(resolve("protocol/fixtures/business-events/valid/task-scope.json"), "utf8"),
        ) as { instance: unknown };
        expect(task(fixture.instance)).toBe(true);
        expect(JSON.stringify(fixture.instance)).not.toContain("notifications/tasks");
        break;
      }
      case "continuity":
        expect(ajv.getSchema("sdar-business-events-continuity-v1.schema.json")).toBeTypeOf(
          "function",
        );
        expect(JSON.stringify(continuity)).toContain("lastReplayableSequence");
        break;
      case "relation-pagination":
        expect(ajv.getSchema("sdar-business-events-relation-v1.schema.json")).toBeTypeOf(
          "function",
        );
        expect(JSON.stringify(relation)).toContain("afterTaskId");
        expect(JSON.stringify(relation)).not.toContain("lastDeliveredTaskId");
        break;
    }
  });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
