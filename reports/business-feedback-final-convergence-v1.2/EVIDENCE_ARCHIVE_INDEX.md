# v1.2 large-evidence archive

PR #35 previously included 20 large raw capture files (81789766 bytes).
They are preserved on branch [`archive/ugv-pr35-raw-evidence-20261008`](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/tree/archive/ugv-pr35-raw-evidence-20261008),
pinned to immutable commit `9f6714d1fc06a65fb7438d66df435da51226455a`.

The active PR retains small textual evidence, acceptance reports, JSON summaries and this
[manifest](EVIDENCE_ARCHIVE_INDEX.json), which records every removed path, byte size and
Git blob SHA-1. This is **review-diff pruning**, not deletion of original qualification
evidence. Historical results and their pass/fail status are not rewritten.

To restore a removed capture from the evidence commit:

```bash
git fetch origin archive/ugv-pr35-raw-evidence-20261008
git show 9f6714d1fc06a65fb7438d66df435da51226455a:reports/business-feedback-final-convergence-v1.2/evidence/map-full-recon.json > map-full-recon.json
git hash-object map-full-recon.json
```

Compare `git hash-object` to `gitBlobSha1` in the manifest.
Run `python3 scripts/audit_evidence_archive.py --repo .` to verify all archived
bytes, manifest paths, immutable URLs and their absence from the candidate tree.
The audit is read-only and requires the pinned archive objects fetched above.
Restore other paths with the same command. References such as
`evidence/map-full-recon.json` in older reports point to this archived
snapshot when the path is absent from the active PR.

**Merge note:** squash-merge PR #35 after all required CI checks succeed.
A merge commit would retain the large historical blobs in `main` history
despite their removal from the final tree. The separate archive branch keeps
the originals available, so ordinary evidence remains traceable.
