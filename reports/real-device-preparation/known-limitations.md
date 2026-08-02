# Known limitations

- The repository's frozen MCP profile implements server/discover, tools/list, tools/call, tasks/get, tasks/update, tasks/cancel, and observations. It does not implement initialize or tasks/result; the real runners record the 404 and stay BLOCKED.
- The local run did not have a live PMS API/worker deployment and therefore did not claim formal package sync, Config Publish, Runtime Deployment ACTIVE, Catalog Snapshot publication, or Registry Snapshot publication for ha-climate-lab and ha-light-lab.
- Real Adapter restart during an in-flight task, Runtime restart against the real devices, HA outage injection, and corrupted real Provider state-file injection were not performed.
- Real qualification is limited to the three explicitly configured lab resources. It is not a production certification of all Home Assistant climate or light entities.
- The two light runs used power control only. Brightness capability was observed in read-only preflight and the optional brightness operation is covered by fake/contract tests, but no brightness side effect was executed on the real lights.
- The existing provider-package suite has one environment-only failure: its Windows symlink assertion receives EPERM; the standalone package self-check passes for all packages.
- `protocol:check`, `verify:v2` and `verify:platform` stop at the protocol lock hash mismatch under `core.autocrlf=true`; the frozen contract, schemas and 74 conformance cases pass and the committed lock is unchanged.
- No SDAR Agent Runtime was connected.
- No credentials, raw Authorization headers, or Home Assistant internal entity IDs are included in reports or handoff artifacts.
