# C10 full regression

- Aggregate evidence class: `unverified`
- Status: `partial`
- Latest real read-only Home Assistant preflight is blocked by `ENTITY_UNAVAILABLE` for the auxiliary light; no write followed that observation.
- The formal PMS Worker now completes repeated runtime reconcile jobs for both Providers after the PM2 connection-lifecycle repair; both Deployments remain `ACTIVE`/ready.
- The Registry-backed real MCP read runner now qualifies the frozen surface with `server/discover`, `tools/list`, and `tools/call`; all three resources were queried, but the current auxiliary light remains unavailable.
- Live Registry `history`, `diff`, `watch`, checksum, ETag, and `If-None-Match` checks passed. A targeted Xiaomi config-entry reload and one local Home Assistant restart did not restore the auxiliary light; both SMPP Runtime readiness endpoints remained ready.
- Controlled platform fault-injection tests passed 4/4; real in-flight restart and REST-200-without-state-change scenarios remain unverified.
- Dependency intake: offline frozen-lockfile rebuild passed with pnpm `11.13.1`.
- Lint, typecheck, build, frozen protocol checks, generated self-check, unit, contract, security, protocol-conformance, focused HA suites, and focused PMS Home Assistant platform tests passed.
- `prettier --check .` is blocked only by two pre-existing files: `docs/protocol/mcp-runtime.md` and `reports/real-device-preparation/authority-map.md`.
- Full integration and E2E suites are partial because existing NPC Tank cases cannot write fixed `D:/tmp/npc-tank-*.json` paths under Windows EPERM.
- The Provider Package symlink security assertion remains blocked by Windows EPERM, including an elevated rerun; the dedicated Linux symlink gate passed earlier.
- `verify:v2` and `verify:platform` aggregate wrappers remain unverified after the pnpm dependency-status failure. Their relevant direct component gates are listed in `full-regression.json`.

No frozen MCP semantic, Adapter Proto field, Task Authority, or real-device safety gate was weakened.
