import assert from "node:assert/strict";
import test from "node:test";
import {
  FAILED_CANDIDATE,
  REQUIRED_JOBS,
  assertCandidateArtifactReport,
  assertCandidateJobResults,
  assertCandidateRelationship,
  assertQualification,
  assertReleaseOnlyPaths,
} from "./release-metadata-lib.mjs";

const validSha = "a".repeat(40);

test("rejects a qualified SHA that does not exist", () => {
  assert.throws(
    () => assertCandidateRelationship({ exists: false, ancestor: false }),
    /RELEASE_QUALIFIED_COMMIT_MISSING/,
  );
});

test("rejects a qualified SHA that is not an ancestor", () => {
  assert.throws(
    () => assertCandidateRelationship({ exists: true, ancestor: false }),
    /RELEASE_QUALIFIED_COMMIT_NOT_ANCESTOR/,
  );
});

test("rejects a failed CI conclusion presented as qualification", () => {
  assert.throws(
    () =>
      assertQualification(
        {
          status: "qualified",
          candidateWorkflow: {
            qualifiedSourceCommit: validSha,
            headSha: validSha,
            runUrl: "https://github.com/example/repository/actions/runs/1",
          },
          requiredJobs: REQUIRED_JOBS.map((name, index) => ({
            name,
            status: index === 0 ? "failure" : "success",
            jobUrl: `https://github.com/example/repository/actions/runs/1/job/${String(index)}`,
          })),
        },
        validSha,
      ),
    /RELEASE_ACTIONS_QUALIFICATION_INCOMPLETE/,
  );
});

test("rejects a missing or mismatched qualified source SHA", () => {
  assert.throws(
    () =>
      assertQualification(
        {
          status: "pending_actions_freeze",
          pendingFreeze: true,
          candidateWorkflow: { qualifiedSourceCommit: FAILED_CANDIDATE, headSha: null },
          requiredJobs: REQUIRED_JOBS.map((name) => ({ name, status: "pending", jobUrl: null })),
        },
        validSha,
      ),
    /RELEASE_QUALIFIED_SOURCE_SHA_MISMATCH/,
  );
});

test("rejects missing Candidate jobs", () => {
  assert.throws(() => assertCandidateJobResults({ static: "success" }), /JOBS_MISSING/);
});

test("rejects a failed Candidate job", () => {
  const results = Object.fromEntries(
    REQUIRED_JOBS.filter((name) => name !== "release-metadata").map((name) => [name, "success"]),
  );
  results.static = "failure";
  assert.throws(() => assertCandidateJobResults(results), /JOB_FAILED/);
});

test("rejects an artifact report from a different SHA or without digests", () => {
  assert.throws(
    () => assertCandidateArtifactReport({ revision: FAILED_CANDIDATE, artifacts: {} }, validSha),
    /ARTIFACT_SHA_MISMATCH/,
  );
  assert.throws(
    () => assertCandidateArtifactReport({ revision: validSha, artifacts: {} }, validSha),
    /ARTIFACT_DIGEST_MISSING/,
  );
});

test("rejects product changes after source qualification", () => {
  assert.throws(
    () =>
      assertReleaseOnlyPaths([
        "reports/platform-v0.1/RELEASE_MANIFEST.json",
        "apps/pms-api/src/main.ts",
      ]),
    /RELEASE_PRODUCT_DIFF_AFTER_QUALIFICATION/,
  );
});

test("accepts only release allowlist changes after qualification", () => {
  assert.doesNotThrow(() =>
    assertReleaseOnlyPaths([
      "reports/platform-v0.1/RELEASE_MANIFEST.json",
      "scripts/release/verify-release-metadata.mjs",
      ".github/workflows/release-candidate.yml",
    ]),
  );
});
