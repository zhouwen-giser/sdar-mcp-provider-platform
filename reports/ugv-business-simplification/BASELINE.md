# v1.3 baseline

Read on 2026-09-30. Actual branch: `codex/smpp-gowm-shared-storage-integration-v0.1`; HEAD: `367910c75f4ffa3969aed1f612b77d74a6518ed4`. Index is unchanged. Existing dirty work comprises the completed v1.2 reports/evidence, the newly written MCP guide and its provider-document link, and the device contract capture. These remain intact.

Source package: `UGV_Provider_MCP_Business_Simplification_Codex_Goal_v1.3.zip`; SHA-256 `69c3573a138165c38167fbac8555dce0e420805c35b542c6b7b0ea38a0f61e2a`. All 13 members were inspected and extracted with path/symlink checks. The installed task package has 12 tasks in 6 phases. Package checks establish intake integrity, not implementation completion.

The v1.3 user objective supersedes the earlier requirement for trusted human identity in development mode. It leaves other authentication modes, task scope, business bindings, revision guards, command idempotency and fire-disable behavior intact. This work changes only SMPP. It does not authorize simulator source changes or require rerunning completed site tests.

Current gaps confirmed in code: development resolver provides no business responder; RequiredInput intake/persistence/dispatcher/Provider require authenticated user provenance; Intervention intake requires it too. UGV configuration already defaults live but runtime fallbacks and airport planner/profile gates still require simulation. Recon has an existing inference resolver; its freshness/identity/uniqueness/time gates require audit. No common public semantic projection yet unifies native status fields across synchronous queries and TaskBusiness.

Previous goal turn classification: progress (MCP guide and offline request validation completed). This goal begins with authoritative package intake and current source inspection; no prior v1.3 completion is assumed.
