# Goal 05 Release Candidate CI Matrix

The release candidate workflow qualifies one immutable Git commit. For pull
requests that commit is `github.event.pull_request.head.sha`; a manual recovery
run must supply the same full 40-character SHA through the required `candidate`
input. Every job checks out `CANDIDATE_SHA` and asserts that `HEAD` is identical
before running a gate.

| Job                            | Qualification coverage                                          |
| ------------------------------ | --------------------------------------------------------------- |
| `static`                       | Formatting, lint, types, build, protocol reports and SBOM       |
| `runtime-ci`                   | Frozen protocol, runtime closure and repository verification    |
| `pms-api-production`           | PMS API production, configuration and migration gates           |
| `worker-pm2-production`        | Real PM2 lifecycle and exact-head credential evidence producer  |
| `runtime-credential-isolation` | Independent validation of exact-head credential evidence        |
| `worker-lease-safety`          | Competing-worker lease ownership and expiry                     |
| `provider-regression`          | UGV, NPC and HA provider suites                                 |
| `platform-e2e`                 | Security, failure injection, registry, interop and platform E2E |
| `runtime-compose`              | Compose build, startup and readiness                            |
| `release-artifacts`            | PMS web build and four local OCI image smoke checks             |
| `release-metadata`             | Exact-head summary, source archive, checksums and SBOM          |

`release-metadata` depends on all other jobs. It refuses missing or unsuccessful
job conclusions, an artifact report from a different SHA, and absent image
digests. Its Candidate Summary records both the qualified product-source commit
and the workflow head commit, the run identity, every job conclusion, bounded
test counts, four image digests, and the source archive and SBOM digests.

Qualification never publishes images, creates a tag, or updates a release. If a
failure requires any committed fix, that commit becomes a new candidate and all
eleven jobs must run again. Results from different candidate SHAs cannot be
combined.
