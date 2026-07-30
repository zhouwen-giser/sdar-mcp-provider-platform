import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  FAILED_CANDIDATE,
  SOURCE_ARCHIVE,
  assertOciArtifacts,
  assertQualification,
  assertQualifiedCommit,
  assertReleaseOnlyPaths,
  changedPaths,
  sha256File,
} from "./release-metadata-lib.mjs";

const root = process.cwd();
const manifestPath = resolve(root, "reports/platform-v0.1/RELEASE_MANIFEST.json");
const manifestSource = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);

assert(manifest.schemaVersion === "3.0", "RELEASE_MANIFEST_SCHEMA_INVALID");
assert(!manifestSource.includes(FAILED_CANDIDATE), "RELEASE_FAILED_CANDIDATE_REFERENCE");
assert(!manifestSource.includes("PASSED_LOCAL"), "RELEASE_LOCAL_STATUS_IS_NOT_AUTHORITY");
assert(!manifestSource.includes("not-created"), "RELEASE_LEGACY_PLACEHOLDER");
assertQualifiedCommit(root, manifest.qualifiedSourceCommit);
assertReleaseOnlyPaths(changedPaths(root, manifest.qualifiedSourceCommit));
assert(
  manifest.releaseAuthority?.model === "two-layer" &&
    manifest.releaseAuthority.releaseMetadata?.tag === "platform-v0.1.0" &&
    manifest.releaseAuthority.releaseMetadata?.commit === null &&
    manifest.releaseAuthority.releaseMetadata?.status === "pending-external-publication",
  "RELEASE_AUTHORITY_MODEL_INVALID",
);
assertQualification(manifest.qualification, manifest.qualifiedSourceCommit);
assertOciArtifacts(manifest.ociArtifacts);
assert(
  manifest.sourceArchive?.path === SOURCE_ARCHIVE &&
    manifest.sourceArchive.digest?.algorithm === "sha256" &&
    manifest.sourceArchive.digest?.status === "generated" &&
    /^[0-9a-f]{64}$/.test(manifest.sourceArchive.digest.value),
  "RELEASE_SOURCE_ARCHIVE_METADATA_INVALID",
);
assert(
  sha256File(resolve(root, SOURCE_ARCHIVE)) === manifest.sourceArchive.digest.value,
  "RELEASE_SOURCE_ARCHIVE_DIGEST_MISMATCH",
);

const evidence = JSON.parse(
  readFileSync(resolve(root, "reports/platform-v0.1/TEST_EVIDENCE.json"), "utf8"),
);
const handoff = JSON.parse(
  readFileSync(resolve(root, ".codex/handoff/platform-v0.1-release-handoff.json"), "utf8"),
);
assert(
  evidence.qualifiedSourceCommit === manifest.qualifiedSourceCommit &&
    handoff.qualifiedSourceCommit === manifest.qualifiedSourceCommit,
  "RELEASE_AUTHORITY_SHA_DIVERGENCE",
);
assertQualification(evidence.qualification, manifest.qualifiedSourceCommit);
assertQualification(handoff.qualification, manifest.qualifiedSourceCommit);
assertChecksums();
assertSbom();
process.stdout.write(`RELEASE_METADATA_OK ${manifest.qualifiedSourceCommit}\n`);

function assertChecksums() {
  const source = readFileSync(resolve(root, "reports/platform-v0.1/CHECKSUMS.sha256"), "utf8");
  const entries = source
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}([^\r\n]+)$/.exec(line);
      if (match === null) throw new Error("RELEASE_CHECKSUM_FORMAT_INVALID");
      return { digest: match[1], path: match[2] };
    });
  assert(entries.length > 0, "RELEASE_CHECKSUMS_EMPTY");
  for (const { digest, path } of entries) {
    assert(path !== "reports/platform-v0.1/CHECKSUMS.sha256", "RELEASE_CHECKSUM_SELF_REFERENCE");
    assert(sha256File(resolve(root, path)) === digest, `RELEASE_CHECKSUM_STALE:${path}`);
  }
  const required = [
    "reports/platform-v0.1/RELEASE_MANIFEST.json",
    "reports/platform-v0.1/TEST_EVIDENCE.json",
    "reports/platform-v0.1/COMPATIBILITY_MATRIX.md",
    "reports/platform-v0.1/KNOWN_LIMITATIONS.md",
    "reports/sbom/runtime-v1.cdx.json",
    SOURCE_ARCHIVE,
  ];
  assert(
    required.every((path) => entries.some((entry) => entry.path === path)),
    "RELEASE_CHECKSUM_COVERAGE_INCOMPLETE",
  );
}

function assertSbom() {
  const sbom = JSON.parse(readFileSync(resolve(root, "reports/sbom/runtime-v1.cdx.json"), "utf8"));
  const expectedLock = sha256File(resolve(root, "pnpm-lock.yaml"));
  assert(
    sbom.bomFormat === "CycloneDX" &&
      sbom.specVersion === "1.6" &&
      sbom.metadata?.properties?.some(
        ({ name, value }) => name === "sdar:pnpm-lock-sha256" && value === expectedLock,
      ),
    "RELEASE_SBOM_STALE",
  );
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
