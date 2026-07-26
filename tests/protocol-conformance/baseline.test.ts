import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const contractPath = resolve("protocol/frozen/SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0.md");
const upstreamSchemaPath = resolve("protocol/upstream/mcp-2026-07-28/schema.json");
const baseline = JSON.parse(readFileSync(resolve("protocol/protocol-baseline.json"), "utf8")) as {
  sourceSchemaGitBlob: string;
  sourceSchemaSha256: string;
  sourceCommit: string;
  protocolVersion: string;
};

describe("frozen protocol baseline", () => {
  it("preserves the exact frozen contract bytes", () => {
    expect(sha256(readFileSync(contractPath))).toBe(
      "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845",
    );
  });

  it("C-006 rejects drift from the pinned MCP source commit, blob and SHA-256", () => {
    const bytes = readFileSync(upstreamSchemaPath);
    const gitHeader = Buffer.from(`blob ${String(bytes.length)}\0`, "utf8");
    const blob = createHash("sha1").update(gitHeader).update(bytes).digest("hex");
    expect(blob).toBe(baseline.sourceSchemaGitBlob);
    expect(sha256(bytes)).toBe(baseline.sourceSchemaSha256);
    expect(baseline.sourceCommit).toBe("26897cc322f356487da89113451bd16b520b9288");
    expect(baseline.protocolVersion).toBe("2026-07-28");
  });

  it("compiles all derived schemas and catalogs exactly 74 unique cases", () => {
    expect(() =>
      execFileSync(process.execPath, [resolve("scripts/protocol/validate-protocol-schemas.mjs")]),
    ).not.toThrow();

    const catalog = JSON.parse(
      readFileSync(resolve("protocol/conformance-cases/cases.json"), "utf8"),
    ) as { cases: { caseId: string; status: string }[] };
    expect(catalog.cases).toHaveLength(74);
    expect(new Set(catalog.cases.map((entry) => entry.caseId)).size).toBe(74);
    expect(catalog.cases[0]?.caseId).toBe("C-001");
    expect(catalog.cases[73]?.caseId).toBe("C-074");
    expect(catalog.cases.every((entry) => entry.status === "required")).toBe(true);
  });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
