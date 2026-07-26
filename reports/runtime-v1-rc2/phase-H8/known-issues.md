# H8 Known Issues and Residual Risk

- The reference Adapter suite qualifies protocol behavior, not the safety of any real external
  resource. Each production Adapter still requires resource-specific side-effect and safe-stop
  qualification.
- The conformance report calls Runtime Profile coverage partial because repository integration,
  recovery, security and wire tests provide the remaining evidence; the 17 Adapter cases alone
  are not a complete standalone P0-P4 Runtime certification.
- Migration checksum normalization accepts both the canonical LF digest and the legacy raw
  checkout digest for an already-applied migration. It does not accept any other content change.
- Local Windows cannot load the bundled grpc-tools binary. Authoritative Linux Docker and remote
  workflows provide protobuf build/check evidence.
- H9 still owns the aggregate rc.2 command, expanded capacity report, final documentation, PR #1
  scope update, final delivery report and immutable rc.2 tag.
