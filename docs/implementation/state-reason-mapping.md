# Task state and reason-code mapping

Adapter Snapshot state is mapped once at the Runtime boundary. A greater
revision may advance a nonterminal Task; equal, lower or post-terminal revisions
cannot change current state.

| Adapter state         | Internal state       | MCP status       | SDAR substate/outcome                |
| --------------------- | -------------------- | ---------------- | ------------------------------------ |
| `QUEUED`              | `QUEUED`             | `working`        | `queued`                             |
| `STARTING`            | `STARTING`           | `working`        | `starting`                           |
| `RUNNING`             | `RUNNING`            | `working`        | `running`                            |
| `PAUSED`              | `PAUSED`             | `working`        | `paused`                             |
| `RESUMING`            | `RESUMING`           | `working`        | `resuming`                           |
| `STOPPING`            | `STOPPING`           | `working`        | `stopping`                           |
| `WAITING_INPUT`       | `INPUT_REQUIRED`     | `input_required` | open stable input keys               |
| `SUCCEEDED`           | `TERMINAL_COMPLETED` | `completed`      | `success`                            |
| `BUSINESS_FAILED`     | `TERMINAL_COMPLETED` | `completed`      | `business_failure`, `isError=true`   |
| `PARTIALLY_COMPLETED` | `TERMINAL_COMPLETED` | `completed`      | `partial_completion`, `isError=true` |
| `TECHNICAL_FAILED`    | `TERMINAL_FAILED`    | `failed`         | retryability and technical reason    |
| `CANCELLED`           | `TERMINAL_CANCELLED` | `cancelled`      | safe-stop proof                      |

Runtime-generated terminal reasons include `START_WINDOW_MISSED`,
`MAX_ELAPSED_TIME_REACHED`/`DEADLINE_REACHED`, `EXECUTION_NOT_FOUND`, and
`ADMISSION_REJECTED`. Adapter reference reasons include `AVAILABLE`,
`RESOURCE_DISABLED`, `PREEMPTIBLE_TASK_ACTIVE`, `STARTED`, `SUCCESS`,
`INPUT_ACCEPTED`, `STOP_ACCEPTED`, `SAFE_STOP_CONFIRMED`,
`EXECUTION_FOUND`, `EXECUTION_NOT_FOUND`, and `ARGUMENT_HASH_CONFLICT`.
Transport uncertainty uses `ADAPTER_TRANSIENT_UNAVAILABLE`; it is never
translated into availability or success.

Reason codes are stable machine identifiers; descriptions are operator/client
text and may change. Clients must branch on MCP state, structured outcome and
reason code, not English messages. Business failure and partial completion are
completed executions with business result semantics, whereas infrastructure or
protocol failure is MCP `failed`.

Control rejection never aliases success. Retryable or transport rejection remains
`working/stopping` with a durable retry; a permanently rejected user cancellation reconciles and
restores the authoritative working state with `CANCEL_REJECTED`; an unconfirmed mandatory stop
ends as `failed` with `SAFE_STOP_UNCONFIRMED`. `START_WINDOW_MISSED` is completed only when no
execution exists or a later Snapshot proves compensation stopped it safely.
