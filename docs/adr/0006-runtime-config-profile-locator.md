# ADR 0006: Runtime Config Profile Locator

- Status: Accepted
- Date: 2026-07-28
- Goal: goal-02
- Task: G2-FIX-P0-B02

## Context

The `RuntimeDeployment` aggregate stores a `config_profile_id` text column that identifies
which published Configuration Revision the Runtime should apply. The Configuration Center
models configuration through `ConfigurationTarget`, a five-field business key:

| Field         | Source                          | Example              |
| ------------- | ------------------------------- | -------------------- |
| `environment` | `RuntimeEnvironmentId`          | `production`         |
| `targetType`  | `ConfigurationTargetType`       | `runtime_deployment` |
| `targetId`    | Deployment or instance identity | `ugv-alpha-01`       |
| `configGroup` | Logical config namespace        | `runtime`            |
| `dataId`      | Specific data document          | `process`            |

A naive approach would set `configProfileId = targetId`, but that is **not unique**:
the same `targetId` can appear under different Environments, ConfigGroups, or DataIds,
each with a different published revision. Hard-coding `configProfileId = targetId`
would cause cross-Environment mismatches and cross-ConfigGroup/DataId mismatches.

## Decision

Introduce a `RuntimeConfigProfileLocator` that deterministically encodes **all five**
`ConfigurationTarget` business keys into a single opaque, verifiable identifier string.

### Interface

```typescript
interface RuntimeConfigProfileLocator {
  readonly environment: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
}
```

### Wire format

```
rtcfg.v1.<b64url(environment)>.<b64url(targetType)>.<b64url(targetId)>.<b64url(configGroup)>.<b64url(dataId)>
```

- Prefix `rtcfg` scopes the identifier namespace.
- Version `v1` enables future format evolution.
- Each business key is base64url-encoded so that field-internal dots, colons, or other
  characters cannot break the dot-separated structure.
- The full string matches the platform identifier pattern `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`
  when the combined encoded length stays within 128 characters.

### Properties

| Property         | Guarantee                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique           | No two distinct `ConfigurationTarget` tuples produce the same locator.                                                                               |
| Deterministic    | The same tuple always yields the same string; no random or time-based component.                                                                     |
| Verifiable       | `parseRuntimeConfigProfileLocator` reverses `formatRuntimeConfigProfileLocator` exactly.                                                             |
| Environment-safe | The `environment` field is part of the encoded tuple; a different Environment yields a different locator, preventing cross-Environment mismatches.   |
| Group/Data-safe  | `configGroup` and `dataId` are part of the encoded tuple; different values yield different locators, preventing cross-ConfigGroup/DataId mismatches. |

### Target type restriction

Only `runtime_deployment` and `runtime_instance` target types are accepted. Other
target types (`environment`, `provider_type`, `provider`, `collector`) are rejected
at parse time because they are not Runtime-scoped configuration.

## Prerequisite integration

`PostgresRuntimeDeploymentPrerequisites.configProfileAvailable(configProfileId)`:

1. Parses `configProfileId` via `parseRuntimeConfigProfileLocator`.
2. If parsing fails, the config profile is **unavailable**.
3. Uses the parsed locator as a `ConfigurationTarget`.
4. Queries `ConfigurationRepository.getPublishedRevision(target)`.
5. Returns `true` only when a published revision exists.

This guarantees that the `configProfileId` stored on a `RuntimeDeployment` unambiguously
resolves to exactly one `ConfigurationTarget` and one published revision.

## Consequences

- `configProfileId` is not a free-form identifier; it is a structured locator.
- Clients must format the locator before creating a RuntimeDeployment.
- The 128-character identifier limit constrains the maximum length of individual
  business keys. For V0.1 deployment and instance identifiers this is sufficient;
  longer identifiers require a future ADR with a hashing strategy.
- No `targetId`-only shortcut is permitted.

## Non-goals

This ADR does not define how the Configuration Center publishes revisions, how the
Runtime applies them, or how config acks are recorded. Those concerns belong to
existing Configuration Center domain logic.
