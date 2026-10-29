import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "site-control-v14.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:19115" },
  webServer: {
    env: { SMPP_ZMQ_UI_V14: "true" },
    command: "node --import tsx apps/ugv-control-console/e2e/site-control-server.ts",
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:19115/health/ready",
    timeout: 30000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
