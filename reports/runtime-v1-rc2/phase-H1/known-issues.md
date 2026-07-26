# H1 Known Issues

- Five expected-red structural guards remain and are owned by H2-H4. They are enumerated in
  `test-results.md`; H1 does not claim those requirements.
- Pause/resume/update have not yet moved to the generalized durable dispatcher.
- Full Adapter Snapshot/Ack identity validation remains H4 scope; H1 validates the returned
  command sequence and never treats an Ack as terminal proof.
- The complete migration-006-to-latest fixture test is H8 scope. Migration 007 has been applied
  by the existing real-PostgreSQL integration/recovery startup path but is not yet the release
  upgrade claim.
- Local Windows native proto generation remains unavailable. GitHub Actions Linux build, Buf,
  dual-language conformance and Compose results are required before H1 closes.
