# SMPP diagnostic contracts

These frozen, provider-independent logical contracts describe Runtime-authoritative task identity,
dispatch uncertainty, reconciliation, business terminal classification, Provider evidence, mission
relations, and the read-only capability surface.

They do not extend the frozen MCP/SEP-2663 or Adapter Protocol wire contracts. ProviderOps remains
`sdar.provider.ops.event@1.1.0`; mapping to its legal record families is implemented from committed
Runtime or accepted Provider Telemetry authority.

Mission identity is observation-derived. It is never inferred from timestamps or task completion.
