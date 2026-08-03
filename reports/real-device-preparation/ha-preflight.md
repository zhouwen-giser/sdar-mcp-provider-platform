# Home Assistant real-device read-only preflight

- Evidence class: `real` (read-only real HA observation)
- Status: **FAILED**
- Environment: `home-lab`
- Side effects attempted: `false`

## Checks

- PASS `home_assistant_url_reachable`: GET /api/ returned HTTP 2xx.
- PASS `token_valid`: Home Assistant accepted the file token.
- PASS `configured_entities_exist`: All configured resources returned a state.
- PASS `entity_domains_match`: Configured resource domains match climate/light.

## Configured resources (redacted)

| resourceId | domain | entity hash | state | reachable | observedAt |
| --- | --- | --- | --- | --- | --- |
| living-room-air-conditioner | climate | 76109bf457a6cdb862e448b84c3ea87c37f9c8cdba92a52b8ef7b3a47a3333f8 | off | true | 2026-08-03T00:36:56.219608+00:00 |
| living-room-main-light | light | 48d411259a1aaeffd9111bc10a9444ff2a092e79e51e1bd337a32e59c19d7928 | off | true | 2026-08-03T01:06:41.408308+00:00 |
| living-room-aux-light | light | 2b3f49cc64f1b856d860173ae06e4a9cef8c4dca858043a3fc46f9eee42e6591 | unavailable | false | 2026-08-03T01:51:47.059061+00:00 |

No token, Authorization header, internal entity identifier, or unrelated Home Assistant entity is included in this report.

Error code: `ENTITY_UNAVAILABLE`
