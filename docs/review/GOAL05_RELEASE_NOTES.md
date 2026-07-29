# SDAR MCP Provider Platform 0.1.0 release notes

Platform 0.1.0 delivers the PMS API, fenced production Worker, PMS Web,
single-host PM2 Runtime lifecycle, isolated PostgreSQL preparation, Runtime
registration, Catalog discovery and Registry publication.

Release qualification covers controlled PostgreSQL, PM2, Provider simulations
and Registry-authoritative interoperability. It does not qualify external SDAR,
real UGV/NPC Tank/ISR MQTT, independently managed Home Assistant, physical
resources, Kubernetes, cross-host scheduling or multiple Runtime replicas.

Upgrades are additive and database recovery is forward-only. Back up PMS and
Runtime databases before rollout; roll back application artifacts only where
the applied schema remains compatible.
