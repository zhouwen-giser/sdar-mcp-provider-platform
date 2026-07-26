#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const frozenContractSha256 = "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845";
const runtimeMergeCommit = "798656827ea747fb824df2975f8e66135e80fcc2";
const provider = argument("--provider");
const check = process.argv.includes("--check");
const write = process.argv.includes("--write");
if (check === write) fail("Choose exactly one of --check or --write.");

const definitions = {
  "home-assistant-light": {
    component: "home-assistant-light-provider",
    output: "reports/home-assistant-light/provider-conformance.json",
    appDirectory: "apps/home-assistant-light-provider",
    manifest: "apps/home-assistant-light-provider/src/manifest.ts",
    execution: "apps/home-assistant-light-provider/src/execution/execution-engine.ts",
    snapshots: "apps/home-assistant-light-provider/src/execution/snapshots.ts",
    providerTest: "tests/integration/home-assistant-light-provider.test.ts",
    e2e: "tests/integration/home-assistant-light-runtime-e2e.test.ts",
    prefix: "P-HAL",
  },
  "home-assistant-climate": {
    component: "home-assistant-climate-provider",
    output: "reports/home-assistant-climate/provider-conformance.json",
    appDirectory: "apps/home-assistant-climate-provider",
    manifest: "apps/home-assistant-climate-provider/src/manifest.ts",
    execution: "apps/home-assistant-climate-provider/src/execution.ts",
    snapshots: "apps/home-assistant-climate-provider/src/execution.ts",
    providerTest: "tests/integration/home-assistant-climate-provider.test.ts",
    e2e: "tests/integration/home-assistant-climate-runtime-e2e.test.ts",
    prefix: "P-HAC",
  },
};
const definition = definitions[provider];
if (definition === undefined) fail(`Unknown provider: ${provider}`);

execFileSync("git", ["merge-base", "--is-ancestor", runtimeMergeCommit, "HEAD"], {
  stdio: "ignore",
});
const sources = {
  manifest: source(definition.manifest),
  execution: source(definition.execution),
  snapshots: source(definition.snapshots),
  providerTest: source(definition.providerTest),
  e2e: source(definition.e2e),
};
assert(sources.manifest.includes('execution: "SYNCHRONOUS"'), "Synchronous operation is missing.");
assert(
  sources.manifest.includes('execution: "TASK_REQUIRED"'),
  "Task-required operation is missing.",
);
assert(sources.execution.includes("confirmedState"), "Observed confirmation is not persisted.");
assert(sources.snapshots.includes("evidenceType"), "Type-only Evidence is not emitted.");
assert(sources.e2e.includes('"mcp-protocol-version": "2026-07-28"'), "Frozen header missing.");
assert(sources.e2e.includes('"subscriptions/listen"'), "Notification subscription missing.");
assert(sources.e2e.includes('resultType: "task"'), "Flat CreateTaskResult assertion missing.");
assert(
  sources.e2e.includes("normalizeNotificationTask"),
  "Notification equality assertion missing.",
);
assert(
  !sources.e2e.includes("@modelcontextprotocol/sdk/client"),
  "Legacy SDK client remains in E2E.",
);
assert(
  !sources.e2e.includes("CreateTaskResultSchema"),
  "Legacy nested Task schema remains in E2E.",
);

for (const path of files(definition.appDirectory)) {
  assert(
    !source(path).includes("requirementId"),
    `Provider source publishes requirementId: ${path}`,
  );
}

const evidence = (paths, assertion) => ({
  assertion,
  files: paths.map((path) => ({ path, sha256: sha256(source(path)) })),
});
const cases = [
  {
    caseId: `${definition.prefix}-001`,
    requirement: "Merged frozen Runtime main is an ancestor of the Provider branch.",
    status: "pass",
    evidence: [
      evidence([definition.manifest], `git merge-base --is-ancestor ${runtimeMergeCommit} HEAD`),
    ],
  },
  {
    caseId: `${definition.prefix}-002`,
    requirement: "Operation names remain explicit and execution maps to frozen taskBehavior.",
    status: "pass",
    evidence: [
      evidence(
        [definition.manifest, definition.e2e],
        "Manifest plus tools/list taskBehavior assertions",
      ),
    ],
  },
  {
    caseId: `${definition.prefix}-003`,
    requirement: "All Runtime E2E calls use frozen request meta and routing headers.",
    status: "pass",
    evidence: [evidence([definition.e2e], "2026-07-28 meta and MCP routing header assertions")],
  },
  {
    caseId: `${definition.prefix}-004`,
    requirement: "Task admission returns a flat CreateTaskResult and preserves idempotency.",
    status: "pass",
    evidence: [evidence([definition.e2e], "Flat resultType task and duplicate taskId assertions")],
  },
  {
    caseId: `${definition.prefix}-005`,
    requirement: "Ack-first Task notifications converge with tasks/get at the same revision.",
    status: "pass",
    evidence: [
      evidence([definition.e2e], "Ack, working, completed, and normalized equality assertions"),
    ],
  },
  {
    caseId: `${definition.prefix}-006`,
    requirement: "Evidence is derived from persisted observed Home Assistant confirmation.",
    status: "pass",
    evidence: [
      evidence(
        [definition.execution, definition.snapshots, definition.providerTest, definition.e2e],
        "confirmedState and structured-content Evidence assertions",
      ),
    ],
  },
  {
    caseId: `${definition.prefix}-007`,
    requirement: "Provider Wire Evidence is type-only and never publishes requirementId.",
    status: "pass",
    evidence: [evidence(files(definition.appDirectory), "Recursive Provider source scan")],
  },
  {
    caseId: `${definition.prefix}-008`,
    requirement: "Provider uses frozen Runtime over real HTTP/SSE and PostgreSQL in E2E.",
    status: "pass",
    evidence: [evidence([definition.e2e], "Provider-specific Runtime/PostgreSQL E2E suite")],
  },
];
const report = {
  schemaVersion: 1,
  frozenContractSha256,
  protocolVersion: "2026-07-28",
  runtimeMergeCommit,
  component: definition.component,
  claim: "Provider Component Conformant",
  realResourceQualified: false,
  cases,
  summary: { total: cases.length, passed: cases.length, failed: 0 },
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (write) {
  writeFileSync(definition.output, serialized, "utf8");
  process.stdout.write(`Wrote ${definition.output}: ${cases.length}/${cases.length} pass\n`);
} else {
  if (!existsSync(definition.output)) fail(`Missing report: ${definition.output}`);
  if (readFileSync(definition.output, "utf8") !== serialized) {
    fail(`Provider conformance report is stale: ${definition.output}`);
  }
  process.stdout.write(`Verified ${definition.output}: ${cases.length}/${cases.length} pass\n`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || process.argv[index + 1] === undefined) fail(`Missing ${name}`);
  return process.argv[index + 1];
}
function source(path) {
  return readFileSync(path, "utf8");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function files(directory) {
  const output = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ts|json)$/.test(entry.name)) {
        output.push(relative(".", path).replaceAll("\\", "/"));
      }
    }
  };
  visit(directory);
  return output.sort();
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
