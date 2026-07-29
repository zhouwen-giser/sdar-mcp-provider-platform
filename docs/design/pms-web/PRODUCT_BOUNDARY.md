# Product boundary

PMS Web is a provider-platform control-plane interaction prototype. It models management intent
and operational visibility; it is not a Runtime Task Console and it does not operate production
infrastructure.

## Included

- Provider onboarding and inventory
- Resources and provider health
- RuntimeDeployment desired/observed state and RuntimeProcess visibility
- Configuration drafts, validation, diffs, impact and Runtime acknowledgements
- Catalog and Registry discovery/diff workflows
- Worker job, incident and audit inspection
- Structured future-scope pages
- Deterministic mock scenarios and simulated operations

## Excluded

- Authentication or permission enforcement
- Real PMS endpoints or generated API clients
- Network streaming or polling
- Database, Worker, Runtime, PM2 or Provider commands
- Secret values, shell commands and Runtime Task editing
- Production packaging, proxying or deployment

The fixed identity “平台管理员 / prototype-user” is presentation-only. Read-only and denied
states are scenario visuals, not authorization decisions.

Every simulated write is labelled “模拟操作”. Its result describes prototype state only and must
never claim that PMS, Runtime, PM2, Worker, Provider, Catalog or Registry changed outside the
browser.

## Data rule

Pages depend only on `PmsWebDataSource`. Fixtures are private inputs to the mock data source and
scenario builder. Refreshing may reset all in-memory writes.
