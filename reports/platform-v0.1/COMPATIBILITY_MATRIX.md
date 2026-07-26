# V0.1 compatibility matrix

| Surface                | V0.1 status                         | Compatibility statement                                    |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Node.js                | Verified on 22.23.1                 | Node.js 22 toolchain                                       |
| pnpm                   | Verified on 11.13.1                 | pnpm 11 workspace                                          |
| PostgreSQL             | Controlled local integration passed | Separate PMS and Provider Runtime authorities required     |
| MCP frozen profile     | Passed                              | Exact locked contract and 74-case catalog retained         |
| Runtime migrations     | Passed                              | Existing files immutable; mapped Runtime set only          |
| PM2                    | Verified on 7.0.3                   | Fork mode and allowlisted Runtime entrypoint only          |
| UGV Provider           | Component/system simulation passed  | Real device qualification pending                          |
| NPC Tank Provider      | Component/system simulation passed  | Real device and ISR MQTT qualification pending             |
| Home Assistant Climate | Component/system simulation passed  | Independent HA and physical resource qualification pending |
| SDAR consumer          | Controlled interoperability passed  | External SDAR unavailable; not Interop Certified           |

Provider Adapter production mode defaults to `vendor_managed`. Secrets are
compatible only through SecretRef or `*_FILE` transport.
