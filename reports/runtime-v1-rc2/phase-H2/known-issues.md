# H2 Known Issues

- H3 still needs a Runtime-owned observation revision and a single transition primitive for
  all Task mutations.
- H4 still needs immutable Operation Snapshot resolution and centralized Snapshot/Ack identity
  validation; these are the two remaining expected-red structural guards.
- The 30-second compatibility start window for clients omitting SDAR timing is frozen in
  ADR-005; explicit zero remains exact.
- The externally merged PR #1 contains H0-H1 only. PR #3 is the continuation and must be the
  final green PR for H2-H9; final reporting must not imply #1 contained those commits.
- New governance workflows duplicate parts of `runtime-ci`; all applicable checks must remain
  green until the workflow layout is intentionally consolidated.
