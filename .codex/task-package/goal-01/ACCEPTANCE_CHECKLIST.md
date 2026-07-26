# Goal 1 Acceptance Checklist

- [ ] Source ZIP/SHA/Git baseline traceable.
- [ ] Existing frozen protocol and Provider gates not weakened.
- [ ] Runtime 001～023, UGV 024, NPC 025 physically isolated and checksum-mapped.
- [ ] Migration isolation E2E proves no cross-created tables.
- [ ] UGV/NPC/HA Provider Packages validate; mock fixtures excluded from production list.
- [ ] Shared ConfigurationDefinition drives Zod/JSON Schema/UI metadata.
- [ ] PMS control DB has Provider/Resource/Config/Audit/Job Lease and no Runtime Task tables.
- [ ] Config Draft/Validate/Publish/No-op/Rollback/Latest/Watch/Ack complete.
- [ ] Runtime Config Client supports ETag, staging, LKG, Ack and PMS outage.
- [ ] OTEL_ENABLED dynamic configuration closes first real loop without affecting Task Engine.
- [ ] 50 task states PASSED and Goal 1 Handoff validator returns 0.
