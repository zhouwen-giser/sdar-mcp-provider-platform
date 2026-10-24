import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "zmq.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:19106" },
  webServer: {
    command: "node --import tsx apps/ugv-control-console/e2e/zmq-server.ts",
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:19106/health/ready",
    timeout: 30000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
});
