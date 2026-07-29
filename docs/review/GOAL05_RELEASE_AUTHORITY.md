# Goal 05 Release Authority

The immutable product source is `945df66df2f2a21d7a2c59e732535fe78d02744f`. It must be an ancestor of
every workflow-head commit, and every intervening path must match the verifier's
release-only allowlist. The exact workflow head separately binds CI definitions
and the narrowly scoped gate harness used to qualify that product source.

The tag `platform-v0.1.0`, its main-branch commit, GitHub Actions run and OCI
digests are external publication facts. They remain null/pending in repository
metadata until the protected release workflow records them. This prevents a
commit from attempting to contain its own unknown identity.

Local gates are supporting diagnostics. Only linked successful GitHub Actions
jobs may change formal qualification from `pending_actions_freeze` to
`qualified`.
