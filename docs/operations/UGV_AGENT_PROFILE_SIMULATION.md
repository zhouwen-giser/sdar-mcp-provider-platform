# UGV Agent Profile simulation operations

The supported SMPP deployment entrypoint for the UGV Agent Profile Goal is
[`deploy/ugv-agent-profile-simulation/README.md`](../../deploy/ugv-agent-profile-simulation/README.md).
It describes the fixed external endpoints, isolated project and volumes, passive preflight,
lifecycle commands, safety limits, and cleanup boundary.

The contract authority for this profile remains:

- `reports/ugv-agent-profile-simulation/device-mcp-contract.redacted.json` with canonical hash
  `472e482c64d7f71f167cfb60461570068c7948108a46aa7614ea9bfccaea4c72`;
- `reports/ugv-agent-profile-simulation/mqtt-contract.redacted.json` with canonical hash
  `a374f360ae1b2008c7ca80c1aed78548c38140c311250da819d253f83e20fffa`.

This runbook does not authorize navigation and does not upgrade external-simulation evidence to
production or physical-vehicle qualification.

The read-only P1 qualification consumes Provider identity from Runtime `server/discover` and the
resource/operation contract from Runtime `tools/list`, then invokes only synchronous
`vehicle_get_state`. Registry Snapshot and Node Control consumption remain a separate `UAP-P2-B02`
handoff and are never inferred from Compose configuration or source code.
