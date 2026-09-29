# BFF-020 SDAR handoff status

IN_PROGRESS; external consumption is EXTERNAL_PENDING. The complete real
navigation handoff is now in
[navigation-public-payload-handoff](evidence/navigation-public-payload-handoff/README.md):
eight hashed NDJSON files, 382 records, 19 full validated Context snapshots and
38 original parsed public notifications, with both Intervention lifecycles and
the terminal Task result.

The new run is Task `c572b7d9-468c-45d7-a657-ae21b8a34201`, missions
47568 → 47569 → 47570. Both processes restarted between adjustments without
adding mutations. Final distance is 1.831354 m, speed zero. Full public payloads
replay through the SMPP normalizer/reducer, reproducing the observed read model;
duplicate replays are no-ops. See [V-PUBLIC-PAYLOADS.md](V-PUBLIC-PAYLOADS.md) for
the command and limits. Incomplete captures and foreign Task notifications are
rejected rather than repaired or substituted.

The old 47564–47566 capture and six-file projection export remain separate and
cannot satisfy the complete-payload verifier. Their original candidate manifest
is preserved in `evidence/navigation-original-candidate.json`. No events or
Context fields from different runs were merged. The current CANDIDATE.json
includes the new capture/verifier tooling; production Runtime/Provider logic was
unchanged in this continuation.

These are selected parsed public messages, not a complete HTTP/SSE byte stream.
Authentication headers, signed snapshot tokens and internal process/Execution
records are excluded from the consumer export. Preserve public resume cursors,
source provenance, exact object versions and receipt/application distinctions.
The consumer contract is in `docs/integration/ugv-task-business-consumer-handoff.md`.

V-OBS and V-INPUT remain NOT_RUN because reset-safe recon source identity is
missing. Their real Input/Action evidence cannot be invented from these navigation
records. External SDAR has not run against this candidate. No external message
was sent and no remote deployment was performed. Both Goal completion flags
remain false.
