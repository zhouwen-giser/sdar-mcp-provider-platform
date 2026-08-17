# Known Limitations

1. The simulator was unavailable. Device MCP, MQTT, navigation, task controls, emergency stop and reconnaissance have no external qualification in this delivery.
2. Deterministic and Mock evidence proves software semantics only. It is labeled separately from `PENDING_SIMULATOR_*` states.
3. The frozen Availability enum cannot represent `DEGRADED`. Internally degraded health maps to `AVAILABLE` with a bounded reason code; `OPEN` and `RECOVERING` map to `UNKNOWN`.
4. Recon observations without a downstream mission/run identifier are explicitly `WEAK_UNCORRELATED`; the Provider never invents an identifier.
5. Source sequence is preferred. Where a topic lacks it, changed cursor plus nondecreasing observed time is an explicitly weaker ingest/time authority, not strict source ordering.
6. The Provider reports objective displacement and terminal facts but intentionally does not decide SDAR business tolerances.
7. Static engineering facts remain null/unconfigured until supplied by vehicle engineering authority.
8. Fire remains present in the frozen catalog for compatibility but is disabled by default and in production; direct start and availability both reject it.
9. Provider metric records traverse the existing Provider telemetry ingress/export pipeline; external collector receipt was not tested without the simulator/deployed telemetry environment.
10. This worktree delivery is based on commit `2e0626f2b2159d7c11061625c15274863479e217`; the implementation delta is carried by the delivery patch and ZIP and has not been pushed or submitted as a PR.

Deferred V1.2 roadmap items are component power, precise turn, payload brightness/focus/absolute zoom, media capture/Artifact integration and engineering-authoritative physical parameters.
