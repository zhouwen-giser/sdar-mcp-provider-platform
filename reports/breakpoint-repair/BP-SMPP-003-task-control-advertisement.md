# BP-SMPP-003 Task-Control Capability Advertisement

Status: `ALREADY_FIXED_ON_MAIN`

## Contract audit

The locked main consistently describes Home Assistant Climate and Light task-control behavior.

| Surface                                      | Cancel                       | Pause / resume               | Observed contract                                                                                          |
| -------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Climate `DescribeProvider` manifest          | `false`                      | `false`                      | Write operations remain task-required but do not advertise task control.                                   |
| Light `DescribeProvider` manifest            | `false`                      | `false`                      | Same as Climate.                                                                                           |
| Adapter `RequestCancel`                      | negative Ack                 | not applicable               | No Home Assistant call and no claim of physical rollback.                                                  |
| Adapter `PauseExecution` / `ResumeExecution` | not applicable               | negative Ack                 | No Home Assistant call and no execution-state mutation.                                                    |
| Catalog `TaskExecutionProfile`               | no independent support claim | no independent support claim | The frozen projection does not manufacture unsupported controls.                                           |
| Provider documentation                       | unsupported                  | unsupported                  | Climate already documented the limitation; Light receives an explicit clarification in this repair branch. |

The resulting invariant is:

```text
advertised capability == implemented capability
```

## Cancel semantics

These Home Assistant providers do not offer cancellation, including before dispatch. This is a
conservative and internally consistent contract. After physical dispatch, a negative Ack does not
mean the device was rolled back, and the Adapter does not issue a reverse physical operation.

If future product work adds safe pre-dispatch cancellation, the manifest, Catalog projection,
Adapter implementation, tests, and documentation must change in the same versioned delivery. That
extension is outside this breakpoint repair.

## Contract regression test

`tests/contract/home-assistant-task-control-advertisement.test.ts` starts the actual Climate and
Light Adapter services over local gRPC with in-memory stores. For both providers it verifies:

- the manifest advertises `cancel=false` and `pauseResume=false`;
- cancel, pause, and resume return stable negative acknowledgements;
- replay does not change the acknowledgement semantics;
- `callServiceCount` remains zero;
- no physical rollback is implied.

The contract test passed on exact candidate
`23eb2ed1c14830a8a6b328d3a67df1badcd492ab`, including the real in-memory gRPC negative-Ack and
zero-Home-Assistant-call assertions. The candidate also passed `verify:platform` and `verify:v2`.

## Compatibility

No Adapter protocol, frozen Catalog DTO, Registry projection, or checksum change is required. The
working-tree documentation/test additions preserve the behavior already present on main.
