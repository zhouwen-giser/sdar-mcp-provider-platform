# Page inventory

## P0 complete interaction pages

| Area | Pages | Required states and interactions |
| --- | --- | --- |
| Dashboard | Overview | Metrics, subsystem health, stale/degraded warnings, incident navigation |
| Provider | List, detail, onboarding | Search/filter/sort, drawer, validation, connection checks, operation |
| Resource | List, detail summary | Environment/status filters, provider links, stale and partial data |
| Runtime | Deployment list/create/detail, process drawer | Desired/observed, impact, lifecycle, reconcile |
| Configuration | List, editor, diff, impact, publish, ACK | Form/JSON views, schema summary, SecretRef, operation |
| Catalog | List, operation diff | Schema diff, breaking severity, Registry block |
| Registry | Revision list and diff | Blocked state, rediscovery and simulated publication |
| Operations | Health, jobs, job drawer, incidents/detail | Backlog, timeline, linked entities and recovery |
| Audit | List and drawer | Filters, correlation, before/after summary |

## P1 structured pages

Provider Packages, Runtime Releases, Database Profiles, Protocol/Conformance, MCP Explorer, Change
Requests and System Settings each receive a real route, page header, explanatory sections, empty
state and an explicit future API/product boundary. They must not be generic “coming soon” screens.

## State matrix

All list and detail page families implement healthy, empty, loading, network error and partial
data. Domain-specific scenarios add degraded, runtime stale, config drift, catalog breaking,
worker backlog, incident active, pending approval, read-only and permission-denied visuals.
