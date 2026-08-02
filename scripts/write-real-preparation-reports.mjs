import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = resolve(root, "reports/real-device-preparation");
const baseSha = readJson("baseline.json").baseSha;
const candidateSha = process.env.SMPP_CANDIDATE_SHA ?? "PENDING_IMPLEMENTATION_COMMIT";
const climate = readJson("climate-real-qualification.json");
const light = readJson("light-real-qualification.json");
const blockers = [
  "FROZEN_MCP_TASKS_RESULT_UNSUPPORTED: the repository frozen MCP profile exposes tasks/get but not tasks/result; real runners therefore remain conservative BLOCKED.",
  "PMS_LIVE_FORMAL_ONBOARDING_UNVERIFIED: no live PMS API/worker deployment was available in this run, so target Provider IDs, Resources, Deployments, Catalog publication, and Registry publication were not claimed as real.",
  "REAL_ADAPTER_RESTART_RECOVERY_UNVERIFIED: real Provider process restart during an in-flight task was not induced after the successful bounded device runs.",
  "REAL_FAULT_INJECTION_UNVERIFIED: HA unavailable, REST-200-without-state-change, and state-file-corruption scenarios were covered by contract/fake tests or not run against the real devices.",
  "WINDOWS_SYMLINK_SECURITY_TEST_UNVERIFIED: test:provider-packages passes 12/13 checks but its symlink assertion is blocked by Windows EPERM; the standalone provider-package self-check passes.",
  "WINDOWS_PROTOCOL_LOCK_LINE_ENDING_UNVERIFIED: protocol:check, verify:v2 and verify:platform stop at the protocol lock hash mismatch under core.autocrlf=true; frozen contract, schemas and 74 conformance cases pass.",
];

writeJson("pms-onboarding.json", {
  evidenceClass: "unverified",
  phase: "P5_PMS_PLATFORM_ONBOARDING",
  status: "blocked",
  environment: "home-lab",
  providerIds: ["ha-climate-lab", "ha-light-lab"],
  resourceIds: ["living-room-air-conditioner", "living-room-main-light", "living-room-aux-light"],
  steps: [
    [
      "providerPackageSync",
      "contract",
      "Provider package registry and self-check include both packages.",
    ],
    [
      "providerTypeCreateOrConfirm",
      "contract",
      "Provider type persistence is covered by the platform E2E path.",
    ],
    [
      "providerCreate",
      "contract",
      "Vendor-managed Provider creation is covered by platform tests.",
    ],
    [
      "resourceCreate",
      "contract",
      "Resource persistence/binding is covered by platform tests; target lab entities were not sent to PMS.",
    ],
    ["bindingCreate", "contract", "N:N binding behavior is covered by platform tests."],
    ["configDraft", "unverified", "No live PMS API run in this environment."],
    ["configPublish", "unverified", "No live PMS API run in this environment."],
    [
      "runtimeDeploymentCreate",
      "unverified",
      "No live PMS deployment control plane in this environment.",
    ],
    [
      "runtimeStartAndReadiness",
      "unverified",
      "The real qualification runners used isolated in-process Runtime instances, not PMS-managed deployments.",
    ],
    [
      "catalogDiscovery",
      "contract",
      "Catalog discovery and resource-binding assertions pass in both Home Assistant platform E2Es.",
    ],
    ["registrySnapshotPublish", "unverified", "No live PMS Registry publication was claimed."],
  ].map(([step, evidenceClass, note]) => ({
    step,
    evidenceClass,
    status: evidenceClass === "unverified" ? "unverified" : "covered",
    note,
  })),
  blockers: [blockers[1]],
  noSecrets: true,
  noEntityIds: true,
});

writeJson("runtime-deployments.json", {
  evidenceClass: "unverified",
  phase: "P5_PMS_PLATFORM_ONBOARDING",
  status: "blocked",
  deploymentModel: "vendor_managed adapter plus PMS-managed Runtime when formally deployed",
  deployments: [
    {
      providerId: "ha-climate-lab",
      hostingMode: "vendor_managed",
      adapterProcess: "contract-supported local controlled process",
      runtimeDeploymentStatus: "unverified",
      readiness: "unverified",
      effectiveEndpoint: null,
    },
    {
      providerId: "ha-light-lab",
      hostingMode: "vendor_managed",
      adapterProcess: "contract-supported local controlled process",
      runtimeDeploymentStatus: "unverified",
      readiness: "unverified",
      effectiveEndpoint: null,
    },
  ],
  blockers: [blockers[1]],
  noSecrets: true,
  noEntityIds: true,
});

writeJson("catalog-snapshots.json", {
  evidenceClass: "contract",
  phase: "P5_PMS_PLATFORM_ONBOARDING",
  status: "contract_verified_not_published",
  catalogs: [
    {
      providerId: "ha-climate-lab",
      catalogRevision: null,
      runtimeToolsMatch: "contract",
      tools: [
        "climate_get_state",
        "climate_set_hvac_mode",
        "climate_set_power",
        "climate_set_temperature",
      ],
      resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
    },
    {
      providerId: "ha-light-lab",
      catalogRevision: null,
      runtimeToolsMatch: "contract",
      tools: ["light_get_state", "light_set_brightness", "light_set_power"],
      resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
    },
  ],
  sourceEvidence: [
    "reports/home-assistant-climate/provider-conformance.json",
    "reports/home-assistant-light/provider-conformance.json",
    "tests/provider-platform-e2e/home-assistant/vendor-managed.test.ts",
    "tests/provider-platform-e2e/home-assistant/light-vendor-managed.test.ts",
  ],
  blockers: [blockers[1]],
  noSecrets: true,
  noEntityIds: true,
});

writeJson("registry-snapshot.redacted.json", {
  evidenceClass: "unverified",
  phase: "P5_PMS_PLATFORM_ONBOARDING",
  status: "not_published",
  environment: "home-lab",
  revision: 0,
  checksum: null,
  etag: null,
  latest: "unverified",
  bootstrap: "unverified",
  watch: "unverified",
  providers: [
    {
      providerId: "ha-climate-lab",
      serverId: null,
      protocolMode: "frozen_v1",
      effectiveEndpoint: null,
      catalogRevision: 0,
    },
    {
      providerId: "ha-light-lab",
      serverId: null,
      protocolMode: "frozen_v1",
      effectiveEndpoint: null,
      catalogRevision: 0,
    },
  ],
  blockers: [blockers[1]],
  noSecrets: true,
  noEntityIds: true,
});

writeJson("idempotency-report.json", {
  evidenceClass: "real",
  phase: "P7_IDEMPOTENCY_AND_RECOVERY",
  status: "blocked",
  scenarios: [
    ...realIdempotency("ha-climate-lab", climate),
    ...realIdempotency("ha-light-lab", light),
    { scenario: "client timeout then retry", evidenceClass: "unverified", status: "unverified" },
    {
      scenario: "Runtime duplicate tools/call after accepted task",
      evidenceClass: "contract",
      status: "covered",
    },
    { scenario: "Adapter restart during task", evidenceClass: "unverified", status: "unverified" },
    {
      scenario: "corrupted Provider state file fails closed",
      evidenceClass: "contract",
      status: "covered by unit contract",
    },
  ],
  activeTasks: sumNumber(climate.activeTasks, light.activeTasks),
  uncertainTasks: sumNumber(climate.uncertainTasks, light.uncertainTasks),
  blockers: [blockers[0], blockers[2], blockers[3]],
});

writeJson("recovery-report.json", {
  evidenceClass: "contract",
  phase: "P7_IDEMPOTENCY_AND_RECOVERY",
  status: "blocked",
  checks: [
    {
      scenario: "accepted substate migration and concurrent accepted admission",
      evidenceClass: "contract",
      status: "passed",
      source: "tests/integration/runtime-accepted-substate.test.ts",
    },
    {
      scenario: "real climate Runtime/Adapter task recovery state",
      evidenceClass: "real",
      status: climate.activeTasks === 0 && climate.uncertainTasks === 0 ? "passed" : "failed",
      activeTasks: climate.activeTasks,
      uncertainTasks: climate.uncertainTasks,
    },
    {
      scenario: "real light Runtime/Adapter task recovery state",
      evidenceClass: "real",
      status: light.activeTasks === 0 && light.uncertainTasks === 0 ? "passed" : "failed",
      activeTasks: light.activeTasks,
      uncertainTasks: light.uncertainTasks,
    },
    {
      scenario: "Provider restart reconcile on real device",
      evidenceClass: "unverified",
      status: "unverified",
    },
    {
      scenario: "Runtime restart with PostgreSQL recovery on real device",
      evidenceClass: "unverified",
      status: "unverified",
    },
    {
      scenario: "PMS outage/Registry latest recovery",
      evidenceClass: "unverified",
      status: "unverified",
    },
  ],
  blockers: [blockers[2], blockers[3]],
});

writeFileSync(
  resolve(reportRoot, "fault-matrix.md"),
  `# SMPP real-device fault matrix\n\n| Fault area | Scenario | Evidence | Status | Notes |\n| --- | --- | --- | --- | --- |\n| HOME_ASSISTANT_CONFIGURATION | URL, token, domains, state and WebSocket preflight | real | passed | Three configured resources reachable; report is redacted. |\n| CLIMATE_PROVIDER | HVAC mode and target temperature through Runtime and Adapter | real | passed for executed lab climate | Original state restored; frozen tasks/result compatibility remains blocked. |\n| LIGHT_PROVIDER | Power control for both configured lights | real | passed for executed lab lights | Each light changed and restored within 2-write budget. |\n| MCP_TASKS_RUNTIME | Duplicate Task ID and argument conflict | real/contract | passed | Same key converged; different arguments returned InvalidParams/IDEMPOTENCY_KEY_CONFLICT. |\n| MCP_TASKS_RUNTIME | tasks/result compatibility | real | blocked | Frozen profile returns 404 Method not found. |\n| MCP_TASKS_RUNTIME | Runtime restart during real task | unverified | unverified | Not induced after bounded real-device runs. |\n| ADAPTER_PROTOCOL | Adapter gRPC manifest/resource/task path | contract/real | passed for executed paths | Protocol conformance reports 8/8; real runs used gRPC. |\n| PMS_CONFIGURATION | Formal live package/provider/resource/config flow | unverified | blocked | No live PMS API/worker deployment in this run. |\n| CATALOG | Tool list and Resource Binding | contract | passed | Both Home Assistant platform E2Es pass. |\n| REGISTRY | Latest/bootstrap/watch and checksum/ETag | unverified | blocked | No live target Registry publication claimed. |\n| HOME_ASSISTANT_CAPABILITY | unavailable, REST 200 without state change | contract/unverified | unverified for real devices | Fake/contract coverage exists; no artificial real fault injected. |\n| MANUAL_SAFETY_BLOCK | AC opposite power interval | real | passed | No opposite AC power write was forced; HA returned to original state. |\n\nThe matrix deliberately separates executed real evidence from contract and unverified evidence.\n`,
  "utf8",
);

writeFileSync(
  resolve(reportRoot, "known-limitations.md"),
  "# Known limitations\n\n- The repository's frozen MCP profile implements server/discover, tools/list, tools/call, tasks/get, tasks/update, tasks/cancel, and observations. It does not implement initialize or tasks/result; the real runners record the 404 and stay BLOCKED.\n- The local run did not have a live PMS API/worker deployment and therefore did not claim formal package sync, Config Publish, Runtime Deployment ACTIVE, Catalog Snapshot publication, or Registry Snapshot publication for ha-climate-lab and ha-light-lab.\n- Real Adapter restart during an in-flight task, Runtime restart against the real devices, HA outage injection, and corrupted real Provider state-file injection were not performed.\n- Real qualification is limited to the three explicitly configured lab resources. It is not a production certification of all Home Assistant climate or light entities.\n- The two light runs used power control only. Brightness capability was observed in read-only preflight and the optional brightness operation is covered by fake/contract tests, but no brightness side effect was executed on the real lights.\n- No SDAR Agent Runtime was connected.\n- No credentials, raw Authorization headers, or Home Assistant internal entity IDs are included in reports or handoff artifacts.\n",
  "utf8",
);

const knownLimitationsPath = resolve(reportRoot, "known-limitations.md");
const knownLimitations = readFileSync(knownLimitationsPath, "utf8");
writeFileSync(
  knownLimitationsPath,
  knownLimitations.replace(
    "- No SDAR Agent Runtime was connected.",
    "- The existing provider-package suite has one environment-only failure: its Windows symlink assertion receives EPERM; the standalone package self-check passes for all packages.\n- No SDAR Agent Runtime was connected.",
  ),
  "utf8",
);
const protocolKnownLimitations = readFileSync(knownLimitationsPath, "utf8");
writeFileSync(
  knownLimitationsPath,
  protocolKnownLimitations.replace(
    "- No SDAR Agent Runtime was connected.",
    "- `protocol:check`, `verify:v2` and `verify:platform` stop at the protocol lock hash mismatch under `core.autocrlf=true`; the frozen contract, schemas and 74 conformance cases pass and the committed lock is unchanged.\n- No SDAR Agent Runtime was connected.",
  ),
  "utf8",
);

const handoff = {
  smppBaseSha: baseSha,
  smppCandidateSha: candidateSha,
  environment: "home-lab",
  registryRevision: 0,
  registryChecksum: "",
  providers: [
    {
      providerId: "ha-climate-lab",
      serverId: "",
      protocolMode: "frozen_v1",
      effectiveEndpoint: "",
      catalogRevision: 0,
    },
    {
      providerId: "ha-light-lab",
      serverId: "",
      protocolMode: "frozen_v1",
      effectiveEndpoint: "",
      catalogRevision: 0,
    },
  ],
  realResourcesQualified: [
    "living-room-air-conditioner",
    "living-room-main-light",
    "living-room-aux-light",
  ],
  activeTasks: sumNumber(climate.activeTasks, light.activeTasks),
  uncertainTasks: sumNumber(climate.uncertainTasks, light.uncertainTasks),
  readyForSdarIntegration: false,
  blockers,
};
writeJson("final-handoff.json", handoff);

writeFileSync(
  resolve(reportRoot, "final-delivery-report.md"),
  `# SMPP Home Assistant real-device preparation final delivery\n\n- Base SHA: \`${baseSha}\`\n- Candidate implementation SHA: \`${candidateSha}\`\n- Environment: \`home-lab\`\n- Overall status: **BLOCKED**\n- Ready for SDAR integration: **NO**\n\n## Real evidence\n\n- Home Assistant read-only preflight passed for one configured climate and two configured lights.\n- Climate real Runtime -> Adapter gRPC -> Home Assistant qualification executed HVAC mode and temperature, confirmed actual state, tested idempotency, and restored the original state.\n- Light real Runtime -> Adapter gRPC -> Home Assistant qualification executed power control for both lights, confirmed actual state, tested idempotency, and restored both original states within the per-light two-write budget.\n- Final real reports show zero active and zero uncertain tasks.\n\n## Contract and static evidence\n\n- Home Assistant Light Provider implementation, package, config schema, deployment descriptor, unit/integration/runtime E2E, protocol conformance, and PMS platform E2E were added.\n- Climate and Light provider conformance reports each pass 8/8.\n- Platform E2Es cover vendor-managed package/type/provider/resource binding, Catalog discovery, and Registry snapshot behavior with fake devices.\n\n## Hard blockers\n\n${blockers.map((item) => `- ${item}`).join("\n")}\n\nThe real resource qualification is deliberately scoped to the three configured lab resources. It does not change the Provider Package realResourceStatus field from pending, and it does not certify all Home Assistant entities. No merge, tag, release, public deployment, or SDAR Agent Runtime integration was performed.\n`,
  "utf8",
);

function realIdempotency(providerId, value) {
  const scenarios = Array.isArray(value.scenarios) ? value.scenarios : [];
  return scenarios
    .filter((item) => item && typeof item === "object" && item.idempotency)
    .map((item) => ({
      providerId,
      resourceId: item.resourceId ?? null,
      operation: item.operation ?? null,
      evidenceClass: "real",
      status:
        item.idempotency.sameArgumentsSameKey && item.idempotency.sameKeyDifferentArgumentsRejected
          ? "passed"
          : "failed",
      sameArgumentsSameKey: item.idempotency.sameArgumentsSameKey ?? false,
      sameKeyDifferentArgumentsRejected:
        item.idempotency.sameKeyDifferentArgumentsRejected ?? false,
      runtimeTaskId: item.runtimeTaskId ?? null,
      adapterExternalExecutionId: item.adapterExternalExecutionId ?? null,
    }));
}
function sumNumber(a, b) {
  return (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
}
function readJson(name) {
  return JSON.parse(readFileSync(resolve(reportRoot, name), "utf8"));
}
function writeJson(name, value) {
  writeFileSync(resolve(reportRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
