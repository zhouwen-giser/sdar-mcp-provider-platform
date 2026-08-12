# SMPP Breakpoint Repair Final Report

Status: `VERIFIED_AWAITING_NON_DRAFT_PR`

## Outcome

The SMPP-owned stability and recovery breakpoints are repaired on exact verified candidate
`23eb2ed1c14830a8a6b328d3a67df1badcd492ab`. A Climate Task now succeeds only after the desired
Home Assistant state remains matched for the configured stable duration and observation count.
Persisted dispatch and confirmation state allow restart/reconciliation without a duplicate physical
side effect in the covered crash windows.

This is a ready-for-protected-review code candidate, not a production-readiness claim. Final delivery
status becomes `READY_FOR_PROTECTED_REVIEW` only after the required non-Draft PR is created and its
base/head metadata is confirmed.

## Source and candidate lock

| Item                                | Value                                      |
| ----------------------------------- | ------------------------------------------ |
| Repository                          | `zhouwen-giser/sdar-mcp-provider-platform` |
| Branch                              | `fix/smpp-breakpoint-repair`               |
| Source-lock `origin/main`           | `cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef` |
| Final merged-main SHA               | `cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef` |
| Verified candidate SHA              | `23eb2ed1c14830a8a6b328d3a67df1badcd492ab` |
| Verified remote branch SHA          | `23eb2ed1c14830a8a6b328d3a67df1badcd492ab` |
| Report-only delivery SHA            | `PENDING_REPORT_ONLY_DELIVERY_COMMIT`      |
| Candidate relation to `origin/main` | 8 ahead / 0 behind                         |

The report-only delivery commit will add or update evidence documents after code verification. It
must not be confused with the exact code candidate above and must contain no runtime implementation
change.

## Breakpoint disposition

| Breakpoint  | Status                  | Result                                                                                                               |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| BP-SMPP-001 | `FIXED`                 | Stable duration plus multiple observations are required; mismatch resets the candidate; deadline and restart pass.   |
| BP-SMPP-002 | `FIXED`                 | Durable intent and candidate state reconcile covered crashes without duplicate HA calls.                             |
| BP-SMPP-003 | `ALREADY_FIXED_ON_MAIN` | Advertised cancel/pause/resume support is false and real Adapter RPC behavior matches it.                            |
| BP-SMPP-004 | `PARTIALLY_FIXED`       | Deterministic failpoint/recovery foundation passes; exhaustive real process/network fault injection is out of scope. |
| BP-SMPP-005 | `DEFERRED`              | Access behavior is coherent, but the versioned consumer access-profile metadata gap remains documented.              |

## Stable-confirmation result

- Policy is centralized and validated: confirmation timeout, minimum stable duration, and minimum
  matching observations.
- Candidate start, matching count, last match, last observation, policy snapshot, and deadline are
  persisted.
- A transient `off -> cool -> off`, including the historical three-second regression, cannot commit
  `SUCCEEDED`.
- A mismatch or unreachable observation discards the active candidate window.
- Timeout produces the stable technical-failure code rather than late success.
- Restart during confirmation continues the persisted window and does not redispatch Home
  Assistant.

## Recovery and side-effect result

- Recovery honors the deadline before dispatch and before accepting confirmation.
- `INTENT_PERSISTED` is treated as an uncertain side effect and is reconciled, not optimistically
  replayed.
- A crash after Home Assistant returns but before `CALL_RETURNED` persistence does not cause a second
  `callService()`.
- Store corruption, duplicate task, polling fallback, and notification-independent confirmation
  paths are covered by deterministic tests.
- Cancellation remains unsupported and never implies physical rollback.

## Verification evidence

| Gate                        | Result | Evidence                     |
| --------------------------- | ------ | ---------------------------- |
| `pnpm verify:v2`            | PASS   | 1111.1 seconds               |
| `pnpm verify:platform`      | PASS   | 274.7 seconds                |
| `pnpm container:check`      | PASS   | 50.4 seconds                 |
| Production Bundle           | PASS   | 33/33 on exact Linux archive |
| Climate focused selection   | PASS   | 7 files / 40 tests           |
| `pnpm test:ha-climate`      | PASS   | 5 files / 33 tests           |
| `pnpm test:fault-injection` | PASS   | 5 files / 39 tests           |
| Climate Runtime E2E         | PASS   | 1/1                          |
| `pnpm test:recovery`        | PASS   | 9/9                          |
| Home Assistant platform E2E | PASS   | 4 tests                      |
| `git diff --check`          | PASS   | no whitespace errors         |

The aggregate gates cover typecheck, lint, build, frozen protocol checks, Runtime, Catalog, PMS,
Registry, recovery, integration, security, conformance, capacity, and platform E2E. The Production
Bundle suite was additionally run from a clean archive of the exact candidate in ephemeral Linux.

## Security and compatibility

- `physicalDeviceWrites = 0`; no real-device side-effect gate was enabled.
- Tests used deterministic fake Home Assistant clients. No real-device qualification is claimed.
- Native Registry, `sdar-registry-v1` DTO/checksum, projection lineage, and
  latest/304/bootstrap/watch semantics are unchanged.
- No SDAR or organization-control-plane repository was modified.
- No Adapter protocol expansion or new Home Assistant device capability was introduced.
- Verification support changes only stabilize PMS expiry boundaries, POSIX permission assertions,
  Windows Docker workspace contexts, and canonical LF delivery bytes; they do not change Runtime
  authentication or Provider control semantics.

## External blockers

None for the code-owned required gates. BP-SMPP-004 and BP-SMPP-005 retain explicitly bounded
follow-up work; those items are not hidden or represented as production qualification. Local `gh`
CLI authentication is not treated as a code blocker because PR publication uses the authenticated
GitHub connector.

## Pull request delivery

- PR number: `PENDING_NON_DRAFT_PR_NUMBER`
- PR URL: `PENDING_NON_DRAFT_PR_URL`
- Base: `main`
- Head: `fix/smpp-breakpoint-repair`
- Draft: `false` (to be confirmed after creation)
- Merge: not performed; protected review remains human-controlled.

After PR creation, replace the two PR placeholders and record the report-only delivery commit
separately from the verified candidate SHA.
