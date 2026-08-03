# Live PMS bootstrap and onboarding

Evidence class: `real`.

The formal PMS API path created or confirmed both Provider Types, both Providers, three Resources, Provider-Resource bindings, configuration drafts and published revision 1. The two deployments use the existing `vendor_managed` adapter plus PMS-managed Runtime model; no hosting mode was changed.

Both deployments reached `ACTIVE` with a ready Runtime and Registry revision 3 was later published. After the PM2 connection-lifecycle fix and a fresh local PM2 control root, the formal Worker completed repeated `runtime_deployment.reconcile` jobs for both Providers; the latest sampled jobs were `succeeded` or `pending` with no active lease. The deployments remained `ACTIVE` and ready at the observation point.

No secret, Authorization header, or Home Assistant Entity ID is present in this report.
