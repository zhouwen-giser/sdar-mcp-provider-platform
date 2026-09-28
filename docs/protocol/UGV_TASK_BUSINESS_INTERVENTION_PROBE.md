# UGV navigation intervention probe

`--mode intervention` submits one explicit `navigation.adjust_plan` command for an existing `vehicle_navigate` Task through the public MCP endpoint. The default probe remains read only. This mode requires an available Intervention in the public snapshot, a working Task, an authenticated bearer token, and an operator supplied manifest for one isolated simulation. The selected UGV production Profile still has no accepting Intervention handler; this probe does not enable that capability.

```json
{
  "schema": "sdar.ugv-intervention-probe/v1",
  "mcpUrl": "http://127.0.0.1:PORT/mcp",
  "authorizationRef": "isolated-run-authorization-record",
  "sceneInstanceId": "SIMULATION_ID",
  "taskId": "TASK_ID",
  "executionId": "EXECUTION_ID",
  "providerId": "PROVIDER_ID",
  "resourceId": "RESOURCE_ID",
  "interventionId": "INTERVENTION_ID",
  "interventionRevision": 1,
  "effectivePlanRevision": 2,
  "commandId": "UNIQUE_COMMAND_ID",
  "input": { "viaPoints": [[106.81305335, 29.71930612]] },
  "submitBefore": "2026-09-29T00:00:00Z",
  "cleanupTaskAfter": false,
  "maxPolls": 10,
  "pollIntervalMs": 1000
}
```

The coordinates above only illustrate the JSON shape. Copy `input` from the qualified entry's published schema and authorized run; the probe validates it against that schema. Copy every identity and revision from the current public snapshot. `sceneInstanceId` must equal its `simulationId`. `submitBefore` is the latest time this probe may send the command, and is checked again after preflight. An authorization reference records the existing authorization; it does not grant access. Keep credentials in `SMPP_TASK_BUSINESS_PROBE_TOKEN`.

```sh
COREPACK_HOME=/tmp/smpp-corepack corepack pnpm task-business:probe --mode intervention --intervention-manifest /path/to/isolated-intervention.json
```

The probe reuses the complete snapshot reader, including page and descriptor hydration. It checks Task, Execution, Provider, resource, scene, operation, active entry revision and effective plan revision before calling `io.sdar/taskBusiness/interventions/apply` once. It sends the existing flattened command and semantic guard. Runtime derives the caller from authentication; the client supplies no responder identity.

The NDJSON output distinguishes these observations:

| Output                     | Meaning                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight`                | The named Task and entry matched the manifest before submission.                                                                                               |
| `runtimeAccepted`          | The matching receipt says `durablyAccepted: true`, `businessApplied: false`.                                                                                   |
| `providerState`            | A later public Intervention version belongs to the same command.                                                                                               |
| `businessAppliedConfirmed` | Provider reports `applied`; all exact result references are hydrated, the current route is an adopted result, and the effective plan revision advanced by one. |
| `cleanupRequested`         | Runtime acknowledged cancellation of this manifest's Task; physical stop remains unconfirmed.                                                                  |

`businessAppliedConfirmed` always carries `qualification: runtime_wire_only` and `deviceEffectConfirmed: false`. A device timeline, selected storage run and external SDAR consumer are still required for business acceptance. A candidate route, stale plan, foreign command, missing result, failed/withdrawn entry or polling timeout exits nonzero. The probe also rejects a receipt claiming immediate business application.

The probe never retries the write automatically. A lost response is uncertain and exits nonzero; inspect the same command ID before deciding whether to retry. `cleanupTaskAfter: true` requests cancellation only for the named Task after a write attempt, including an uncertain response. It never cleans up after a failed preflight. A second adjustment requires a new available entry and a new manifest using its current revisions and a new command ID.

`tests/contract/ugv-intervention-probe.test.ts` uses an explicitly synthetic public HTTP fixture and the production public command parser. It checks receipt/application separation, result hydration, source identity fences and cleanup. It is not an executed UGV adjustment, V-EDIT, selected GOWM or SDAR integration result.
