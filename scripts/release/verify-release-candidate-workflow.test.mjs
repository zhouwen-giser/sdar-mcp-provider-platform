import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertReleaseCandidateWorkflow } from "./verify-release-candidate-workflow.mjs";

const rawSource = readFileSync(".github/workflows/release-candidate.yml", "utf8");
const source = rawSource.replace(/\r\n?/g, "\n");

test("accepts the exact release candidate workflow", () => {
  assert.doesNotThrow(() => assertReleaseCandidateWorkflow(source));
});

test("accepts a CRLF workflow without changing its semantics", () => {
  assert.doesNotThrow(() => assertReleaseCandidateWorkflow(rawSource));
});

test("rejects a missing required job", () => {
  const changed = source.replace(
    /^ {2}worker-lease-safety:\n[\s\S]*?(?=^ {2}provider-regression:)/m,
    "",
  );
  assert.throws(() => assertReleaseCandidateWorkflow(changed), /RELEASE_WORKFLOW_JOBS_INVALID/);
});

test("rejects a checkout that can drift from the candidate", () => {
  const changed = source.replace("ref: ${{ env.CANDIDATE_SHA }}", "ref: main");
  assert.throws(
    () => assertReleaseCandidateWorkflow(changed),
    /RELEASE_WORKFLOW_EXACT_CHECKOUT_MISSING:static/,
  );
});

test("rejects an incomplete metadata dependency graph", () => {
  const changed = source.replace(
    "      - runtime-compose\n      - release-artifacts",
    "      - release-artifacts",
  );
  assert.throws(() => assertReleaseCandidateWorkflow(changed), /RELEASE_WORKFLOW_NEEDS_INVALID/);
});

test("rejects publication from qualification", () => {
  const changed = `${source}\n# docker push ghcr.io/example/image\n`;
  assert.throws(
    () => assertReleaseCandidateWorkflow(changed),
    /RELEASE_WORKFLOW_PUBLICATION_FORBIDDEN/,
  );
});
