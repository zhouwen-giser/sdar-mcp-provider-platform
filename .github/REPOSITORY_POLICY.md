# Repository governance policy

The declarative configuration in this directory establishes the intended
GitHub governance controls:

- `main` accepts changes only through pull requests. It requires the
  `runtime-ci` and `runtime-compose` checks, resolved review conversations, and
  zero approving reviews so a sole maintainer is not blocked.
- Pull requests can be merged only with the squash merge method. Force pushes
  and branch deletion are disabled for `main`.
- Tags matching `v*` are immutable after creation: updates and deletions are
  prohibited by the active tag ruleset.

`settings.yml` is consumed by the GitHub Settings app. The tag ruleset payload
is intentionally stored separately because GitHub applies repository rulesets
through its REST API rather than the branch-protection API.
