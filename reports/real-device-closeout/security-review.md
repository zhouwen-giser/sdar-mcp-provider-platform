# Security review

- Status: **passed**
- Token matches in scanned reports: `0`
- Entity ID matches in scanned reports: `0`
- Authorization headers in scanned reports: `0`
- Real write gate: **read-only; new real writes fail closed**
- Dependency audit: The current lockfile was audited after the dependency overrides: 0 high or critical, 6 moderate, and 1 low advisory.
- Dependency audit refresh: blocked_by_approval_policy_to_avoid_external_dependency_inventory_disclosure

The local token and entity identifiers are not copied into committed evidence; the preflight keeps only resource IDs and hashes.
