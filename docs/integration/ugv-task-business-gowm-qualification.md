# Selected GOWM business Store qualification

The selected mode is `gowm_shared`. The suite opens the existing Store through
`openGowmTaskBusinessStore`, which verifies the pinned base contract, business
manifest and current device/service bindings. It performs no migrations, owner
DDL, privilege changes or native fallback. An incomplete owner installation must
fail verification.

Provision a disposable database through the GOWM owner's migration chain with
the business handoff installed and its checksum manifest published. Supply the
non-superuser, non-BYPASSRLS application role and two distinct active device
bindings for the same service. The database name must include `test`; do not
point the suite at the deployed business database. Test rows use random run IDs
and are left in that disposable database for inspection. Dispose of it through
the owner workflow afterward.

Keep the fixture outside the repository with restricted file permissions. Its
strict JSON shape is:

```json
{
  "databaseUrl": "postgresql://APP_ROLE:REDACTED@HOST:5432/gowm_business_test",
  "contractDir": "/absolute/path/to/owner-published-contract",
  "serviceKey": "OWNER_SERVICE_KEY",
  "sourceSessionKey": "qualification-session",
  "dataScopeKey": "qualification-data-scope",
  "providerId": "isr.vehicle.ugv.qualification",
  "deviceIds": ["OWNER_DEVICE_A", "OWNER_DEVICE_B"],
  "bindingIds": ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  "resourceIds": ["vehicle:qualification-a", "vehicle:qualification-b"]
}
```

Replace the placeholders with the owner's actual test installation identities;
the example is not an installed fixture. Run:

```sh
SMPP_GOWM_SHARED_OPEN_TEST_CONFIG_FILE=/private/path/gowm-business-test.json \
  pnpm test:task-business:ugv-gowm
```

The package command requires a fixture and explicitly enables the integration
suite. Calling Vitest directly without the enable flag skips it and is not a
qualification result. Missing configuration causes the package command to fail
before test execution.

The suite covers app-role restrictions; Context, Artifact, command and source
event isolation; exact immutable Artifact revisions and stale Context rejection;
same-command replay and conflict; atomic object/Context/command/source commit;
and rehydration through a fresh strict Store opener and pool. A transaction test
injects a real PostgreSQL division-by-zero error on the second source append,
after earlier writes have executed. It verifies rollback and successful retry
without requiring trigger or owner privileges. This is intentional test fault
injection, not a claim about a naturally occurring device failure. Fresh-pool
rehydration validates Store recovery, not a full Runtime process restart or
completion of the four live workflows.

Current evidence and installation gaps are recorded in
`reports/business-feedback-final-convergence-v1.2/PERSISTENCE_QUALIFICATION.md`.
The isolated owner-template and native PostgreSQL suites remain component
evidence; neither qualifies the selected complete GOWM Store.
