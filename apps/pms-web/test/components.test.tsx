// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, DetailDrawer } from "../src/components/ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("overlay components", () => {
  it("closes a drawer with Escape and returns focus", async () => {
    const trigger = document.createElement("button");
    const host = document.createElement("div");
    document.body.append(trigger, host);
    trigger.focus();
    const close = vi.fn();
    await act(() => {
      createRoot(host).render(
        <DetailDrawer title="Detail" open onClose={close} returnFocus={trigger}>
          content
        </DetailDrawer>,
      );
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires an explicit confirm button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const confirm = vi.fn();
    await act(() => {
      createRoot(host).render(
        <ConfirmDialog
          title="Confirm"
          impact="Mock only"
          open
          onCancel={vi.fn()}
          onConfirm={confirm}
        />,
      );
    });
    const button = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("确认"),
    );
    button?.click();
    expect(confirm).toHaveBeenCalledOnce();
  });
});
