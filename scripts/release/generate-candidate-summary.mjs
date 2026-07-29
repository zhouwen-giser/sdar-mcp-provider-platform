import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  REQUIRED_JOBS,
  assertCandidateArtifactReport,
  assertCandidateJobResults,
  sha256File,
} from "./release-metadata-lib.mjs";

const root = process.cwd();
const workflowHeadCommit = required("RELEASE_CANDIDATE_SHA");
const runId = required("RELEASE_RUN_ID");
const runUrl = required("RELEASE_RUN_URL");
if (!/^[0-9a-f]{40}$/.test(workflowHeadCommit)) {
  throw new Error("RELEASE_CANDIDATE_SHA_INVALID");
}
if (!/^[1-9][0-9]*$/.test(runId) || !runUrl.startsWith("https://github.com/")) {
  throw new Error("RELEASE_CANDIDATE_RUN_INVALID");
}
const results = JSON.parse(required("RELEASE_JOB_RESULTS"));
assertCandidateJobResults(results);
const artifactReportPath = resolve(root, "reports/ci/release-artifacts.json");
const artifactReport = JSON.parse(readFileSync(artifactReportPath, "utf8"));
assertCandidateArtifactReport(artifactReport, workflowHeadCommit);
const manifest = JSON.parse(
  readFileSync(resolve(root, "reports/platform-v0.1/RELEASE_MANIFEST.json"), "utf8"),
);
const summary = {
  schemaVersion: "1.0",
  status: "qualified",
  qualifiedSourceCommit: manifest.qualifiedSourceCommit,
  workflowHeadCommit,
  workflow: ".github/workflows/release-candidate.yml",
  runId,
  runUrl,
  jobs: [
    ...REQUIRED_JOBS.filter((name) => name !== "release-metadata").map((name) => ({
      name,
      conclusion: results[name],
    })),
    { name: "release-metadata", conclusion: "success" },
  ],
  testCounts: {
    frozenProtocolCases: 74,
    pmsWebTests: 17,
    runtimeCredentialIsolationDeployments: 2,
    workerLeaseSafetyWorkers: 2,
    releaseImages: 4,
  },
  artifacts: {
    images: Object.fromEntries(
      Object.entries(artifactReport.artifacts).map(([name, artifact]) => [
        name,
        { image: artifact.image, digest: artifact.imageId, sizeBytes: artifact.sizeBytes },
      ]),
    ),
    sourceArchive: {
      path: manifest.sourceArchive.path,
      digest: `sha256:${sha256File(resolve(root, manifest.sourceArchive.path))}`,
    },
    sbom: {
      path: "reports/sbom/runtime-v1.cdx.json",
      digest: `sha256:${sha256File(resolve(root, "reports/sbom/runtime-v1.cdx.json"))}`,
    },
  },
  qualificationBoundary: manifest.qualificationBoundary,
  secretsIncluded: false,
};
writeFileSync(
  resolve(root, "reports/platform-v0.1/CANDIDATE_SUMMARY.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
process.stdout.write(`RELEASE_CANDIDATE_SUMMARY_OK ${workflowHeadCommit}\n`);

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`RELEASE_ENV_REQUIRED:${name}`);
  return value;
}
