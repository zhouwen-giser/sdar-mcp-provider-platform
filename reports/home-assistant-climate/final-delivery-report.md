# Home Assistant Climate Provider Final Delivery Report

Date: 2026-07-19

Branch: `feature/home-assistant-climate-provider`

Base: protected Runtime merge `798656827ea747fb824df2975f8e66135e80fcc2`

## Delivered

- Standalone Node.js Provider for explicitly configured Home Assistant `climate.*` entities.
- Synchronous state reads plus durable power, HVAC-mode, and target-temperature tasks.
- Home Assistant REST service calls and authenticated, reconnecting WebSocket state observation.
- Persist-before-effect task execution, task-ID idempotency, confirmation-based completion,
  monotonic revisions, terminal-state protection, and restart recovery.
- Durable, fail-open telemetry delivery for resource state, temperatures, health, and task progress.
- Secret-file-only token loading, production plaintext-HTTP guard, TLS/mTLS validation, resource
  allowlisting, capability checks, and temperature-range checks.
- Fake Home Assistant fixtures, unit/integration/recovery/security coverage, Runtime/PostgreSQL E2E,
  image integration, Compose example, operator documentation, and an execution plan.
- Frozen request metadata/headers, flat Task results, Ack-first notifications, same-Revision
  `tasks/get` equality, and actual-state type-only Evidence.

## Verification

Exact implementation commit `225b09c` passed `pnpm verify:v2` in a clean detached worktree in
474.1 seconds. This report-only follow-up commit requires independent protected CI validation.

| Check                                           | Result                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| TypeScript and ESLint                           | PASS                                                                    |
| Climate-focused suite (4 files, 7 tests)        | PASS                                                                    |
| Runtime/PostgreSQL climate E2E (1 file, 1 test) | PASS                                                                    |
| `pnpm test:ha-climate:protocol-v1`              | PASS, 5 files / 8 tests                                                 |
| `pnpm protocol:ha-climate:check`                | PASS, 8/8 SHA-locked Provider cases                                     |
| Frozen protocol / numbered catalog              | PASS, 68/68 and 74/74                                                   |
| Unit / contract / integration                   | PASS, 78 / 9 / 199 tests                                                |
| Recovery / security                             | PASS, 9 / 29 tests                                                      |
| `pnpm verify:v1.1`                              | PASS (exit 0, 343.1 seconds)                                            |
| Dependency audit                                | PASS, no known vulnerabilities                                          |
| Production SBOM                                 | PASS, 221 components                                                    |
| Kubernetes manifests                            | PASS, 10 validated                                                      |
| Runtime image audit                             | PASS, 99,876,549 bytes, non-root `node`, reproducible filesystem/config |

The complete repository gate also exercised unit, contract, integration, recovery, security, E2E,
TypeScript/Python conformance, capacity, and repeat-image checks. Generated conformance, capacity,
and image reports are committed with this delivery.

The exact v2 audit rebuilt the Runtime image as non-root, reproducible filesystem/config, at
99,910,238 bytes. Dependency audit, SBOM, Kubernetes, rc.2 regressions, protocol locks, and the
Provider 8/8 report verifier also passed.

## Verification boundary

Home Assistant behavior was verified against the in-repository Fake Home Assistant and a real local
PostgreSQL-backed frozen Runtime HTTP/SSE path. No physical air conditioner or independently
managed Home Assistant installation was used, so vendor-specific device behavior and a real
deployment remain unverified. The maximum claim is **Home Assistant Climate Provider Component
Conformant**; this report does not claim `real-resource qualified` or `Interop Certified`.

## Publication

The branch is intentionally separate from the light Provider branch. It must be pushed and opened
as its own Draft PR, then pass protected checks before publication is complete.
