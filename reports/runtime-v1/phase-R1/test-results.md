# Phase R1 Test Results

| Command                                           | Result        | Evidence                                                      |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| `pnpm install`                                    | PASS          | 6 workspace projects; lockfile created                        |
| `pnpm format:check`                               | PASS          | all scoped files formatted                                    |
| `pnpm lint`                                       | PASS          | ESLint strict typed rules                                     |
| `pnpm typecheck`                                  | PASS          | TypeScript 5.9 strict/no emit                                 |
| `pnpm build`                                      | PASS          | generated Proto plus compiled Runtime/Adapters                |
| `pnpm test:unit`                                  | PASS          | 2 files, 3 tests                                              |
| `pnpm test:contract`                              | PASS          | 1 file, 4 tests                                               |
| `pnpm test:integration`                           | PASS          | 1 file, real gRPC socket test                                 |
| `pnpm adapter:python:smoke`                       | PASS          | real Python grpc.aio server and Node gateway DescribeProvider |
| `python3 -m py_compile .../adapter.py`            | PASS          | included in contract suite                                    |
| `docker compose config -q`                        | PASS          | valid Compose model                                           |
| `docker compose build runtime adapter-typescript` | BLOCKED LOCAL | Docker socket permission; remote CI gate committed            |

No test was skipped. R2-R9 suite directories are assigned future scope and are not claimed as passing R1 evidence.
