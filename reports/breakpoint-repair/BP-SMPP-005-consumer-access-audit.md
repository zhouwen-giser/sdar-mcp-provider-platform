# BP-SMPP-005 Consumer Access Profile Audit

Status: `DEFERRED`

## Audit result

The current strict-intranet deployment is operationally coherent, but consumers must combine facts
from multiple files to understand the access contract. There is no single versioned metadata object
that states auth mode, transport mode, network scope, and consumer profile together.

Finding: `SMPP_CONSUMER_ACCESS_PROFILE_METADATA_GAP`.

## Surface audit

| Surface                      | Current behavior                                                                                                                                                                                | Audit disposition                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PMS Web                      | Proxies raw `/api/v1` routes and does not invent credentials for the anonymous production profile.                                                                                              | Behavior is documented in the production-bundle runbook; consumer metadata is indirect.                                         |
| PMS API                      | `anonymous_intranet` is an explicit opt-in and requires insecure-internal-transport acknowledgement. OpenAPI operations can expose `security: []` and `x-sdar-access-mode: anonymous_intranet`. | Auth behavior is explicit at this surface.                                                                                      |
| `sdar-registry-v1`           | Projection paths, checksums, lineage, and HTTP semantics are frozen and previously integrated successfully.                                                                                     | Do not modify the DTO or checksum for this breakpoint. The frozen contract does not carry the complete consumer access profile. |
| Runtime MCP endpoint         | Production Runtime selects `AUTH_MODE=anonymous` with `ALLOW_INSECURE_INTERNAL_TRANSPORT=true`.                                                                                                 | Runtime behavior is explicit in config, but not joined to Registry consumer metadata.                                           |
| PMS Worker / Runtime Catalog | `PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet` permits no-credential discovery only with the internal-transport opt-in.                                                            | Discovery behavior is explicit in config and runbooks.                                                                          |
| Runtime deployment           | The bundle uses `runtimeAuthority=direct_container`; Compose owns the process while PMS observes and publishes it.                                                                              | Authority is explicit in deployment metadata.                                                                                   |
| Transport and network        | The bundle documents `strict-intranet-plaintext`, isolated private networking, and no public exposure assumption.                                                                               | Network scope is documented rather than carried in a machine-readable consumer profile.                                         |
| Provider bundle              | Provider Adapter/telemetry and HA credentials retain their own safety boundaries; anonymous consumer access does not open real-device write gates.                                              | No compatibility change required for this repair.                                                                               |

## Why no projection change is made

The Goal explicitly protects the native Registry and the working `sdar-registry-v1` projection. A
consumer-profile field added directly to the frozen projection would change DTO bytes, checksum
vectors, and cross-repository contract lineage. That expansion is disproportionate to the core
Climate stability repair.

This branch therefore does not change:

- native Registry state;
- projection DTO or schema;
- projection checksum or canonicalization;
- lineage headers;
- latest/304/bootstrap/watch behavior.

## Recommended follow-up

A later, separately versioned delivery can add a deployment-manifest overlay that explicitly carries:

```text
authMode = anonymous
transportMode = private HTTP plaintext
networkScope = isolated trusted intranet
consumerProfile = anonymous_intranet
runtimeAuthority = direct_container
```

That overlay should reference the existing projection rather than mutate `sdar-registry-v1`, and it
should have contract tests proving that PMS Web, PMS API, PMS Worker, Runtime MCP, and bundle docs
agree.

## Security boundary

`anonymous_intranet` is not Internet-anonymous access. It depends on VLAN/routing/host-firewall
isolation and an explicit insecure-internal-transport opt-in. Runtime registration tokens, database
credentials, Home Assistant tokens, and physical-device write gates remain separate and must not be
removed or inferred from the consumer profile.

The metadata follow-up is deliberately `DEFERRED`; the existing deployment behavior is not presented
as a new production qualification by this audit.
