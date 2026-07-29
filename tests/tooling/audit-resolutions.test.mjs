import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
const lockfile = readFileSync("pnpm-lock.yaml", "utf8");

describe("high-severity audit resolutions", () => {
  it("pins find-my-way beyond the vulnerable HTTP/2 range", () => {
    expect(workspace).toMatch(/^\s+find-my-way: 9\.7\.0$/mu);
    expect(lockfile).toMatch(/^\s+find-my-way: 9\.7\.0$/mu);
    expect(lockfile).toContain("find-my-way@9.7.0:");
    expect(lockfile).not.toMatch(/find-my-way@(?:[0-8]\.|9\.[0-6]\.)/u);
  });

  it("pins brace-expansion beyond the vulnerable expansion range", () => {
    expect(workspace).toMatch(/^\s+brace-expansion: 5\.0\.8$/mu);
    expect(lockfile).toMatch(/^\s+brace-expansion: 5\.0\.8$/mu);
    expect(lockfile).toContain("brace-expansion@5.0.8:");
    expect(lockfile).not.toMatch(/brace-expansion@(?:[0-4]\.|5\.0\.[0-7](?:\\D|$))/u);
  });
});
