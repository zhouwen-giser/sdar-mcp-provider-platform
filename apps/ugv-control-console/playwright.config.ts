import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chromium =
  process.env.UGV_CONSOLE_CHROMIUM ??
  "/home/sz/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 45000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:19105",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      ...(existsSync(chromium) ? { executablePath: chromium } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx e2e/server.ts",
    url: "http://127.0.0.1:19105/health/ready",
    timeout: 30000,
  },
});
