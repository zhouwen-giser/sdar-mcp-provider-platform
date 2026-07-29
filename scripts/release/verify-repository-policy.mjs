import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import { REQUIRED_JOBS, assertReleaseOnlyPaths, changedPaths } from "./release-metadata-lib.mjs";

export function evaluateRepositoryPolicy({
  protection,
  pullRequest,
  reviews,
  reviewThreads,
  checkRuns,
  candidateRun,
  candidateArtifact,
  handoff,
  localHead,
}) {
  const errors = [];
  const contexts = protection.required_status_checks?.contexts ?? [];
  requireCondition(
    protection.required_status_checks?.strict === true,
    "POLICY_STRICT_CHECKS_REQUIRED",
  );
  requireCondition(
    REQUIRED_JOBS.every((name) => contexts.includes(name)),
    "POLICY_REQUIRED_CHECKS_MISSING",
  );
  requireCondition(
    protection.required_pull_request_reviews?.required_approving_review_count >= 1,
    "POLICY_APPROVAL_REQUIRED",
  );
  requireCondition(
    protection.required_pull_request_reviews?.require_last_push_approval === true,
    "POLICY_LAST_PUSH_APPROVAL_REQUIRED",
  );
  requireCondition(
    protection.enforce_admins?.enabled === true,
    "POLICY_ADMIN_ENFORCEMENT_REQUIRED",
  );
  requireCondition(
    protection.allow_force_pushes?.enabled === false,
    "POLICY_FORCE_PUSH_MUST_BE_DISABLED",
  );
  requireCondition(
    protection.allow_deletions?.enabled === false,
    "POLICY_BRANCH_DELETE_MUST_BE_DISABLED",
  );
  requireCondition(
    protection.required_conversation_resolution?.enabled === true,
    "POLICY_CONVERSATION_RESOLUTION_REQUIRED",
  );

  requireCondition(pullRequest.state === "open", "POLICY_PR_NOT_OPEN");
  requireCondition(pullRequest.base?.ref === "main", "POLICY_PR_BASE_INVALID");
  requireCondition(pullRequest.head?.sha === localHead, "POLICY_PR_HEAD_LOCAL_MISMATCH");
  requireCondition(pullRequest.draft === false, "POLICY_PR_MUST_BE_READY");

  const completedChecks = new Map(
    checkRuns
      .filter((check) => check.head_sha === pullRequest.head?.sha)
      .map((check) => [check.name, check.conclusion]),
  );
  requireCondition(
    REQUIRED_JOBS.every((name) => completedChecks.get(name) === "success"),
    "POLICY_PR_REQUIRED_CHECKS_NOT_GREEN",
  );

  const candidate = handoff.qualification?.candidateWorkflow;
  requireCondition(candidate?.headSha === candidateRun.head_sha, "POLICY_CANDIDATE_SHA_MISMATCH");
  requireCondition(
    String(candidate?.runId) === String(candidateRun.id) &&
      candidate?.runUrl === candidateRun.html_url &&
      candidateRun.conclusion === "success",
    "POLICY_CANDIDATE_RUN_INVALID",
  );
  requireCondition(
    candidateArtifact?.name === "release-candidate-summary" &&
      candidateArtifact?.expired === false &&
      candidateArtifact?.digest === handoff.artifacts?.candidateSummary?.digest,
    "POLICY_CANDIDATE_ARTIFACT_INVALID",
  );

  const independentApprovals = latestReviewStates(reviews).filter(
    ({ login, state }) => state === "APPROVED" && login !== pullRequest.user?.login,
  );
  requireCondition(independentApprovals.length >= 1, "POLICY_INDEPENDENT_APPROVAL_MISSING");
  requireCondition(
    reviewThreads.every((thread) => thread.isResolved === true),
    "POLICY_REVIEW_THREADS_UNRESOLVED",
  );

  return { ok: errors.length === 0, errors, independentApprovals, completedChecks };

  function requireCondition(condition, code) {
    if (!condition) errors.push(code);
  }
}

export function latestReviewStates(reviews) {
  const latest = new Map();
  for (const review of [...reviews].sort((left, right) =>
    String(left.submitted_at).localeCompare(String(right.submitted_at)),
  )) {
    const login = review.user?.login;
    if (login) latest.set(login, { login, state: review.state, submittedAt: review.submitted_at });
  }
  return [...latest.values()];
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    process.stdout.write("REPOSITORY_POLICY_SELF_TEST_OK 4 cases\n");
    return;
  }
  const { branch, pr } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const handoff = JSON.parse(
    readFileSync(resolve(root, ".codex/handoff/platform-v0.1-release-handoff.json"), "utf8"),
  );
  const localHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assertReleaseOnlyPaths(changedPaths(root, handoff.qualifiedSourceCommit));

  const repository = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  const encodedBranch = encodeURIComponent(branch);
  const pullRequest = ghJson(["api", `repos/${repository}/pulls/${pr}`]);
  const protection = ghJson(["api", `repos/${repository}/branches/${encodedBranch}/protection`]);
  const reviews = ghJson(["api", `repos/${repository}/pulls/${pr}/reviews?per_page=100`]);
  const checkRuns = ghJson([
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${repository}/commits/${pullRequest.head.sha}/check-runs?per_page=100`,
  ]).check_runs;
  const candidateRun = ghJson([
    "api",
    `repos/${repository}/actions/runs/${handoff.qualification.candidateWorkflow.runId}`,
  ]);
  const candidateArtifact = ghJson([
    "api",
    `repos/${repository}/actions/artifacts/${handoff.artifacts.candidateSummary.id}`,
  ]);
  const [owner, name] = repository.split("/");
  const reviewThreads = ghJson([
    "api",
    "graphql",
    "-f",
    `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${pr}`,
  ]).data.repository.pullRequest.reviewThreads.nodes;

  const result = evaluateRepositoryPolicy({
    protection,
    pullRequest,
    reviews,
    reviewThreads,
    checkRuns,
    candidateRun,
    candidateArtifact,
    handoff,
    localHead,
  });
  if (!result.ok) {
    throw new Error(result.errors.join(","));
  }
  process.stdout.write(
    `REPOSITORY_POLICY_OK ${repository} ${branch} PR#${pr} ${pullRequest.head.sha}\n`,
  );
}

function runSelfTest() {
  const sha = "a".repeat(40);
  const handoff = {
    qualification: {
      candidateWorkflow: {
        headSha: sha,
        runId: 1,
        runUrl: "https://github.com/example/repository/actions/runs/1",
      },
    },
    artifacts: { candidateSummary: { digest: `sha256:${"b".repeat(64)}` } },
  };
  const input = {
    protection: {
      required_status_checks: { strict: true, contexts: [...REQUIRED_JOBS] },
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        require_last_push_approval: true,
      },
      enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
    },
    pullRequest: {
      state: "open",
      draft: false,
      base: { ref: "main" },
      head: { sha },
      user: { login: "implementer" },
    },
    reviews: [
      {
        user: { login: "reviewer" },
        state: "APPROVED",
        submitted_at: "2026-07-29T00:00:00Z",
      },
    ],
    reviewThreads: [{ isResolved: true }],
    checkRuns: REQUIRED_JOBS.map((name) => ({
      name,
      conclusion: "success",
      head_sha: sha,
    })),
    candidateRun: {
      id: 1,
      head_sha: sha,
      conclusion: "success",
      html_url: "https://github.com/example/repository/actions/runs/1",
    },
    candidateArtifact: {
      name: "release-candidate-summary",
      expired: false,
      digest: `sha256:${"b".repeat(64)}`,
    },
    handoff,
    localHead: sha,
  };
  assert.equal(evaluateRepositoryPolicy(input).ok, true);

  const missingCheck = clone(input);
  missingCheck.protection.required_status_checks.contexts.pop();
  assert(evaluateRepositoryPolicy(missingCheck).errors.includes("POLICY_REQUIRED_CHECKS_MISSING"));

  const missingApproval = clone(input);
  missingApproval.reviews = [];
  assert(
    evaluateRepositoryPolicy(missingApproval).errors.includes(
      "POLICY_INDEPENDENT_APPROVAL_MISSING",
    ),
  );

  const weakenedProtection = clone(input);
  weakenedProtection.protection.allow_force_pushes.enabled = true;
  assert(
    evaluateRepositoryPolicy(weakenedProtection).errors.includes(
      "POLICY_FORCE_PUSH_MUST_BE_DISABLED",
    ),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index], args[index + 1]);
  }
  const branch = values.get("--branch");
  const pr = Number(values.get("--pr"));
  if (!branch || !Number.isInteger(pr) || pr <= 0) {
    throw new Error("Usage: verify-repository-policy.mjs --branch <branch> --pr <number>");
  }
  return { branch, pr };
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
