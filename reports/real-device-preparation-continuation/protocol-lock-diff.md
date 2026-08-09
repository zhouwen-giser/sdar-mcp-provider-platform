# C2 protocol lock portability evidence

The frozen protocol lock was not regenerated or overwritten.

| Check                          | Before normalization | After normalization |
| ------------------------------ | -------------------: | ------------------: |
| Files compared                 |                   38 |                  38 |
| Hash and size already matching |                    6 |                  38 |
| Line-ending drift only         |                   32 |                   0 |
| Content drift                  |                    0 |                   0 |
| Protocol lock modified         |                   no |                  no |

The before and after per-file records are [protocol-lock-diff-before.json](protocol-lock-diff-before.json) and [protocol-lock-diff-after.json](protocol-lock-diff-after.json). The fix is scoped to `.gitattributes` (`proto/**` and `protocol/**/*.json` use LF) and LF materialization of the affected tracked text files. Windows `core.autocrlf=true` remains unchanged.

Verification:

```text
Protocol lock verified for 38 files
```

## Linux symlink gate

The repository’s compiled Provider Package Registry implementation was executed under `node:22-bookworm` with `process.platform=linux`. It created a real directory symlink and verified the production loader rejected it with `PACKAGE_ENTRY_SYMLINK_REJECTED`. The full Vitest invocation could not start in the Windows dependency tree mounted into Linux because its optional Rolldown native binding was Windows-only; the dedicated Linux gate avoids that unrelated test-runner native binding and exercises the actual registry implementation.

The reusable command is `node scripts/provider-package-linux-symlink-check.mjs` after `pnpm build`; it intentionally exits as unsupported on non-Linux hosts.
