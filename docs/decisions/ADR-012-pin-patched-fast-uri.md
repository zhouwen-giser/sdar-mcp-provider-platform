# ADR-012: Pin patched fast-uri transitive releases

Status: accepted

Date: 2026-07-22

## Context

The release gate's live dependency audit began reporting GHSA-v2hh-gcrm-f6hx at high severity.
The locked graph contained both `fast-uri` 3.1.3 through Ajv/MCP SDK paths and 4.1.0 through
Fastify JSON serialization paths. Both lines have upstream patch releases.

## Decision

Use exact pnpm overrides from 3.1.3 to 3.1.4 and from 4.1.0 to 4.1.1. Preserve both existing
major lines instead of forcing a cross-major resolution. Pin the resulting packages and npm
integrity values in the workspace lockfile and OSS source ledger.

## Consequences

- The high-severity advisory is removed without changing the Runtime's direct dependency APIs.
- Full build, test, container, conformance, SBOM, and audit gates must prove compatibility.
- The overrides are temporary and may be removed once upstream direct dependencies select patched
  releases themselves.
