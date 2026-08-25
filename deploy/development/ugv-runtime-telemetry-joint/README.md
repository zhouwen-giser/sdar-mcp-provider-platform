# UGV Runtime / Telemetry joint development override

This development-only Compose override enables the existing UGV Runtime's
cleartext OTLP export to the local Telemetry Collector while preserving the
release/simulation Compose defaults.

Use it together with `deploy/ugv-simulation/compose.yaml` and an existing,
secret-backed `deploy/ugv-simulation/.env`. Real control and fire remain
disabled by the base deployment; this override does not add either
authorization.

```bash
docker compose \
  --env-file deploy/ugv-simulation/.env \
  -f deploy/ugv-simulation/compose.yaml \
  -f deploy/development/ugv-runtime-telemetry-joint/compose.override.yaml \
  config --quiet
```
