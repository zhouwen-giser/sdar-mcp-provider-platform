# SMPP real-device fault matrix

| Area                      | Evidence      | Status                                               |
| ------------------------- | ------------- | ---------------------------------------------------- |
| Home Assistant preflight  | real          | blocked (failed)                                     |
| Climate Provider          | real          | passed for executed mode/temperature/power-off scope |
| Light Provider            | real          | passed for both configured lights                    |
| Runtime idempotency       | real/contract | passed for bounded duplicate and conflict scenarios  |
| Adapter in-flight restart | mixed         | unverified                                           |
| Runtime in-flight restart | mixed         | unverified                                           |
| Real fault injection      | mixed         | unverified                                           |
| PMS outage Task Authority | unverified    | unverified                                           |
| Manual AC safety interval | real          | preserved; no unsafe inverse operation forced        |

Controlled fault-injection results remain classified as controlled evidence and are not promoted to real-device qualification.
