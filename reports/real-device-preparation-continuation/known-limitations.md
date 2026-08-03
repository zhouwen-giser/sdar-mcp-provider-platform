# Known limitations

- Current Home Assistant state for the auxiliary light is `unavailable` after a targeted Xiaomi integration reload and one local Home Assistant restart; no device write was attempted afterward.
- `climate_set_power` remains deferred by the five-minute inverse-power safety rule.
- Real in-flight restart, REST-200-without-state-change, and complete HA/PMS outage recovery remain unverified.
- Windows symlink and aggregate repository gates remain environment-limited.
- Readiness is `false`; no SDAR Agent Runtime was connected.
- Reports contain no credentials, Authorization headers, or internal Home Assistant Entity IDs.
