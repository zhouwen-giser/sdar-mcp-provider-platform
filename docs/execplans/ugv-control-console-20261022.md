# UGV MCP control console — 2026-10-22

## Objective

Ship a standalone Chinese UGV operator console on LAN HTTPS port 19101, connected only through the frozen SMPP MCP endpoint. Coordinate forms and a scalable schematic, one operator account, shared PostgreSQL command/task journal, no dispatch on reconnect or restart.

## Source and constraints

Base c23f0ec includes the deployed f67fd0a navigation repair. Work in the already attached, clean managed worktree on codex/ugv-control-console-20261022. Preserve the primary checkout's uncommitted united deployment work. Use protocol 2026-07-28, TaskExecution 1.0, TaskBusiness 1.0-rc2. Runtime remains authority for physical execution, task ownership, availability and business result. Read-only field acceptance; operator initiates field controls.

## Implementation sequence

- [x] Shared coordinate parser, polygon validation, dedicated tool adapters and truthful task result presentation.
- [x] Fastify backend: login/session/origin guard, fixed upstream MCP, independent PostgreSQL migration and durable command journal, task import/actions and full business snapshot/artifact reads.
- [x] React operator UI: state overview, coordinate controls, scalable schematic, task history and task/business actions, SSE refresh and diagnostics/report export.
- [x] Isolated protocol, persistence, concurrency, recovery and browser verification, plus real Runtime/adapter/MQTT/PostgreSQL integration where available.
- [ ] Docker image, reproducible bundle, secret/certificate provisioning, LAN 19101 deployment and read-only acceptance.

## Decisions

One deployment-configured operator; HTTPS with deployment certificate or generated site certificate; 8-hour HttpOnly sessions. PostgreSQL schema ugv_control_console with separate migration. All writes require UUID commandId and durable intent before dispatch. Repeated UUID with changed content conflicts. Unknown dispatch outcomes never auto retry. Task index covers this console and imported IDs, not all Runtime tasks. Read availability before ordinary tool calls; stop has an independent path. Only supported dedicated UGV operations can dispatch. Unknown or disabled operations remain unavailable.

## Evidence

Record commands, exit codes, source/image hashes, bundle checksum and acceptance results here as work completes. Never store credentials in Git or acceptance outputs.

## Verification progress

- Console tests: 40 passed, including the shared-read cache regression. This includes five honest inspection outcomes and cancellation through a formal Runtime/gRPC adapter with owned PostgreSQL, MQTT and mock Device MCP, plus immutable large object reads, source isolation, observation replies and intervention guards.
- Browser suite: 2 passed, covering operator login, coordinate preview, lifecycle, reload, a second browser and mobile overflow. Desktop/mobile screenshots inspected.
- Existing real provider lifecycle suite: 7 passed (including pause/resume/cancel, recovery and timeout). Network subnet regressions: 4 passed. Root typecheck, build and frozen protocol validation passed; frozen lock remains d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845.
- Validation deployment created the dedicated database role/schema, secret files and certificate. Shared station network is internal, so a dedicated public edge bridge is required. Docker initially allocated 192.168.0.0/20; this shadowed device 192.168.2.63. Removed that owned bridge, restored the route, and added explicit 10.252.244.0/24 plus subnet/route/protected-address checks. All three native ports were rechecked as reachable.
- Read-only field check at 2026-10-22T16:49:24Z: login 200, 13 published tools, all four state reads without errors, MQTT and Device MCP online, resource vehicle:ugv, imported old Task ed90ab34-2c7b-4508-8a33-5b7c54d59c51 still working/stopping. Live control command count is 0. Native chassis/health/payload source times remain about six seconds ahead of the platform; no freshness guard was relaxed.
- Scoped forwarding repair is limited to this console, Runtime 8080, PostgreSQL 5432 and published 19101. Restored the temporary shared-bridge route_localnet setting to its original 0; the console's own edge bridge carries loopback support.

Final source/image/bundle and field browser receipts will be recorded after release deployment. Credentials are outside Git under the operator-owned 0700 state directory.
