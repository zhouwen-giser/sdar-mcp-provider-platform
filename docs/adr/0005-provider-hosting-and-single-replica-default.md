# ADR 0005: Default to vendor-managed Providers and one Runtime replica

- Status: Accepted
- Date: 2026-07-26
- Goal: goal-02
- Task: G2-P0-B03

## Context

Provider Adapters may contain vendor device logic and credentials that the platform must not assume
it can supervise. Separately, multiple Runtime replicas need a stable MCP endpoint and unambiguous
instance routing in addition to a shared Task Authority database.

## Decision

- Provider Adapter production hosting defaults to `vendor_managed`.
- `platform_managed` is allowed only when a trusted built-in Provider Package explicitly declares
  it and the platform uses an allowlisted adapter entry.
- A logical Provider deployment defaults to and is limited to one Runtime replica in V0.1.
- Provider Package previews and administrator input cannot become official Operation Catalog
  authority; Catalog comes from Runtime `server/discover + tools/list`.

## Deferred multi-replica requirement

Lifting the single-replica limit requires a stable gateway or equivalent routing design, explicit
instance/deployment identity, shared-database concurrency evidence, draining behavior, health-aware
routing, and end-to-end failure tests. That work requires a replacement ADR and is not inferred
from PM2's ability to start more processes.

## Consequences

V0.1 has a conservative production default and does not silently take ownership of vendor
processes. The control plane may model desired replica count, but validation rejects unsupported
counts rather than partially deploying them.

## Non-goals

This ADR does not implement a gateway, cross-node scheduler, rolling Task Authority database
switch, or online Provider code installation.
