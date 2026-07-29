import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const FAILED_CANDIDATE = "349fb8339ead8760f158ac8b05ad8d01e4825199";
export const RELEASE_TAG = "platform-v0.1.0";
export const SOURCE_ARCHIVE =
  "reports/platform-v0.1/sdar-mcp-provider-platform-0.1.0-source.tar.gz";
export const REQUIRED_JOBS = Object.freeze([
  "static",
  "runtime-ci",
  "pms-api-production",
  "worker-pm2-production",
  "runtime-credential-isolation",
  "worker-lease-safety",
  "provider-regression",
  "platform-e2e",
  "runtime-compose",
  "release-artifacts",
  "release-metadata",
]);
export const OCI_IMAGES = Object.freeze([
  "ghcr.io/zhouwen-giser/sdar-mcp-provider-platform/runtime",
  "ghcr.io/zhouwen-giser/sdar-mcp-provider-platform/pms-api",
  "ghcr.io/zhouwen-giser/sdar-mcp-provider-platform/pms-worker",
  "ghcr.io/zhouwen-giser/sdar-mcp-provider-platform/pms-web",
]);

const RELEASE_PATHS = [
  /^\.gitattributes$/,
  /^\.github\/workflows\/(?:ci|release-candidate|release)\.yml$/,
  /^scripts\/release\//,
  /^scripts\/generate-sbom\.mjs$/,
  /^scripts\/run-worker-pm2-production-gate\.mjs$/,
  /^tests\/worker-pm2-production\/run-production-lifecycle\.mjs$/,
  /^package\.json$/,
  /^reports\/platform-v0\.1\//,
  /^reports\/sbom\/runtime-v1\.cdx\.json$/,
  /^reports\/ci\//,
  /^\.codex\/handoff\/platform-v0\.1-release-handoff\.json$/,
  /^\.codex\/goal-05\/(?:decisions\.md|evidence\/G5-[A-Z0-9-]+\.json)$/,
  /^docs\/review\/GOAL05_(?:RELEASE_AUTHORITY|RELEASE_NOTES|CI_MATRIX|RELEASE_HANDOFF)\.md$/,
  /^CHANGELOG\.md$/,
];

export function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
}

export function assertQualifiedCommit(root, candidate) {
  if (!/^[0-9a-f]{40}$/.test(candidate) || candidate === FAILED_CANDIDATE) {
    throw new Error("RELEASE_QUALIFIED_COMMIT_INVALID");
  }
  let exists = true;
  try {
    git(root, ["cat-file", "-e", `${candidate}^{commit}`]);
  } catch {
    exists = false;
  }
  let ancestor = true;
  try {
    git(root, ["merge-base", "--is-ancestor", candidate, "HEAD"]);
  } catch {
    ancestor = false;
  }
  assertCandidateRelationship({ exists, ancestor });
}

export function assertCandidateRelationship({ exists, ancestor }) {
  if (!exists) throw new Error("RELEASE_QUALIFIED_COMMIT_MISSING");
  if (!ancestor) throw new Error("RELEASE_QUALIFIED_COMMIT_NOT_ANCESTOR");
}

export function assertReleaseOnlyPaths(paths) {
  const invalid = paths.filter((path) => !RELEASE_PATHS.some((pattern) => pattern.test(path)));
  if (invalid.length > 0) {
    throw new Error(`RELEASE_PRODUCT_DIFF_AFTER_QUALIFICATION:${invalid.join(",")}`);
  }
}

export function changedPaths(root, candidate) {
  return lines(git(root, ["diff", "--name-only", `${candidate}..HEAD`]));
}

export function assertQualification(qualification, candidate) {
  if (qualification?.candidateWorkflow?.qualifiedSourceCommit !== candidate) {
    throw new Error("RELEASE_QUALIFIED_SOURCE_SHA_MISMATCH");
  }
  const jobs = qualification.requiredJobs;
  if (
    !Array.isArray(jobs) ||
    jobs.map(({ name }) => name).join("\n") !== REQUIRED_JOBS.join("\n")
  ) {
    throw new Error("RELEASE_REQUIRED_JOBS_INVALID");
  }
  if (qualification.status === "pending_actions_freeze") {
    if (
      qualification.pendingFreeze !== true ||
      qualification.candidateWorkflow.headSha !== null ||
      qualification.candidateWorkflow.runId !== null ||
      qualification.candidateWorkflow.runUrl !== null ||
      jobs.some(({ status, jobUrl }) => status !== "pending" || jobUrl !== null)
    ) {
      throw new Error("RELEASE_PENDING_QUALIFICATION_INVALID");
    }
    return;
  }
  if (qualification.status !== "qualified") {
    throw new Error("RELEASE_QUALIFICATION_STATUS_INVALID");
  }
  if (
    !/^[0-9a-f]{40}$/.test(qualification.candidateWorkflow.headSha) ||
    typeof qualification.candidateWorkflow.runUrl !== "string" ||
    !qualification.candidateWorkflow.runUrl.startsWith("https://github.com/") ||
    jobs.some(
      ({ status, jobUrl }) =>
        status !== "success" ||
        typeof jobUrl !== "string" ||
        !jobUrl.startsWith("https://github.com/"),
    )
  ) {
    throw new Error("RELEASE_ACTIONS_QUALIFICATION_INCOMPLETE");
  }
}

export function assertCandidateJobResults(results) {
  if (
    results === null ||
    typeof results !== "object" ||
    Array.isArray(results) ||
    Object.keys(results).sort().join("\n") !==
      REQUIRED_JOBS.filter((name) => name !== "release-metadata")
        .sort()
        .join("\n")
  ) {
    throw new Error("RELEASE_CANDIDATE_JOBS_MISSING");
  }
  if (Object.values(results).some((result) => result !== "success")) {
    throw new Error("RELEASE_CANDIDATE_JOB_FAILED");
  }
}

export function assertCandidateArtifactReport(report, workflowHeadCommit) {
  if (report?.revision !== workflowHeadCommit) {
    throw new Error("RELEASE_CANDIDATE_ARTIFACT_SHA_MISMATCH");
  }
  const artifacts = report.artifacts;
  if (
    artifacts === null ||
    typeof artifacts !== "object" ||
    !["runtime", "api", "worker", "web"].every((name) =>
      /^sha256:[0-9a-f]{64}$/.test(artifacts[name]?.imageId),
    )
  ) {
    throw new Error("RELEASE_CANDIDATE_ARTIFACT_DIGEST_MISSING");
  }
}

export function assertOciArtifacts(artifacts) {
  if (
    !Array.isArray(artifacts) ||
    artifacts.map(({ name }) => name).join("\n") !== OCI_IMAGES.join("\n")
  ) {
    throw new Error("RELEASE_OCI_ARTIFACTS_INVALID");
  }
  for (const artifact of artifacts) {
    if (
      artifact.tag !== "0.1.0" ||
      artifact.digest?.algorithm !== "sha256" ||
      !["pending-tag-workflow", "published"].includes(artifact.digest.status)
    ) {
      throw new Error("RELEASE_OCI_DIGEST_SCHEMA_INVALID");
    }
    if (artifact.digest.status === "pending-tag-workflow" && artifact.digest.value !== null) {
      throw new Error("RELEASE_OCI_PENDING_DIGEST_INVALID");
    }
    if (artifact.digest.status === "published" && !/^[0-9a-f]{64}$/.test(artifact.digest.value)) {
      throw new Error("RELEASE_OCI_PUBLISHED_DIGEST_INVALID");
    }
  }
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function repositoryPath(root, path) {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  if (local.startsWith("..") || resolve(root, local) !== absolute) {
    throw new Error("RELEASE_PATH_OUTSIDE_REPOSITORY");
  }
  return absolute;
}

export function lines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
