import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  OCI_IMAGES,
  RELEASE_TAG,
  REQUIRED_JOBS,
  SOURCE_ARCHIVE,
  assertQualifiedCommit,
  git,
  sha256File,
} from "./release-metadata-lib.mjs";

const root = process.cwd();
const candidate = argument("--candidate");
assertQualifiedCommit(root, candidate);
const generatedAt = git(root, ["show", "-s", "--format=%cI", candidate]).trim();
const output = resolve(root, "reports/platform-v0.1");
mkdirSync(output, { recursive: true });

const qualification = {
  status: "pending_actions_freeze",
  pendingFreeze: true,
  candidateWorkflow: {
    workflow: ".github/workflows/release-candidate.yml",
    qualifiedSourceCommit: candidate,
    headSha: null,
    runId: null,
    runUrl: null,
  },
  requiredJobs: REQUIRED_JOBS.map((name) => ({ name, status: "pending", jobUrl: null })),
};
const manifest = {
  schemaVersion: "3.0",
  product: "SDAR MCP Provider Platform",
  package: "sdar-mcp-provider-platform",
  platformVersion: "0.1.0",
  runtimeComponent: { package: "@sdar/runtime", version: "2.0.0-rc.1" },
  qualifiedSourceCommit: candidate,
  generatedAt,
  releaseAuthority: {
    model: "two-layer",
    qualifiedSource: "qualifiedSourceCommit",
    releaseMetadata: {
      tag: RELEASE_TAG,
      commit: null,
      status: "pending-external-publication",
      recordingLocation: "GitHub Release and protected tag",
    },
  },
  qualification,
  sourceArchive: {
    path: SOURCE_ARCHIVE,
    digest: { algorithm: "sha256", value: null, status: "pending-build" },
  },
  ociArtifacts: OCI_IMAGES.map((name) => ({
    name,
    tag: "0.1.0",
    digest: { algorithm: "sha256", value: null, status: "pending-tag-workflow" },
  })),
  releaseFiles: [
    "CHANGELOG.md",
    "package.json",
    "docs/operations/PLATFORM_V0_1_OPERATIONS.md",
    "docs/operations/PLATFORM_V0_1_UPGRADE.md",
    "docs/operations/PMS_WEB.md",
    "docs/review/GOAL05_RELEASE_AUTHORITY.md",
    "docs/review/GOAL05_RELEASE_NOTES.md",
    "reports/platform-v0.1/TEST_EVIDENCE.json",
    "reports/platform-v0.1/COMPATIBILITY_MATRIX.md",
    "reports/platform-v0.1/KNOWN_LIMITATIONS.md",
    "reports/platform-v0.1/FINAL_DELIVERY_REPORT.md",
    "reports/platform-v0.1/CHECKSUMS.sha256",
    "reports/sbom/runtime-v1.cdx.json",
    ".codex/handoff/platform-v0.1-release-handoff.json",
  ],
  qualificationBoundary: boundary(),
  secretsRedacted: true,
};
const evidence = {
  schemaVersion: "3.0",
  platformVersion: "0.1.0",
  runtimeVersion: "2.0.0-rc.1",
  qualifiedSourceCommit: candidate,
  generatedAt,
  qualification,
  supportingLocalEvidence: {
    authority: "non-release-supporting-only",
    tasksPassedBeforeFreeze: 8,
    releaseArtifactReport: "reports/ci/release-artifacts.json",
    priorGoalStatesChanged: false,
  },
  qualificationBoundary: boundary(),
  secretsRedacted: true,
};
writeJson(resolve(output, "RELEASE_MANIFEST.json"), manifest);
writeJson(resolve(output, "TEST_EVIDENCE.json"), evidence);
writeFileSync(resolve(output, "COMPATIBILITY_MATRIX.md"), compatibility());
writeFileSync(resolve(output, "KNOWN_LIMITATIONS.md"), limitations());
writeFileSync(resolve(output, "FINAL_DELIVERY_REPORT.md"), delivery(candidate));
writeFileSync(resolve(root, "docs/review/GOAL05_RELEASE_AUTHORITY.md"), authority(candidate));
writeFileSync(resolve(root, "docs/review/GOAL05_RELEASE_NOTES.md"), notes());
mkdirSync(resolve(root, ".codex/handoff"), { recursive: true });
writeJson(resolve(root, ".codex/handoff/platform-v0.1-release-handoff.json"), {
  schemaVersion: "2.0",
  platformVersion: "0.1.0",
  runtimeVersion: "2.0.0-rc.1",
  qualifiedSourceCommit: candidate,
  releaseManifest: "reports/platform-v0.1/RELEASE_MANIFEST.json",
  qualification,
  releaseMetadata: manifest.releaseAuthority.releaseMetadata,
  ociArtifacts: manifest.ociArtifacts,
  qualificationBoundary: boundary(),
  secretsRedacted: true,
});
writeChecksums(
  root,
  manifest.releaseFiles.filter((path) => path !== "reports/platform-v0.1/CHECKSUMS.sha256"),
);
process.stdout.write(`RELEASE_METADATA_GENERATED ${candidate}\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined) throw new Error(`RELEASE_ARGUMENT_REQUIRED:${name}`);
  return value;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function writeChecksums(repository, paths) {
  const entries = paths
    .filter((path) => {
      try {
        sha256File(resolve(repository, path));
        return true;
      } catch {
        return false;
      }
    })
    .sort()
    .map((path) => `${sha256File(resolve(repository, path))}  ${path}`);
  writeFileSync(resolve(output, "CHECKSUMS.sha256"), `${entries.join("\n")}\n`);
}

function boundary() {
  return {
    controlledSdarInterop: "qualified",
    externalSdarInterop: "not-qualified",
    realUgv: "not-qualified",
    realNpcTank: "not-qualified",
    realHomeAssistant: "not-qualified",
    certificationClaim: "none",
  };
}

function compatibility() {
  return `# Platform 0.1.0 compatibility matrix

| Surface                | Qualified version or mode                 | Boundary                                          |
| ---------------------- | ----------------------------------------- | ------------------------------------------------- |
| Platform monorepo      | \`sdar-mcp-provider-platform@0.1.0\`        | Private release identity                          |
| Runtime component      | \`@sdar/runtime@2.0.0-rc.1\`                | Version remains independent                       |
| Node.js                | 22                                        | Node 22 is required                               |
| pnpm                   | 11.13.1                                   | Frozen workspace install                          |
| PostgreSQL             | 17                                        | Separate PMS and Provider Runtime authorities     |
| PM2                    | 7.0.3                                     | Pinned JavaScript API; fork mode; local host only |
| MCP frozen profile     | 74/74                                     | Locked schemas and reports retained               |
| PMS API / Worker / Web | 0.1.0                                     | Independent non-root OCI artifacts                |
| Providers              | Controlled platform E2E                   | Real resources remain unqualified                 |
| SDAR consumer          | Controlled Registry-authoritative interop | External SDAR is not certified                    |

Provider Adapter production mode remains \`vendor_managed\`. Secrets use only
SecretRef or controlled file transport.
`;
}

function limitations() {
  return `# Platform 0.1.0 known limitations

- External SDAR infrastructure was unavailable. Controlled interoperability is
  not an external Interop Certified result.
- Real UGV and NPC Tank devices and ISR MQTT feeds were unavailable.
- Independently managed Home Assistant and physical climate resources were unavailable.
- PM2 is single-host only. This release has no Kubernetes Runtime orchestration,
  cross-host scheduling, multi-replica gateway, or arbitrary remote commands.
- The production Worker runs one Runtime replica per deployment.
- PostgreSQL backup, PITR, managed-service, multi-region, and production capacity
  qualification remain operator responsibilities.
- Database rollback migrations are unsupported; recovery is forward-only.
- The release remains pending until one exact-SHA GitHub Actions run, required
  repository protection, independent approval, and explicit Release Approval pass.
`;
}

function delivery(candidate) {
  return `# SDAR MCP Provider Platform 0.1.0 final delivery

## Authority

Product source is frozen at \`${candidate}\`. The exact workflow-head commit may
change only release metadata, workflow, and explicitly allowlisted gate-harness
files verified by
\`scripts/release/verify-release-metadata.mjs\`. The protected tag and metadata
commit are recorded externally at publication, avoiding self-reference.

## Qualification state

Formal qualification is pending the exact-head Release Candidate workflow.
Local results are supporting evidence only and are not represented as GitHub
Actions success.

## Boundary

External SDAR and real UGV, NPC Tank, ISR MQTT, Home Assistant, and physical
resources are unqualified. No external certification is claimed.
`;
}

function authority(candidate) {
  return `# Goal 05 Release Authority

The immutable product source is \`${candidate}\`. It must be an ancestor of
every workflow-head commit, and every intervening path must match the verifier's
release-only allowlist. The exact workflow head separately binds CI definitions
and the narrowly scoped gate harness used to qualify that product source.

The tag \`${RELEASE_TAG}\`, its main-branch commit, GitHub Actions run and OCI
digests are external publication facts. They remain null/pending in repository
metadata until the protected release workflow records them. This prevents a
commit from attempting to contain its own unknown identity.

Local gates are supporting diagnostics. Only linked successful GitHub Actions
jobs may change formal qualification from \`pending_actions_freeze\` to
\`qualified\`.
`;
}

function notes() {
  return `# SDAR MCP Provider Platform 0.1.0 release notes

Platform 0.1.0 delivers the PMS API, fenced production Worker, PMS Web,
single-host PM2 Runtime lifecycle, isolated PostgreSQL preparation, Runtime
registration, Catalog discovery and Registry publication.

Release qualification covers controlled PostgreSQL, PM2, Provider simulations
and Registry-authoritative interoperability. It does not qualify external SDAR,
real UGV/NPC Tank/ISR MQTT, independently managed Home Assistant, physical
resources, Kubernetes, cross-host scheduling or multiple Runtime replicas.

Upgrades are additive and database recovery is forward-only. Back up PMS and
Runtime databases before rollout; roll back application artifacts only where
the applied schema remains compatible.
`;
}
