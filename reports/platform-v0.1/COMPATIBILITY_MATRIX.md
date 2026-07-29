# Platform 0.1.0 compatibility matrix

| Surface                | Qualified version or mode                        | Boundary                                                     |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Platform monorepo      | `sdar-mcp-provider-platform@0.1.0`               | Private release identity                                     |
| Runtime component      | `@sdar/runtime@2.0.0-rc.1`                       | Version remains independent from Platform                    |
| Node.js                | 22.23.1                                          | Node 22 is required                                          |
| pnpm                   | 11.13.1                                          | Frozen workspace install                                     |
| PostgreSQL             | 17                                               | Separate PMS and Provider Runtime authorities                |
| PM2                    | 7.0.3                                            | Repository-pinned JavaScript API; fork mode; local host only |
| MCP frozen profile     | 74/74                                            | Locked schemas and protocol reports retained                 |
| UGV Provider           | Controlled platform E2E passed                   | Real device/ISR MQTT unqualified                             |
| NPC Tank Provider      | Controlled platform E2E passed                   | Real device/ISR MQTT unqualified                             |
| Home Assistant Climate | Controlled platform E2E passed                   | Independent HA and physical resource unqualified             |
| SDAR consumer          | Controlled Registry-authoritative interop passed | External SDAR unavailable; not certified                     |

Provider Adapter production mode remains `vendor_managed`. Secrets are
supported only through SecretRef or controlled `*_FILE` transport.
