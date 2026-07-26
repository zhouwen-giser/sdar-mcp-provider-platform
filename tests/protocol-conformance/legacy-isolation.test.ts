import { describe, expect, it, vi } from "vitest";
import { ProtocolRouter } from "../../packages/mcp-protocol/src/index.js";

describe("legacy protocol isolation", () => {
  it("always routes /mcp to frozen and disables /mcp/legacy by default", () => {
    const frozen = { handle: vi.fn() };
    const legacy = { handle: vi.fn() };
    const router = new ProtocolRouter(frozen, legacy, false);
    expect(router.handler("/mcp")).toBe(frozen);
    expect(router.handler("/mcp/legacy")).toBeUndefined();
  });

  it("exposes legacy only on its explicit endpoint when enabled", () => {
    const frozen = { handle: vi.fn() };
    const legacy = { handle: vi.fn() };
    const router = new ProtocolRouter(frozen, legacy, true);
    expect(router.handler("/mcp")).toBe(frozen);
    expect(router.handler("/mcp/legacy")).toBe(legacy);
    expect(router.handler("/other")).toBeUndefined();
  });
});
