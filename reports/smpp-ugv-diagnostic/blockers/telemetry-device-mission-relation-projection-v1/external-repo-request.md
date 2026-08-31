# SMPP Telemetry Compatibility Request

Source SMPP commit: `6fe65ac80173b1bec9246009a509570ea5ffd531`

ProviderOps contract: `sdar.provider.ops.event/1.1.0`

Target: `zhouwen-giser/smpp-telemetry-platform` after observed `main@a5e3dea00f825c4400523c8a957e539c901ee0c6`

Required semantics:

- dispatch uncertainty;
- reconciliation outcome and identity validation;
- four-axis business terminal classification;
- Provider Evidence with physical `observedAt`;
- exact Task→ExternalExecution→DeviceMission relation.

The frozen target accepts and preserves all emitted legal records, and already specializes recovery/task/resource/execution families. The remaining request is a canonical DeviceMission entity and relation projection for `sdar.fact.kind=mission_relation` with exact/unresolved/conflict behavior.

Please return an implementation branch and 40-hex commit satisfying the acceptance probe in `blocker-report.md`. No near-name, latest-record or time-proximity mapping is authorized. Resume also requires explicit human authorization using `sdar.smpp.human-resume-authorization/v1`.
