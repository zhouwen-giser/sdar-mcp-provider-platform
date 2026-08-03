# SMPP to SDAR handoff

The handoff is valid only when the redacted Registry Snapshot, Catalog revisions, Runtime endpoints, and qualification reports refer to the same candidate commit. It must contain public Provider IDs and Resource IDs only. It must not contain Home Assistant Entity IDs, tokens, Authorization headers, private-network credentials, or PMS secrets.

The authoritative continuation handoff is `reports/real-device-preparation-continuation/final-handoff.json`; the legacy summary under `reports/real-device-preparation/final-handoff.json` must agree with it. `readyForSdarIntegration` remains `false` while any required real-device, Runtime, PMS, Registry, recovery, or restoration hard gate is blocked. A passed lab Resource is not a production qualification for every Home Assistant resource of the same domain.

The current local handoff is deliberately not ready: the auxiliary light remains `unavailable` in Home Assistant after a targeted `xiaomi_home` config-entry reload and one local Home Assistant restart. The climate power operation is also deferred by the five-minute inverse-power safety rule. No SDAR Agent Runtime is connected until all three readiness fields are true.

The live evidence refresh is reproducible with:

```text
node scripts/probe-live-registry-contract.mjs
node --import tsx scripts/run-live-smpp-registry-e2e.ts
node scripts/write-live-continuation-views.mjs
```

The first and third commands are read-only with respect to Home Assistant devices. The Registry-backed E2E is read-only in its current continuation profile; device writes remain separately gated by the real-device safety variables and run budget.
