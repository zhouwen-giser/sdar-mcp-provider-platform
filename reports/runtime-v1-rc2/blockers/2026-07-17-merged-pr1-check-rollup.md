# Blocker: merged PR #1 cannot acquire rc.2 checks

## Required condition

H9 requires PR #1 to be updated to rc.2 scope with all checks successful before creating the
annotated `v1.0.0-rc.2` tag.

## Verified state

- PR #1 is already merged. Its release commit and merge ref are immutable in GitHub.
- Its title/body now index rc.2 and F-001 through F-019.
- Its check rollup retains failed runtime jobs `29511142789` and `29511133163`; both failed
  Prettier on two repository policy files before their later formatting fix.
- Current rc.2 continuation PR #4 is clean and all H9 checks pass: push runtime `29544205005`,
  PR runtime `29544206323`, PR Compose `29544206369`, PR quality `29544206345`.

## Attempts and prohibited workarounds

The old logs were inspected and the current full gate was rerun successfully. GitHub cannot add
new commits or current workflow runs to a merged PR's historical merge ref. Rerunning the old
workflow would execute the same old content and fail the same format check. Deleting failed runs,
rewriting history, force-pushing or describing PR #4 checks as PR #1 checks would conceal the
actual record and is prohibited by the task package.

## Required decision

Either accept the current continuation PR #4 as the rc.2 check context, or explicitly waive the
literal merged-PR #1 green-rollup condition. Until then the tag must not be created.
