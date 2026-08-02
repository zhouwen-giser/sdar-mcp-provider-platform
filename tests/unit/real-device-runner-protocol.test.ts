import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const legacyTaskResultMethod = ["tasks", "result"].join("/");

describe("real-device runner frozen MCP profile", () => {
  it("uses tasks/get as the only terminal task read", () => {
    for (const relativePath of ["scripts/run-ha-real-climate.ts", "scripts/run-ha-real-light.ts"]) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source, relativePath).toContain('"tasks/get"');
      expect(source, relativePath).not.toContain(legacyTaskResultMethod);
      expect(source, relativePath).not.toContain("taskResultCompatibility");
    }
    const aggregateSource = readFileSync(resolve(root, "scripts/run-ha-real-e2e.ts"), "utf8");
    expect(aggregateSource).toContain("terminalTask");
    expect(aggregateSource).not.toContain(legacyTaskResultMethod);
    expect(aggregateSource).not.toContain("taskResultCompatibility");
  });

  it("documents the removed legacy method without listing it as a current API method", () => {
    const apiReference = readFileSync(resolve(root, "docs/protocol/api-reference.md"), "utf8");
    const runtimeBoundary = readFileSync(resolve(root, "docs/protocol/mcp-runtime.md"), "utf8");
    expect(apiReference).not.toMatch(/\|\s*`tasks\/result`\s*\|/);
    expect(runtimeBoundary).toContain("does not expose the legacy `tasks/result` method");
  });
});
