import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AuditRepository,
  ConfigurationRepository,
  JobLeaseRepository,
  LastModifiedPrecondition,
  PmsUnitOfWork,
  ProviderPackageRepository,
  ProviderRepository,
  RevisionPrecondition,
  SavePrecondition,
} from "../src/index.js";
import { PmsRepositoryError } from "../src/index.js";

describe("PMS repository ports", () => {
  it("makes mutable aggregate concurrency preconditions mandatory", () => {
    expectTypeOf<ProviderRepository["update"]>()
      .parameter(1)
      .toEqualTypeOf<LastModifiedPrecondition>();
    expectTypeOf<ProviderPackageRepository["save"]>()
      .parameter(1)
      .toEqualTypeOf<SavePrecondition>();
    expectTypeOf<ConfigurationRepository["createRevision"]>()
      .parameter(1)
      .toEqualTypeOf<RevisionPrecondition>();
    expectTypeOf<ConfigurationRepository["transitionRevision"]>()
      .parameter(2)
      .toEqualTypeOf<Parameters<ConfigurationRepository["transitionRevision"]>[2]>();
  });

  it("exposes append-only audit and fenced Job Lease capabilities", () => {
    expectTypeOf<keyof AuditRepository>().toEqualTypeOf<"append" | "list">();
    expectTypeOf<keyof JobLeaseRepository>().toEqualTypeOf<
      "enqueue" | "claim" | "renew" | "release" | "complete" | "fail" | "list"
    >();
  });

  it("defines transaction work as a callback over one repository set", () => {
    expectTypeOf<PmsUnitOfWork["transaction"]>().toBeFunction();
    expectTypeOf<PmsUnitOfWork["transaction"]>().parameter(0).toBeFunction();
  });

  it("uses stable persistence-neutral conflict errors", () => {
    const error = new PmsRepositoryError("OPTIMISTIC_CONCURRENCY_CONFLICT", "Provider changed", {
      aggregate: "Provider",
      expectedRevision: 3,
    });

    expect(error).toMatchObject({
      name: "PmsRepositoryError",
      code: "OPTIMISTIC_CONCURRENCY_CONFLICT",
      details: { aggregate: "Provider", expectedRevision: 3 },
    });
  });

  it("does not expose PostgreSQL or web framework types", async () => {
    const files = [
      "audit.ts",
      "common.ts",
      "errors.ts",
      "index.ts",
      "job-lease.ts",
      "repositories.ts",
      "unit-of-work.ts",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(new URL(`../src/ports/${file}`, import.meta.url), "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(/\b(?:pg|fastify|Pool|PoolClient|QueryResult)\b/);
  });
});
