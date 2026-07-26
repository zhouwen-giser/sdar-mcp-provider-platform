import { describe, expect, it } from "vitest";
import { matchRoute } from "../src/router.js";
import { errorView, loading, packagesView, providersView } from "../src/views.js";

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
});
