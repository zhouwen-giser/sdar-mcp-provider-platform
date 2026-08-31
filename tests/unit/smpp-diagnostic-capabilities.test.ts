import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import {
  SMPP_CAPABILITY_IDS,
  SMPP_DIAGNOSTIC_SOURCE_COMMIT,
} from "../../apps/runtime/src/diagnostics.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";

let runtime: RuntimeApplication | undefined;

afterEach(async () => {
  await runtime?.app.close();
  runtime = undefined;
});

describe("SMPP Runtime diagnostic capabilities", () => {
  it("lists exactly seven provider-independent read-only production capabilities", async () => {
    runtime = createRuntime(loadRuntimeConfig({}));
    const response = await runtime.app.inject({
      method: "GET",
      url: "/v1/diagnostics/capabilities",
    });
    expect(response.statusCode).toBe(200);
    const capabilities = response.json().capabilities as Record<string, unknown>[];
    expect(capabilities.map((value) => value.capabilityId)).toEqual(SMPP_CAPABILITY_IDS);
    for (const capability of capabilities) {
      expect(capability).toMatchObject({
        schemaVersion: "sdar.external-capability/v1",
        readOnlyProbe: true,
        implementationKind: "production",
        component: "smpp-mcp-tasks-runtime",
        sourceCommit: SMPP_DIAGNOSTIC_SOURCE_COMMIT,
        details: { providerIndependent: true, claimsGoalSuccess: false },
      });
      expect(capability).not.toHaveProperty("benchmarkCaseId");
    }
  });

  it("gets the qualified external Mission relation capability", async () => {
    runtime = createRuntime(loadRuntimeConfig({}));
    const response = await runtime.app.inject({
      method: "GET",
      url: "/v1/diagnostics/capabilities/SMPP-MISSION-RELATION",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capabilityId: "SMPP-MISSION-RELATION",
      status: "available",
      qualification: {
        status: "passed",
        evidenceRefs: ["reports/smpp-ugv-diagnostic/phase-s13/report.md"],
      },
      reasonCodes: [],
    });
  });

  it("returns 404 for a non-frozen capability name", async () => {
    runtime = createRuntime(loadRuntimeConfig({}));
    const response = await runtime.app.inject({
      method: "GET",
      url: "/v1/diagnostics/capabilities/PV-LATEST-TASK",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "capability_not_found" });
  });
});
