# Permission UI future map

No authentication or authorization is implemented. `read-only` and `permission-denied` are local
display scenarios, not security controls.

| Capability | Current prototype behavior | Future authority question |
| --- | --- | --- |
| Read inventories | Always Mock-readable unless the selected error scenario applies | Which tenant/environment may be read? |
| Onboard Provider | Browser-only operation | Who may register a Provider and approve dependencies? |
| Create/Reconcile Runtime | Browser-only lifecycle | Who owns desired-state and recovery authority? |
| Publish configuration | Browser-only Pull/Apply/ACK sequence | Who may approve restart/immutable impact? |
| Publish Catalog | Disabled for breaking classification | Who reviews compatibility and Registry publication? |
| Requeue Worker Job | Adds a Mock attempt; never marks success | Who may create a new attempt? |
| Close Incident | Enabled only after the Mock deployment is recovered | Who owns resolution approval? |
| View Audit | Secret values remain `REDACTED` | Which fields require additional masking? |

Future permission denial should be supplied as data/capabilities by a backend contract. It must not
be inferred from a browser-stored actor or implemented as a client-side route guard.
