#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const directory = "reports/business-events-telemetry-v1";
const required = [
  "baseline.json",
  "metric-policy.json",
  "provider-ops-audit.json",
  "trace-log.json",
  "security.json",
  "failure-isolation.json",
  "protocol-zero-diff.json",
  "runtime-verification.json",
];
const commonFields = [
  "schemaVersion",
  "implementationCommit",
  "reportCommit",
  "ciRun",
  "testCommand",
  "startedAt",
  "endedAt",
  "durationMs",
  "exitCode",
  "status",
  "evidenceFiles",
];
for (const file of required) {
  const path = `${directory}/${file}`;
  if (!existsSync(path)) throw new Error(`Missing Business Events telemetry report: ${file}`);
  const report = JSON.parse(readFileSync(path, "utf8"));
  for (const field of commonFields) {
    if (!(field in report)) throw new Error(`${file} is missing ${field}`);
  }
  if (report.status !== "PASS" || report.exitCode !== 0) {
    throw new Error(`${file} does not contain passing executed evidence`);
  }
  if (!Array.isArray(report.evidenceFiles) || report.evidenceFiles.length === 0) {
    throw new Error(`${file} has no evidence files`);
  }
}
if (!existsSync(`${directory}/final-delivery-report.md`)) {
  throw new Error("Missing Business Events telemetry final delivery report");
}
process.stdout.write("Business Events telemetry reports verified\n");
