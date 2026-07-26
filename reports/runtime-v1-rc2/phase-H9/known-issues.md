# H9 Known Issues and Residual Risk

- The merged PR #1 historical rollup blocker is detailed in
  `../blockers/2026-07-17-merged-pr1-check-rollup.md`.
- Current Adapter protocol evidence covers the two reference processes. Production resource
  safety, rollback and compensation behavior require separate qualification.
- Stateless MCP HTTP deliberately omits session resumption, GET/DELETE session lifecycle and
  server task notifications.
- The 350 MB image ceiling and capacity measurements are regression guards, not production SLOs.
- Local Windows grpc-tools returns `0xc0000135`; authoritative Linux Docker/CI passes build,
  proto-check and Buf.
