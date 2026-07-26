# SDAR Registry Snapshot import

SDAR consumes the PMS Registry Snapshot for one environment from:

```text
GET /api/v1/registry/{environment}/latest
```

Send the last strong ETag in `If-None-Match`. A `304` response means the local snapshot remains
current. On first boot, or when no local snapshot exists, use:

```text
GET /api/v1/registry/{environment}/bootstrap
```

`source=registry_lkg` contains the latest committed snapshot. `source=empty_safe_default` is an
explicit revision `0` projection with no providers; it is not a published or qualified snapshot.
Persist a successfully validated snapshot locally before replacing the prior LKG.

The `watch` endpoint is an SSE hint stream. Each `revision` event contains only `environment`,
`revision`, and `checksum`; clients must retrieve `latest` and validate its ETag rather than treating
the hint as Registry content.

## Import fixture

```json
{
  "environment": "production",
  "revision": 7,
  "checksum": "f27f4c19bcb43d3c589780f2666fb53dd92bde185de0acd71ee5464dbfc9bd09",
  "document": {
    "environment": "production",
    "providers": [
      {
        "providerId": "ugv-provider-1",
        "serverId": "runtime-ugv-provider-1",
        "protocolMode": "frozen_v1",
        "effectiveEndpoint": "https://ugv-provider.example.test/mcp",
        "catalogRevision": 3,
        "tools": []
      }
    ]
  }
}
```

V0.1 requires exactly one externally effective MCP endpoint per Provider projection. The endpoint
must be HTTPS, except loopback HTTP used for local operation, and must not contain user info, query
credentials, or fragments.

Credentials are provisioned separately through an implementation-owned credential reference. The
Registry response never contains credential values, Secret files, PM2 names/PIDs/ports, Runtime
Task data, or qualification claims. A component or mock test result must not be interpreted as
real-resource certification.
