# Known limitations

- The repository's frozen MCP profile implements server/discover, tools/list, tools/call, tasks/get, tasks/update, tasks/cancel, and observations. It does not implement initialize or tasks/result; real runners treat initialize as not applicable and use terminal tasks/get where needed.
- The live continuation performed formal PMS API onboarding, Config Publish, ACTIVE Runtime Deployment reconciliation, Catalog publication, and Registry revision 3 publication. After the PM2 connection-lifecycle repair, the formal PMS Worker completed repeated reconcile jobs for both Providers.
- Real Adapter outage and recovery were observed; the Adapter came back but the existing Runtime required an exact restart before readiness recovered. Adapter/Runtime restart during an in-flight Task, HA outage injection, and corrupted real Provider state-file injection remain unverified.
- Real qualification is limited to the three explicitly configured lab resources. It is not a production certification of all Home Assistant climate or light entities.
- The two light runs used power control only. Brightness capability was observed in read-only preflight and the optional brightness operation is covered by fake/contract tests, but no brightness side effect was executed on the real lights.
- The existing provider-package suite has one environment-only failure: its Windows symlink assertion receives EPERM; the standalone package self-check passes for all packages.
- `protocol:check` and the frozen protocol lock pass on the current candidate. `verify:v2` and `verify:platform` aggregate wrappers remain unverified after the pnpm dependency-status EPERM; the direct component results are recorded in the continuation regression report.
- `climate_set_power` was not written on the current PMS Registry path: its original power was off and the five-minute opposite-power protection did not permit an additional bounded power cycle. Current Registry-backed HVAC mode and temperature writes are also left unverified rather than inferred from historical isolated-run evidence.
- The latest read-only Home Assistant preflight found `living-room-aux-light` unavailable. No further real-device write was attempted after that observation; P1 must pass again before any resumed qualification.
- Home Assistant `xiaomi_home` logs show repeated MIoT session disconnect/reconnect attempts. A targeted config-entry reload and one local Home Assistant restart did not restore the auxiliary light; this is tracked as an external Home Assistant/device-availability blocker.
- No SDAR Agent Runtime was connected.
- No credentials, raw Authorization headers, or Home Assistant internal entity IDs are included in reports or handoff artifacts.
- Repository-wide formatting is blocked by two pre-existing files; unrelated NPC Tank fixed temporary paths and the Provider Package symlink assertion remain Windows EPERM limitations.
