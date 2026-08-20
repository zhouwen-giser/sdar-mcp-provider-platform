# Known limitations

- Classification is `UGV_PROVIDER_TEMPLATE_READY_LIVE_VALIDATION_PENDING`. The exact point-navigation mutation was not authorized in this run; the controlled runner stopped before databases, network I/O, or dispatch and recorded zero mutating calls.
- The external read-only preflight connected to the configured real Device MCP and MQTT services, but the upstream contract still omits optional `ugv_laser_range` and publishes `/ugv/speed` at QoS 0 instead of the expected QoS 1.
- The development mock profile proves local startup and read-only Runtime-to-Adapter behavior. It is not evidence of physical motion, terminal position, or stationary confirmation on a real UGV.
- Real control remains disabled unless an operator explicitly supplies all LIVE authorization variables. An uncertain mutating response must be reconciled and must never be replayed automatically.
- This goal intentionally does not add mTLS or production security hardening. Endpoint validation, secret exclusion, log redaction, disabled fire controls, and no-replay safety remain in force.
- `VehicleStateV1` intentionally omits the internal `entityId` field from its public schema so Catalog publication cannot leak internal identifiers. Provider and resource identities remain available.
- The existing user-owned modification at `reports/ugv-simulation/READ_ONLY_SMOKE.json` is not part of this goal's commits or delivery artifacts.
