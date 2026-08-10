import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const configuredExecutable = process.env.PMS_WEB_CHROMIUM_EXECUTABLE;
const knownExecutables =
  process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      ]
    : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const executablePath =
  configuredExecutable ?? knownExecutables.find((candidate) => existsSync(candidate));
const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: "../../tests/e2e/pms-console-real",
  testMatch: "gate-f.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["line"]],
  outputDir: "../../test-results/pms-console-real",
  use: {
    baseURL: "http://127.0.0.1:4176",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/e2e/pms-console-real/serve-stack.ts",
    cwd: workspaceRoot,
    url: "http://127.0.0.1:4176/health/ready",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
