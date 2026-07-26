import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("follow-up report integrity", () => {
  it("records the execution baseline and honest database classification", async () => {
    const baseline = JSON.parse(
      await readFile("reports/runtime-conformance-followup/baseline.json", "utf8"),
    ) as Record<string, unknown>;
    const correction = await readFile(
      "reports/runtime-conformance-followup/report-correction.md",
      "utf8",
    );
    expect(baseline.minimumRequiredAncestor).toBe("8db97c7030f09b2a17c1821b80747f67ff885639");
    expect(correction).toContain("MRTR Unit/Mock Tests");
    expect(correction).toContain("MRTR Real PostgreSQL Integration Tests");
    expect(correction).toContain("MRTR Real PostgreSQL Concurrency Tests");
    expect(correction).toContain("actual Vitest reporter output");
  });
});
