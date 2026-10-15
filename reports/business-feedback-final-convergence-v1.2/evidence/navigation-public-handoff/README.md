# Real navigation consumer samples

These records were exported from `../navigation-public-restart.json` without
re-running a device task. `manifest.json` records the original capture period,
source report hash, candidate source fingerprint and output file hashes.

| File                    | Meaning                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| stream-initial.ndjson   | Initial read-only probe window, including 15 applied business events          |
| stream-recovered.ndjson | Probe window after both processes restarted, including 39 applied events      |
| intervention-1.ndjson   | First public command, Runtime receipt, Provider application and exact objects |
| intervention-2.ndjson   | Second public command and the same lifecycle records                          |
| snapshots.ndjson        | Four recorded snapshots and the terminal snapshot, with exact object versions |
| task-result.ndjson      | Public terminal Task result and device completion evidence                    |

Preserve each file's recorded order. There is no inferred total order between
files. Stream records are the existing probe's reducer output, including public
and source cursors; they are not raw `notifications/io.sdar/businessEvents`
messages. Snapshot records contain the probe summary and hydrated objects, not
every field of the original Context wire envelope. Do not feed these projections
to a raw SSE parser or claim wire replay coverage from them.

Only the Runtime public cursor is a listen/reconnect cursor. Source cursors are
provenance. Object identity and revision must match exactly. A Runtime accepted
receipt still has `businessApplied=false`; later `businessAppliedConfirmed`
records identify the adopted route and effective plan revision.

The terminal summary's `properties.unresolvedRefs` archives unused business
entries, such as the third available adjustment. It is distinct from the probe's
top-level `unresolvedRefs`, which reports missing object hydration and is empty
in the final snapshot. Terminal `activeRefs` is empty.

Internal Execution, mutation journal, process environment, credentials and
connection strings are excluded. Public Task/object IDs, simulated coordinates,
timestamps and cursor provenance are retained for correlation. No RequiredInput
or recon workflow, external SDAR consumption, or remote deployment is claimed.
