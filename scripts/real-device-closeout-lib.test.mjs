import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSdarIntegrationAllowlist,
  describeCurrentPreflight,
  hasStateChangedSubscription,
  renderFaultMatrix,
  resolveCurrentRuntimeTaskCounts,
} from "./real-device-closeout-lib.mjs";

const providerEndpoints = [
  {
    providerId: "ha-climate-lab",
    serverId: "climate-server",
    protocolMode: "frozen_v1",
    effectiveEndpoint: "http://127.0.0.1:18080/mcp",
    catalogRevision: 1,
  },
  {
    providerId: "ha-light-lab",
    serverId: "light-server",
    protocolMode: "frozen_v1",
    effectiveEndpoint: "http://127.0.0.1:18081/mcp",
    catalogRevision: 1,
  },
];
const resourceBindings = [
  { providerId: "ha-climate-lab", resourceId: "climate-one" },
  { providerId: "ha-light-lab", resourceId: "light-one" },
];

test("keeps unqualified operations out of the functional SDAR scope", () => {
  const result = buildSdarIntegrationAllowlist({
    environment: "home-lab",
    providerEndpoints,
    resourceBindings,
    preflightResources: [
      { resourceId: "climate-one", state: "off", reachable: true },
      { resourceId: "light-one", state: "on", reachable: true },
    ],
    operationQualifications: {
      climate_get_state: "real_pass",
      climate_set_power: "real_pass_off_restore_only",
      light_get_state: "real_pass_time_scoped",
      light_set_brightness: "unverified_optional",
    },
    functionalPass: true,
    resiliencePass: false,
    fullCapabilityPass: false,
    blockers: ["RESILIENCE_UNVERIFIED"],
  });

  assert.equal(result.status, "functional_only");
  assert.equal(result.activationAllowed, false);
  assert.deepEqual(
    result.allowedOperations.map((item) => item.operation),
    ["climate_get_state", "light_get_state"],
  );
  assert.deepEqual(
    result.forbiddenOrUnverifiedOperations.map((item) => item.operation),
    ["climate_set_power", "light_set_brightness"],
  );
});

test("does not expose unavailable resources as allowed", () => {
  const result = buildSdarIntegrationAllowlist({
    environment: "home-lab",
    providerEndpoints,
    resourceBindings,
    preflightResources: [
      { resourceId: "climate-one", state: "off", reachable: true },
      { resourceId: "light-one", state: "unavailable", reachable: false },
    ],
    operationQualifications: { climate_get_state: "real_pass", light_get_state: "real_pass" },
    functionalPass: false,
    resiliencePass: false,
    fullCapabilityPass: false,
    blockers: ["HA_PREFLIGHT_NOT_CURRENTLY_PASSED"],
  });

  assert.deepEqual(result.allowedResources, []);
  assert.deepEqual(result.forbiddenOrUnverifiedResources, [
    {
      providerId: "ha-light-lab",
      resourceId: "light-one",
      reason: "home_assistant_unavailable",
    },
  ]);
});

test("renders failed preflight evidence without promoting it to passed", () => {
  const qualification = {
    resilience: {
      adapterInFlight: "unverified",
      runtimeInFlight: "unverified",
      realFaultInjection: "unverified",
      pmsOutageTaskAuthority: "unverified",
    },
  };
  assert.match(renderFaultMatrix(qualification, "failed"), /blocked \(failed\)/);
  assert.doesNotMatch(renderFaultMatrix(qualification, "failed"), /passed for three configured/);
  assert.match(
    describeCurrentPreflight({
      status: "failed",
      resources: [{ resourceId: "light-one", state: "unavailable", reachable: false }],
    }),
    /light-one \(unavailable\)/,
  );
});

test("prefers current Registry-backed Runtime task counts over historical counts", () => {
  assert.deepEqual(
    resolveCurrentRuntimeTaskCounts(
      {
        status: "passed",
        runtimeTaskCounts: { active: 0, uncertain: 0, runtimes: [{ providerId: "current" }] },
      },
      { runtimeTaskCounts: { active: 4, uncertain: 2 } },
    ),
    {
      active: 0,
      uncertain: 0,
      runtimes: [{ providerId: "current" }],
      source: "current_registry_backed_read_only_e2e",
    },
  );
});

test("fails task-count resolution closed when no valid evidence is available", () => {
  assert.deepEqual(resolveCurrentRuntimeTaskCounts({ status: "failed" }, {}), {
    active: null,
    uncertain: null,
    runtimes: [],
    source: "unavailable",
  });
});

test("recognizes the current and legacy WebSocket report shapes", () => {
  assert.equal(
    hasStateChangedSubscription({ websocket: { subscribedEventType: "state_changed" } }),
    true,
  );
  assert.equal(hasStateChangedSubscription({ ws: { subscribedEventType: "state_changed" } }), true);
  assert.equal(hasStateChangedSubscription({ websocket: {} }), false);
});
