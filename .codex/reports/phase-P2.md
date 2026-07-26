# Goal 1 Phase P2 — Provider Package report

## Outcome

P2 establishes a versioned, strict ProviderPackage v1 model and a controlled
offline Registry for the three delivered Providers. UGV, NPC Tank, and Home
Assistant Climate descriptions bind source entry, stable configuration
definition ID, owned Migration set, compatible Runtime, and auditable
qualification evidence without treating package metadata as an Operation
Catalog.

## Task ledger

| Task        | Result | Commit             | Primary evidence                                        |
| ----------- | ------ | ------------------ | ------------------------------------------------------- |
| `G1-P2-B01` | PASSED | `abe4e3a`          | strict Zod model and `schemas/provider-package-v1.json` |
| `G1-P2-B02` | PASSED | `56186f1`          | UGV package, real-resource status pending               |
| `G1-P2-B03` | PASSED | `5fa5016`          | NPC Tank package and conditional-capability evidence    |
| `G1-P2-B04` | PASSED | `486bab9`          | non-vehicle Climate package with null Migration set     |
| `G1-P2-B05` | PASSED | `19b15e3`          | deterministic controlled-root Loader and Registry       |
| `G1-P2-B06` | PASSED | `a32de52`          | mock exclusion and qualification projection             |
| `G1-P2-B07` | PASSED | this report commit | offline self-check CLI and phase gate                   |

## Built-in package inventory

| Package                                | Provider type            | Hosting modes    | Migration           | Component | Real resource |
| -------------------------------------- | ------------------------ | ---------------- | ------------------- | --------- | ------------- |
| `builtin.isr.vehicle.ugv@1.0.0`        | `isr.vehicle.ugv`        | vendor, platform | `provider:ugv`      | passed    | pending       |
| `builtin.isr.vehicle.npc-tank@0.1.0`   | `isr.vehicle.npc_tank`   | vendor, platform | `provider:npc-tank` | passed    | pending       |
| `builtin.home-assistant.climate@0.1.0` | `home_assistant.climate` | vendor           | null                | passed    | pending       |

`vendor_managed` remains the production default. Platform management is only
declared for the two built-in vehicle reference implementations and still
requires an explicit deployment choice. Home Assistant Climate does not invent
or borrow a database Migration.

## Schema and Registry boundaries

- The repository JSON Schema is semantically identical to the task-package
  Draft 2020-12 ProviderPackage Schema.
- Zod and JSON Schema reject missing required fields, unknown or duplicate
  hosting modes, and additional fields at every object boundary.
- The Loader reads only direct package directories under the controlled
  `provider-packages/` root and rejects symlinked roots, entries, or
  descriptors.
- Invalid JSON, invalid Schema, duplicate package ID/version pairs, and
  ambiguous unversioned lookups fail with explicit error codes.
- List order is deterministic by package ID then package version.
- Registry APIs support list, exact get, provider-type query, standalone
  validation, and qualification projection.

Mock Device MCP applications, MQTT publishers, and Fake Home Assistant remain
fixtures. A package directory, ID, provider type, or Adapter entry identified
as mock is rejected from the production Registry.

## Qualification boundary

The projection exposes exact `componentStatus`, `realResourceStatus`, and
evidence references. It contains no `Certified`, `systemStatus`, combined
badge, production approval, or interoperation claim. All three built-ins retain
`realResourceStatus=pending`; component evidence from mocks or fakes does not
upgrade that status. The display and governance rules are documented in
`docs/providers/qualification.md`.

Operation Catalog authority remains the running Runtime's `server/discover`
plus `tools/list`. Package descriptions are only versioned onboarding and
configuration previews.

## Gate results

| Gate                      | Result | Evidence                                                            |
| ------------------------- | ------ | ------------------------------------------------------------------- |
| Registry/model suite      | PASS   | 2 files, 13 tests                                                   |
| Built-in self-check       | PASS   | JSON status PASS, 3 packages                                        |
| Adapter entries           | PASS   | three controlled regular source files                               |
| Configuration contracts   | PASS   | three current config sources resolved                               |
| Provider Migration sets   | PASS   | UGV 1 file, NPC 1 file, Climate null                                |
| Qualification evidence    | PASS   | 11 controlled evidence references                                   |
| Damaged fixtures          | PASS   | invalid JSON/Schema, duplicate, symlink, and mock fixtures rejected |
| CLI failure behavior      | PASS   | unavailable workspace emits JSON FAIL and exit code 1               |
| `pnpm build`              | PASS   | protocol generation and production TypeScript build                 |
| Formatting/Lint/typecheck | PASS   | selected files and full TypeScript project                          |

The first combined command used the `tsx` CLI, whose optional IPC server was
denied by the filesystem/network sandbox after all 13 Registry tests had
passed. The entry was changed to Node's `--import tsx` loader, which requires no
IPC socket. After the production build, the initial directory test selector
also matched compiled copies under `dist/`; it was narrowed to the two explicit
source test files. The exact `pnpm test:provider-packages` command then passed
before and after build without relaxing any assertion or validation.

## Exit conclusion

All P2 cards are PASSED with atomic commits, truthful built-in descriptions,
strict validation, deterministic loading, mock isolation, and a CI/PMS-suitable
offline JSON self-check. P3 may now extract shared configuration contracts
without changing the package identities or overstating qualification.
