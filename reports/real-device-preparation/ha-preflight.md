# Home Assistant real-device read-only preflight

- Evidence class: `real` (read-only real HA observation)
- Status: **PASSED**
- Environment: `home-lab`
- Side effects attempted: `false`

## Checks

- PASS `home_assistant_url_reachable`: GET /api/ returned HTTP 2xx.
- PASS `token_valid`: Home Assistant accepted the file token.
- PASS `configured_entities_exist`: All configured resources returned a state.
- PASS `entity_domains_match`: Configured resource domains match climate/light.
- PASS `entities_reachable`: No configured entity is unknown or unavailable.
- PASS `climate_capabilities`: A configured HVAC mode and Home Assistant temperature limits are readable.
- PASS `light_brightness_capabilities`: Brightness capability was inspected for both configured lights; unsupported values remain null.
- PASS `websocket_connected`: Home Assistant WebSocket authenticated.
- PASS `websocket_state_changed_subscription`: state_changed subscription acknowledged.
- PASS `rest_websocket_initial_state_consistent`: Configured resource state snapshots matched REST reads.

## Configured resources (redacted)

| resourceId                  | domain  | entity hash                                                      | state | reachable | observedAt                       |
| --------------------------- | ------- | ---------------------------------------------------------------- | ----- | --------- | -------------------------------- |
| living-room-air-conditioner | climate | 76109bf457a6cdb862e448b84c3ea87c37f9c8cdba92a52b8ef7b3a47a3333f8 | off   | true      | 2026-08-02T16:07:45.409171+00:00 |
| living-room-main-light      | light   | 48d411259a1aaeffd9111bc10a9444ff2a092e79e51e1bd337a32e59c19d7928 | off   | true      | 2026-08-02T16:19:42.189475+00:00 |
| living-room-aux-light       | light   | 2b3f49cc64f1b856d860173ae06e4a9cef8c4dca858043a3fc46f9eee42e6591 | off   | true      | 2026-08-02T16:19:44.636121+00:00 |

No token, Authorization header, internal entity identifier, or unrelated Home Assistant entity is included in this report.
