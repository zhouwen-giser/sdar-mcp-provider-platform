# Actual Recon / Input public evidence handoff

Local production Provider/Runtime and the real software simulator passed both
continue_observation and decline on 2026-09-30. Each run includes public
input_required, trusted-user response, working state, independently observed
device effect, and successful final cancellation. Fire stayed disabled.

The five NDJSON files export actual captured parsed records from the sanitized
source in manifest.json. Stream files contain full Context snapshots, immutable
objects and selected original JSON-RPC notifications. Standalone snapshots cover
before/after decisions and terminal state. Input records distinguish acceptance
from application; device observations independently show the effect. No Provider
Execution rows, credentials, authorization headers or snapshot tokens are exported.

Replay: `node --import tsx scripts/task-business/replay-public-recon.mjs reports/business-feedback-final-convergence-v1.2/evidence/recon-public-attempt-17.json`

54 complete Contexts and 76 selected notifications pass normalizer/reducer replay;
76 duplicate applications are no-ops. The manifest pins all NDJSON bytes. This is
selected parsed public evidence, not an entire raw HTTP/SSE byte stream or an
external SDAR run. Historical navigation evidence remains a separate candidate.
