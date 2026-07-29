# Information architecture

## Navigation groups

| Group | Primary destinations | Operator question |
| --- | --- | --- |
| Overview | Dashboard | Is the provider platform healthy now? |
| Providers | Providers, Provider Packages, Resources | What is connected and what does it expose? |
| Runtime | Deployments, Processes, Releases, Database Profiles | What should run and what is actually running? |
| Configuration | Configuration Profiles | What configuration is drafted, published and acknowledged? |
| Discovery | Catalog, Registry, Conformance, MCP Explorer | What operations are discoverable and safe to publish? |
| Operations | Health, Jobs, Incidents | What is delayed, failing or being reconciled? |
| Governance | Change Requests, Audit, System Settings | Why did state change and what remains controlled? |

## Detail behavior

- Entity summaries open in a right-side drawer when the operator should retain list context.
- Multi-step changes use dedicated pages.
- Provider, deployment, configuration and incident details expose related-entity links.
- A global operation panel shows every simulated write and its deterministic step timeline.
- A development-only scenario switcher changes mock projections without introducing permission
  logic.

## Shared states

Every page can render loading, empty, error and partial/stale states. Additional scenario states
cover degraded providers, stale runtime observations, configuration drift, breaking catalog
changes, worker backlog, active incidents, pending approval, read-only and denied visuals.

## Density and responsive baseline

The shell uses a 56px header, approximately 232px navigation and 24px content spacing. Tables are
compact, IDs are copyable and status never relies on color alone. The minimum supported acceptance
viewports are 1440×900 and 1280×720.
