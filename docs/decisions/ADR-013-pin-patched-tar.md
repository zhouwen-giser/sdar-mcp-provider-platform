# ADR-013: Pin patched tar transitive release

Status: accepted

Date: 2026-08-25

## Context

The release gate's live dependency audit began reporting GHSA-r292-9mhp-454m at high severity.
The locked graph contained `tar` 7.5.20 through the existing `@pb33f/openapi-changes` and
`grpc-tools`/`@mapbox/node-pre-gyp` build-tool paths. Upstream `tar` 7.5.21 contains the patch and
retains the BlueOak-1.0.0 license.

## Decision

Use one exact pnpm override for `tar` 7.5.21. Pin its npm integrity, upstream repository and git
commit in the OSS source ledger. This is a transitive build-dependency security update; it does not
add a Runtime API, source adaptation or new execution authority.

## Consequences

- The high-severity advisory is removed without changing Provider Runtime behavior or public APIs.
- Format, lint, typecheck, build, registry/PMS integration and live dependency-audit gates must prove
  compatibility.
- The override may be removed when every direct build dependency selects a patched `tar` release.
