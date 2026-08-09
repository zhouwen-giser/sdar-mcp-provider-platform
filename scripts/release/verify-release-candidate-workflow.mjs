import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { REQUIRED_JOBS } from "./release-metadata-lib.mjs";

const WORKFLOW_PATH = ".github/workflows/release-candidate.yml";
const SUPPLEMENTAL_JOBS = Object.freeze(["provider-packages-windows"]);

export function assertReleaseCandidateWorkflow(source) {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const jobs = extractJobBlocks(normalizedSource);
  const expectedJobs = REQUIRED_JOBS.flatMap((name) =>
    name === "provider-regression" ? [...SUPPLEMENTAL_JOBS, name] : [name],
  );
  if (Object.keys(jobs).join("\n") !== expectedJobs.join("\n")) {
    throw new Error("RELEASE_WORKFLOW_JOBS_INVALID");
  }
  if (
    !normalizedSource.includes("pull_request:\n    branches: [main]") ||
    !normalizedSource.includes("workflow_dispatch:") ||
    !normalizedSource.includes(
      "CANDIDATE_SHA: ${{ inputs.candidate || github.event.pull_request.head.sha }}",
    )
  ) {
    throw new Error("RELEASE_WORKFLOW_CANDIDATE_TRIGGER_INVALID");
  }
  for (const [name, block] of Object.entries(jobs)) {
    const exactCandidateCheck =
      block.includes('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"') ||
      block.includes("if ((git rev-parse HEAD).Trim() -ne $env:CANDIDATE_SHA) { exit 1 }");
    if (
      !block.includes("uses: actions/checkout@v4") ||
      !block.includes("ref: ${{ env.CANDIDATE_SHA }}") ||
      !exactCandidateCheck
    ) {
      throw new Error(`RELEASE_WORKFLOW_EXACT_CHECKOUT_MISSING:${name}`);
    }
  }
  if (!jobs["provider-regression"].includes("needs: provider-packages-windows")) {
    throw new Error("RELEASE_WORKFLOW_WINDOWS_PROVIDER_GATE_MISSING");
  }
  const metadata = jobs["release-metadata"];
  const needs = extractNeeds(metadata);
  const expectedNeeds = REQUIRED_JOBS.filter((name) => name !== "release-metadata");
  if (needs.join("\n") !== expectedNeeds.join("\n")) {
    throw new Error("RELEASE_WORKFLOW_NEEDS_INVALID");
  }
  if (
    !metadata.includes("generate-candidate-summary.mjs") ||
    !metadata.includes("name: release-candidate-summary")
  ) {
    throw new Error("RELEASE_WORKFLOW_SUMMARY_MISSING");
  }
  if (
    /docker\s+(?:image\s+)?push\b/.test(normalizedSource) ||
    /\bghcr\.io\/.*(?:push|login-action)/.test(normalizedSource)
  ) {
    throw new Error("RELEASE_WORKFLOW_PUBLICATION_FORBIDDEN");
  }
}

function extractJobBlocks(source) {
  const jobsMarker = "\njobs:\n";
  const start = source.indexOf(jobsMarker);
  if (start < 0) throw new Error("RELEASE_WORKFLOW_JOBS_MISSING");
  const jobsSource = source.slice(start + jobsMarker.length);
  const matches = [...jobsSource.matchAll(/^ {2}([a-z0-9-]+):\n/gm)];
  return Object.fromEntries(
    matches.map((match, index) => [
      match[1],
      jobsSource.slice(match.index, matches[index + 1]?.index ?? jobsSource.length),
    ]),
  );
}

function extractNeeds(jobBlock) {
  const match = jobBlock.match(/^ {4}needs:\n((?: {6}- [a-z0-9-]+\n)+)/m);
  if (!match) return [];
  return [...match[1].matchAll(/^ {6}- ([a-z0-9-]+)$/gm)].map((entry) => entry[1]);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.cwd();
  assertReleaseCandidateWorkflow(readFileSync(resolve(root, WORKFLOW_PATH), "utf8"));
  process.stdout.write(`RELEASE_CANDIDATE_WORKFLOW_OK ${WORKFLOW_PATH}\n`);
}
