# Home Assistant Light Provider

`builtin.home-assistant.light` is a vendor-managed Provider Adapter. It owns the Home Assistant connection and the actual `light.*` side effect; PMS owns the Provider and Resource configuration, while MCP Tasks Runtime owns Task admission, persistence, notifications, and recovery.

## Operations

| Operation              | Execution       | Semantics                                                                                                                                         |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `light_get_state`      | `SYNCHRONOUS`   | Reads the configured allowlisted light and returns `power`, `reachable`, `brightnessPercent`, and `observedAt`. Unsupported brightness is `null`. |
| `light_set_power`      | `TASK_REQUIRED` | Calls only the fixed Home Assistant `light.turn_on` or `light.turn_off` service and completes only after observed state confirmation.             |
| `light_set_brightness` | `TASK_REQUIRED` | Calls the fixed `light.turn_on` service with a validated `brightness_pct` and completes only after the observed brightness matches.               |

The Adapter never accepts a Home Assistant domain, service, or entity identifier from a Task argument. Runtime arguments contain the public `resourceId`; the local resource file maps that identifier to exactly one `light.*` entity.

## Configuration

Use `LIGHT_RESOURCES_FILE` and `HOME_ASSISTANT_TOKEN_FILE`. A token is read from the file only; `HOME_ASSISTANT_TOKEN` is rejected. Real writes additionally require both `ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES` and a non-empty `REAL_DEVICE_TEST_RUN_ID`. Missing either gate fails closed after the read-only state path.

The Provider uses `vendor_managed` hosting. PMS may manage the Provider Package and Runtime Deployment, but the Adapter is started by the local controlled process or Compose deployment.

Task cancellation and pause/resume are not supported; a negative Adapter Ack never implies physical rollback.
