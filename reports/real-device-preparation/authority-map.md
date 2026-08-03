# SMPP Home Assistant authority map

| Concern                                                                                   | Authoritative component       | Required evidence                                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Provider identity, package, config, desired deployment and audit                          | PMS                           | PMS API/application records and redacted audit/deployment output                                               |
| Task acceptance, task state, command sequencing, scheduler, recovery and `/mcp`           | MCP Tasks Runtime             | Runtime readiness, `tools/list`, `tools/call`, authoritative `tasks/get`, notification and PostgreSQL evidence |
| Home Assistant connection, resource allowlist, actual service call and state confirmation | Provider Adapter              | Adapter manifest, gRPC trace, persisted execution, HA REST/WebSocket observations                              |
| Actual `climate.*` and `light.*` state                                                    | Home Assistant                | HA REST state and `state_changed` observations for only the configured resources                               |
| Catalog and Registry publication                                                          | PMS Catalog/Registry services | Catalog checksum/revision and redacted Registry Snapshot; no secret or internal HA entity identifier           |

## Non-negotiable boundaries

- PMS must not call Home Assistant services.
- Runtime must not call Home Assistant REST or WebSocket APIs.
- The Adapter must not mutate PMS or Runtime task tables.
- A test driver may call HA directly only during read-only preflight and must label that evidence `real-preflight`, never as SMPP control validation.
- Public `resourceId` values are the only identifiers allowed to cross the Runtime/PMS boundary. Internal HA entity identifiers remain in `.local/ha-real-device/resources.local.json` and redacted evidence.

## Qualification vocabulary

Every report records one of `real`, `simulated`, `contract`, `static`, or `unverified`. A real result is scoped to the exact configured laboratory resources and run; it is not a production-wide certification of all Home Assistant entities.
