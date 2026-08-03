# Registry endpoint real E2E

- Evidence class: `real`
- Status: **blocked_resource_unavailable**
- Integration run: `smpp-registry-e2e-5c2b9ab6-3420-40a5-8de3-89adfe52758c`
- Protocol qualification: `passed`

| providerId     | resourceId                  | HTTP status | power       | reachable |
| -------------- | --------------------------- | ----------- | ----------- | --------- |
| ha-climate-lab | living-room-air-conditioner | 200         | off         | true      |
| ha-light-lab   | living-room-main-light      | 200         | off         | true      |
| ha-light-lab   | living-room-aux-light       | 200         | unavailable | false     |

Active tasks: `0`; uncertain tasks: `0`.

The report uses the live Registry effective endpoints and the frozen server/discover, tools/list, and tools/call surface.
