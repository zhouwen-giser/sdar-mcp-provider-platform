# Route to future API map

This map describes future contracts only. The prototype implements none of these requests.

| Route family | Future read need | Future command need |
| --- | --- | --- |
| `/dashboard` | Aggregated health, incidents and backlog | None |
| `/providers`, `/resources` | Provider/resource projections | Provider onboarding |
| `/runtime/deployments`, `/runtime/processes` | Desired, observed, process and registration projections | Create deployment, reconcile |
| `/runtime/releases`, `/databases` | Release and profile metadata | Lifecycle management outside V0.1 prototype |
| `/configuration` | Profiles, revisions and Runtime ACKs | Validate and publish revision |
| `/catalog` | Discovered operations, schemas and evidence | Rediscover and classify |
| `/registry` | Revision history and bootstrap projection | Publish reviewed revision |
| `/operations/health`, `/operations/jobs` | Health, lease, fence and attempt views | Requeue job |
| `/operations/incidents` | Incident, timeline and linked aggregates | Close recovered incident |
| `/audit` | Redacted immutable event projection | None |
| P1 routes | Conformance, change and settings projections | Deferred |

Any future transport must live behind a production `PmsWebDataSource` implementation. Page
components must continue to avoid direct `fetch`, Axios, WebSocket or EventSource usage.
