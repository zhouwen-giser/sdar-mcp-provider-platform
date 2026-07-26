# Migration ownership and source mapping

`migrations/migration-source-map.json` is the machine-readable provenance lock
for all 26 SQL files imported from the offline delivery. Every entry records
the immutable delivered path and SHA-256, the current hash-verifiable path, the
owner-specific planned path, and a unique deterministic sequence.

## Authority boundaries

| Migration set       | Owner                     | Delivered files | Authoritative directory after split |
| ------------------- | ------------------------- | --------------: | ----------------------------------- |
| `runtime`           | Runtime Task Authority    |              24 | `migrations/runtime/`               |
| `provider:ugv`      | UGV Provider Adapter      |               1 | `migrations/providers/ugv/`         |
| `provider:npc-tank` | NPC Tank Provider Adapter |               1 | `migrations/providers/npc-tank/`    |
| `pms`               | PMS Control Plane         |               0 | `migrations/pms/`                   |

Runtime owns delivered files 001 through 023, including both independent 014
files. UGV owns delivered 024 and NPC Tank owns delivered 025. PMS does not own
or apply any delivered Runtime or Provider SQL.

The source map starts in `pre_split` state. Before physical movement,
`newPath` equals the existing root path so the task-package verifier can hash
the real file. `plannedPath` is the only allowed destination. The Runtime and
Provider split tasks update `newPath` to `plannedPath` and change `pathState`
to `owner_directory` without changing `oldPath`, `legacyVersion`, or `sha256`.

## Ordering and the duplicate 014 prefix

`sequence` is the unique cross-delivery order from 1 through 26. It follows
lexicographic filename order, matching the delivered migrator. The
`legacyVersion` field preserves the numeric prefix and therefore contains two
014 values:

1. `014_observation_pagination.sql`
2. `014_start_confirmation_watchdog.sql`

They are separate immutable migrations. Neither is renumbered, and future
resolvers must reject an ambiguous numeric-version policy unless their
duplicate-version rule explicitly preserves the delivered full-filename order.

## New PMS Migration naming

PMS starts a separate version namespace under `migrations/pms/`:

```text
NNN_lower_snake_case_description.sql
```

- numbering starts at `001` and is unique within the PMS set;
- names use a three-digit prefix, one underscore, and lowercase snake case;
- new files are append-only and must not reuse a number;
- each applied file is protected by checksum and a PMS-specific version table;
- the PMS Runner scans only `migrations/pms/`;
- PMS SQL must not create, read, alter, or drop Runtime Task Authority or
  Provider Adapter business tables.

Runtime, UGV, NPC Tank, and PMS version numbers are scoped to their own
Migration sets. A matching number in two different sets does not imply shared
ownership or shared application history.
