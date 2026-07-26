import { describe, expect, it } from "vitest";
import {
  auditEventId,
  configRevisionId,
  createAuditEvent,
  createConfigRevision,
  createProvider,
  createProviderPackage,
  environmentId,
  providerId,
  providerPackageId,
  ProviderResourceBindings,
  providerTypeId,
  resourceId,
  transitionConfigRevision,
  transitionProvider,
} from "../src/index.js";

const providerType = providerTypeId("isr.vehicle.ugv");
const firstProvider = providerId("isr.vehicle.ugv.ugv1");
const secondProvider = providerId("isr.vehicle.ugv.ugv2");
const environment = environmentId("production");
const firstResource = resourceId("vehicle:ugv1");
const secondResource = resourceId("vehicle:ugv2");

describe("PMS control-plane domain", () => {
  it("constructs branded identifiers and rejects malformed values", () => {
    expect(providerType).toBe("isr.vehicle.ugv");
    expect(() => providerTypeId("UGV")).toThrow(
      expect.objectContaining({ code: "INVALID_IDENTIFIER" }),
    );
    expect(() => configRevisionId("not-a-uuid")).toThrow(
      expect.objectContaining({ code: "INVALID_IDENTIFIER" }),
    );
  });

  it("defaults Provider hosting to vendor-managed", () => {
    const provider = createProvider({
      providerId: firstProvider,
      providerTypeId: providerType,
    });

    expect(provider).toMatchObject({ hostingMode: "vendor_managed", status: "draft" });
  });

  it("requires explicit platform-managed hosting", () => {
    expect(
      createProvider({
        providerId: firstProvider,
        providerTypeId: providerType,
        hostingMode: "platform_managed",
      }).hostingMode,
    ).toBe("platform_managed");
  });

  it("models Provider to Resource as a true many-to-many binding", () => {
    const bindings = new ProviderResourceBindings();
    bindings.bind({
      providerId: firstProvider,
      environment,
      resourceId: firstResource,
      boundAt: now(),
    });
    bindings.bind({
      providerId: firstProvider,
      environment,
      resourceId: secondResource,
      boundAt: now(),
    });
    bindings.bind({
      providerId: secondProvider,
      environment,
      resourceId: firstResource,
      boundAt: now(),
    });

    expect(bindings.forProvider(firstProvider)).toHaveLength(2);
    expect(bindings.forResource(environment, firstResource)).toHaveLength(2);
    expect(bindings.all()).toHaveLength(3);
  });

  it("rejects duplicate bindings and missing unbinds", () => {
    const bindings = new ProviderResourceBindings([
      { providerId: firstProvider, environment, resourceId: firstResource, boundAt: now() },
    ]);

    expect(() =>
      bindings.bind({
        providerId: firstProvider,
        environment,
        resourceId: firstResource,
        boundAt: now(),
      }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_RESOURCE_BINDING" }));
    expect(() => bindings.unbind(secondProvider, environment, firstResource)).toThrow(
      expect.objectContaining({ code: "RESOURCE_BINDING_NOT_FOUND" }),
    );
  });

  it("enforces Provider lifecycle transitions and retired terminal state", () => {
    const draft = createProvider({
      providerId: firstProvider,
      providerTypeId: providerType,
    });
    const active = transitionProvider(draft, "active");
    const retired = transitionProvider(active, "retired");

    expect(active.status).toBe("active");
    expect(() => transitionProvider(draft, "degraded")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
    expect(() => transitionProvider(retired, "active")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
  });

  it("enforces immutable Config Revision lifecycle", () => {
    const draft = configRevision();
    const validated = transitionConfigRevision(draft, "validated");
    const published = transitionConfigRevision(validated, "published");
    const superseded = transitionConfigRevision(published, "superseded");

    expect(superseded.status).toBe("superseded");
    expect(() => transitionConfigRevision(draft, "published")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
    expect(() => transitionConfigRevision(superseded, "published")).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
  });

  it("validates Package versions, hosting modes, and checksums", () => {
    expect(
      createProviderPackage({
        packageId: providerPackageId("builtin.isr.vehicle.ugv"),
        packageVersion: "1.0.0",
        providerTypeId: providerType,
        hostingModes: ["vendor_managed", "platform_managed"],
        checksum: "a".repeat(64),
        status: "available",
      }).hostingModes,
    ).toEqual(["vendor_managed", "platform_managed"]);
    expect(() =>
      createProviderPackage({
        packageId: providerPackageId("builtin.isr.vehicle.ugv"),
        packageVersion: "latest",
        providerTypeId: providerType,
        hostingModes: ["vendor_managed"],
        checksum: "a".repeat(64),
        status: "available",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
  });

  it("creates append-only-shaped audit values without infrastructure types", () => {
    const event = createAuditEvent({
      auditEventId: auditEventId("11111111-1111-4111-8111-111111111111"),
      action: "provider.created",
      actorId: "admin-1",
      correlationId: "request-1",
      subjectType: "provider",
      subjectId: firstProvider,
      occurredAt: now(),
      metadata: { hostingMode: "vendor_managed" },
    });

    expect(event).toMatchObject({ action: "provider.created", subjectId: firstProvider });
    expect(Object.isFrozen(event)).toBe(true);
  });
});

function configRevision() {
  return createConfigRevision({
    revisionId: configRevisionId("22222222-2222-4222-8222-222222222222"),
    target: {
      environment,
      targetType: "provider",
      targetId: firstProvider,
      configGroup: "provider.ugv",
      dataId: "runtime",
    },
    revision: 1,
    checksum: "b".repeat(64),
    applyMode: "restart_required",
    status: "draft",
    content: { OTEL_ENABLED: false },
    createdAt: now(),
  });
}

function now(): Date {
  return new Date("2026-07-26T00:00:00.000Z");
}
