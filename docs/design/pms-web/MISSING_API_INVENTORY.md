# Missing API inventory

The prototype intentionally has no production API implementation.

| Priority | Missing contract | Minimum response shape needed |
| --- | --- | --- |
| P0 | Dashboard projection | Counts, freshness and risk links |
| P0 | Provider/resource query and onboarding command | Stable IDs, validation blockers and operation reference |
| P0 | Runtime desired/observed/process query | Revisions, lifecycle, health, registration and heartbeat |
| P0 | Runtime create/reconcile command | Durable operation and worker job references |
| P0 | Configuration profile/revision/ACK query | Effective source, Apply Mode, SecretRef and ACK state |
| P0 | Configuration validate/publish command | Schema messages, impact and operation reference |
| P0 | Catalog discovery/diff/Registry query | Schema, compatibility, evidence and revision |
| P0 | Catalog rediscover/publish command | Breaking-review outcome and operation reference |
| P0 | Job/Incident/Audit query | Lease/fence/timeline, linked aggregates and redacted changes |
| P1 | Conformance, change requests and settings | Product contracts remain undefined |

No endpoints, URL conventions, credentials or transport mechanism are assumed here. API design is
a separate goal and must preserve redaction and authority boundaries.
