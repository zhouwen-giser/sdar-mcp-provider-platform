# Platform 0.1.0 release approval handoff

## Release authority

- Release PR: [#6](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/6)
- Qualified product source: `7579c26a96544f19bbf39da679419e85b52ee054`
- Frozen candidate workflow head: `33e43afbfc841a8c48f4e469c30943d02b8963e0`
- Candidate run: [30456436614](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/30456436614)
- Candidate Summary artifact: `8725965106`
- Candidate Summary ZIP digest:
  `sha256:0265b72dd6f1bc2a9853573d14042fc1d518fa022212dd213011cb8938e6d3e4`
- Source archive digest:
  `sha256:4abab21e31ec9f9d4713cd13434163344057406b922000ac3aff3d9396ba80d5`
- SBOM digest:
  `sha256:333ac90a46397740c2425e8cabe913fb7240029f4d0f77764a6882f1731f6034`

The Candidate Summary is the authority for the four exact-run image digests.
The committed release manifest intentionally keeps external publication facts
pending so a commit does not attempt to contain its own identity.

## Required repository policy

`main` requires all eleven checks listed in `GOAL05_CI_MATRIX.md`, a pull
request, one approval from someone other than the implementer, approval after
the last push, resolved review conversations, and up-to-date checks. Force
pushes and branch deletion are disabled, and administrators are subject to the
same protection.

Run:

```bash
node scripts/release/verify-repository-policy.mjs --branch main --pr 6
```

The verifier fails closed while an independent approval, a required check, a
review-thread resolution, or a protection setting is missing.

## Reviewer and release approver actions

1. Review PR #6 as a non-implementer and resolve every thread.
2. Submit a GitHub `APPROVED` review after the final branch push.
3. Confirm all eleven required checks are green for the final PR head.
4. Separately authorize publication with the exact approval value
   `SDAR_RELEASE_APPROVED=platform-v0.1.0`.
5. Do not merge, create the tag, publish images, or create the GitHub Release
   until that explicit release approval exists.

The release command preview after approval is:

```bash
export SDAR_RELEASE_APPROVED=platform-v0.1.0
node scripts/release/verify-repository-policy.mjs --branch main --pr 6
node scripts/release/verify-release-metadata.mjs
node scripts/release/publish-release.mjs --tag platform-v0.1.0
node scripts/release/verify-published-release.mjs --tag platform-v0.1.0
```

## Changes, migration, rollback, and boundary

The release qualifies the Platform 0.1 management lifecycle, Worker/PM2
composition, lease fencing, runtime credential isolation, provider
regressions, release images, source archive, checksums, and SBOM. PostgreSQL
migrations are forward-only and must be applied by the documented PMS
migration command before application rollout.

Rollback uses the last-known-good registry snapshot, stops the new Worker/API,
and redeploys the prior immutable image digests. Database rollback is not
automatic; operators follow the documented forward-recovery procedure.

Qualification covers controlled SDAR interoperability only. It does not claim
external SDAR certification or qualify real UGV, NPC Tank, Home Assistant,
Kubernetes, multi-host scheduling, or multi-replica operation.
