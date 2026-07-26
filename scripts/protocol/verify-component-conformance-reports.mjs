import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const directory = resolve(root, "reports/protocol-v1-conformance");
const catalog = JSON.parse(
  readFileSync(resolve(root, "protocol/conformance-cases/cases.json"), "utf8"),
);

const runtime = readReport("runtime");
if (runtime.component !== "runtime" || runtime.claim !== "Runtime Component Conformant") {
  throw new Error("Runtime component conformance identity is invalid");
}
if (runtime.results.length !== 74 || runtime.results.length !== catalog.cases.length) {
  throw new Error("Runtime component report must contain exactly 74 cases");
}
for (const [index, expected] of catalog.cases.entries()) {
  const actual = runtime.results[index];
  if (
    actual?.caseId !== expected.caseId ||
    actual.component !== "runtime" ||
    actual.status !== "pass" ||
    !Array.isArray(actual.evidence) ||
    actual.evidence.length === 0
  ) {
    throw new Error(`Runtime component report is incomplete at ${expected.caseId}`);
  }
}

for (const [component, claim] of [
  ["adapter-typescript", "TypeScript Adapter Component Conformant"],
  ["adapter-python", "Python Adapter Component Conformant"],
]) {
  const report = readReport(component);
  if (report.component !== component || report.claim !== claim) {
    throw new Error(`${component} conformance identity is invalid`);
  }
  if (
    report.results.length < 17 ||
    report.results.some(
      (entry) =>
        entry.component !== component ||
        entry.status !== "pass" ||
        !Array.isArray(entry.evidence) ||
        entry.evidence.length === 0,
    ) ||
    report.scope?.adapterProtocol !== "passed" ||
    report.scope?.runtimeProfile !== "partial" ||
    report.scope?.resourceSpecificSafety !== "not_claimed"
  ) {
    throw new Error(`${component} conformance scope or evidence is incomplete`);
  }
}

const summary = readFileSync(resolve(directory, "summary.md"), "utf8");
if (!summary.includes("Interop Certified") || !summary.includes("does not claim")) {
  throw new Error("Protocol V1 summary must explicitly reject an Interop Certified claim");
}

process.stdout.write("Protocol V1 component conformance reports verified\n");

function readReport(component) {
  return JSON.parse(readFileSync(resolve(directory, `${component}.json`), "utf8"));
}
