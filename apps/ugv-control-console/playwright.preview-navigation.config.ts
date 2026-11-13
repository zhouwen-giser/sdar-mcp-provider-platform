import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: "preview-navigation.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:19116" },
  webServer: {
    command:
      "pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 19116 --strictPort",
    url: "http://127.0.0.1:19116/",
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
