# Phase H0 Known Issues

- F-001 through F-019 remain open by design at H0; six core issues have red reproducers.
- Local grpc-tools native executables fail on this Windows host; generated artifacts were
  restored after the unmodified baseline attempt. Linux CI is required and the generator must be
  hardened before release.
- The Windows `python3` application alias is not a usable interpreter. Contract/conformance
  scripts need explicit interpreter discovery instead of assuming a Unix command name.
- PostgreSQL/Docker full gates were not reached because `verify` stopped at its first baseline
  format failure. They remain mandatory, not waived.
- Mock Adapter evidence cannot qualify real resource safety; final reporting must preserve this
  distinction.
