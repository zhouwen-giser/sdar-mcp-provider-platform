# SDAR MCP Provider Platform V0.1 final delivery

## Outcome

Goal 2 delivers Runtime governance and the V0.1 control-plane-to-provider
workflow. The terminal `pnpm verify:platform` gate passed on Node.js 22.23.1,
pnpm 11.13.1, local PostgreSQL, and real isolated PM2 7.0.3.

The delivery includes revision-safe RuntimeDeployment, Provider-scoped database
and role preparation, locked Runtime migration orchestration, governed PM2
lifecycle, live/ready reconciliation, Runtime identity registration,
Runtime-authoritative Operation Catalog, Registry snapshots, UGV/NPC
Tank/Home Assistant integrations, PMS Web, security/fault tests, and controlled
SDAR interoperability.

## Reproducible gate

```bash
TEST_DATABASE_URL=<local-postgres> pnpm verify:platform
python3 .codex/task-package/scripts/taskctl.py status
git status --short
```

The first command passed formatting, lint, typecheck, build, frozen protocol,
SBOM, migration isolation, configuration compatibility, PMS, Runtime
governance, real PM2, security, fault injection, and five system E2E files with
11 tests. Database credentials are redacted from this report.

## Core evidence

| Gate                 | Result                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| Frozen protocol      | PASS; exact profile, 11 schemas, 74 cases, 38 locked files                 |
| SBOM                 | PASS; CycloneDX with 273 production components                             |
| RuntimeDeployment    | PASS; 8 files, 54 tests                                                    |
| Database provisioner | PASS; 3 files, 21 tests                                                    |
| PM2 adapter          | PASS; 6 files, 37 tests                                                    |
| PMS API              | PASS; 10 files, 53 tests                                                   |
| PMS Web              | PASS; 2 files, 16 tests plus production build                              |
| Real PM2             | PASS; fork mode, restart recovery, live/ready, unrelated process isolation |
| Security/fault       | PASS; 4 plus 4 tests                                                       |
| Platform E2E         | PASS; 5 files, 11 tests                                                    |

## Invariants retained

- PMS owns control-plane data and cannot access Runtime Task Authority tables.
- Runtime does not depend on the PMS database and keeps a no-PMS cold-start
  path.
- Existing Runtime migrations remain unchanged and are selected through the
  established migration-set mapping.
- PM2 only receives the allowlisted Runtime entrypoint, cwd, environment, and
  stable platform process names.
- Secrets cross boundaries only as SecretRef or `*_FILE`.
- PM2 `online` is not Runtime `ACTIVE`; live and ready must also pass.
- Catalog authority is Runtime `server/discover` plus `tools/list`.
- Provider Adapter production mode defaults to `vendor_managed`.

## Qualification boundary

Controlled local SDAR interoperability passed. External SDAR infrastructure,
real UGV/NPC devices, ISR MQTT feeds, independent Home Assistant, and physical
climate resources were unavailable. Those qualifications remain pending; this
delivery does not claim external Interop Certified or real-resource
certification.

## Release artifacts

See `RELEASE_MANIFEST.json`, `TEST_EVIDENCE.json`, `COMPATIBILITY_MATRIX.md`,
`KNOWN_LIMITATIONS.md`, the operations/upgrade guides, and
`reports/sbom/runtime-v1.cdx.json`.
