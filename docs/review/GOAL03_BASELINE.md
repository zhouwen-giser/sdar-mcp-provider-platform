# Goal 03 Merge-Readiness Baseline

Captured on 2026-07-29 (Asia/Shanghai) for `G3-P0-B01`.

## Git and pull request baseline

- Goal branch: `codex/goal-03-merge-readiness-foundation`
- Integration branch: `origin/codex/goal-02-runtime-governance`
- Integration SHA: `ed5f01b7a7eac2ef9c982bfbc5132311bdb30cad`
- `origin/main` SHA: `6bbd54fe3eec0514157cf05fe28690f09c15bcff`
- PR #2: open, draft, mergeable, not merged
- PR #2 base/head: `main` <- `codex/goal-02-runtime-governance`
- PR #2 head SHA: `ed5f01b7a7eac2ef9c982bfbc5132311bdb30cad`

Commands:

```text
git fetch origin
git rev-parse origin/codex/goal-02-runtime-governance
git rev-parse origin/main
gh pr checks 2 --json name,state,bucket,link,startedAt,completedAt,workflow
gh run view 30413182605 --json databaseId,name,workflowName,status,conclusion,url,event,headBranch,headSha,createdAt,updatedAt,jobs
gh run view 30413182605 --job 90453790964 --log
gh run view 30413182605 --job 90453790990 --log
```

The current failed workflow is `runtime-ci`, run `30413182605`, for head
`ed5f01b7a7eac2ef9c982bfbc5132311bdb30cad`.

| Job | Job ID | Failed step |
| --- | --- | --- |
| `runtime-compose` | `90453790964` | `docker compose build runtime adapter-typescript` |
| `runtime-ci` | `90453790990` | `pnpm verify:v2` |

## Toolchain baseline

CI declares Ubuntu 24.04, Node 22, pnpm 11.13.1, and
`postgres:17-alpine`. The service log identifies PostgreSQL 17.10.

Local mandatory-version commands returned:

```text
$ node --version
v22.23.1
$ pnpm --version
11.13.1
$ docker --version
Docker version 29.6.1, build 8900f1d
$ docker compose version
Docker Compose version v5.3.1
$ psql --version
psql: command not found
```

The absent local `psql` client does not prevent Docker-backed PostgreSQL
verification. CI remains the authoritative PostgreSQL version baseline.

## First causal failure: runtime-compose

The remote job fails while BuildKit evaluates the manifest-copy layer:

```text
#31 [runtime build 21/30] COPY packages/provider-telemetry/package.json packages/provider-telemetry/package.json
#31 ERROR: ... "/packages/provider-telemetry/package.json": not found
target runtime: failed to solve: failed to compute cache key
```

The same failure was reproduced locally with a clean cache:

```text
$ docker compose build --no-cache runtime adapter-typescript
...
COPY packages/provider-telemetry/package.json packages/provider-telemetry/package.json
ERROR: ... "/packages/provider-telemetry/package.json": not found
target runtime: failed to solve: failed to compute cache key
```

Exit code: 1. A manifest inventory found this to be the only missing
`COPY */package.json` source in the Dockerfile. The directory contains
TypeScript sources imported directly by other workspace code, but it has
never contained a tracked `package.json` and is not a lockfile workspace
importer.

Minimal fix scope for `G3-P1-B01`:

- `Dockerfile`: remove the stale manifest-only `COPY` entry.
- No production TypeScript, migration, workflow, or package script change is
  indicated by the first failure.
- Validate the complete compose build, startup, and both readiness endpoints
  required by the task card; do not stop at the first successful image build.

## First causal failure: runtime-ci

All preceding `verify:v2` suites, formatting, lint, typecheck, and build
steps completed. The first causal failure is the unchanged strict audit gate:

```text
$ pnpm audit --audit-level high
high  find-my-way: DDoS with HTTP2
Vulnerable versions <=9.6.0; patched versions >=9.6.1
Paths: .>fastify>find-my-way; apps__pms-api>fastify>find-my-way

high  brace-expansion: DoS via unbounded expansion length
Vulnerable versions <=5.0.7; patched versions >=5.0.8
... Found 54 paths ...

4 vulnerabilities found
Severity: 2 moderate | 2 high
[ELIFECYCLE] Command failed with exit code 1.
```

The checked lockfile resolves `find-my-way@9.6.0` and
`brace-expansion@5.0.7`, matching the remote advisories. A local online
`pnpm audit --audit-level high` replay was not permitted by the execution
environment because it would send dependency metadata to an external
registry; no gate was skipped or weakened, and the complete authenticated
CI log supplies the exact reproduction.

Minimal fix scope for `G3-P1-B02`:

- `pnpm-workspace.yaml` and `pnpm-lock.yaml`: resolve the two transitive
  dependencies to patched compatible versions.
- Touch `package.json` only if the package manager cannot express a safe
  transitive resolution without it.
- Preserve `audit:dependencies`, `verify`, and `verify:v2` command semantics
  exactly and run the complete clean-PostgreSQL verification required by the
  task card.

## Scope and state checks

`python3 .codex/goal-03-task-package/scripts/verify_goal2_state_unchanged.py .`
reports the original Goal 2 state unchanged at SHA-256
`5ffce4a73146dd9c8a7d7ffd299fb9298d2c461355946120019a36d6ce4378be`.

This baseline task changes only this document and `.codex/goal-03/**`.
It makes no production, test, Dockerfile, workflow, package, migration, or
Goal 2 state change.
