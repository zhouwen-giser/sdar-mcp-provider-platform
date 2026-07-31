// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, DeferredCapability, EmptyState, ErrorState } from "../src/components/ui.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });

describe("product state components", () => {
  it("requires reason and confirmation phrase for high-risk operations", async () => {
    const host=document.createElement("div");document.body.append(host);const confirm=vi.fn();
    await act(()=>{createRoot(host).render(<ConfirmDialog title="Stop runtime" impact="Scale to zero" open requirePhrase="deploy-001" reasonRequired onCancel={vi.fn()} onConfirm={confirm}/>)});
    const inputs=host.querySelectorAll("input,textarea");
    await act(()=>{(inputs[0] as HTMLTextAreaElement).value="maintenance";(inputs[0] as HTMLTextAreaElement).dispatchEvent(new Event("input",{bubbles:true}));(inputs[1] as HTMLInputElement).value="deploy-001";(inputs[1] as HTMLInputElement).dispatchEvent(new Event("input",{bubbles:true}))});
    const button=[...host.querySelectorAll("button")].find(item=>item.textContent?.includes("确认执行"));
    await act(()=>button?.click());
    expect(confirm).toHaveBeenCalledWith("maintenance");
  });

  it("renders deferred, empty and mapped error states", async () => {
    const host=document.createElement("div");document.body.append(host);
    await act(()=>{createRoot(host).render(<><DeferredCapability title="Runtime upgrade" reason="No upgrade command"><button disabled>Execute unavailable</button></DeferredCapability><EmptyState title="No providers" description="Empty scenario"/><ErrorState error={new Error("API_DATA_SOURCE_NOT_CONFIGURED")}/></>)});
    expect(host.textContent).toContain("DEFERRED");
    expect(host.textContent).toContain("No providers");
    expect(host.textContent).toContain("PMS_API_NOT_CONFIGURED");
  });
});
