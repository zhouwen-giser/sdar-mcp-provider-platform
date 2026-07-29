# Platform 0.1.0 compatibility matrix

| Surface                | Qualified version or mode                 | Boundary                                          |
| ---------------------- | ----------------------------------------- | ------------------------------------------------- |
| Platform monorepo      | `sdar-mcp-provider-platform@0.1.0`        | Private release identity                          |
| Runtime component      | `@sdar/runtime@2.0.0-rc.1`                | Version remains independent                       |
| Node.js                | 22                                        | Node 22 is required                               |
| pnpm                   | 11.13.1                                   | Frozen workspace install                          |
| PostgreSQL             | 17                                        | Separate PMS and Provider Runtime authorities     |
| PM2                    | 7.0.3                                     | Pinned JavaScript API; fork mode; local host only |
| MCP frozen profile     | 74/74                                     | Locked schemas and reports retained               |
| PMS API / Worker / Web | 0.1.0                                     | Independent non-root OCI artifacts                |
| Providers              | Controlled platform E2E                   | Real resources remain unqualified                 |
| SDAR consumer          | Controlled Registry-authoritative interop | External SDAR is not certified                    |

Provider Adapter production mode remains `vendor_managed`. Secrets use only
SecretRef or controlled file transport.
