# Provider qualification boundaries

Provider Package qualification reports two independent evidence scopes. It is
not a certification label.

## Component status

`componentStatus` describes verification of the repository component against
the stated protocol, contracts, and test environment:

- `passed`: the stated component checks passed;
- `partial`: only a documented subset passed;
- `pending`: the component evidence is not complete;
- `failed`: a required component check failed.

A component pass may use mocks or fakes when the evidence says so. It proves
only that explicit component claim and never upgrades real-resource status.

## Real-resource status

`realResourceStatus` is separate:

- `qualified`: evidence covers the identified real resource and required real
  interfaces;
- `pending`: real-resource evidence is missing or incomplete;
- `failed`: a required real-resource qualification failed;
- `not_applicable`: the package has no real-resource qualification scope.

UGV, NPC Tank, and Home Assistant Climate currently remain `pending`. Mock
Device MCP servers, Mock MQTT publishers, and Fake Home Assistant fixtures
cannot change that status.

## System and interoperation claims

System qualification, production approval, and interoperation certification
are not ProviderPackage v1 fields. They require separate end-to-end evidence
and governance. The Registry projection intentionally exposes only:

- package ID and version;
- exact component and real-resource status enums;
- evidence references.

It does not emit `Certified`, `systemStatus`, or a combined boolean badge.
Consumers must display the two scopes independently and provide access to their
evidence.

## Mock fixture isolation

Production Provider Packages are loaded only from the controlled
`provider-packages/` root. The loader rejects package directories, package IDs,
provider types, or Adapter entry path segments identified as `mock`. Current
test-only assets remain under:

- `apps/mock-ugv-device-mcp`;
- `apps/mock-ugv-mqtt-publisher`;
- `apps/mock-npc-tank-device-mcp`;
- `apps/mock-npc-tank-mqtt-publisher`;
- `tests/fixtures/fake-home-assistant-climate.ts`.

None is a production Provider Package or evidence of real-resource
qualification.
