# NPC Tank deployment secrets

This repository directory is documentation-only. Never create a live token, password, header,
certificate, key, database URL, or descriptor here. Every configured path must be absolute and
outside the repository.

Recommended external layout:

```text
<external-root>/
├── npc-adapter-db-password
├── npc-adapter-database-url
├── npc-runtime-db-password
├── npc-runtime-database-url
├── device-mcp-headers.json          # optional
├── mqtt-password                    # optional
├── mqtt-ca.pem                      # optional
├── mqtt-client.pem                  # optional
├── mqtt-client-key.pem              # optional
└── npc-pms-credentials/
    ├── management.json
    ├── runtime.json
    ├── management-administrator.token
    └── <provider/deployment/instance-scoped runtime token files>
```

The PMS descriptors contain only identities, roles/scopes, target identity, and absolute container
paths such as `/run/npc-pms-credentials/management-administrator.token`; they never contain token
values. The overlay mounts the whole credential root read-only at that exact container path.

Directories must have permissions no broader than `0700`. Files must be regular, non-symlink,
singly linked, non-empty, readable by the deployment, and no broader than `0600`. The PMS API image
runs as UID `1000`, so its external credential root and files must be readable by that UID. Rotate
tokens and database passwords out of band, then restart the affected services. Deployment scripts
validate paths and consistency without printing any credential content.
