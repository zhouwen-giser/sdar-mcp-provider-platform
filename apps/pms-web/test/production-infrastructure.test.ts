import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTRACT_OPENAPI_SHA256, CONTRACT_STATUS, CONTRACT_VERSION } from "../src/api/types.js";
import { toUiProblem } from "../src/shared/errors/ui-problem.js";

describe("production infrastructure", () => {
  it("pins the frozen contract", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
    expect(CONTRACT_STATUS).toBe("frozen");
    expect(CONTRACT_OPENAPI_SHA256).toHaveLength(64);
  });

  it("maps gateway failures to stable UI problems", () => {
    expect(toUiProblem(new Error("API_DATA_SOURCE_NOT_CONFIGURED")).code).toBe(
      "PMS_API_NOT_CONFIGURED",
    );
  });

  it("guards prototype routes and rejects generic public pages", () => {
    const router = readFileSync(resolve(process.cwd(), "src/app/router.tsx"), "utf8");
    expect(router).toContain("import.meta.env.DEV");
    expect(router).toContain("prototypeRoutes");
    expect(router).not.toMatch(/StructuredPlaceholder|PlatformPage|GenericRoute/);
  });
});
