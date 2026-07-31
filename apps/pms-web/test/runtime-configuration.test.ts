import { describe, expect, it } from "vitest";
import { createMockGateways } from "../src/gateways/mock/create-mock-gateways.js";

const context = { actorId: "test-admin", correlationId: "corr-runtime" };

describe("runtime deployment contract behavior", () => {
  it("uses desiredState stopped when desiredReplicas is zero", async () => {
    const gateways = createMockGateways("healthy");
    const intent = await gateways.runtime.createDeployment({
      deploymentId: "deploy-test-zero",
      providerId: "ugv-prod-001",
      environment: "production",
      runtimeVersion: "2.0.0-rc.1",
      databaseProfileId: "db-profile-001",
      configProfileId: "production:runtime_deployment:deploy-test-zero:runtime:runtime-main",
      adapterEndpoint: "127.0.0.1:8101",
      desiredReplicas: 0,
    }, context);
    expect(intent.deployment.desiredState).toBe("stopped");
    expect(intent.deployment.desiredReplicas).toBe(0);
  });

  it("accepts only the current desired revision", async () => {
    const gateways = createMockGateways("healthy");
    const deployment = await gateways.runtime.getDeployment("deploy-001", context);
    await expect(gateways.runtime.restartDeployment(deployment.deploymentId, { providerId: deployment.providerId, expectedDesiredRevision: deployment.desiredRevision - 1 }, context)).rejects.toMatchObject({ problem: { code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT", status: 409 } });
    const intent = await gateways.runtime.stopDeployment(deployment.deploymentId, { providerId: deployment.providerId, expectedDesiredRevision: deployment.desiredRevision }, context);
    expect(intent.deployment.desiredState).toBe("stopped");
    expect(intent.deployment.desiredRevision).toBe(deployment.desiredRevision + 1);
  });
});

describe("configuration contract behavior", () => {
  it("validates, publishes and rolls back using explicit concurrency fields", async () => {
    const gateways = createMockGateways("healthy");
    const draft = await gateways.configuration.getDraft("draft-001", context);
    const validated = await gateways.configuration.validateDraft(draft.draftId, context);
    const publication = await gateways.configuration.publishDraft(draft.draftId, { expectedDraftVersion: validated.version, expectedPublishedRevision: 3 }, context);
    expect(publication.outcome).toBe("published");
    const rollback = await gateways.configuration.rollbackDraft(draft.draftId, { expectedDraftVersion: validated.version, expectedPublishedRevision: publication.revision.revision, sourceRevisionId: "223e4567-e89b-42d3-a456-426614174000" }, context);
    expect(rollback.revision.revision).toBe(publication.revision.revision + 1);
  });

  it("returns validation issues for plaintext-secret scenario", async () => {
    const gateways = createMockGateways("configuration-invalid");
    const validated = await gateways.configuration.validateDraft("draft-001", context);
    expect(validated.status).toBe("invalid");
    expect(validated.validationIssues[0]?.code).toBe("PLAINTEXT_SECRET_REJECTED");
  });

  it("supports deterministic no-change publication", async () => {
    const gateways = createMockGateways("configuration-no-change");
    const draft = await gateways.configuration.validateDraft("draft-001", context);
    const result = await gateways.configuration.publishDraft(draft.draftId, { expectedDraftVersion: draft.version, expectedPublishedRevision: 3 }, context);
    expect(result.outcome).toBe("no_change");
  });
});
