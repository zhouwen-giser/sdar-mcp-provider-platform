# Runtime database lock order

Task-scoped transactions that touch multiple state tables acquire row locks in this order:

```text
provider_task
task_command
task_input_request
task_input_response_inbox
task_observation
outbox_event
provider_ops_delivery
```

Batch claim transactions that lock one table may remain independent, but must not subsequently
acquire a lock from an earlier tier. Input-response promotion first selects candidate Task IDs
without row locks, sorts UUIDs, and then handles each Task in its own transaction beginning with
`provider_task`. Safe-stop state is checked while that Task lock is held.
