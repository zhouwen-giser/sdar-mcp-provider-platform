# SMPP to SDAR handoff

The handoff is valid only when the redacted Registry Snapshot, Catalog revisions, Runtime endpoints, and qualification reports refer to the same candidate commit. It must contain public Provider IDs and Resource IDs only. It must not contain Home Assistant Entity IDs, tokens, Authorization headers, private-network credentials, or PMS secrets.

The authoritative closeout handoff is `reports/real-device-closeout/final-handoff.json`; the compatibility summary under `reports/real-device-preparation/final-handoff.json` must agree with it. `readyForSdarIntegration` remains `false` while any required real-device, Runtime, PMS, Registry, recovery, or restoration hard gate is blocked. A passed lab Resource is not a production qualification for every Home Assistant resource of the same domain.

The latest read-only Home Assistant and Registry-backed MCP evidence reports all three configured resources reachable, with zero active or uncertain Runtime Tasks. Functional integration is therefore allowed for the explicit operation/resource allowlist. Resilience and full-capability integration remain false because real in-flight recovery, real outage/fault behavior, PMS-outage Task Authority, and explicit climate power-on qualification are still unverified. No SDAR Agent Runtime is connected until all three readiness fields are true.

The live evidence refresh is reproducible with:

```text
node scripts/probe-live-registry-contract.mjs
node --import tsx scripts/run-live-smpp-registry-e2e.ts
pnpm report:ha-real-closeout
```

All three commands are read-only with respect to Home Assistant devices; the final command only regenerates reports and intentionally exits non-zero while any overall SDAR hard gate remains blocked. Device writes remain separately gated by the real-device safety variables and durable run budget. Any climate operation capable of changing power—including `climate_set_power` and `climate_set_hvac_mode` from off—additionally requires `ALLOW_CLIMATE_POWER_TEST=YES` and must stop with manual restoration required while the five-minute opposite-power interval is active.
