# Verification Summary

- Status: **passed**
- Commit: `9cd615b4da06f91386067dec92d0116a5f77dd95` (dirty working tree)
- Started: 2026-10-24T17:40:17.481Z
- Finished: 2026-10-24T18:08:02.636Z
- Duration: 1665155 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 33329 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3436 ms |
| lint | `pnpm lint` | passed | 139341 ms |
| typecheck | `pnpm typecheck` | passed | 42297 ms |
| unit | `pnpm test:unit` | passed | 134672 ms |
| contract | `pnpm test:contract` | passed | 37360 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1318 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 730 ms |
| architecture | `pnpm verify:architecture` | passed | 1680 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 741 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 728 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 758 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 3503 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 880 ms |
| acceptance | `pnpm verify:acceptance` | passed | 727 ms |
| sources | `pnpm verify:sources` | passed | 725 ms |
| protocol | `pnpm verify:protocol` | passed | 941 ms |
| infra | `pnpm verify:infra` | passed | 874 ms |
| project-license | `pnpm verify:project-license` | passed | 731 ms |
| licenses | `pnpm verify:licenses` | passed | 821 ms |
| build | `pnpm build` | passed | 39985 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1096 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 32450 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 377970 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 287370 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 92930 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 287587 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 13790 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 54390 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 71950 ms |
