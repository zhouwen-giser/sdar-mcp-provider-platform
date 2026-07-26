#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const directory = "reports/business-events-profile-v1";
const required = [
  "baseline.json",
  "requirements-lock.json",
  "protocol-contract.json",
  "migration-report.json",
  "persistence-report.json",
  "source-conformance.json",
  "rotation-concurrency.json",
  "stream-conformance.json",
  "relation-conformance.json",
  "security.json",
  "capacity.json",
  "runtime-component.json",
  "typescript-adapter.json",
  "python-adapter.json",
];
for (const file of required) {
  const path = `${directory}/${file}`;
  if (!existsSync(path)) throw new Error(`Missing Business Events report: ${file}`);
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (/"status"\s*:\s*"fail"/.test(JSON.stringify(report))) {
    throw new Error(`Failed evidence in ${file}`);
  }
}
const runtime = JSON.parse(readFileSync(`${directory}/runtime-component.json`, "utf8"));
if (runtime.summary?.failed !== 0 || runtime.results?.length !== 9) {
  throw new Error("Runtime component report is incomplete");
}
const interop = existsSync(`${directory}/interop.json`);
const blocker = existsSync(`${directory}/interop-blocker.json`);
if (interop === blocker) throw new Error("Exactly one interop report or blocker is required");
if (blocker) {
  const report = JSON.parse(readFileSync(`${directory}/interop-blocker.json`, "utf8"));
  if (report.status !== "blocked" || report.interopCertified !== false) {
    throw new Error("Interop blocker must deny certification");
  }
}
process.stdout.write("Business Events conformance reports verified\n");
