# Goal 2 Phase P2 — Database automatic provisioning gate report

- Phase: `P2 Database automatic provisioning`
- Status: `PASSED`
- Closing task: `G2-P2-B09`
- Git commit: this report commit
- Tasks passed: `G2-P2-B01` through `G2-P2-B09`
- External environment gaps: no P2 acceptance blocker; controlled local PostgreSQL supplied
  database-backed evidence. No managed-service, backup/restore, or production credential
  qualification is claimed.
- Next phase readiness: P2 dependants may become READY only through `taskctl`

## Scope delivered

P2 delivers the DatabaseProfile domain and append-only PMS persistence, a restricted PostgreSQL
Provisioner port and adapter, a file-backed SecretRef store, the fixed-set Runtime Migration
Runner, a checkpointed database-preparation application job and worker handler, real PostgreSQL
credential-isolation E2E, and the operations runbook.

The workflow separates provisioning, Runtime, and PMS credentials. External database, secret, and
migration calls occur outside PMS transactions. Failures preserve the database, emit stable
redacted error codes, and retain checkpoints for idempotent retry.

## Task ledger

| Task | Result | Commit | Primary evidence |
| --- | --- | --- | --- |
| `G2-P2-B01` | PASSED | `1a2f21d` | DatabaseProfile validation, SecretRefs and stable names |
| `G2-P2-B02` | PASSED | `215bab7` | append-only PMS migration and repository CAS |
| `G2-P2-B03` | PASSED | `848931f` | pure Provisioner port, plans, error taxonomy and delete policy |
| `G2-P2-B04` | PASSED | `91d8e59` | restricted real PostgreSQL adapter and idempotent replay |
| `G2-P2-B05` | PASSED | `462892a` | atomic 0600 file SecretRef store and explicit cleanup |
| `G2-P2-B06` | PASSED | `0981b9f` | fixed Runtime migration set, lock, timeout and failure evidence |
| `G2-P2-B07` | PASSED | `87f3726` | checkpointed application orchestration and worker handler |
| `G2-P2-B08` | PASSED | `e248d0b` | real PostgreSQL Provider/PMS isolation E2E and JSON evidence |
| `G2-P2-B09` | PASSED | this report commit | runbook and complete P2 regression gate |

## Gate results

| Command | Result | Evidence or limitation |
| --- | --- | --- |
| `pnpm test:db-provisioner` | PASS | 3 files, 21 tests; controlled local PostgreSQL used |
| `pnpm exec vitest run tests/database-provisioning-e2e` | PASS | semantic equivalent of the not-yet-defined `test:db-provisioner-e2e`; 1 file, 1 E2E |
| `pnpm build` | PASS | protocol generation and TypeScript production build |
| Database preparation application tests | PASS | 2 files, 5 tests for checkpoints, recovery, mapping and fencing |
| Isolation evidence | PASS | `reports/evidence/G2-P2-B08-database-isolation.json`; cleanup verified |

## Security and authority checks

- DatabaseProfile stores only structured host/port/mode/SSL data and distinct admin/Runtime
  SecretRefs; it stores no plaintext credential.
- Runtime roles are `NOSUPERUSER`, `NOCREATEDB`, and `NOCREATEROLE`.
- Runtime A cannot read Provider B Runtime tables; PMS cannot read or create in a Runtime database.
- Provisioning credentials are adapter-only and are never returned by production interfaces.
- Secret files are atomically published with file mode 0600 under mode-0700 directories; references
  are opaque and cleanup is policy-gated.
- Runtime Migration scans only `migrations/runtime`, serializes with an advisory lock, verifies
  immutable checksums, and never automatically drops or rebuilds a failed database.
- Evidence and audits contain stable result/error codes rather than connection strings, passwords,
  secret content, or filesystem secret paths.

## Qualification limits and residual risks

- Local PostgreSQL E2E proves database object/role isolation in the controlled test environment. It
  is not a production managed-database certification.
- PostgreSQL installations may grant database `CONNECT` via `PUBLIC`; P2 proves denial of Runtime
  table reads and schema creation. Operators may enforce stricter connection policy separately.
- Backup, restore, PITR, replication, managed secret rotation, and disaster-recovery drills remain
  infrastructure responsibilities and are not implemented by P2.
- The B08 package script name is absent from the root manifest, so the exact semantic Vitest target
  is recorded and executed instead of adding an out-of-scope empty alias.

## Exit conclusion

All nine P2 task cards and all three mandatory semantic gates pass. Database provisioning is
recoverable, checkpointed, redacted, least-privilege at the Runtime object boundary, and migration
safe. P2 is closed without modifying any delivered migration SQL or expanding PMS into Runtime
Task authority.
