#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";

const directory = process.env.BUSINESS_EVENTS_REPORT_DIR ?? "reports/business-events-profile-v1";
mkdirSync(directory, { recursive: true });
const matrix = [
  "strict discovery",
  "header",
  "empty stream",
  "cursor resume",
  "task event",
  "resource event",
  "relation pagination",
  "mixed continuity",
  "source gap",
  "rotated drain",
  "stream reset",
  "notification independence",
  "provider relation but SDAR impact=false",
];
const command = process.env.SDAR_INTEROP_COMMAND;
if (command === undefined || command.trim() === "") {
  rmSync(`${directory}/interop.json`, { force: true });
  write(`${directory}/interop-blocker.json`, {
    schemaVersion: 1,
    status: "blocked",
    claimLevel: "Level 2 Component Conformance",
    interopCertified: false,
    reason:
      process.env.SDAR_INTEROP_REPO === undefined
        ? "Neither SDAR_INTEROP_COMMAND nor SDAR_INTEROP_REPO is available."
        : "SDAR_INTEROP_REPO is present but no executable SDAR_INTEROP_COMMAND was provided.",
    unexecutedMatrix: matrix,
  });
  process.stdout.write("Real SDAR interop unavailable; wrote interop-blocker.json\n");
  process.exit(0);
}

const started = performance.now();
const result = spawnSync(command, { shell: true, encoding: "utf8", env: process.env });
const evidence = {
  testName: command,
  status: result.status === 0 ? "pass" : "fail",
  durationMs: Math.round(performance.now() - started),
  databaseMode: "external-sdar",
  replicaCount: 2,
  sourceDeliveryMode: "durable_and_best_effort",
  implementationCommit: gitHead(),
  reportCommit: gitHead(),
  ciRun: process.env.GITHUB_RUN_ID ?? "local",
};
rmSync(`${directory}/interop-blocker.json`, { force: true });
write(`${directory}/interop.json`, {
  schemaVersion: 1,
  status: evidence.status,
  claimLevel: evidence.status === "pass" ? "Real SDAR Interop" : "not_qualified",
  interopCertified: evidence.status === "pass",
  matrix,
  evidence,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) process.exitCode = result.status ?? 1;

function gitHead() {
  return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}
function write(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
