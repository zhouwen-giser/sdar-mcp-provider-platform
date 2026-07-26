# H4 Known Issues

- Existing third-party Adapters must be upgraded to echo the new protobuf identity fields. An
  Adapter that omits them is rejected instead of receiving a compatibility bypass.
- H8 must prove migration 010 from a real rc.1 migration-006 data fixture and run the expanded
  dual-language Adapter conformance matrix before a release-level conformance claim is made.
- The unique external-execution binding is provider-scoped. This deliberately permits different
  providers to use the same opaque external id while preventing a provider from binding it to two
  Runtime Tasks.
- PR #1 was externally merged during H2. Draft PR #3 is the only open PR that can carry H4-H9
  continuation checks; the final report must describe this repository fact without rewriting
  history.
