# UGV ZMQ phase 1 contract candidate

This directory freezes the supplied self-driving V2.0, optical V2.2 and CARLA simulation-effect V1.0 documents. `source-lock.json` records exact source bytes and their authority. `contract-lock.json` additionally pins the executable validators, message inventory, known gaps, candidate business profile and independent reference vectors.

The simulation-effect document includes the operator-requested terminology revision. Its original supplied bytes are also retained and hashed; the verifier checks that JSON/YAML wire examples remain identical between the original and presentation revision.

The status is **candidate**. A matching wire sample proves the observed encoding; it does not prove device ownership, physical capability, task lifecycle, producer identity or recovery correctness. No operation is registered with the running Provider by this package.

## Files and checks

- `sources/`: byte-preserved user documents. Historical source paths are informational and need not exist on the machine running the check.
- `message-inventory.json`: supported message IDs/topics/methods, limits, retry boundaries and missing equivalents.
- `known-gaps.json`: unresolved contractual guarantees and affected intended operations. These blockers cannot be removed by merely declaring an endpoint online.
- `fixtures/chassis-reference.json`: **constructed reference**, built independently with Python struct and `binascii.crc_hqx`; never provider-confirmed golden frames.
- `packages/vehicle-zmq-contract`: strict lexical JSON, duplicate-key/UTF-8/finite-number checks, envelope correlation, geometry and nullable evidence checks, lossless uint64 decoding, binary CRC/length/vector checks, candidate profile validation and G0 assessment.

```bash
pnpm zmq:contract:check
pnpm test:ugv-zmq
pnpm zmq:preflight --profile deploy/ugv-zmq/deployment.candidate.json --capture reports/ugv-zmq-phase1/raw/passive-publications-20261023.json --report reports/ugv-zmq-phase1/G0-candidate.json
```

Contract checking exits 0 only when all locked bytes match. Preflight exits 1 on invalid input/integrity errors, 2 on unresolved G0 conditions or nonconforming passive samples, and 0 only when the supplied static candidate prerequisites are complete for its intended scope. **Even exit 0 retains `runtimeAdmission=not_published`.** Evidence-reference hashes attest integrity, not the truth of provider/operator attestations; their authority and scope must be reviewed. Merely inserting a test fixture path cannot legitimately replace provider-confirmed evidence.

The shipped candidate is expected to return 2: simulation run/provider binding, policy/physical/time agreements, provider source/golden frames and capability signoff remain unconfirmed. The known protocol recovery/association/completeness gaps additionally block affected control/full-result guarantees. Developers may proceed with isolated foundations; runtime control qualification belongs to later stages.

## Passive evidence collected

The initial bounded SUB-only capture observed system ID `1` (recipient `0`, broadcast), `isr-01` publishing JSON `2.2`, and `artillery-01` publishing JSON `1.0`. Its 18 retained samples pass the executable validators. The chassis wire header has no version: V2.0 remains a selected document contract, not an in-band advertised version. Localization times stay decimal uint64 strings with unconfirmed timebase; no UTC, compass-heading or altitude-datum conversion is inferred.

The capture sampled the first two publications of each observed type. Counts describe messages delivered to this subscriber during a short observation interval; they do not prove continuous capture, replay support or full inventory coverage. No request/reply command, navigation task, optical scan or simulation interaction was sent. Provider-generated mode/path/feedback golden frames and controlled lifecycle evidence are still required.

## Repeating a bounded passive capture

The helper uses only SUB sockets and connects only to the profile's publication endpoints. It requires an explicitly supplied, independently installed `zeromq@6.8.0` directory; the production dependency is intentionally deferred to the observation-driver phase. The recorded initial probe used libzmq 4.3.5. Duration is bounded to 1–60 seconds and at most two samples per observed message class, with a per-component cap.

```bash
node --import tsx scripts/ugv-zmq/passive-capture.mjs --help
node --import tsx scripts/ugv-zmq/passive-capture.mjs --profile deploy/ugv-zmq/deployment.candidate.json --binding-directory /absolute/path/to/node_modules/zeromq --out /absolute/path/to/new-capture.json --duration-ms 6000
```

Use a new output path; original raw receipts are immutable evidence. The tool never binds a live port or opens a command socket. It does not automatically amend the deployment profile or grant qualification.

## Updating the contract candidate

After reviewing an intentional source/validator change, regenerate constructed reference vectors if necessary, format editable files, explicitly run `node scripts/ugv-zmq/freeze-contracts.mjs --write`, review the changed hashes and rerun the checks. Source snapshots and raw/reference bytes are excluded from automatic formatting. Do not relabel constructed vectors as real captures or silently replace a provider document with a corrected interpretation.

Ambiguities retained from the documents include the missing native patrol task, optical rejection example using `result` instead of `command`, explanatory non-JSON examples, ambiguous command accepted wording, and missing producer epoch/timebase details. Strict validators follow the stated envelope/tables; raw mismatches must be diagnosed rather than loosely accepted.

On 2026-10-24 the operator made the controller system ID optional. An omitted field normalizes to null and no longer adds a global G0 blocker. Read-only SUB reception never uses a controller identity; future command encoding requires its own explicit, confirmed header/default semantics.
