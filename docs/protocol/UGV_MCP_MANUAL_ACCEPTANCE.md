# UGV public MCP manual acceptance

Run against the **Runtime `/mcp` endpoint** and an existing Task. The harness
discovers `tools/list` first (including pagination), records current schema
digests, and reuses the public Context/Snapshot/Artifact/SSE reader and its
object hydration and cursor handling. It does not invoke Device MCP tools.

```sh
pnpm task-business:manual-acceptance --manifest /absolute/path/acceptance.json \
  > acceptance.ndjson
```

Use `SMPP_TASK_BUSINESS_PROBE_TOKEN` for the Runtime bearer token. Keep it out of
the manifest. For a simulation Task, provide `sceneInstanceId` in the outer
manifest (or the nested write manifest); every read/write sends the matching
Runtime execution-mode and simulation headers. Conflicting scene values fail
before discovery. Optional scene/correlation fields in public object identity
are checked when present, while the five required identity fields and selected
object/Context binding must match. The default mode is read-only; default event duration is 10 seconds.
`snapshotOnly: true` skips SSE. Every run asserts a final fresh snapshot, using
the latest version of each object, so a superseded lock cannot satisfy a current
active-lock expectation. A failed assertion exits nonzero.

Example manifest (replace the URL and Task ID with actual public discovery values):

```json
{
  "schema": "sdar.ugv-manual-acceptance/v1",
  "mcpUrl": "http://127.0.0.1:19120/mcp",
  "taskId": "REPLACE_WITH_TASK_ID",
  "expectedTools": ["vehicle_area_recon"],
  "durationMs": 10000,
  "expectations": [
    {
      "kind": "action",
      "type": "sensor.visual_lock",
      "active": true,
      "match": { "state": "active", "triggerOrigin": "provider_policy" }
    },
    {
      "kind": "input_request",
      "type": "target.disposition_decision",
      "match": { "state": "pending", "requiredResponder": "user" }
    }
  ]
}
```

Expectation kinds are `artifact`, `action`, `input_request`, `intervention`.
`type` compares the corresponding public type field. Optional `id`, `revision`
and `active` constrain the match. `match` is a recursive subset of the public
object (arrays compare exactly). For a route, assert
`{"properties":{"adoption":"adopted"}}`; for an intervention, assert
`{"state":"available","blocking":false}`. Expectations apply together to the
final snapshot, not to different moments accumulated over the event window.
Exact historical Artifact reads remain available through `task-business:probe`.

## Explicit writes

To answer **one existing RequiredInput** or submit **one existing navigation
adjustment**, add `write` to the manifest:

```json
{
  "kind": "input",
  "manifest": { "schema": "sdar.ugv-manual-input-probe/v1" }
}
```

The nested manifest above is illustrative, not executable. Supply every binding
field specified in [the input probe contract](UGV_TASK_BUSINESS_MANUAL_INPUT_PROBE.md).
Use `kind: "intervention"` and the full
[intervention probe manifest](UGV_TASK_BUSINESS_INTERVENTION_PROBE.md) for replan.
Both must name the exact same Runtime URL and Task as the outer manifest.

Set `SMPP_UGV_MANUAL_ACCEPTANCE_ALLOW_WRITES=true` explicitly and provide the bearer
token. Otherwise any write manifest fails before a network request. Existing
trusted-responder, deadline, scene, lock, target, plan-revision and command-ID
guards remain in effect. Input cancellation is an input response; task cleanup
only occurs if the nested manifest explicitly sets `cleanupTaskAfter: true`.
The harness has no arbitrary tool-call mode and no weapon action.

Output keeps Runtime receipts distinct from Provider business application. A
successful assertion has `qualificationComplete: false`: public observations
must still be matched with independent real device facts, route provenance,
the selected GOWM installation, and the same candidate's four workflow reports.
No fixture, green self-test, idle SSE window or generated scene label proves a
real workflow by itself.

Self-test: `pnpm test:task-business:ugv-local` includes the harness regressions.
