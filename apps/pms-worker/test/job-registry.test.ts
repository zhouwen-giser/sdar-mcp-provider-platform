import { describe, expect, it, vi } from "vitest";
import {
  PmsJobRegistry,
  RUNTIME_DEPLOYMENT_RECONCILE_JOB,
  type PmsJobHandler,
} from "../src/index.js";

describe("PmsJobRegistry", () => {
  it("rejects duplicate job types during construction", () => {
    expect(
      () =>
        new PmsJobRegistry([
          handler(RUNTIME_DEPLOYMENT_RECONCILE_JOB),
          handler(RUNTIME_DEPLOYMENT_RECONCILE_JOB),
        ]),
    ).toThrow("PMS_JOB_HANDLER_DUPLICATE");
  });

  it("rejects duplicate job types registered after construction", () => {
    const registry = new PmsJobRegistry([handler("provider_package.sync")]);

    expect(() => registry.register(handler("provider_package.sync"))).toThrow(
      "PMS_JOB_HANDLER_DUPLICATE",
    );
    expect(registry.jobTypes()).toEqual(["provider_package.sync"]);
  });

  it("reports one canonical external RuntimeDeployment lifecycle job type", () => {
    const registry = new PmsJobRegistry([
      handler("provider_package.sync"),
      handler(RUNTIME_DEPLOYMENT_RECONCILE_JOB),
    ]);

    expect(registry.jobTypes()).toEqual(["provider_package.sync", "runtime_deployment.reconcile"]);
  });
});

function handler(jobType: string): PmsJobHandler {
  return { jobType, execute: vi.fn(() => Promise.resolve()) };
}
