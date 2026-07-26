# Phase H6 Implementation Report

## 1. Goal

Freeze the MCP result and error channels at the real SDK/wire boundary, enforce Adapter output
schemas before publication, and make the official Task field names coexist with SDAR Profile
compatibility metadata without inventing top-level fields.

## 2. Baseline and upstream sync

- Phase-start SHA and target remote: `e7500d1b3685eee6bc8cd801574619d2958c96b6`.
- During pre-commit sync, merged PR #3 advanced `origin/main` to
  `2d5faa11de798ad09ab213d6cdf8f0073d169021`; its tree was identical to H5 Head, so the local
  branch fast-forwarded without a content conflict.
- Pre-commit target remote remained `e7500d1`; implementation Head became `787648a` and was
  pushed normally.
- PR #1 and PR #3 are immutable merged history. Continuation PR #4 carries H6-H9 checks.
- Annotated `v1.0.0-rc.1` object remained
  `9a4715e6316a23f399ee06eea2444b0245fa1adb`, peeled to
  `51d68926ba1bc9e935438e750582693aea3ecf4d`.

## 3. Error and result channels

- Domain errors now distinguish invalid parameters, hidden/expired Tasks, capability absence,
  Adapter contract/transient failures, technical execution and business Tool outcomes.
- One MCP boundary mapper returns typed SDK `McpError` values with stable JSON-RPC code, safe
  message and `data.reasonCode`. Internal errors invoke the Runtime logger with correlation id
  and original cause.
- The boundary normalizes the SDK's local `McpError.message` prefix before serialization, so a
  client receives one prefix locally rather than a nested wire prefix.
- Unknown Tool/Task, expiry, malformed timing/input/TTL and unsupported capability are Invalid
  Params. Synchronous and pre-publication technical failures are Internal Error.
- A published technical failure is a Task `failed` with a standard code/message/reason/retryable
  error object. Business failure and partial completion stay `completed` and return
  `CallToolResult.isError=true`.

## 4. Output contract

- Operation Registry retains compiled Draft 2020-12 output validators for current Manifest and
  immutable stored Operation Snapshot definitions. The Manifest hash is the output schema
  version.
- Runtime validates raw Adapter results for synchronous success, task-capable inline success,
  asynchronous success and partial completion before any visible success publication.
- Output JSON is bounded at 1 MiB, depth 32 and 10,000 nodes. Contract failure becomes
  `ADAPTER_OUTPUT_SCHEMA_MISMATCH` or the corresponding stable JSON-limit reason.
- Successful `structuredContent` is the operation-defined raw result. Business/partial output
  uses the standardized envelope; advertised Tool schema accepts those two documented shapes.
- Scheduler, Recovery and command-rejection reconciliation apply the same immutable operation
  validator rather than bypassing it.

## 5. Task compatibility and persistence repair

- Official top-level Task fields are `ttl` and `pollInterval`. SDAR aliases appear only at
  `_meta["io.sdar/taskExecution"].ttlMs/pollIntervalMs`.
- TTL is strictly a safe integer from 1 through 31,536,000,000 ms. A narrow official request
  schema extension lets Runtime map a malformed type to Invalid Params instead of the SDK's
  generic Zod Internal Error.
- Official base Task parsing and an SDAR DetailedTask schema extension are both exercised on the
  real Streamable HTTP endpoint.
- The new initial-terminal cases exposed an H5 persistence defect: inserting a terminal state
  before `terminal_at` violated migration 011's immediate check constraint. Publication now
  writes terminal/expiry/last-confirmed retention fields atomically in the INSERT using
  PostgreSQL time. No constraint is deferred or weakened.

## 6. Tests

- T-031 covers valid synchronous, task-capable inline and asynchronous success.
- T-032 covers invalid synchronous, inline and asynchronous success and proves no invalid success
  is published.
- T-033 covers valid and schema-invalid partial payloads.
- T-034..T-039 freeze synchronous/published technical, business, unknown Tool/Task, expiry and
  capability error channels.
- T-040 validates official Task fields, namespaced aliases, numeric TTL bounds and a raw malformed
  TTL request over Streamable HTTP.
- TypeScript and Python Adapters implement matching H6 fault scenarios. All new wire tests use
  the official SDK client where the SDK schema accepts the request; the malformed-type test uses
  the same HTTP endpoint and asserts the raw JSON-RPC response.

See `test-results.md` for exact local and remote evidence. No test is skipped.

## 7. Known limitations

- MCP Task APIs are experimental in SDK 1.29.0. SDK upgrades must rerun the full H6 wire matrix;
  no compatibility beyond the locked version is claimed.
- The official base Task schema intentionally strips Profile-only `result/error` fields. SDAR
  clients must use the documented schema extension to retain them; aliases remain namespaced.
- H8 owns the expanded dual-language conformance matrix. H6 remote `pnpm verify` passed the
  existing P0-P4 suites, but this report does not claim the H8 expansion is complete.
- Local Linux `pnpm build` passed. A subsequent local `proto:check` encountered the known
  Windows-host CRLF checkout mismatch in one generated comment; remote Linux Buf/generation
  checks passed and are the authoritative result. The failed local command is not reported as a
  pass.

## 8. Commit and CI

- Implementation commit: `787648a05feeb18a3b2d90c43ed000422052c927`.
- Push runtime `29539952514`: SUCCESS (`pnpm verify`, Buf lint/breaking, Compose).
- PR runtime `29539965808`: SUCCESS (`pnpm verify`, Buf lint/breaking, Compose).
- PR quality `29539965866`: SUCCESS.
- PR Compose `29539965781`: SUCCESS.
- Report-containing closure Head checks: pending.

## 9. Exit status

- [x] Wire error codes/messages/reason data have black-box assertions.
- [x] Technical failures no longer use an invalid ordinary CallToolResult channel.
- [x] Success and partial output schema validation is active on every execution path.
- [x] Official MCP and SDAR DetailedTask compatibility tests pass.
- [x] T-031..T-040 pass locally without skip.
- [x] Implementation Head passes branch and PR checks.
- [ ] Report-containing closure Head passes branch and PR checks.
