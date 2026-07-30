import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { REQUIRED_JOBS } from "./release-metadata-lib.mjs";

const WORKFLOW_PATH = ".github/workflows/release-candidate.yml";

export function assertReleaseCandidateWorkflow(source) {
  const jobs = extractJobBlocks(source);
  if (Object.keys(jobs).join("\n") !== REQUIRED_JOBS.join("\n")) {
    throw new Error("RELEASE_WORKFLOW_JOBS_INVALID");
  }
  if (
    !source.includes("pull_request:\n    branches: [main]") ||
    !source.includes("workflow_dispatch:") ||
    !source.includes("CANDIDATE_SHA: ${{ inputs.candidate || github.event.pull_request.head.sha }}")
  ) {
    throw new Error("RELEASE_WORKFLOW_CANDIDATE_TRIGGER_INVALID");
  }
  for (const [name, block] of Object.entries(jobs)) {
    if (
      !block.includes("uses: actions/checkout@v4") ||
      !block.includes("ref: ${{ env.CANDIDATE_SHA }}") ||
      !block.includes('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"')
    ) {
      throw new Error(`RELEASE_WORKFLOW_EXACT_CHECKOUT_MISSING:${name}`);
    }
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
    /docker\s+(?:image\s+)?push\b/.test(source) ||
    /\bghcr\.io\/.*(?:push|login-action)/.test(source)
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
