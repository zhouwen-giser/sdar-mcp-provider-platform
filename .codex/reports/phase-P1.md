# Goal 1 Phase P1 — Migration isolation report

## Outcome

P1 separates the 26 delivered, byte-preserved SQL files into three explicit
authority sets: 24 Runtime migrations, one UGV Provider migration, and one NPC
Tank Provider migration. Runtime and both Provider entrypoints now resolve only
their owned set. Real PostgreSQL verification applies every set twice in three
temporary schemas and proves representative Runtime, UGV, and NPC Tank tables
do not cross authority boundaries.

## Task ledger

| Task | Result | Commit | Primary evidence |
| --- | --- | --- | --- |
| `G1-P1-B01` | PASSED | `c9f006a` | `migrations/migration-source-map.json`, `docs/database/migration-ownership.md` |
| `G1-P1-B02` | PASSED | `aee5b68` | 24 byte-identical files in `migrations/runtime/` |
| `G1-P1-B03` | PASSED | `cc94050` | Provider SQL in `migrations/providers/{ugv,npc-tank}/` |
| `G1-P1-B04` | PASSED | `3208b41` | explicit set resolver, 9/9 resolver tests |
| `G1-P1-B05` | PASSED | `f5baf02` | Runtime-only Runner and fresh-schema assertions |
| `G1-P1-B06` | PASSED | `ea4676e` | fixed-set Provider entrypoints, unit suite 123/123 |
| `G1-P1-B07` | PASSED | `bbbb5b2` | `reports/evidence/migration-isolation.json` |
| `G1-P1-B08` | PASSED | this report commit | `docs/database/MIGRATION_SET_UPGRADE.md` and phase gates |

## Authority and compatibility conclusions

- PMS remains the control plane and owns none of the delivered SQL.
- Runtime startup and `db:migrate` use only the `runtime` set while preserving
  advisory locking, full-filename versions, normalized checksums, and
  per-file transactions.
- UGV and NPC Tank migration entrypoints contain fixed set identifiers and
  cannot accept an unknown or cross-Provider set from an operator.
- The delivered duplicate `014` Runtime filenames retain their original
  lexicographic order through an explicit, exact compatibility allowlist.
- No delivered SQL content was edited. Physical relocation is recorded as Git
  renames and remains hash-verifiable from the source map.
- Legacy Runtime databases may retain valid 024/025 history rows and Provider
  tables. The new Runner neither reapplies nor deletes them.

The repository contains no production entrypoint that implicitly scans SQL
from the root `migrations/` directory. Runtime's optional directory argument is
retained solely for explicit forward-upgrade test fixtures and has no implicit
root default.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration ownership/source-map verification | PASS | 26/26 paths and SHA-256 values |
| Resolver unit tests | PASS | 9/9 |
| Runtime Runner package test | PASS | 1/1; exactly 24 Runtime files |
| Provider migration entrypoint tests | PASS | 2/2; no cross-set SQL |
| Full unit suite after Provider binding | PASS | 30 files, 123 tests |
| PostgreSQL Migration isolation | PASS | 1/1; three schemas, two applications per set |
| Evidence JSON validation | PASS | status `PASS`, Runtime count 24, credentials redacted |
| Temporary-schema cleanup | PASS | zero `migration_isolation_%` schemas remain |
| Root-scan audit | PASS | set directories only in `apps/**` and `packages/**` |

The final B08 execution also runs `pnpm test:migration-isolation` and
`pnpm build`; their results are recorded by `taskctl` in
`.codex/execution-log.md`.

## Upgrade and rollback readiness

`docs/database/MIGRATION_SET_UPGRADE.md` gives the ordered operator procedure:
backup and inventory, build, run each owner entrypoint, explicitly copy
Provider-prefixed legacy business data when needed, validate isolation, canary,
and restore traffic. Secrets are referenced only through approved SecretRef or
`*_FILE` injection and are excluded from evidence.

Rollback preserves append-only database history. Operators restore the matching
previous application artifact and routing; they do not edit delivered SQL,
delete version rows, or move Provider tables into a fresh Runtime authority
database.

## Exit conclusion

All P1 cards are PASSED with atomic commits and evidence. Migration ownership,
resolution, runtime binding, Provider binding, real-database isolation, and
upgrade guidance are complete. The next READY task may begin without expanding
P1 into PMS schema implementation or later deployment-management goals.
