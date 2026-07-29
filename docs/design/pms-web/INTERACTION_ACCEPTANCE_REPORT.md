# Interaction acceptance report

## Automated evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Unit/component behavior | `pnpm --filter @sdar/pms-web test` | 9 files, 24 tests |
| Type safety | `pnpm --filter @sdar/pms-web typecheck` | Passed |
| Production bundle | `pnpm --filter @sdar/pms-web build` | Passed |
| Five browser flows | `prototype-flows.spec.ts` | Passed |
| 29 routes | Browser route loop | Passed |
| 14 scenarios | Browser scenario loop | Passed |
| Console | `pageerror` and console `error` collection | Zero errors |
| Real data transport | XHR/fetch/WebSocket/EventSource request collection | Zero requests |
| Screenshots | `prototype-screenshots.spec.ts` and screenshot verifier | 15/15 |

## Flow results

1. Provider onboarding preserves wizard state, validates fields, performs Mock checks and navigates
   to the new in-memory Provider.
2. RuntimeDeployment creation progresses from REQUESTED through ACTIVE while Desired and Observed
   revisions synchronize with the Operation Panel.
3. Configuration publishing exposes Form/JSON/Diff/Impact, keeps SecretRef non-revealable and
   produces simulated Runtime ACK states.
4. Runtime recovery traverses Incident, Deployment, Process and Job; Reconcile restores ACTIVE
   before Incident closing becomes available.
5. Catalog breaking change displays the schema diff, blocks Registry publishing and offers Mock
   rediscovery plus a structured Conformance boundary.

All technical outcomes are explicitly described as simulations.
