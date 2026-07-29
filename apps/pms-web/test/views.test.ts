import { describe, expect, it } from "vitest";
import { configurationDraftInput } from "../src/app.js";
import { RUNTIME_BOOTSTRAP_FIELDS } from "../src/configuration-metadata.js";
import { matchRoute } from "../src/router.js";
import {
  configurationView,
  auditView,
  catalogView,
  errorView,
  loading,
  packagesView,
  providersView,
  registryView,
  runtimeView,
} from "../src/views.js";

describe("PMS Web routes and views", () => {
  it("matches list, detail, Package, and environment Resource routes", () => {
    expect(matchRoute("/providers")).toEqual({ page: "providers" });
    expect(matchRoute("/providers/provider%3Aone")).toEqual({
      page: "provider",
      providerId: "provider:one",
    });
    expect(matchRoute("/packages")).toEqual({ page: "packages" });
    expect(matchRoute("/resources", "?environment=staging")).toEqual({
      page: "resources",
      environment: "staging",
    });
    expect(matchRoute("/configuration", "?draftId=draft-1")).toEqual({
      page: "configuration",
      draftId: "draft-1",
    });
    expect(matchRoute("/runtime", "?providerId=p-1&deploymentId=d-1")).toEqual({
      page: "runtime",
      providerId: "p-1",
      deploymentId: "d-1",
    });
    expect(matchRoute("/catalog", "?environment=staging&providerId=p-1")).toEqual({
      page: "catalog",
      environment: "staging",
      providerId: "p-1",
    });
    expect(matchRoute("/registry", "?environment=production&fromRevision=1&toRevision=2")).toEqual({
      page: "registry",
      environment: "production",
      fromRevision: 1,
      toRevision: 2,
    });
    expect(matchRoute("/audit", "?subjectType=runtime&correlationId=trace-1")).toEqual({
      page: "audit",
      subjectType: "runtime",
      correlationId: "trace-1",
    });
  });

  it("labels component evidence and real-resource qualification without conflating them", () => {
    const html = packagesView([
      {
        packageId: "builtin.test",
        packageVersion: "1.0.0",
        providerType: "test.provider",
        hostingModes: ["vendor_managed"],
        compatibleRuntimeVersion: "2.0.0",
        protocolMode: "frozen_v1",
        qualification: { componentStatus: "passed", realResourceStatus: "pending" },
      },
    ]);

    expect(html).toContain("Component: passed");
    expect(html).toContain("Real resource: pending");
    expect(html).toContain("does not certify");
    expect(html).not.toContain("Interop Certified");
  });

  it("renders a usable create form with vendor_managed as the default", () => {
    const html = providersView([]);
    expect(html).toContain('data-form="create-provider"');
    expect(html.indexOf('value="vendor_managed"')).toBeLessThan(
      html.indexOf('value="platform_managed"'),
    );
    expect(html).not.toMatch(/password|secret|database.?url/i);
  });

  it("renders explicit loading and stable error states", () => {
    expect(loading("Providers")).toContain('aria-busy="true"');
    expect(errorView("Providers", "<unsafe>")).toContain("&lt;unsafe&gt;");
    expect(errorView("Providers", "<unsafe>")).not.toContain("<unsafe>");
  });

  it("renders metadata-driven SecretRef fields without a secret value", () => {
    const html = configurationView(
      RUNTIME_BOOTSTRAP_FIELDS,
      {
        draftId: "draft-1",
        definitionId: "runtime.bootstrap",
        environment: "production",
        targetType: "runtime_deployment",
        targetId: "deployment-1",
        configGroup: "runtime.bootstrap",
        dataId: "runtime",
        version: 2,
        status: "validated",
        applyMode: "restart_required",
        configuredKeys: ["DATABASE_URL_FILE", "PORT"],
        secretConfiguredKeys: ["DATABASE_URL_FILE"],
        validationIssues: [],
      },
      {
        applyMode: "restart_required",
        valid: true,
        keys: ["DATABASE_URL_FILE", "PORT"],
        sources: { "/DATABASE_URL_FILE": "runtime_deployment" },
      },
    );

    expect(html).toContain('name="config:DATABASE_URL_FILE"');
    expect(html).toContain("SecretRef configured");
    expect(html).toContain("Restart required");
    expect(html).toContain('data-danger="Publish this configuration revision?');
    expect(html).not.toContain("postgresql://");
  });

  it("serializes secret fields as SecretRef objects", () => {
    const data = new FormData();
    data.set("draftId", "draft-1");
    data.set("targetId", "deployment-1");
    data.set("environment", "production");
    data.set("config:PORT", "8080");
    data.set("config:DATABASE_URL_FILE", "/run/secrets/runtime-database-url");

    expect(configurationDraftInput(data).content).toEqual({
      PORT: 8080,
      DATABASE_URL_FILE: { secretRef: "/run/secrets/runtime-database-url" },
    });
  });

  it("separates PM2, liveness, readiness, governed health, and config ACK", () => {
    const html = runtimeView(
      "provider-1",
      [
        {
          deploymentId: "deployment-1",
          providerId: "provider-1",
          environment: "production",
          desiredState: "running",
          desiredReplicas: 1,
          runtimeVersion: "0.1.0",
          status: "HEALTH_CHECKING",
          desiredRevision: 3,
          observedRevision: 2,
        },
      ],
      [
        {
          instanceId: "instance-1",
          deploymentId: "deployment-1",
          processState: "online",
          livenessState: "live",
          readinessState: "not_ready",
          observedHealth: "NOT_READY",
          readyForActive: false,
          healthReasonCode: "READINESS_FAILED",
          configState: "restart_required",
          configRevision: 4,
          runtimeVersion: "0.1.0",
          restartCount: 0,
        },
      ],
      "deployment-1",
    );

    expect(html).toContain("PM2 online ≠ Runtime ACTIVE");
    expect(html).toContain("not_ready");
    expect(html).toContain("READINESS_FAILED");
    expect(html).toContain("Config ACK");
    expect(html).toContain('data-danger="Stop Runtime deployment-1?"');
    expect(html).toContain('data-danger="Restart Runtime deployment-1?"');
  });

  it("renders authoritative Catalog schemas in a read-only viewer", () => {
    const html = catalogView("production", [
      {
        providerId: "provider-1",
        serverId: "server-1",
        protocolMode: "frozen_v1",
        catalogRevision: 3,
        tools: [
          {
            name: "observe",
            description: "Observe safely",
            inputSchema: { type: "object", properties: { resourceId: { type: "string" } } },
            outputSchema: { type: "object" },
            taskBehavior: "synchronous_only",
            resourceBindingMode: "ARGUMENT_REFERENCE",
          },
        ],
      },
    ]);

    expect(html).toContain("server/discover + tools/list");
    expect(html).toContain("Input schema");
    expect(html).toContain("resourceId");
    expect(html).not.toMatch(/textarea|contenteditable/i);
  });

  it("renders safe Registry diff/history and traceable Audit filters", () => {
    const registry = registryView(
      "production",
      [
        {
          environment: "production",
          revision: 2,
          checksum: "a".repeat(64),
          publishedAt: "2026-07-27T00:00:00.000Z",
          providers: [],
        },
      ],
      {
        environment: "production",
        fromRevision: 1,
        toRevision: 2,
        addedProviderIds: ["provider-2"],
        removedProviderIds: [],
        changedProviderIds: ["provider-1"],
      },
    );
    const audit = auditView(
      [
        {
          auditEventId: "audit-1",
          action: "runtime.restart",
          actorId: "admin-1",
          correlationId: "trace-1",
          subjectType: "runtime_deployment",
          subjectId: "deployment-1",
          occurredAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      { correlationId: "trace-1" },
    );

    expect(registry).toContain("provider-2");
    expect(registry).toContain(`${"a".repeat(16)}…`);
    expect(registry).not.toMatch(/effectiveEndpoint|credential|secret/i);
    expect(audit).toContain("trace-1");
    expect(audit).toContain("admin-1");
    expect(audit).toContain('name="correlationId"');
  });
});
