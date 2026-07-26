# H3 Known Issues

- H4 must load immutable Operation Snapshots for historical Tasks and validate every Adapter
  Snapshot and command Ack identity; these are the two remaining expected-red guards.
- H8 must validate migration 009 using a real schema/data fixture stopped at migration 006.
- The outbox is durable and queryable but no MCP task-notification delivery capability is
  claimed in rc.2 unless the later full conformance matrix proves it.
- The externally merged PR #1 contains H0-H1 only. Draft PR #3 carries H2-H9 and must provide
  the final green PR-context evidence.
