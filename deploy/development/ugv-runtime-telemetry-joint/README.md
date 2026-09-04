# UGV Runtime / Telemetry joint development override

This development-only Compose override is the default live integration profile. It sets
`UGV_DELIVERY_STAGE=development_debug`, connects to Device MCP
`http://192.168.2.63:19000/mcp` and MQTT `mqtt://192.168.2.63:1883`, enables live execution and
all registered tool side effects (including the effector tool), and enables cleartext OTLP export
to the local Telemetry Collector. The two Benchmark diagnostic control capabilities are enabled by
default in this Development Debug profile, but remain protected by a scoped operator token mounted
from `SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE`.

Use it together with `deploy/ugv-simulation/compose.yaml` and an existing, secret-backed
`deploy/ugv-simulation/.env`. The remote service is a simulator, but the Adapter deliberately uses
`live` execution mode because `simulation` mode does not dispatch to the remote MCP service.
Set `SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE` to an existing non-empty file that is readable by Docker;
the override fails closed during Compose interpolation when the path is missing from the environment.

```bash
docker compose \
  --env-file deploy/development/ugv-runtime-telemetry-joint/.env \
  --env-file deploy/ugv-simulation/.env \
  -f deploy/ugv-simulation/compose.yaml \
  -f deploy/development/ugv-runtime-telemetry-joint/compose.override.yaml \
  config --quiet
```

Integration Candidate and Qualification are never inferred from readiness, source state, or
environment health. To leave Development Debug, an operator must explicitly change
`UGV_DELIVERY_STAGE` to `integration_candidate` or `qualification` and use the corresponding
stage-specific deployment procedure. Those stages may explicitly disable the diagnostic gates;
Development Debug evidence must not be presented as qualification evidence.
