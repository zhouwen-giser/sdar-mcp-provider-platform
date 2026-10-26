import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const report = fileURLToPath(new URL("./raw/", import.meta.url));
const require = createRequire(resolve(root, "apps/ugv-control-console/package.json"));
const { chromium } = require("@playwright/test");
const { passwordMatches } = await import(
  resolve(root, "apps/ugv-control-console/server/security.ts")
);
const privateDirectory = process.env.SITE_CONSOLE_PRIVATE_DIRECTORY;
if (!privateDirectory) throw Error("PRIVATE_CONSOLE_DIRECTORY_REQUIRED");
const credentials = JSON.parse(readFileSync(resolve(privateDirectory, "credentials.json"), "utf8"));
const raw = readFileSync(resolve(privateDirectory, "operator-login.txt"), "utf8");
const password = [
  raw.trim(),
  ...raw.split(/\r?\n/).map((s) => s.replace(/^.*?[:=：]\s*/, "")),
  ...raw.split(/[\s:=：]+/),
].find((p) => p.length >= 8 && passwordMatches(credentials, credentials.username, p));
if (!password) throw Error("CREDENTIAL_READ_FAILED");
const base = "http://127.0.0.1:19111";
const startedAt = new Date().toISOString();
const login = await fetch(base + "/api/session/login", {
  method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ username: credentials.username, password }),
});
if (!login.ok) throw Error("SITE_LOGIN_FAILED");
const cookie = login.headers.get("set-cookie").split(";")[0];
const read = async (path) => {
  const r = await fetch(base + "/api/" + path, { headers: { cookie } });
  return { status: r.status, value: await r.json() };
};
const device = await read("device");
writeFileSync(
  report + "site-device-final.json",
  JSON.stringify({ observedAt: new Date().toISOString(), ...device }, null, 2) + "\n",
);
const commands = await read("commands");
const old = commands.value.find((c) => c.commandId === "e004747d-db93-44fd-b3e0-4b9cfaef2b77");
const preview = old?.response?.structuredContent;
const retainedPreview = {
  commandId: old?.commandId,
  status: old?.status,
  taskId: old?.taskId,
  previewId: preview?.previewId,
  sourceHashValid:
    preview &&
    createHash("sha256").update(preview.sourceMessage).digest("hex") ===
      preview.sourceMessageSha256,
};
const tasks = await read("tasks");
const history = [];
for (const task of tasks.value) {
  const r = await read("tasks/" + encodeURIComponent(task.taskId) + "/report");
  history.push({
    taskId: task.taskId,
    status: r.status,
    businessReadable: !!r.value.business,
    missingBusinessReason: r.value.missingBusinessReason ?? null,
  });
}
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.UGV_CONSOLE_CHROMIUM,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let planning;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(base);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await page.getByRole("heading", { name: "设备观测与路线预览" }).waitFor();
  const fillPosition = page.getByRole("button", { name: "填入当前接收位置" });
  let startProvenance;
  if (await fillPosition.isEnabled()) {
    await fillPosition.click();
    startProvenance = "fresh_received_localization_source_clock_unverified";
  } else {
    await page.getByLabel("预览起点").fill("lon: 106.81307318, lat: 29.71952521");
    startProvenance = "operator_historical_coordinate_not_current_GNSS";
  }
  await page.getByLabel("预览目的地与途经点").fill("lon: 106.81283082, lat: 29.72057535");
  const wait = page.waitForResponse(
    (r) => r.url().endsWith("/api/commands") && r.request().method() === "POST",
    { timeout: 12000 },
  );
  await page.getByRole("button", { name: "预览路线", exact: true }).click();
  const response = await wait;
  const command = await response.json();
  const value = command.response?.structuredContent;
  if (command.status === "completed")
    await page.getByText("路线预览已生成 · 尚未采用", { exact: true }).waitFor();
  else await page.getByRole("alert").waitFor();
  const alerts = await page.getByRole("alert").allTextContents();
  planning = {
    status: response.status(),
    commandId: command.commandId,
    commandStatus: command.status,
    taskId: command.taskId,
    startProvenance,
    reasonCode: value?.reasonCode ?? command.reasonCode ?? null,
    points: value?.waypoints?.length ?? 0,
    adoption: value?.adoption ?? null,
    alerts,
    stopDisabled: await page.getByRole("button", { name: "■ 停止不可用 · 只读模式" }).isDisabled(),
  };
  writeFileSync(report + "site-browser-plan-final.json", JSON.stringify(command, null, 2) + "\n");
  await page.screenshot({ path: report + "site-console-final.png", fullPage: true });
} finally {
  await browser.close();
}
const result = {
  schemaVersion: "ugv.zmq-site-browser-check/1",
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceCommit: require("node:child_process")
    .execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
    .trim(),
  url: base,
  login: login.status,
  device: device.status,
  retainedPreview,
  history,
  planning,
};
writeFileSync(report + "site-browser-final.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
