import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertReleaseCandidateWorkflow } from "./verify-release-candidate-workflow.mjs";

const rawSource = readFileSync(".github/workflows/release-candidate.yml", "utf8");
const source = rawSource.replace(/\r\n?/g, "\n");

test("accepts the exact release candidate workflow", () => {
  assert.doesNotThrow(() => assertReleaseCandidateWorkflow(source));
});

test("candidate qualification cannot automatically run on development PRs or pushes", () => {
  for (const trigger of ["pull_request", "push"]) {
    assert.throws(
      () => assertReleaseCandidateWorkflow(source.replace("on:\n", `on:\n  ${trigger}:\n`)),
      /RELEASE_WORKFLOW_CANDIDATE_TRIGGER_INVALID/,
    );
  }
});

test("development CI retains quality gates and makes production suites opt-in", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r\n?/g, "\n");
  assert.match(ci, / {2}pull_request:/);
  assert.match(ci, / {2}workflow_dispatch:/);
  for (const name of ["static", "development-tests"]) {
    assert.match(ci, new RegExp(`  ${name}:\\n    name: ${name}\\n`));
  }
  for (const name of [
    "runtime-ci",
    "pms-api-production",
    "worker-pm2-production",
    "worker-lease-safety",
    "release-artifacts",
    "provider-regression",
    "platform-e2e",
    "runtime-compose",
  ]) {
    assert.ok(
      ci.includes(
        `  ${name}:\n    if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/heads/release/')`,
      ),
    );
  }
  assert.match(ci, /run: pnpm test:unit/);
  assert.match(ci, /run: pnpm --filter @sdar\/runtime-configuration-contract test/);
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

test("requires Linux provider regression to depend on the exact-candidate Windows gate", () => {
  const changed = source.replace("    needs: provider-packages-windows\n", "");
  assert.throws(
    () => assertReleaseCandidateWorkflow(changed),
    /RELEASE_WORKFLOW_WINDOWS_PROVIDER_GATE_MISSING/,
  );
});

test("rejects publication from qualification", () => {
  const changed = `${source}\n# docker push ghcr.io/example/image\n`;
  assert.throws(
    () => assertReleaseCandidateWorkflow(changed),
    /RELEASE_WORKFLOW_PUBLICATION_FORBIDDEN/,
  );
});
