# Goal 05 scope lock

## Release objective

Qualify and, only after the required human gate, publish Platform `0.1.0` as
`platform-v0.1.0`. The release must bind source, tests, OCI digests, SBOM, checksums and evidence
to one exact candidate. Runtime remains `2.0.0-rc.1`.

## Locked findings

| Priority | Finding                                                  | Required closure                                                      |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| P0       | Release authority points at a failed/intermediate commit | Rebind all metadata after exact-commit qualification                  |
| P0       | Runtime control-plane credential is global               | Resolve and authorize one credential per Provider/Deployment/Instance |
| P0       | Claimed Worker jobs are not renewed                      | Renew independently, cancel on lease loss, fence all later effects    |
| P1       | PMS API, Worker and Web lack deployable targets          | Add non-root, labeled OCI targets and qualification                   |
| P1       | PMS Web lacks dedicated Test/Build/Serve CI              | Add gates without removing the seven existing jobs                    |
| P1       | Independent review and required-check proof are absent   | Produce a PR handoff and wait for external approval                   |
| P2       | Source archives include non-product workspace files      | Apply explicit `export-ignore` and verify the archive                 |

## Qualification boundary

In scope:

- instance-scoped Runtime credential resolution and cross-instance denial;
- Worker lease renewal, cancellation, fencing and safe takeover;
- deployable Runtime, PMS API, PMS Worker and PMS Web OCI artifacts;
- PMS Web static serving and configurable API base;
- CI jobs, release metadata, checksums, SBOM, OCI digest manifest and source archive;
- repository protection and independent-review evidence.

Out of scope:

- external authentication or certification;
- Kubernetes, cross-host scheduling or multi-replica Runtime;
- new shell/command authority;
- changes to migrations 001–009;
- a stable Runtime 2.0.0 release;
- claims about real UGV, NPC Tank, ISR MQTT or Home Assistant qualification.

## Safety invariants

- No credential value, connection string, private host path or PM2 dump enters source, logs,
  evidence, OCI labels or release attachments.
- Credential roots and files must be canonical, bounded, non-symlink and permission-controlled.
- A lost lease immediately revokes the old worker's right to complete, fail or publish observation.
- Existing seven CI jobs remain present and must pass alongside the new qualification jobs.
- Historical Goal 2/03/04 state and handoff hashes remain unchanged.
- The historical green candidate is not automatically promoted to the new release candidate.
- No tag or GitHub Release may be created without independent review, required checks and explicit
  `SDAR_RELEASE_APPROVED=platform-v0.1.0` authorization.
