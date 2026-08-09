import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiBaseUrl = process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090";
const environment = "home-lab";
const tokenPath = resolve(root, ".local/pms-continuation/secrets/pms-management.token");
const reportPath = resolve(
  root,
  "reports/real-device-preparation-continuation/live-registry-contract.json",
);

const report = {
  evidenceClass: "real",
  phase: "C5_LIVE_REGISTRY_CONTRACT",
  status: "blocked",
  environment,
  observedAt: new Date().toISOString(),
  source: "live PMS Registry API",
  checks: {},
  registry: null,
  errors: [],
};

try {
  const token = (await readFile(tokenPath, "utf8")).trim();
  if (token.length === 0) throw new Error("PMS_MANAGEMENT_TOKEN_EMPTY");
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  const latest = await json(`${apiBaseUrl}/api/v1/registry/${environment}/latest`, headers);
  const latestBody = isObject(latest.body) ? latest.body : {};
  const revision = integer(latestBody.revision);
  const checksum = string(latestBody.checksum);
  const providers = Array.isArray(latestBody.document?.providers)
    ? latestBody.document.providers.filter(isObject)
    : [];
  const sensitive = inspectSensitive(latestBody);

  const bootstrap = await json(`${apiBaseUrl}/api/v1/registry/${environment}/bootstrap`, headers);
  const bootstrapBody = isObject(bootstrap.body) ? bootstrap.body : {};
  const bootstrapSnapshot = isObject(bootstrapBody.snapshot) ? bootstrapBody.snapshot : {};
  const history = await json(
    `${apiBaseUrl}/api/v1/registry/${environment}/history?limit=10`,
    headers,
  );
  const historyItems = Array.isArray(history.body?.items) ? history.body.items : [];
  const revisions = historyItems.map((item) => integer(item?.revision)).filter(Number.isInteger);
  const diff =
    revision !== null && revision > 1
      ? await json(
          `${apiBaseUrl}/api/v1/registry/${environment}/diff?fromRevision=${revision - 1}&toRevision=${revision}`,
          headers,
        )
      : { status: 400, body: null };
  const conditional = await fetch(`${apiBaseUrl}/api/v1/registry/${environment}/latest`, {
    headers: { ...headers, "if-none-match": latest.etag ?? "" },
  });
  const watch = await probeWatch(`${apiBaseUrl}/api/v1/registry/${environment}/watch`, headers);

  const checks = {
    latest: latest.status === 200,
    bootstrap: bootstrap.status === 200,
    history: history.status === 200 && revisions.length > 0,
    historyMonotonic: revisions.every(
      (value, index) => index === 0 || value < revisions[index - 1],
    ),
    diff: diff.status === 200,
    etag: typeof latest.etag === "string" && latest.etag.length > 0,
    ifNoneMatch: conditional.status === 304,
    watch: watch.status === 200 && watch.firstEvent,
    checksum: checksum !== null && bootstrapSnapshot.checksum === checksum,
    providerCount: providers.length === 2,
    noSecretKeys: !sensitive.containsSecretKeys,
    noEntityIdKeys: !sensitive.containsEntityIdKeys,
  };
  report.checks = checks;
  report.registry = {
    revision,
    checksum,
    etag: latest.etag,
    bootstrapChecksum: string(bootstrapSnapshot.checksum),
    historyCount: historyItems.length,
    historyRevisions: revisions,
    providerIds: providers.map((provider) => provider.providerId ?? null),
    latestStatus: latest.status,
    bootstrapStatus: bootstrap.status,
    historyStatus: history.status,
    diffStatus: diff.status,
    conditionalStatus: conditional.status,
    watchStatus: watch.status,
    watchContentType: watch.contentType,
  };
  report.status = Object.values(checks).every(Boolean) ? "passed" : "blocked";
} catch (error) {
  report.errors.push(safeError(error));
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${report.status === "passed" ? "PASS" : "BLOCKED"} live Registry contract\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

async function json(url, headers) {
  const response = await fetch(url, { headers });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error bodies are represented by the null body.
  }
  return { status: response.status, etag: response.headers.get("etag"), body };
}

async function probeWatch(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, {
      headers: { ...headers, accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    let firstEvent = false;
    if (reader !== undefined) {
      const chunk = await reader.read();
      firstEvent = new TextDecoder().decode(chunk.value ?? new Uint8Array()).includes("retry:");
      await reader.cancel();
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      firstEvent,
    };
  } catch (error) {
    return { status: null, contentType: null, firstEvent: false, error: safeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function inspectSensitive(value) {
  const serialized = JSON.stringify(value);
  return {
    containsSecretKeys: /password|secret|token|authorization|credential|privateKey/i.test(
      serialized,
    ),
    containsEntityIdKeys: /entity[_-]?id/i.test(serialized),
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function string(value) {
  return typeof value === "string" ? value : null;
}

function safeError(error) {
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}
