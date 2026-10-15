# sz-gowm delivery — 2026-09-30

Final source `367910c75f4ffa3969aed1f612b77d74a6518ed4` deployed at `2026-09-30T08:05:23.395Z` (16:05 China time). Both SMPP containers are running with revision `367910c75f4ffa3969aed1f612b77d74a6518ed4-worktree-352317bb9881`.

- Uploaded archive: `/mnt/data/smpp-gowm-gdps-gsap-cbabdfc23eefc58e.tar.gz`.
- Installed root: `/mnt/data/smpp-business-feedback-20260930/smpp-gowm-gdps-gsap-cbabdfc23eefc58e`.
- SHA-256: `3ef8541190ec0f158214c4cf14c3455b0cfc19b80fce53a353cafbc34b857bb7`. Independent rebuild is byte-identical; all 8 archive member checksums passed.
- Analysis upstream SHA `321700fd62de81f19b3a7e1e92f2ea22ba538be5ea94aef02bc5633711f95f52`; GOWM SHA `62fd9970d399039df7c7c138e8534f73c294e33836f629f64e56da3a4a91eb81`. Existing upstream identity is unchanged.

The existing shared GOWM database, `ugv_smpp_app` role, binding and MQTT session remain in use. Runtime 027 / Provider 030 business SQL is installed. No independent business PostgreSQL was created. Deployment verified all 33 upstream containers remained in place; Runtime/Adapter named volumes were retained. The verified SMPP-scoped backup is 364,317,157 bytes; raw snapshot table data is excluded from this backup and remains in the original database.

Actual config: `AUTH_MODE=development`, `SIMULATOR_CREDENTIAL_FREE=true`, `UGV_FIRE_ENABLED=false`, `UGV_OBSERVATION_MAX_FUTURE_SKEW_MS=3000`. Past-data expiry stays 3000 ms. Map-full uses the explicitly labeled range/FOV/pose sector estimate. The private JWT candidate remains unapplied; anonymous callers do not bypass trusted Input authorization.

Required static, development-tests and task-business-ugv jobs passed in [CI 36686731297](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/36686731297). The affected source/rotation/finalization regression passed 21 cases. Production dependency imports, image revision and Adapter profile checks passed in read-only network-disabled containers. Dispatch-only RELEASE checks were skipped.

Passive checks at `2026-09-30T08:07:22.706555+00:00`: `/health/live` and `/health/ready` returned HTTP 200. Old business events 169–171 reached `terminal_skipped` with individual finalized timestamps. No unfinalized rejected/mapping/continuity barriers remain for this device. Malformed health inbox 52 remains `rejected` with its original rejection reason and a finalized barrier; it was not rewritten as a valid source event. Runtime/Adapter/PostgreSQL logs (last 2000 lines since deployment, all observed windows below the limit) showed zero check-constraint or finalization failures.

Source state retains historical `TASK_MAPPING_FAILED` / `SOURCE_TEMPORARILY_UNAVAILABLE` labels. The published business cursor remains 167 while later orphan events are explicitly skipped; this is not proof of a new successful business workflow. No synthetic source event or vehicle task was created for this check.

The user requested no repeated tests of completed functions. Navigation, adjustments, Recon, lock, Input and estimated Map-full evidence is retained with its original source revision. Later failed attempts, including the last camera fault, remain recorded without prompting further resets or running another workflow. External SDAR qualification remains separate; no fresh full field qualification of this maintenance binary is claimed.

Evidence: [installation](evidence/barrier-installed-verification.json), [images](evidence/barrier-image-verification.json), [package](evidence/barrier-package-verification.json), [CI](evidence/barrier-hosted-ci.json), [passive checks](evidence/barrier-site-passive.json), [functional evidence reuse](ACCEPTANCE_REUSE_DECISION.json).
