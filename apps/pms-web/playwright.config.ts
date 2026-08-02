import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const configuredExecutable = process.env.PMS_WEB_CHROMIUM_EXECUTABLE;
const knownExecutables = process.platform === "win32"
  ? [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ]
  : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const executablePath = configuredExecutable ?? knownExecutables.find(candidate => existsSync(candidate));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --port 4175",
    url: "http://127.0.0.1:4175/dashboard",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
