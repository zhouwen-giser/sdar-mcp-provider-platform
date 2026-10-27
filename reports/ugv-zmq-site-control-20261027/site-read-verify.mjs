import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = fileURLToPath(new URL("./raw/", import.meta.url));
const privateDirectory = process.env.SITE_PRIVATE_DIRECTORY;
const operatorDirectory = process.env.SITE_OPERATOR_DIRECTORY;
if (!privateDirectory || !operatorDirectory) throw Error("PRIVATE_DIRECTORIES_REQUIRED");
const { passwordMatches } = await import(
  resolve(root, "apps/ugv-control-console/server/security.ts")
);
const { Mcp } = await import(resolve(root, "apps/ugv-control-console/server/mcp.ts"));
const credentials = JSON.parse(
  readFileSync(resolve(operatorDirectory, "credentials.json"), "utf8"),
);
const raw = readFileSync(resolve(operatorDirectory, "operator-login.txt"), "utf8");
const password = [
  raw.trim(),
  ...raw.split(/\r?\n/).map((s) => s.replace(/^.*?[:=：]\s*/, "")),
  ...raw.split(/[\s:=：]+/),
].find((p) => p.length >= 8 && passwordMatches(credentials, credentials.username, p));
if (!password) throw Error("OPERATOR_CREDENTIAL_INVALID");
const authorization = readFileSync(
  resolve(privateDirectory, "upstream-authorization"),
  "utf8",
).trim();
const require = createRequire(resolve(root, "apps/ugv-control-console/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({
  executablePath:
    process.env.UGV_CONSOLE_CHROMIUM ??
    "/home/sz/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const summaries = [];
try {
  for (const [name, base, upstream, expectedVersion] of [
    ["candidate", "http://127.0.0.1:19111", "http://127.0.0.1:19110/mcp", "1.2.0"],
    ["formal-readonly", "http://17.26.1.20:19101", "http://127.0.0.1:19100/mcp", "1.1.0"],
  ]) {
    if (process.env.SITE_VERIFY_ONLY && process.env.SITE_VERIFY_ONLY !== name) continue;
    const login = await fetch(base + "/api/session/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ username: credentials.username, password }),
    });
    if (!login.ok) throw Error("HTTP_LOGIN_FAILED");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const get = async (path) => {
      const r = await fetch(base + "/api/" + path, { headers: { cookie } });
      return { status: r.status, value: await r.json() };
    };
    const device = await get("device"),
      state = device.value.data?.vehicle_get_state;
    if (
      device.status !== 200 ||
      device.value.provider?.providerVersion !== expectedVersion ||
      !state ||
      state.archive.status !== "running" ||
      !Object.values(state.channels).every((c) => c.state === "connected" && c.receiptFresh)
    )
      throw Error("LIVE_SUBSCRIPTION_OR_CATALOG_INVALID");
    writeFileSync(out + name + "-observations.json", JSON.stringify(state, null, 2) + "\n");
    const mcp = new Mcp(upstream, { authorization, "x-sdar-execution-mode": "live" });
    const tools = await mcp.rpc("tools/list");
    if (tools.tools?.length !== 13) throw Error("TOOL_COUNT_MISMATCH");
    writeFileSync(out + name + "-catalog.json", JSON.stringify(tools, null, 2) + "\n");
    let anonymousDenied = false;
    try {
      await new Mcp(upstream, { "x-sdar-execution-mode": "live" }).rpc("tools/list");
    } catch {
      anonymousDenied = true;
    }
    if (!anonymousDenied) throw Error("ANONYMOUS_RUNTIME_ACCESS_NOT_REJECTED");
    const tasks = await get("tasks"),
      history = [];
    for (const task of tasks.value) {
      const report = await get("tasks/" + encodeURIComponent(task.taskId) + "/report");
      history.push({
        taskId: task.taskId,
        status: report.status,
        businessReadable: !!report.value.business,
        reasonCode: report.value.reasonCode ?? report.value.missingBusinessReason ?? null,
        responseSha256: createHash("sha256").update(JSON.stringify(report.value)).digest("hex"),
      });
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "进入控制台 →" }).click();
    await page.getByRole("heading", { name: "设备观测与路线预览", exact: true }).waitFor();
    if (expectedVersion === "1.2.0")
      await page.getByRole("heading", { name: "现场设备控制", exact: true }).waitFor();
    await page.screenshot({ path: out + name + "-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: out + name + "-mobile.png", fullPage: true });
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    if (errors.length || width.document > width.viewport) {
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map((e) => ({
            tag: e.tagName,
            className: e.className,
            text: e.textContent?.slice(0, 100),
          })),
      );
      writeFileSync(
        out + name + "-browser-diagnostic.json",
        JSON.stringify({ width, errors, overflow }, null, 2) + "\n",
      );
      throw Error("BROWSER_CHECK_FAILED_" + JSON.stringify({ name, width, errors }));
    }
    await page.close();
    summaries.push({
      at: new Date().toISOString(),
      name,
      base,
      checkLocation: "host; formal uses actual LAN address, independent remote client not tested",
      provider: device.value.provider,
      tools: tools.tools.map((t) => t.name),
      anonymousDenied,
      controlAdmission: device.value.data.vehicle_get_capabilities?.controlAdmission,
      channels: state.channels,
      archive: state.archive,
      history,
      width,
      pageErrors: errors,
      deviceCommandsSentByProbe: 0,
    });
  }
} finally {
  await browser.close();
}
writeFileSync(out + "site-read-verification.json", JSON.stringify(summaries, null, 2) + "\n");
console.log(
  JSON.stringify(
    summaries.map(({ name, provider, width, history }) => ({ name, provider, width, history })),
  ),
);
