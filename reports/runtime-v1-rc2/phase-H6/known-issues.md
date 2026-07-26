# H6 Known Issues and Residual Risk

- The locked MCP SDK labels Task support experimental. The exact typed error and Task parsing
  behavior is version-specific; dependency upgrades require T-031..T-040 before merge.
- Official TaskSchema contains status/TTL/polling fields but not SDAR Profile `result/error`.
  Runtime emits the Profile fields on wire and the SDAR client test uses a documented schema
  extension; generic clients may intentionally discard them.
- A client-provided `pollInterval` is not an execution control. Runtime returns its persisted
  2,000 ms recommendation and does not let polling metadata alter Scheduler behavior.
- Existing P0-P4 conformance passes in both languages, but H8 has not yet added T-048/T-049 and
  the expanded fault matrix. No expanded/full conformance claim is made here.
- Windows checkout line endings prevent a clean local Linux-container `proto:check` when the
  repository is bind-mounted. Remote native Linux generation and Buf gates passed.
- H7 operational hardening (continuous readiness, bounded limiter, DB pool lease behavior,
  image audit and explicit stateless MCP HTTP contract) remains open.
