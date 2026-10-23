# UGV MCP control console — 2026-10-22

## Objective

Ship a standalone Chinese UGV operator console on LAN HTTP port 19101 (user transport change on 2026-10-23), connected only through the frozen SMPP MCP endpoint. Coordinate forms and a scalable schematic, one operator account, shared PostgreSQL command/task journal, no dispatch on reconnect or restart.

## Source and constraints

Base c23f0ec includes the deployed f67fd0a navigation repair. Work in the already attached, clean managed worktree on codex/ugv-control-console-20261022. Preserve the primary checkout's uncommitted united deployment work. Use protocol 2026-07-28, TaskExecution 1.0, TaskBusiness 1.0-rc2. Runtime remains authority for physical execution, task ownership, availability and business result. Read-only field acceptance; operator initiates field controls.

## Implementation sequence

- [x] Shared coordinate parser, polygon validation, dedicated tool adapters and truthful task result presentation.
- [x] Fastify backend: login/session/origin guard, fixed upstream MCP, independent PostgreSQL migration and durable command journal, task import/actions and full business snapshot/artifact reads.
- [x] React operator UI: state overview, coordinate controls, scalable schematic, task history and task/business actions, SSE refresh and diagnostics/report export.
- [x] Isolated protocol, persistence, concurrency, recovery and browser verification, plus real Runtime/adapter/MQTT/PostgreSQL integration where available.
- [x] Docker image, reproducible bundle, secret/certificate provisioning, LAN 19101 deployment and read-only acceptance.

## Decisions

One deployment-configured operator; HTTP by the user's 2026-10-23 request; 8-hour HttpOnly and SameSite=Strict sessions. PostgreSQL schema ugv_control_console with separate migration. All writes require UUID commandId and durable intent before dispatch. Repeated UUID with changed content conflicts. Unknown dispatch outcomes never auto retry. Task index covers this console and imported IDs, not all Runtime tasks. Read availability before ordinary tool calls; stop has an independent path. Only supported dedicated UGV operations can dispatch. Unknown or disabled operations remain unavailable.

## Evidence

Record commands, exit codes, source/image hashes, bundle checksum and acceptance results here as work completes. Never store credentials in Git or acceptance outputs.

## Verification progress

- Console tests: 40 passed, including the shared-read cache regression. This includes five honest inspection outcomes and cancellation through a formal Runtime/gRPC adapter with owned PostgreSQL, MQTT and mock Device MCP, plus immutable large object reads, source isolation, observation replies and intervention guards.
- Browser suite: 2 passed, covering operator login, coordinate preview, lifecycle, reload, a second browser and mobile overflow. Desktop/mobile screenshots inspected.
- Existing real provider lifecycle suite: 7 passed (including pause/resume/cancel, recovery and timeout). Network subnet regressions: 4 passed. Root typecheck, build and frozen protocol validation passed; frozen lock remains d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845.
- Validation deployment created the dedicated database role/schema, secret files and certificate. Shared station network is internal, so a dedicated public edge bridge is required. Docker initially allocated 192.168.0.0/20; this shadowed device 192.168.2.63. Removed that owned bridge, restored the route, and added explicit 10.252.244.0/24 plus subnet/route/protected-address checks. All three native ports were rechecked as reachable.
- Read-only field check at 2026-10-22T16:49:24Z: login 200, 13 published tools, all four state reads without errors, MQTT and Device MCP online, resource vehicle:ugv, imported old Task ed90ab34-2c7b-4508-8a33-5b7c54d59c51 still working/stopping. Live control command count is 0. Native chassis/health/payload source times remain about six seconds ahead of the platform; no freshness guard was relaxed.
- Scoped forwarding repair is limited to this console, Runtime 8080, PostgreSQL 5432 and published 19101. Restored the temporary shared-bridge route_localnet setting to its original 0; the console's own edge bridge carries loopback support.

## Release and acceptance — 2026-10-23

- Implementation source: `9842a7f9a155e7905f6d7ff6ab2a5c238e423d11`. Image `smpp/ugv-control-console:20261023-9842a7f`, ID `sha256:c501f5b8556a55d404e0ceb599b98d338b894ac67e5c9553af2fd8dbb209aab5`. Image label and bundled source pin this implementation commit; this later closeout changes only this document.
- Healthy deployed container `smpp-ugv-control-console`, LAN URL `https://17.26.1.20:19101`. Local loopback health also passed. Preserved the existing Runtime/adapter/PostgreSQL container IDs, images and mounts and all five operator secret/certificate files. The primary checkout retains its existing united packaging changes.
- Final isolated browser rerun: 2 passed. Total automated cases: 53 (40 console, 7 provider lifecycle, 4 subnet policy, 2 browser). App/root typecheck and build, changed-file ESLint/Prettier and frozen protocol validation passed.
- Real browser acceptance at `2026-10-23T01:41:52Z`: authenticated LAN login, 13 actual tools, all four device reads without errors, imported Task detail shown, no JavaScript errors, no desktop/mobile horizontal overflow and zero control submissions. Desktop/mobile screenshots inspected. The local browser's system proxy caused `ERR_NETWORK_CHANGED`; the successful LAN run used a direct connection (`--no-proxy-server`). HTTPS test context allowed this generated site certificate; operator computers should trust the deployed `tls.crt`.
- Bundle `/mnt/data/ugv-control-console-20261022/ugv-control-console-9842a7f9a155.tar.gz`, SHA-256 `cf6e16dc2990f08ca0eec8c0fac3fedb9c707db9654b3198773d9569e71b37ee`. All seven internal file checks and the outer archive check passed. No deployment credentials are included.
- Evidence and command receipts: `/mnt/data/ugv-control-console-20261022/REPORT.md`, `SUMMARY.json`, `EVIDENCE_SHA256SUMS`. Isolated PostgreSQL/MQTT fixtures are removed after acceptance.
- Physical control acceptance remains pending operator execution. Native source timestamps remain approximately six seconds ahead of position/platform time, and imported Task `ed90ab34-2c7b-4508-8a33-5b7c54d59c51` remains `working/stopping`. The UI preserves those facts; no freshness or lifecycle guard was relaxed and this task issued no field control command.

Credentials are outside Git under the operator-owned 0700 state directory. Deployment has a previous image configuration for rollback; database records, operator credentials and certificate persist.

## HTTP change requested by user — 2026-10-23

- [x] Default HTTP transport, LAN origin allowlist, HTTP session cookie and protocol-aware health check; retain credentials, records and existing TLS files for rollback.
- [x] Replace secure-context-only browser randomUUID with cryptographic UUID generation that works on LAN HTTP. Isolated browser lifecycle tests explicitly remove randomUUID.
- [x] Validate configuration/authentication and browser controls, build and deploy the HTTP image, refresh the deployment bundle and record direct LAN HTTP acceptance.

HTTP verification before release: 44 console cases and 2 browser cases passed; app typecheck/build, changed-source ESLint and console/deployment Prettier passed. Browser coverage seeds a previous HTTPS Secure cookie and removes randomUUID before submitting isolated navigation/lifecycle commands. HTTP uses `ugv_session_http`, preserving HttpOnly/SameSite and session revocation while avoiding a collision with the previous HTTPS cookie.

HTTP release source: `99e35266fd562a26a97bb66cfa99d36b98e303fc`, image `smpp/ugv-control-console:20261023-http-99e3526`, image ID `sha256:ead44a82266d9bb505ffb1c365aaab36f4fec0fc57b430099d30e30d60e30413`. Container healthy; direct `http://17.26.1.20:19101/health/ready` returned 200 without redirect and the HTTPS probe failed with EPROTO as expected for HTTP. Real LAN browser acceptance at `2026-10-23T05:34:02Z` passed login with a previous Secure cookie, HTTP session attributes, non-secure-context API availability, 13 actual tools, all device reads and imported Task detail; no page errors, no desktop/mobile overflow and zero live controls. Existing platform containers/mounts and five private files were verified unchanged. Owned isolated PostgreSQL/MQTT fixtures were removed.

Updated bundle: `/mnt/data/ugv-control-console-http-20261023/ugv-control-console-99e35266fd56.tar.gz`, SHA-256 `b128e3c66b4ddaf1dfa8dfd6e7444968d756d16e42af6e7ff9a815017f894825`; internal and outer checks passed. `REPORT.md`, `SUMMARY.json` and `EVIDENCE_SHA256SUMS` record commands, exit codes and evidence. This closeout changes only the plan; the image and source bundle pin the implementation commit above.

Evidence directory: `/mnt/data/ugv-control-console-http-20261023`.

## Navigation freshness recovery — 2026-10-23

- [x] Reproduced `UGV_STATE_STALE` with a complete navigation availability request. Native chassis/health/mission/payload timestamps were about 6 seconds ahead of the station; position reception was current. Two Cloudflare NTP probes measured the station clock approximately 6.4 seconds behind UTC. systemd-timesyncd had no successful samples, with `ntp.ubuntu.com` resolved to proxy fake IP `198.18.0.49` and repeated timeouts.
- [x] Installed only `/etc/systemd/timesyncd.conf.d/70-smpp-clock-sync.conf`, pointing the existing synchronization service at the provider's documented IPs `162.159.200.1` and `162.159.200.123`, and restarted systemd-timesyncd. The second NTP sample measured a 38.783 ms offset, synchronized=yes. Application code, freshness limits and device clocks were unchanged.
- [x] Rechecked navigation twice through the console API: `available / UGV_AVAILABLE`; observed source ages 51–70 ms and 336–351 ms. The four pre-existing console commands remained rejected records with no Task IDs; command count stayed four and no physical action was dispatched during recovery.

Evidence: `/mnt/data/ugv-navigation-freshness-20261023/REPORT.md`, `SUMMARY.json`, before/after availability snapshots, NTP probes and synchronization status. The persistent station NTP drop-in fixes the earlier clock blocker recorded above. Existing deployment images and database records remain in place.

## Reconnaissance availability recovery — 2026-10-23

- [x] Read the actual console state and raw non-retained MQTT. `/ugv/area_recon/status` reports idle/unlocked, while fresh `/ugv/status` repeatedly reports EO task 2630 in state 1 (running). The old recon Task ed90ab34-2c7b-4508-8a33-5b7c54d59c51 uses native mission 38871 and remains stopping after earlier preemption. No persisted execution owns native 2630. The current external occupancy is a separate device fact.
- [x] Implement automatic availability refresh after an explicit check, expiry-aware result labels and external EO diagnostics. Parameter edits invalidate the request; physical commands remain explicit actions.
- [ ] Run isolated expiry, auto-release, late-response and external occupancy regressions; build/deploy the console update and refresh its bundle.
- [ ] Resolve the live external EO occupancy if the operator authorizes interrupting task 2630, then verify the actual device report and Task receipts. Do not infer channel release from the separate recon idle report.

Evidence: `/mnt/data/ugv-recon-channel-recovery-20261023`. Operator approval requested for interrupting the unowned external EO task; continue independent UI work while waiting.

Pre-release checks: 4 isolated browser cases passed (including automatic recovery after channel release, expiry labels and late responses after parameter edits); 2 targeted adapter occupancy cases passed (96 unrelated cases skipped). Console build/typecheck, root typecheck and changed-source ESLint passed. The initial new browser test had unsafe-any lint errors; typed JSON parsing repaired those before the successful run. No deployed adapter logic or physical interlock has been relaxed.
