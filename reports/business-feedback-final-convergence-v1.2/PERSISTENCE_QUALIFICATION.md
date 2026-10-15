# BFF-018 selected GOWM qualification

Selected `gowm_shared` Store: **9/9 strict integration cases PASS** on a complete
disposable SMPP installation using PostgreSQL 18.6. A full Runtime/Provider process restart and real public navigation/two edits also
passed on a separate complete disposable installation. V-OBS/V-INPUT and remote
sz-gowm/external SDAR qualification remain pending.

`scripts/task-business/provision-gowm-test.mjs` invokes the original GOWM core
001–079 migration chain and its SMPP installer read-only from the owner checkout,
then installs SMPP's packaged Runtime 027 and Provider 030 overlays. It requires an empty loopback
test database and an explicit provisioning flag. It creates two test device
bindings through the owner's resolver and a non-superuser, non-BYPASSRLS app role.
No GOWM or simulator repository file, production schema or deployed binding changed.

The strict consumer opens fixed `ugv_smpp` storage, verifies base and business
checksums, then verifies app restrictions, device isolation, exact immutable
versions/CAS, command replay/conflict, atomic object/Context/command/source-event
commit and rollback after a real late SQL error, and fresh-pool recovery. This is
selected Store evidence, not a full Runtime process restart or all-domain GOWM
qualification. The installation includes SMPP domains; the SDAR domain is outside
this disposable fixture.

One test query originally sorted source sequences lexicographically after casting
to text. Ordering by the qualified numeric column fixed the test (no assertion was
relaxed); all eight cases then passed. Evidence: `evidence/gowm-complete-owner-8-tests.log`
and `evidence/gowm-complete-owner-install.json`.

The prior remote read at 2026-09-29T03:39:33Z found all four business tables absent
on sz-gowm. That deployed installation has not been modified in this continuation.
The packaged installer still requires explicit owner credentials/deployment and
records the SQL checksum. Runtime startup remains verify-only with no native or
Memory fallback. The old upstream all-domain verifier does not include overlay 030;
its complete audit is not claimed here.

Run the strict suite with a private fixture:

```sh
SMPP_GOWM_SHARED_OPEN_TEST_CONFIG_FILE=/private/gowm-test.json \
  pnpm test:task-business:ugv-gowm
```

Missing configuration fails before execution. Fresh-pool recovery remains distinct from the separately captured full process
restart/public Runtime run in `evidence/navigation-public-restart.json`.

The final strict suite includes Runtime 027 checksum/constraint qualification and
rejection of a tampered expected checksum (`evidence/navigation-final-gowm.log`).
Seven explicit deployment tests also passed, including both migration families,
transaction rollback, two-device command uniqueness, required payload constraints,
retry/privileges and checksum drift (`evidence/navigation-deployment-sql.log`).
