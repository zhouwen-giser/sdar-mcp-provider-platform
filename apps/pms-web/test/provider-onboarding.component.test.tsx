// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PmsWebDataSourceProvider } from "../src/data/context.js";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";
import { ProviderOnboardingPage } from "../src/features/providers/ProviderOnboardingPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Provider onboarding component", () => {
  it("blocks incomplete identity without making a network call", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const network = vi.fn();
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: network });
    await act(() => {
      createRoot(host).render(
        <PmsWebDataSourceProvider
          dataSource={new MockPmsWebDataSource("healthy", { id: () => "fixed" })}
        >
          <ProviderOnboardingPage />
        </PmsWebDataSourceProvider>,
      );
    });
    const next = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "下一步",
    );
    await act(() => next?.click());

    expect(host.textContent).toContain("MOCK_ONBOARDING_BLOCKED");
    expect(host.textContent).toContain("Provider ID 必须使用");
    expect(network).not.toHaveBeenCalled();
  });
});
