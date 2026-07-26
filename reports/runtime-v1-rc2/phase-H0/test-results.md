# Phase H0 Test Results

| Command                          | Result | Tests | Notes                                                                          |
| -------------------------------- | ------ | ----: | ------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | PASS   |   n/a | pnpm 11.13.1                                                                   |
| `pnpm lint`                      | PASS   |   n/a | rc.1 source                                                                    |
| `pnpm typecheck`                 | PASS   |   n/a | rc.1 source                                                                    |
| `pnpm test:unit`                 | PASS   |    24 | no skip                                                                        |
| `pnpm test:contract`             | FAIL   |   2/4 | generated files removed by failed grpc-tools; Windows `python3` alias unusable |
| `pnpm format:check`              | FAIL   |   n/a | Windows CRLF checkout, 173 paths                                               |
| `pnpm build`                     | FAIL   |   n/a | native grpc-tools process failed                                               |
| `pnpm verify`                    | FAIL   |   n/a | correctly stopped at format                                                    |

These are baseline facts, not H0 acceptance success. After adding H0 files, the normal
format/lint/typecheck/unit gate and the expected-red test output must be rerun before commit.
The six red tests must fail on rc.1 and are not skipped.

## H0 pre-commit rerun

| Command             | Result        | Tests | Notes                                                   |
| ------------------- | ------------- | ----: | ------------------------------------------------------- |
| `pnpm format:check` | PASS          |   n/a | portable CRLF handling; task package excluded unchanged |
| `pnpm lint`         | PASS          |   n/a | includes H0 guard source                                |
| `pnpm typecheck`    | PASS          |   n/a | includes H0 guard source                                |
| `pnpm test:unit`    | PASS          | 24/24 | no skip                                                 |
| `pnpm test:rc2:red` | EXPECTED FAIL |   0/6 | all six rc.1 defect guards failed as required           |

An expected-red result is not counted as a passing release test. Its complete six-failure result
is the H0 reproducer evidence; owning phases must turn it green and add the required real-layer
tests.

## First pushed CI

GitHub Actions push run `29507898216` passed `compose-smoke` but its `quality` job stopped at
`format:check`: this report had been appended after its earlier local formatting pass. No product
test ran or was hidden after that fail-fast gate. The report was reformatted and the complete
local format check rerun before the corrective push.
