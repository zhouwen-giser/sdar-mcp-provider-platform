import { describe, expect, it } from "vitest";
import {
  rehydrateRuntimeDeployment,
  type RuntimeDeploymentSnapshot,
} from "@sdar/runtime-deployment";
import {
  RuntimeDeploymentApplicationService,
  type RuntimeDeploymentApplicationRepositories,
  type RuntimeDeploymentPrerequisitePort,
} from "../src/index.js";

const audit = { actorId: "admin-1", correlationId: "request-1" };
const now = new Date("2026-07-26T00:00:00.000Z");

describe("RuntimeDeployment application use cases", () => {
  it("validates Provider, config profile, and database profile before creation", async () => {
    for (const unavailable of ["provider", "config", "database"] as const) {
      const harness = createHarness(unavailable);
      await expect(
        harness.service.create(createInput("deployment-invalid"), audit),
      ).rejects.toMatchObject({
        code: {
          provider: "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE",
          config: "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE",
          database: "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE",
        }[unavailable],
      });
      expect(harness.deployments.size).toBe(0);
    }
  });

  it("creates desired state, enqueues reconcile, and appends Audit atomically", async () => {
    const harness = createHarness();
    const created = await harness.service.create(createInput("deployment-create"), audit);

    expect(created).toMatchObject({
      desiredState: "running",
      desiredReplicas: 1,
      status: "REQUESTED",
      desiredRevision: 0,
      observedRevision: 0,
    });
    expect(harness.jobs).toEqual([
      expect.objectContaining({
        jobType: "runtime_deployment.reconcile",
        payload: {
          deploymentId: "deployment-create",
          providerId: "provider:A",
          intent: "create",
          correlationId: "request-1",
        },
      }),
    ]);
    expect(harness.audits).toEqual([
      expect.objectContaining({
        action: "runtime_deployment.created",
        subjectId: "deployment-create",
        metadata: { desiredReplicas: 1 },
      }),
    ]);
  });

  it("uses draining desired state for stop and never changes observed lifecycle directly", async () => {
    const harness = createHarness();
    await harness.service.create(createInput("deployment-stop"), audit);
    const stopped = await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-stop",
        command: "stop",
        expectedDesiredRevision: 0,
      },
      audit,
    );

    expect(stopped).toMatchObject({
      desiredState: "draining",
      desiredReplicas: 0,
      desiredRevision: 1,
      status: "REQUESTED",
      observedRevision: 0,
    });
    expect(harness.jobs.at(-1)).toMatchObject({ payload: { intent: "stop" } });
    expect(harness.audits.at(-1)).toMatchObject({
      action: "runtime_deployment.stop_requested",
    });
  });

  it("enqueues start, restart, scale, and reconcile intents with optimistic desired revisions", async () => {
    const harness = createHarness();
    await harness.service.create(createInput("deployment-commands"), audit);
    const draining = await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-commands",
        command: "scale",
        desiredReplicas: 0,
        expectedDesiredRevision: 0,
      },
      audit,
    );
    const running = await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-commands",
        command: "start",
        expectedDesiredRevision: draining.desiredRevision,
      },
      audit,
    );
    const restarted = await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-commands",
        command: "restart",
        expectedDesiredRevision: running.desiredRevision,
      },
      audit,
    );
    const reconciled = await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-commands",
        command: "reconcile",
        expectedDesiredRevision: restarted.desiredRevision,
      },
      audit,
    );

    expect(reconciled).toMatchObject({
      desiredState: "running",
      desiredReplicas: 1,
      desiredRevision: 2,
      status: "REQUESTED",
    });
    expect(harness.jobs.map(({ payload }) => payload.intent)).toEqual([
      "create",
      "scale",
      "start",
      "restart",
      "reconcile",
    ]);
  });

  it("rejects replicas above one without a stable gateway", async () => {
    const harness = createHarness();
    await expect(
      harness.service.create({ ...createInput("deployment-replicas"), desiredReplicas: 2 }, audit),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED" });
    await harness.service.create(createInput("deployment-scale"), audit);
    await expect(
      harness.service.command(
        {
          providerId: "provider:A",
          deploymentId: "deployment-scale",
          command: "scale",
          desiredReplicas: 2,
          expectedDesiredRevision: 0,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_REPLICA_COUNT_UNSUPPORTED" });
  });

  it("rejects stale revisions and cross-Provider deployment access", async () => {
    const harness = createHarness();
    await harness.service.create(createInput("deployment-scope"), audit);
    await expect(
      harness.service.command(
        {
          providerId: "provider:B",
          deploymentId: "deployment-scope",
          command: "reconcile",
          expectedDesiredRevision: 0,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_NOT_FOUND" });
    await harness.service.command(
      {
        providerId: "provider:A",
        deploymentId: "deployment-scope",
        command: "stop",
        expectedDesiredRevision: 0,
      },
      audit,
    );
    await expect(
      harness.service.command(
        {
          providerId: "provider:A",
          deploymentId: "deployment-scope",
          command: "reconcile",
          expectedDesiredRevision: 0,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" });
  });
});

function createInput(deploymentId: string) {
  return {
    deploymentId,
    providerId: "provider:A",
    environment: "production",
    runtimeVersion: "2.0.0-rc.1",
    databaseProfileId: "database-profile-1",
    configProfileId: "config-profile-1",
    adapterEndpoint: "127.0.0.1:50051",
  };
}

function createHarness(unavailable?: "provider" | "config" | "database") {
  const deployments = new Map<string, RuntimeDeploymentSnapshot>();
  const jobs: {
    readonly jobId: string;
    readonly jobType: string;
    readonly payload: Record<string, unknown>;
  }[] = [];
  const audits: {
    readonly action: string;
    readonly subjectId: string;
    readonly metadata: Record<string, unknown>;
  }[] = [];
  const repositories: RuntimeDeploymentApplicationRepositories = {
    deployments: {
      get: (providerId, deploymentId) => {
        const value = deployments.get(deploymentId);
        return Promise.resolve(
          value?.providerId === providerId ? rehydrateRuntimeDeployment(value) : null,
        );
      },
      insert: (value) => {
        deployments.set(value.deploymentId, value);
        return Promise.resolve();
      },
      save: (value) => {
        deployments.set(value.deploymentId, value);
        return Promise.resolve(true);
      },
    },
    jobs: {
      enqueue: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
    audit: {
      append: (event) => {
        audits.push({ action: event.action, subjectId: event.subjectId, metadata: event.metadata });
        return Promise.resolve();
      },
      list: () => Promise.resolve({ items: [] }),
    },
  };
  const prerequisites: RuntimeDeploymentPrerequisitePort = {
    providerAvailable: () => Promise.resolve(unavailable !== "provider"),
    configProfileAvailable: () => Promise.resolve(unavailable !== "config"),
    databaseProfileAvailable: () => Promise.resolve(unavailable !== "database"),
  };
  let sequence = 0;
  const service = new RuntimeDeploymentApplicationService(
    { transaction: (work) => work(repositories) },
    prerequisites,
    {
      now: () => now,
      newId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    },
  );
  return { service, deployments, jobs, audits };
}
