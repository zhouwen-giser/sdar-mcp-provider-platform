import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RuntimeDatabasePreparationJob } from "../../../packages/pms-application/src/index.js";

describe("Runtime database preparation boundary", () => {
  it("keeps database preparation available as an internal application service", () => {
    expect(RuntimeDatabasePreparationJob).toBeTypeOf("function");
  });

  it("does not export a second external worker handler", () => {
    const workerIndex = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(workerIndex).not.toContain("runtime-database-preparation-job");
    expect(workerIndex).toContain('export * from "./runtime-reconcile-job.js"');
  });

  it("types PostgreSQL credential-rotation parameters for the real server", () => {
    const implementation = readFileSync(
      new URL("../src/runtime-database-preparation-job.ts", import.meta.url),
      "utf8",
    );

    expect(implementation).toContain("format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text)");
  });
});
