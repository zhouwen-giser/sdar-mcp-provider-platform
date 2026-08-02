import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { assertCandidateArtifactReport } from "./release-metadata-lib.mjs";

const candidate = process.env.CANDIDATE_SHA;
if (!/^[0-9a-f]{40}$/.test(candidate ?? "")) {
  throw new Error("RELEASE_CANDIDATE_SHA_INVALID");
}

const report = JSON.parse(readFileSync(resolve("reports/ci/release-artifacts.json"), "utf8"));
assertCandidateArtifactReport(report, candidate);
process.stdout.write(`RELEASE_CANDIDATE_ARTIFACT_OK ${candidate}\n`);
