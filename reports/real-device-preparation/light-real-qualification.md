# Light real qualification

- Evidence class: `real`
- Status: `partial`
- Provider: `ha-light-lab`
- Resources: `living-room-main-light`, `living-room-aux-light`

Both configured lights were read through the PMS Registry-backed Runtime, toggled once, restored within the two-write budget, and confirmed through terminal `tasks/get` plus a subsequent state read. Same-argument duplicate Task IDs reused the original Task; conflicting arguments were rejected with HTTP 400. The final state of both lights matched the saved original state, with zero active and zero uncertain tasks.

The overall qualification remains partial because the frozen Runtime does not implement `initialize`, and Adapter reconnect without an exact Runtime restart plus in-flight recovery are not qualified. Entity identifiers and credentials are excluded.
