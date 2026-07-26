import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import process from "node:process";
import { format } from "prettier";
import { writeRuntimeComponentReport } from "./component-conformance-reports.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
  throw new Error("TEST_DATABASE_URL is required for the frozen 74-case conformance run");
}

const catalog = JSON.parse(readFileSync(resolve("protocol/conformance-cases/cases.json"), "utf8"));
const outputPath = resolve(tmpdir(), `sdar-frozen-conformance-${String(process.pid)}.json`);
const testTargets = [
  "tests/protocol-conformance",
  "tests/integration/task-lifecycle-postgres.test.ts",
];
const args = [
  resolve("node_modules/vitest/vitest.mjs"),
  "run",
  ...testTargets,
  "--reporter=json",
  `--outputFile=${outputPath}`,
];
const execution = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

let vitestReport;
try {
  vitestReport = JSON.parse(readFileSync(outputPath, "utf8"));
} finally {
  rmSync(outputPath, { force: true });
}

const assertions = vitestReport.testResults.flatMap((file) =>
  file.assertionResults.map((assertion) => ({
    file: relative(process.cwd(), file.name).replaceAll("\\", "/"),
    title: assertion.fullName,
    status: assertion.status,
    failureMessages: assertion.failureMessages,
  })),
);

const results = catalog.cases.map((entry) => {
  const evidence = assertions.filter((assertion) => assertion.title.includes(entry.caseId));
  const passed = evidence.filter((assertion) => assertion.status === "passed");
  return {
    ...entry,
    status:
      evidence.length === 0 ? "missing" : passed.length === evidence.length ? "passed" : "failed",
    evidence: evidence.map(({ file, title, status, failureMessages }) => ({
      file,
      title,
      status,
      ...(failureMessages.length === 0 ? {} : { failureMessages }),
    })),
  };
});
const passed = results.filter((entry) => entry.status === "passed").length;
const report = {
  schemaVersion: 1,
  protocolVersion: "2026-07-28",
  frozenContractSha256: "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845",
  sourceCommit: "26897cc322f356487da89113451bd16b520b9288",
  command:
    "node node_modules/vitest/vitest.mjs run tests/protocol-conformance tests/integration/task-lifecycle-postgres.test.ts --reporter=json",
  testTargets,
  summary: { total: results.length, passed, failed: results.length - passed },
  results,
};
const reportPath = resolve("reports/protocol-v1-migration/conformance-74.json");
mkdirSync(resolve("reports/protocol-v1-migration"), { recursive: true });
writeFileSync(reportPath, await format(JSON.stringify(report), { parser: "json" }));
writeRuntimeComponentReport(report);

process.stdout.write(
  `Frozen conformance: ${String(passed)}/${String(results.length)} passed; report ${reportPath}\n`,
);
if (execution.status !== 0 || passed !== results.length) process.exitCode = 1;
