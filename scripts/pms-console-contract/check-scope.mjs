/* global console, process */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readJson } from "./lib.mjs";

const approvedExceptions = process.argv.includes("--approved-non-contract-exceptions");
const baselineReport = readJson(
  path.join(process.cwd(), "reports/pms-console-api-contract-v1/LOCAL_BASELINE.json"),
);
const baseline = baselineReport.businessMergeBase;
const validationStart = baselineReport.validationStartHead;
const allowed = [
  /^contracts\/pms-console-api\//,
  /^packages\/pms-console-api-contract\//,
  /^packages\/pms-console-api-testkit\//,
  /^scripts\/pms-console-contract\//,
  /^docs\/adr\/[^/]*pms-console[^/]*$/i,
  /^docs\/review\/PMS_CONSOLE_API_/,
  /^reports\/pms-console-api-contract-v1\//,
  /^(DELIVERY_REPORT|FREEZE_READINESS|FREEZE_VALIDATION_REPORT|FREEZE_BLOCKERS)\.md$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
];

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

const files = new Set([
  ...git(["diff", "--name-only", baseline, "HEAD"]),
  ...git(["diff", "--name-only"]),
  ...git(["ls-files", "--others", "--exclude-standard"]),
]);
const violations = [...files]
  .filter((file) => !allowed.some((pattern) => pattern.test(file)))
  .sort();
if (violations.length > 0) {
  if (approvedExceptions) {
    const exceptionEvidence = readJson(
      path.join(process.cwd(), "contracts/pms-console-api/v1/FREEZE_EXCEPTIONS.json"),
    );
    const accepted = [...(exceptionEvidence.acceptedScopePaths ?? [])].sort();
    if (
      exceptionEvidence.status !== "accepted" ||
      JSON.stringify(violations) !== JSON.stringify(accepted)
    ) {
      throw new Error(
        `out-of-scope paths do not exactly match approved exceptions:\n${violations.join("\n")}`,
      );
    }
    const preExisting = git(["diff", "--name-only", baseline, validationStart]).sort();
    const notPreExisting = accepted.filter((file) => !preExisting.includes(file));
    if (notPreExisting.length > 0) {
      throw new Error(`approved path was not present at validation start: ${notPreExisting}`);
    }
    const changedAfterStart = git(["diff", "--name-only", validationStart, "--", ...accepted]);
    if (changedAfterStart.length > 0) {
      throw new Error(
        `approved path changed after validation start:\n${changedAfterStart.join("\n")}`,
      );
    }
    console.log(
      `scope accepted with explicit non-contract exceptions: ${accepted.length} pre-existing paths`,
    );
    process.exit(0);
  }
  throw new Error(`out-of-scope paths relative to ${baseline}:\n${violations.join("\n")}`);
}
console.log(`scope passed: ${files.size} changed/delivery files`);
