# Complete public navigation payload capture and replay

Status: **PASS for local production Runtime and actual software simulator**.
Task `c572b7d9-468c-45d7-a657-ae21b8a34201` used missions 47568 → 47569 → 47570
and effective plan revisions 1 → 2 → 3. Both Runtime and Provider processes
restarted between adjustments; their mutation journal remained unchanged.
The final public Task completed at 1.831354 m from the requested destination,
with speed zero and stationarity confirmed. Fire stayed disabled.

The optional `capturePublicPayloads` probe setting now records the full validated
Context and each selected applied event's original parsed JSON-RPC notification.
Default probe output is unchanged. Authentication headers and snapshot tokens
are excluded. Chunked Context values must pass their digest and schema checks
before capture, and unrelated Tasks/sources are not exported.

The live run produced 19 complete Context snapshots and 38 original selected
notifications: 7 initial and 31 after restart. Offline replay through the public
normalizer and reducer reproduces recorded phase, summary, active references,
unresolved references and both cursor domains. Replaying each event again is a
no-op. Negative copies with a missing Context, missing original notification or
foreign Task are rejected; the older projection-only report is also rejected
instead of being reconstructed into a supposed raw capture.

Restore the immutable raw capture from the [archive index](EVIDENCE_ARCHIVE_INDEX.md),
then run the read-only verifier from the repository root:

```sh
git fetch origin archive/ugv-pr35-raw-evidence-20261008
git show 9f6714d1fc06a65fb7438d66df435da51226455a:reports/business-feedback-final-convergence-v1.2/evidence/navigation-public-payloads.json > /tmp/pr35-navigation-public-payloads.json
git hash-object /tmp/pr35-navigation-public-payloads.json
# Expected: 9f4137b4761d57b4acc49d912586dea78dee5738
node --import tsx scripts/task-business/replay-public-navigation.mjs \
  /tmp/pr35-navigation-public-payloads.json
```

The [eight-file handoff](evidence/navigation-public-payload-handoff/README.md)
contains 382 NDJSON records with pinned hashes. The earlier 47564–47566 capture
and its six-file projection export remain separate historical evidence. No
records from different runs or source sessions were merged.

Validation: 285 UGV local tests passed, including opt-in/default output,
authorization/token exclusion, Task filtering and chunked Context checks.
Workspace typecheck and changed-file ESLint passed. The initial sandbox test
attempt could not bind loopback ports (EPERM); the same tests passed with local
test execution permission. The negative verifier's foreign-Task case uses the
actual `BUSINESS_EVENT_TASK_BINDING_INVALID` rejection reason.

This is parsed public-payload replay, not byte-for-byte HTTP/SSE replay or an
external SDAR run. The current recon identity blocker still prevents V-OBS and
V-INPUT. No remote deployment or whole-Goal completion is claimed.
