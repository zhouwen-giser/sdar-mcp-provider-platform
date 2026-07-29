# ADR 0009: Bind PM2 through its pinned JavaScript API

## Status

Accepted for Goal 04.

## Context

The existing controlled PM2 test acquires and invokes a CLI with
`pnpm dlx pm2`. That path is useful as historical component evidence but is not
a production authority: it can acquire a different tool at execution time,
bypasses `Pm2ProcessManager`, and encourages command-oriented integration.

The Platform already has the bounded `Pm2JavascriptApi` port and keeps process
names, release paths, the fixed Runtime entry, fork-mode policy, restart
limits, and environment validation in `Pm2ProcessManager`.

## Decision

- Pin `pm2@7.0.3` as a production dependency of
  `@sdar/pm2-runtime-adapter`.
- Construct a PM2 custom JavaScript client with an explicit absolute
  `pm2_home`; do not mutate the ambient `PM2_HOME`.
- Expose only connect, disconnect, start, stop, restart, delete, describe, and
  list through the existing port.
- Normalize all installed-module failures to stable codes without preserving
  daemon paths, environment values, or command details.
- Disconnect after both failed connections and completed manager operations;
  repeated bridge disconnect is a no-op.

## Security consequences

The bridge provides no shell, exec, command string, arbitrary script, arbitrary
working directory, remote operation, daemon kill, dump, module installation,
startup integration, or unconstrained environment API. Production callers
still pass through `Pm2ProcessManager`, so only `sdar-runtime-*`, the fixed
release root, the fixed Runtime entry, fork mode, and one instance are
authorized.

## Testing consequences

Focused contract tests inject a module-shaped fixture to verify callback
adaptation, PM2 home isolation, connection and operation error redaction,
failure cleanup, and idempotent disconnect. The following Goal 04 task replaces
the historical CLI E2E with a real test through this production bridge and
manager.
