import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "v15-frames.spec.ts",
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:19116",
    launchOptions: {
      ...base.use?.launchOptions,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
    },
  },
  webServer: {
    env: { SMPP_ZMQ_UI_V15: "true" },
    command: "node --import tsx apps/ugv-control-console/e2e/site-control-server.ts",
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:19116/health/ready",
    timeout: 30000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
