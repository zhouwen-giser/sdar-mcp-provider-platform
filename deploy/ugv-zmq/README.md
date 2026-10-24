# ZMQ candidate deployment inputs

`deployment.candidate.json` is a phase 1 audit input, not an active Docker deployment. The operator confirmed that all three services remain at `192.168.2.63`; the bounded passive captures independently observed their publication endpoints and optical/effect identities. The chassis system ID `1` was decoded from CRC-valid publications. Port/identity/ownership and other deployment agreements still need confirmation, and recipient broadcast `0` does not identify a valid controller ID. See `reports/ugv-zmq-phase1/operator-confirmations.json` for the scope of the human reply. Historical raw receipts preserve their capture-time confirmation status.

The controller ID is optional by operator instruction (2026-10-24). Omission normalizes to null; the read-only SUB observer has no sender header. No wire sender value is invented by the contract layer.

Fill simulationId, Provider/resource/source-session binding and planner policy from the actual deployment agreement. Attach repository-relative, SHA-256-addressed evidence for deployment identity, time/coordinates, optical plane/limits, capability scope, server implementation, planner policy and authoritative provider golden frames. The preflight verifies referenced bytes and reports missing/invalid evidence; it cannot establish the truth of a self-authored attestation.

Evidence-backed scope must state which guarantees remain unavailable. Native feedback association, restart recovery and full inspection report recovery are open in the frozen protocol candidate. The profile cannot switch to a guessed protocol version or use wildcard/broadcast device configuration to hide these gaps.

`task-business.candidate.json` keeps the existing TaskBusiness storage contract and 1Hz sampled trajectory policy while disabling legacy Provider visual-lock/manual decisions, airport-derived footprint and navigation adjustment dependencies. It passes the existing startup policy without the old planner. This does not establish ZMQ runtime wiring or coverage qualification; do not point the running legacy adapter at this profile as a phase 1 deployment change.

See `contracts/ugv-zmq/v1/README.md` and `docs/execplans/ugv-zmq-migration-20261023.md` for commands, phase boundaries and remaining inputs.
