# Route map

| Route | Level | Page / behavior |
| --- | --- | --- |
| `/dashboard` | P0 | Platform overview, risks, health and incident entry |
| `/providers` | P0 | Provider list, filters, drawer and onboarding entry |
| `/providers/new` | P0 | Provider onboarding wizard |
| `/providers/:providerId` | P0 | Provider summary, resources, runtime and catalog links |
| `/provider-packages` | P1 | Package inventory structure and future boundary |
| `/resources` | P0 | Resource inventory and health filters |
| `/resources/:resourceId` | P0 | Resource summary |
| `/runtime/deployments` | P0 | RuntimeDeployment inventory |
| `/runtime/deployments/new` | P0 | RuntimeDeployment creation wizard |
| `/runtime/deployments/:deploymentId` | P0 | Desired/observed state and recovery context |
| `/runtime/processes` | P0 | RuntimeProcess inventory and drawer |
| `/runtime/releases` | P1 | Release inventory structure |
| `/databases` | P1 | Database Profile structure; never exposes secrets |
| `/configuration` | P0 | Configuration profile inventory |
| `/configuration/:profileId` | P0 | Editor, schema, diff, impact, publish and ACK |
| `/catalog` | P0 | Catalog inventory and breaking-change entry |
| `/catalog/:providerId/:operationName` | P0 | Operation schema and Catalog diff |
| `/registry` | P0 | Registry revisions, block and publish workflow |
| `/conformance` | P1 | Conformance boundary and result structure |
| `/mcp-explorer` | P1 | Read-only explorer boundary |
| `/operations/health` | P0 | Platform subsystem health |
| `/operations/jobs` | P0 | Worker jobs and detail drawer |
| `/operations/incidents` | P0 | Incident inventory |
| `/operations/incidents/:incidentId` | P0 | Incident recovery workflow |
| `/changes` | P1 | Change request structure |
| `/audit` | P0 | Audit list and event drawer |
| `/system/settings` | P1 | Prototype settings boundary |
| `/_prototype/components` | Internal | Component catalogue |
| `/_prototype/scenarios` | Internal | Scenario catalogue and switcher |

The root path redirects client-side to `/dashboard`. Unknown routes render a recoverable not-found
state inside the application shell.
