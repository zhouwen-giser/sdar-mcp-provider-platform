# ADR 0012: Instance-scoped Runtime control-plane credentials

## Status

Accepted for Platform 0.1.0 release qualification.

## Context

The PMS Worker previously accepted one global Runtime control-plane token file and projected it into
every Runtime instance. PMS API authorization already binds a token digest to an explicit
Provider/Deployment/Instance principal, so a global Worker credential cannot safely serve multiple
deployments.

## Decision

The Worker accepts only `PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT`. The legacy global token-file
variable is rejected with a stable error and has no compatibility fallback.

The credential resolver uses this deterministic layout:

```text
<credential-root>/
  providers/<providerId>/
    deployments/<deploymentId>/
      instances/<instanceId>/
        control-plane.token
```

Identity segments are restricted to bounded alphanumeric, dot, underscore and hyphen forms, with
traversal sequences rejected. The canonical root must be an existing non-symlink directory no
broader than `0700`. Every parent is canonical, contained by the root, non-symlink and not
group/world writable. A token must be a canonical regular non-symlink file, non-empty, singly
linked and no broader than `0600`.

The resolver returns only the absolute file path. The owning Runtime adapter reads the file; the
resolver never returns, logs or embeds token content in errors or evidence.

PMS API continues to use an explicit credential descriptor. Each Runtime principal names its own
token file and exact Provider/Deployment/Instance identity. Reusing one token or one token file for
multiple principals is invalid; the Worker directory layout is not used to infer API principals.

## Rotation and provisioning

For V0.1, adding or rotating an instance credential is an atomic operations change:

1. provision the new instance token file under the credential root with secure permissions;
2. update the PMS API descriptor with the matching principal and token file;
3. atomically publish both configuration trees as one change;
4. restart PMS API so the descriptor is reloaded;
5. reconcile the affected Runtime instance.

A partial update fails closed. There is no fallback to the previous global credential.

## Consequences

- Distinct instances cannot accidentally inherit the same Worker credential path.
- Missing, unsafe or duplicated mappings prevent reconciliation before PM2 receives a bootstrap.
- Credential provisioning and API descriptor rotation must be coordinated operationally.
