import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const reportDirectory = "reports/protocol-v1-conformance";

export function writeRuntimeComponentReport(sourceReport, root = process.cwd()) {
  const results = sourceReport.results.map((entry) => ({
    caseId: entry.caseId,
    title: entry.title,
    status: normalizeStatus(entry.status),
    component: "runtime",
    evidence: entry.evidence.map((item) => ({
      file: item.file,
      title: item.title,
      status: normalizeStatus(item.status),
      ...(item.failureMessages === undefined ? {} : { failureMessages: item.failureMessages }),
    })),
  }));
  const report = {
    schemaVersion: 1,
    protocolVersion: sourceReport.protocolVersion,
    frozenContractSha256: sourceReport.frozenContractSha256,
    component: "runtime",
    claim: "Runtime Component Conformant",
    summary: summarize(results),
    results,
  };
  writeJson(resolve(root, reportDirectory, "runtime.json"), report);
  return report;
}

export function writeAdapterComponentReport(sourceReport, root = process.cwd()) {
  const component = `adapter-${sourceReport.adapterLanguage}`;
  const results = sourceReport.groups.flatMap((group) =>
    group.tests.map((test, index) => ({
      caseId: `ADAPTER-${group.id}-${String(index + 1).padStart(3, "0")}`,
      title: test.name,
      status: normalizeStatus(test.status),
      component,
      evidence: [
        {
          file: `reports/conformance/${sourceReport.adapterLanguage}.json`,
          group: group.id,
          title: test.name,
          status: normalizeStatus(test.status),
          ...(test.error === undefined ? {} : { error: test.error }),
        },
      ],
    })),
  );
  const languageName = sourceReport.adapterLanguage === "typescript" ? "TypeScript" : "Python";
  const report = {
    schemaVersion: 1,
    protocolVersion: "2026-07-28",
    frozenContractSha256: "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845",
    component,
    claim: `${languageName} Adapter Component Conformant`,
    scope: {
      adapterProtocol: sourceReport.scopes.adapterProtocol.status,
      runtimeProfile: sourceReport.scopes.runtimeProfile.status,
      resourceSpecificSafety: sourceReport.scopes.resourceSpecificSafety.status,
    },
    summary: summarize(results),
    results,
  };
  writeJson(resolve(root, reportDirectory, `${component}.json`), report);
  return report;
}

export function writeProtocolV1Summary(root = process.cwd()) {
  const reports = ["runtime", "adapter-typescript", "adapter-python"].map((component) =>
    readJson(resolve(root, reportDirectory, `${component}.json`)),
  );
  const rows = reports.map(
    (report) =>
      `- ${report.component}: ${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed + report.summary.missing} failed or missing; maximum claim ${report.claim}.`,
  );
  const summary = `# Protocol V1 Component Conformance Summary

## Results

${rows.join("\n")}

The Runtime and reference Adapters are evaluated as separate components. Adapter Runtime Profile
coverage is partial and resource-specific safety is not claimed. This repository does not claim
Interop Certified.
`;
  const directory = resolve(root, reportDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "summary.md"), summary, "utf8");
}

function normalizeStatus(status) {
  if (status === "passed" || status === "pass") return "pass";
  if (status === "failed" || status === "fail") return "fail";
  return "missing";
}

function summarize(results) {
  return {
    total: results.length,
    passed: results.filter((entry) => entry.status === "pass").length,
    failed: results.filter((entry) => entry.status === "fail").length,
    missing: results.filter((entry) => entry.status === "missing").length,
  };
}

function writeJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
