import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "site-control.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:19113" },
  webServer: {
    command: "node --import tsx apps/ugv-control-console/e2e/site-control-server.ts",
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:19113/health/ready",
    timeout: 30000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
