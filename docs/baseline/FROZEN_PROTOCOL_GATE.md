# Runtime frozen protocol regression gate

- Task: `G1-P0-B04`
- Executed at: `2026-07-26T09:19:06Z`
- Node.js: `v22.23.1`
- pnpm: `11.13.1`

## Existing gate inventory

The delivered repository already exposes the required gates; no package script,
protocol asset, test, or assertion was changed.

| Script                   | Coverage                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `protocol:check:frozen`  | Verifies the exact frozen profile bytes and SHA-256 sidecar                                                               |
| `protocol:check`         | Verifies the frozen profile, pinned upstream MCP Schema, 11 generated schemas, 74-case catalog, and 38-file protocol lock |
| `test:protocol:frozen`   | Runs the database-independent protocol-conformance tests                                                                  |
| `test:frozen-74`         | Runs the complete catalog against protocol tests and PostgreSQL lifecycle integration                                     |
| `verify:frozen-protocol` | Composes `protocol:check` and protocol conformance                                                                        |

## Protocol lock result

Command:

```bash
pnpm protocol:check
```

Result: PASS.

```text
Frozen contract verified: d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845
Verified schema/draft/schema.json from 26897cc322f356487da89113451bd16b520b9288
Git blob: cc44564e33305dbc07e820cdd0a97648f3852019
SHA-256: 9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708
Validated 11 protocol schemas and 74 frozen conformance cases
Protocol lock verified for 38 files
```

## Frozen 74-case result

The repository-defined PostgreSQL 17 Compose service was started and reported
healthy. The test used its dedicated `sdar_runtime` database; the connection
URL is intentionally not persisted in this evidence file.

Command:

```bash
TEST_DATABASE_URL=<local-test-database> pnpm test:frozen-74
```

Result: PASS, 74/74.

```text
Frozen conformance: 74/74 passed; report reports/protocol-v1-migration/conformance-74.json
```

The generated report summary was independently parsed as:

```json
{ "total": 74, "passed": 74, "failed": 0 }
```

The generated report was byte-equivalent to the tracked baseline, so the gate
left no report or product-code diff.
