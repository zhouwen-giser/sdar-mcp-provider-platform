# Phase R0 Known Issues

## Resolved or expected baseline gaps

- No package manifest, build, test or CI existed. This is expected for the
  confirmed greenfield baseline and is R1 scope.
- Global `protoc` and `buf` are absent. R1 makes generation repository-managed;
  release compatibility checks use pinned tooling/container execution.

## Open implementation work

All code and delivery requirements are explicitly assigned to R1-R9. These are
planned phase scopes, not hidden R0 defects or release waivers.

## Blockers

None. GitHub branch creation/push credentials are working, Docker tooling is
present, and no irreconcilable normative conflict was found.
