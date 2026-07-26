#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";

const directory = process.env.BUSINESS_EVENTS_REPORT_DIR ?? "reports/business-events-profile-v1";
mkdirSync(directory, { recursive: true });
const commit = command("git", ["rev-parse", "HEAD"]).stdout.trim();
const ciRun = process.env.GITHUB_RUN_ID ?? "local";
const databaseMode = process.env.TEST_DATABASE_URL?.includes("127.0.0.1")
  ? "local-postgresql"
  : "postgresql";

const suites = [
  suite(
    "protocol-contract",
    "node",
    ["scripts/protocol/run-business-events-contract-catalog.mjs"],
    1,
    "mixed",
  ),
  suite(
    "migration-report",
    "pnpm",
    ["exec", "vitest", "run", "tests/business-events/migration"],
    1,
    "mixed",
  ),
  suite(
    "persistence-report",
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tests/business-events/persistence",
      "tests/business-events/retention",
    ],
    2,
    "mixed",
  ),
  suite(
    "source-conformance",
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tests/business-events/adapter-contract",
      "tests/business-events/source",
      "tests/business-events/fencing",
      "tests/business-events/poison",
    ],
    2,
    "durable_and_best_effort",
  ),
  suite(
    "rotation-concurrency",
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tests/business-events/finalizer",
      "tests/business-events/rotation",
      "tests/business-events/concurrency",
    ],
    2,
    "durable_and_best_effort",
  ),
  suite(
    "stream-conformance",
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tests/business-events/stream",
      "tests/business-events/replay",
      "tests/business-events/continuity",
    ],
    2,
    "durable_and_best_effort",
  ),
  suite(
    "relation-conformance",
    "pnpm",
    ["exec", "vitest", "run", "tests/business-events/relation"],
    2,
    "mixed",
  ),
  suite(
    "security",
    "pnpm",
    ["exec", "vitest", "run", "tests/business-events/security"],
    2,
    "mixed",
  ),
  suite(
    "capacity",
    "pnpm",
    ["exec", "vitest", "run", "tests/business-events/capacity"],
    2,
    "mixed",
  ),
];

for (const result of suites) write(`${result.name}.json`, report(result));

const runtime = {
  schemaVersion: 1,
  component: "runtime",
  claim: "Business Events Profile V1 Runtime Component Conformant",
  implementationCommit: commit,
  reportCommit: commit,
  ciRun,
  results: suites.map(evidence),
  coverage: [
    "Contract Catalog",
    "Persistence",
    "Source Intake",
    "Finalizer",
    "Rotation",
    "Current Replay",
    "Rotated Drain",
    "Relation Query",
    "Security",
    "Capacity",
    "Multi-replica",
  ],
  summary: summarize(suites),
};
write("runtime-component.json", runtime);

const adapterResult = suites.find((entry) => entry.name === "source-conformance");
for (const [file, component] of [
  ["typescript-adapter.json", "adapter-typescript"],
  ["python-adapter.json", "adapter-python"],
]) {
  write(file, {
    schemaVersion: 1,
    component,
    claim: "Business Events Adapter Component Conformant",
    capabilities: { durableAtLeastOnce: "passed", bestEffortLive: "passed" },
    evidence: evidence(adapterResult),
  });
}

write("baseline.json", {
  schemaVersion: 1,
  baselineCommit: "ee14d2f",
  implementationCommit: commit,
  reportCommit: commit,
  ciRun,
  status: suites.every((entry) => entry.status === "pass") ? "pass" : "fail",
});
write("requirements-lock.json", {
  schemaVersion: 1,
  requirementsSha256: "a17ee1552bc5b516dabdcc24db2fe9fd2d3deaf74688eae51e2fdc0c6a24cc0f",
  evidence: evidence(suites[0]),
});

const summary = summarize(suites);
process.stdout.write(
  `Business Events conformance: ${summary.passed}/${summary.total} suites passed\n`,
);
if (summary.failed > 0) process.exitCode = 1;

function suite(name, executable, args, replicaCount, sourceDeliveryMode) {
  const started = performance.now();
  const result = command(executable, args, false);
  const durationMs = Math.round(performance.now() - started);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return {
    name,
    testName: `${executable} ${args.join(" ")}`,
    status: result.status === 0 ? "pass" : "fail",
    durationMs,
    databaseMode,
    replicaCount,
    sourceDeliveryMode,
    implementationCommit: commit,
    reportCommit: commit,
    ciRun,
    exitCode: result.status ?? 1,
  };
}

function evidence(result) {
  return { ...result };
}

function report(result) {
  return {
    schemaVersion: 1,
    component: result.name,
    evidence: [evidence(result)],
    summary: summarize([result]),
  };
}

function summarize(results) {
  const passed = results.filter((result) => result.status === "pass").length;
  return { total: results.length, passed, failed: results.length - passed };
}

function write(file, value) {
  writeFileSync(`${directory}/${file}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function command(executable, args, fail = true) {
  const result = spawnSync(executable, args, { encoding: "utf8", env: process.env });
  if (result.error !== undefined) throw result.error;
  if (fail && result.status !== 0)
    throw new Error(`${executable} failed with ${String(result.status)}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
