// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, DeferredCapability, EmptyState, ErrorState } from "../src/components/ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  document.body.innerHTML = "";
});

describe("product state components", () => {
  it("requires reason and confirmation phrase for high-risk operations", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const confirm = vi.fn();
    await act(() => {
      createRoot(host).render(
        <ConfirmDialog
          title="Stop runtime"
          impact="Scale to zero"
          open
          requirePhrase="deploy-001"
          reasonRequired
          onCancel={vi.fn()}
          onConfirm={confirm}
        />,
      );
    });
    const inputs = host.querySelectorAll("input,textarea");
    await act(() => {
      setNativeValue(inputs[0] as HTMLTextAreaElement, "maintenance");
      setNativeValue(inputs[1] as HTMLInputElement, "deploy-001");
    });
    const button = host.querySelector("button.button-danger") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(() => button.click());
    expect(confirm).toHaveBeenCalledWith("maintenance");
  });

  it("renders deferred, empty and mapped error states", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(() => {
      createRoot(host).render(
        <>
          <DeferredCapability title="Runtime upgrade" reason="No upgrade command">
            <button disabled>Execute unavailable</button>
          </DeferredCapability>
          <EmptyState title="No providers" description="Empty scenario" />
          <ErrorState error={new Error("API_DATA_SOURCE_NOT_CONFIGURED")} />
        </>,
      );
    });
    expect(host.textContent).toContain("DEFERRED");
    expect(host.textContent).toContain("No providers");
    expect(host.textContent).toContain("PMS_API_NOT_CONFIGURED");
  });
});

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter === undefined) throw new Error("native value setter missing");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
