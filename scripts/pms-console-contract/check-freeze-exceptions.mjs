/* global console, process */
import path from "node:path";
import { readJson } from "./lib.mjs";

const root = process.cwd();
const exceptions = readJson(path.join(root, "contracts/pms-console-api/v1/FREEZE_EXCEPTIONS.json"));
const repositoryEvidence = readJson(
  path.join(root, "reports/pms-console-api-contract-v1/REPOSITORY_GATE_EVIDENCE.json"),
);

const expectedScopePaths = [
  ".gitignore",
  "README.md",
  "docs/api/PMS_Console_API_Contract_V1.0.md",
  "docs/api/pms_contract_task.md",
  "docs/operations/pms-local-configuration-runbook.md",
  "scripts/serve-pms-web.mjs",
];
const expectedGateFailures = {
  "pnpm lint": ["scripts/serve-pms-web.mjs"],
  "pnpm format:check": [
    "docs/api/PMS_Console_API_Contract_V1.0.md",
    "docs/api/pms_contract_task.md",
  ],
};

function same(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

if (
  exceptions.status !== "accepted" ||
  exceptions.appliesTo !== "PMS Console API Contract V1.0 Candidate 3 freeze"
) {
  throw new Error("freeze exception approval is not valid for Candidate 3");
}
if (!same(exceptions.acceptedScopePaths ?? [], expectedScopePaths)) {
  throw new Error("freeze exception scope paths do not match the approved findings");
}
for (const [command, paths] of Object.entries(expectedGateFailures)) {
  const approval = exceptions.acceptedRepositoryGateFailures?.find(
    (entry) => entry.command === command,
  );
  const rerun = repositoryEvidence.finalReruns?.find((entry) => entry.command === command);
  if (!approval || !same(approval.affectedPaths ?? [], paths)) {
    throw new Error(`freeze exception does not exactly approve ${command}`);
  }
  if (
    !rerun ||
    rerun.exitCode === 0 ||
    rerun.preExistingAtValidationStart !== true ||
    !same(rerun.affectedPaths ?? [], paths)
  ) {
    throw new Error(`repository evidence no longer matches approved exception ${command}`);
  }
}
if ((exceptions.acceptedRepositoryGateFailures ?? []).length !== 2) {
  throw new Error("unexpected repository gate exception");
}
console.log("explicit Candidate 3 non-contract freeze exceptions passed");
