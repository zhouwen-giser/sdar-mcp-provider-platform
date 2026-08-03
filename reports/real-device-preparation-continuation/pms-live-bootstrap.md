# Live PMS bootstrap and onboarding

Evidence class: `real` (with an explicitly unverified Worker sub-gate).

The formal PMS API path created or confirmed both Provider Types, both Providers, three Resources, Provider-Resource bindings, configuration drafts and published revision 1. The two deployments use the existing `vendor_managed` adapter plus PMS-managed Runtime model; no hosting mode was changed.

Both deployments reached `ACTIVE` with a ready Runtime and Registry revision 3 was later published. The direct application reconciler was required to converge the live deployments. The separately launched Worker claimed three old `runtime_deployment.reconcile` jobs and renewed their leases without completing them, so Worker job completion remains unverified and is recorded as a blocker.

No secret, Authorization header, or Home Assistant Entity ID is present in this report.
