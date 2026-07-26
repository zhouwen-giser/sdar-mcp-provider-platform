# Phase R9 Known Issues

- The committed capacity workload is a sequential regression baseline, not a
  production concurrency/SLO claim; each resource team must load-test its real
  Adapter, database and topology.
- Kubernetes manifests deliberately depend on externally managed PostgreSQL,
  Adapter, ingress and secret resources. Placeholder values cannot be deployed
  unchanged.
- Local Docker/Python/PostgreSQL release verification is unavailable; Actions
  `29501239305` passed the complete remote gate with no skipped suite.
