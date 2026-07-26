# Phase R8 Test Results

| Command                     | Result | Evidence                                                               |
| --------------------------- | ------ | ---------------------------------------------------------------------- |
| format/lint/typecheck/build | PASS   | strict TypeScript and generated Proto gates                            |
| Python syntax               | PASS   | `python3 -m py_compile examples/mock-adapter-python/adapter.py`        |
| TypeScript durable restart  | PASS   | local seed, process replacement, Reconcile FOUND using same state file |
| `pnpm test:conformance`     | PASS   | Actions `29499994468`; both P0-P4 JSON reports passed                  |
| Compose images              | PASS   | Actions `29499994468`; TS/Python builds and Runtime readiness passed   |

Local Python lacks pip and local Docker is unavailable. GitHub Actions supplied
the authoritative Python, PostgreSQL and Docker environment. The exact output is
stored in `reports/conformance/typescript.json` and `python.json`; each contains
10 passing cases across P0-P4 and no skipped case.
