# Required user flows

## 1. Provider onboarding

Providers → New Provider → package and identity → Adapter check → Database Profile → Runtime
selection → preflight blockers → simulated operation → Provider detail.

Validation prevents incomplete progress. Previous inputs survive back navigation. Connection
results and final state are mock projections.

## 2. RuntimeDeployment creation

Provider → Runtime Release → Database Profile → Configuration Profile → placement → impact
analysis → simulated operation → lifecycle timeline → Deployment detail.

The flow distinguishes desired state from observed state at every transition.

## 3. Configuration publishing

Draft → form/JSON editing → schema validation → diff → impact → apply mode → simulated publish →
Runtime ACK matrix.

SecretRef shows reference metadata only. No secret value is ever displayed or collected.

## 4. Runtime recovery

Dashboard warning → Incident detail → linked Deployment → RuntimeProcess drawer → Worker Job →
simulated reconcile → observed state ACTIVE → close Incident.

Closing is enabled only after the mock recovery steps complete.

## 5. Catalog breaking change

Catalog operation → schema diff → breaking severity → Registry blocked → Conformance structured
placeholder → simulated rediscovery → simulated Registry publication.

Each mutation appears in the operation panel and explicitly states that no production change was
performed.
