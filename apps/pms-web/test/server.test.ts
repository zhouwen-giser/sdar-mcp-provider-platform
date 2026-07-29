import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPmsWebServer } from "../src/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PMS Web static server", () => {
  it("serves built assets, SPA fallback, health, API base, and security headers", async () => {
    const root = await fixture();
    const server = await createPmsWebServer({
      root,
      apiBase: "https://pms.example.test/api/",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("TEST_ADDRESS_MISSING");
    const base = `http://127.0.0.1:${String(address.port)}`;
    try {
      for (const path of ["/", "/providers/one"]) {
        const response = await fetch(`${base}${path}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain(
          'name="pms-api-base" content="https://pms.example.test/api"',
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      }
      await expect(fetch(`${base}/assets/main.js`).then((value) => value.text())).resolves.toBe(
        "globalThis.__pms = true;\n",
      );
      await expect(fetch(`${base}/styles.css`).then((value) => value.text())).resolves.toBe(
        "body { color: white; }\n",
      );
      for (const path of ["/health/live", "/health/ready"]) {
        await expect(fetch(`${base}${path}`).then((value) => value.json())).resolves.toEqual({
          status: "ok",
        });
      }
      expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pms-web-server-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  await Promise.all([
    writeFile(
      join(root, "index.html"),
      '<meta name="pms-api-base" content="" /><div id="app"></div>\n',
    ),
    writeFile(join(root, "assets/main.js"), "globalThis.__pms = true;\n"),
    writeFile(join(root, "styles.css"), "body { color: white; }\n"),
  ]);
  return root;
}
