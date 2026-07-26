# Blocker: Frozen Contract Source Bytes Missing

Observed: 2026-07-18 (Asia/Shanghai)

Severity: H0 hard gate

## Required artifact

```text
SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0_FROZEN.md
SHA-256 d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845
```

The migration requires copying this document byte-for-byte to
`protocol/frozen/SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0.md`. Formatting, line-ending changes,
reconstruction from summaries, or substitution with upstream documentation are forbidden.

## Evidence gathered

- Latest remote `main` is `d55d64649b7a1cd53197ea393e7af0bb07eabfff` and does not contain the
  frozen document or a `protocol/frozen` tree.
- The referenced attachment directory contains only `pasted-text-1.txt`.
- `pasted-text-1.txt` is 35,884 bytes and hashes to
  `7c27e62e43f0358f3a50718caac4c73001cbc807d5eb2521fced794c81db8ff6`.
- Its content is the migration task package, not the frozen protocol contract.
- A filename and required-hash search across the available attachment corpus found no other source
  artifact.

## Why implementation stops at this gate

The task explicitly makes the frozen contract the sole product contract and requires failure when
its hash cannot be verified. Generating schemas, handlers, or 74 conformance cases from the task
summary alone could encode a different contract while appearing plausible. That would invalidate
the protocol lock and all downstream conformance claims.

## Required resolution

Attach the exact frozen contract file whose SHA-256 is
`d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`. Work can then resume at H0 by
copying the original bytes, verifying the hash, and fetching only the pinned MCP source commit and
schema blob.

No Runtime or Provider Wire Contract implementation was changed while this artifact was missing.

## Resolution

Resolved on 2026-07-18. The user supplied
`D:\downloads\SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0_FROZEN.md`; both the source and the
byte-preserving repository copy hash to
`d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`. The committed checksum
sidecar is validated by `pnpm protocol:check:frozen`.
