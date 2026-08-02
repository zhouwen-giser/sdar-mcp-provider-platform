# SMPP to SDAR handoff

The handoff is valid only when the redacted Registry Snapshot, Catalog revisions, Runtime endpoints, and qualification reports refer to the same candidate commit. It must contain public Provider IDs and Resource IDs only. It must not contain Home Assistant Entity IDs, tokens, Authorization headers, private-network credentials, or PMS secrets.

`readyForSdarIntegration` remains `false` while any required real-device, Runtime, PMS, Registry, recovery, or restoration hard gate is blocked. A passed lab Resource is not a production qualification for every Home Assistant resource of the same domain.
