# H5 Known Issues

- H8 must prove migration 011 together with migrations 007-010 against a real migration-006
  rc.1 fixture; empty-database integration migration success is not reported as that proof.
- The existing P0-P4 reference-Adapter suite passed in both languages, but it is not yet the
  expanded H8 compliance matrix. This phase makes no broader conformance claim.
- Background Reconcile is best-effort immediately after a degraded read and is also retried by
  periodic Recovery. A process crash can lose only the immediate wakeup, not persisted Task state
  or the periodic recovery path.
- Logical expiry intentionally remains query-ineligible during purge grace. Operators can inspect
  and audit the row until physical purge, but MCP callers receive `TASK_EXPIRED` after successful
  authorization.
- PR #1 was externally merged during H2. Draft PR #3 is the only open continuation PR available
  for H5-H9 checks; final delivery must preserve that fact.
