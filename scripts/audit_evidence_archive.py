#!/usr/bin/env python3
"""Read-only byte and tree audit of the immutable PR #35 evidence archive."""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath


def git(repo, *args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, check=False
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def text_git(repo, *args):
    return git(repo, *args).decode("utf-8").strip()


def tree(repo, commit):
    entries = {}
    for record in git(repo, "ls-tree", "-rlz", commit).split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        _, kind, sha, size = metadata.split()
        if kind == b"blob":
            entries[path.decode("utf-8")] = (sha.decode("ascii"), int(size))
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument(
        "--manifest",
        default="reports/business-feedback-final-convergence-v1.2/EVIDENCE_ARCHIVE_INDEX.json",
    )
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    manifest = json.loads((repo / args.manifest).read_text(encoding="utf-8"))
    source = manifest["archiveCommit"]
    branch = manifest["archiveBranch"]
    # A bad candidate ref must fail, rather than masquerade as absent files.
    candidate = text_git(repo, "rev-parse", "--verify", args.head + "^{commit}")
    try:
        archive = text_git(repo, "rev-parse", "--verify", source + "^{commit}")
        archive_tree = tree(repo, archive)
    except RuntimeError as error:
        raise RuntimeError(
            f"Archive objects unavailable; run git fetch origin {branch}: {error}"
        ) from error
    candidate_tree = tree(repo, candidate)
    errors = []
    branch_refs = {}
    for ref in (f"refs/heads/{branch}", f"refs/remotes/origin/{branch}"):
        try:
            branch_refs[ref] = text_git(repo, "rev-parse", "--verify", ref + "^{commit}")
        except RuntimeError:
            continue
        if branch_refs[ref] != archive:
            errors.append(f"{ref}: differs from the pinned archive commit")
    files = manifest["files"]
    paths = [entry["path"] for entry in files]
    threshold = manifest["thresholdBytes"]
    raw_paths = {
        path
        for path, (_, size) in archive_tree.items()
        if path.startswith("reports/")
        and "evidence" in PurePosixPath(path).parts
        and path.endswith(".json")
        and size >= threshold
    }
    if len(paths) != len(set(paths)):
        errors.append("Duplicate manifest paths")
    if set(paths) != raw_paths:
        errors.append(
            f"Raw capture set mismatch: missing={sorted(raw_paths - set(paths))}, "
            f"extra={sorted(set(paths) - raw_paths)}"
        )
    if len(files) != manifest["fileCount"]:
        errors.append("Manifest file count mismatch")
    results = []
    total = 0
    for entry in files:
        path = entry["path"]
        failures = []
        actual_sha = None
        actual_size = None
        sha256 = None
        expected_url = (
            "https://github.com/zhouwen-giser/sdar-mcp-provider-platform/"
            f"blob/{archive}/{path}"
        )
        if entry["immutableUrl"] != expected_url:
            failures.append("immutable URL mismatch")
        try:
            resolved, _ = archive_tree[path]
            data = git(repo, "cat-file", "blob", resolved)
            actual_size = len(data)
            actual_sha = hashlib.sha1(
                f"blob {actual_size}\0".encode("ascii") + data
            ).hexdigest()
            sha256 = hashlib.sha256(data).hexdigest()
            total += actual_size
            if actual_sha != entry["gitBlobSha1"] or resolved != actual_sha:
                failures.append("Git blob SHA-1 mismatch")
            if actual_size != entry["sizeBytes"]:
                failures.append("byte size mismatch")
        except (KeyError, RuntimeError) as error:
            failures.append(f"archive blob unavailable: {error}")
        if path in candidate_tree:
            failures.append("still present in candidate tree")
        errors.extend(f"{path}: {failure}" for failure in failures)
        results.append(
            {
                "path": path,
                "expectedGitBlobSha1": entry["gitBlobSha1"],
                "actualGitBlobSha1": actual_sha,
                "expectedSizeBytes": entry["sizeBytes"],
                "actualSizeBytes": actual_size,
                "sha256": sha256,
                "absentFromCandidate": path not in candidate_tree,
                "result": "FAIL" if failures else "PASS",
            }
        )
    if total != manifest["totalBytes"]:
        errors.append("Total actual byte size mismatch")
    print(
        json.dumps(
            {
                "schemaVersion": "sdar.pr35-raw-evidence-audit/1",
                "archiveCommit": archive,
                "archiveBranch": branch,
                "localArchiveRefs": branch_refs,
                "candidateRef": args.head,
                "candidateCommit": candidate,
                "filesChecked": len(results),
                "filesPassed": sum(item["result"] == "PASS" for item in results),
                "totalBytes": total,
                "manifestSetMatchesRawCaptures": set(paths) == raw_paths,
                "result": "FAIL" if errors else "PASS",
                "errors": errors,
                "files": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
