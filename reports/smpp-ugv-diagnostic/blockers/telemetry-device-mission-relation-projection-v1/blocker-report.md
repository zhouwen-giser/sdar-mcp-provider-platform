# External Blocker

- Goal: `sdar-smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Blocker ID: `telemetry-device-mission-relation-projection-v1`
- Target repository/owner: `zhouwen-giser/smpp-telemetry-platform`
- Observed branch/commit: `main@a5e3dea00f825c4400523c8a957e539c901ee0c6`
- Phase: S13

## Missing capability

Canonical projection of the exact SMPP Task → ExternalExecution → DeviceMission relation carried by a legal ProviderOps 1.1.0 Mission-relation fact.

## Reproduction

Read-only commands:

```bash
git -C /home/zhouwen/web-download/smpp-telemetry-platform show a5e3dea00f825c4400523c8a957e539c901ee0c6:telemetry-processor/src/packages/normalization/smpp-provider-ops-v1.ts
git -C /home/zhouwen/web-download/smpp-telemetry-platform show a5e3dea00f825c4400523c8a957e539c901ee0c6:telemetry-schema/contracts/relation/entity-relation-fact-v1.schema.json
```

Actual result:

- `provider.execution.progress` / `execution.progress` is legal and accepted;
- `sourcePayload()` preserves the relation status, authoritative device Mission ID and source-record refs;
- Task and ExternalExecution entity refs are created;
- `#relations()` only handles origin SDAR correlation and never creates a `device_mission` entity or Mission relation;
- Core projection therefore writes no Mission row to `telemetry_core.entity_relation_fact`.

## Why SMPP cannot safely compensate

SMPP has already committed the exact source fact and cannot write canonical Telemetry tables or redefine Telemetry entity/relation semantics. Doing so would cross the repository authority boundary and create two relation authorities.

## Requested target implementation

Add a provider-independent normalizer rule for `attributes["sdar.fact.kind"] == "mission_relation"`:

- `exact`: create a `device_mission` entity from `sdar.device.mission_id` and canonical Task→Execution plus Execution→DeviceMission relations with authoritative confidence and source-record provenance;
- `unresolved`: retain the fact but create no exact device Mission relation;
- `conflict`: retain the conflicting fact and create no exact device Mission relation;
- never select a Mission by time proximity or newest record.

Existing relation types may be reused only if their semantics stay explicit and the full three-identity path remains queryable.

## Forbidden workaround

- no fake fact;
- no direct ClickHouse write;
- no time-proximity identity inference;
- no Benchmark-specific Provider API;
- no frozen contract weakening.

## Acceptance probe

At the approved Telemetry implementation commit, add a fixture with:

```json
{
  "recordType": "provider.execution.progress",
  "eventCategory": "execution.progress",
  "taskId": "task-1",
  "externalExecutionId": "execution-1",
  "attributes": {
    "sdar.fact.kind": "mission_relation",
    "sdar.mission.relation_status": "exact",
    "sdar.device.mission_id": "mission-1",
    "sdar.mission.source_record_refs": ["source-record-1"]
  }
}
```

Assert normalization/projection creates a `device_mission:mission-1` entity and queryable exact Task→Execution→DeviceMission relation rows. Repeat with `unresolved` and `conflict` and assert neither creates an exact device Mission relation.

## Pause checkpoint

- SMPP commit: `6fe65ac80173b1bec9246009a509570ea5ffd531`
- environment/fault lease state: clean; no active fault lease; diagnostic arming has no Runtime HTTP route
- next step after human resume: read-only compatibility rerun, S13 handoff assets, S14 repository gates and Draft PR
