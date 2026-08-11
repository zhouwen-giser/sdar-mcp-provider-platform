import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { hashSdarRegistryProjection } from "../apps/pms-api/src/sdar-registry-projection.ts";

const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localStateRoot = resolve(process.env.SMPP_LOCAL_STATE_ROOT ?? resolve(root, ".local"));
const apiBaseUrl = safeBaseUrl(process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090");
const smppSourceId = process.env.SMPP_SOURCE_ID ?? "home-lab-smpp";
if (!SOURCE_ID.test(smppSourceId)) throw new Error("SMPP_PROJECTION_PROBE_SOURCE_ID_INVALID");
const environment = "home-lab";
const reportPath = resolve(root, "reports/sdar-integration-support/projection-http.json");
const contractRoot = resolve(root, "protocol/consumer-projections/sdar-registry/v1");
const report = {
  schemaVersion: 1,
  goalRunId: "019fca75-f48a-7780-ac5e-942503c6690e",
  contract: "sdar-registry-v1",
  observedAt: new Date().toISOString(),
  status: "blocked",
  evidenceClass: "real_live_goal_service",
  liveGoalServiceVerified: false,
  routes: ["latest", "bootstrap", "watch"],
  checks: {},
  nativeLineage: null,
  projection: null,
  contractAssets: null,
  redaction: {
    secretsIncluded: false,
    endpointsIncluded: false,
    entityIdsIncluded: false,
  },
  errors: [],
};

try {
  const token = await managementToken();
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  const native = await requestJson(`${apiBaseUrl}/api/v1/registry/${environment}/latest`, headers);
  requireStatus(native, 200, "SMPP_NATIVE_LATEST_FAILED");
  const nativeBody = object(native.body, "SMPP_NATIVE_BODY_INVALID");
  const nativeRevision = positiveInteger(nativeBody.revision, "SMPP_NATIVE_REVISION_INVALID");
  const nativeChecksum = hash(nativeBody.checksum, "SMPP_NATIVE_CHECKSUM_INVALID");

  const routeBase = `${apiBaseUrl}/api/v1/registry/${environment}/consumers/sdar/v1/sources/${encodeURIComponent(smppSourceId)}`;
  const latest = await requestJson(`${routeBase}/latest`, headers);
  requireStatus(latest, 200, "SMPP_PROJECTION_LATEST_FAILED");
  const projection = strictProjection(latest.body);
  const expectedEtag = `"${projection.checksum}"`;
  const latestLineage = strictLineage(latest.response, projection.revision);
  if (latest.response.headers.get("etag") !== expectedEtag) {
    throw new Error("SMPP_PROJECTION_ETAG_MISMATCH");
  }
  if (
    latestLineage.nativeRevision !== nativeRevision ||
    latestLineage.nativeChecksum !== nativeChecksum
  ) {
    throw new Error("SMPP_PROJECTION_NATIVE_LINEAGE_MISMATCH");
  }
  const computedChecksum = hashSdarRegistryProjection({
    smppSourceId,
    revision: projection.revision,
    generatedAt: projection.generatedAt,
    expiresAt: projection.expiresAt,
    candidates: projection.providers,
  });
  if (computedChecksum !== projection.checksum) {
    throw new Error("SMPP_PROJECTION_CHECKSUM_MISMATCH");
  }
  if (Date.parse(projection.expiresAt) - Date.parse(projection.generatedAt) !== 2_592_000_000) {
    throw new Error("SMPP_PROJECTION_TTL_MISMATCH");
  }

  const conditional = await fetch(`${routeBase}/latest`, {
    headers: { ...headers, "if-none-match": expectedEtag },
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  const conditionalLineage = strictLineage(conditional, projection.revision);
  const conditionalBody = await conditional.arrayBuffer();
  if (
    conditional.status !== 304 ||
    conditional.headers.get("etag") !== expectedEtag ||
    conditionalBody.byteLength !== 0 ||
    conditionalLineage.nativeRevision !== nativeRevision ||
    conditionalLineage.nativeChecksum !== nativeChecksum
  ) {
    throw new Error("SMPP_PROJECTION_304_INVALID");
  }

  const bootstrap = await requestJson(`${routeBase}/bootstrap`, headers);
  requireStatus(bootstrap, 200, "SMPP_PROJECTION_BOOTSTRAP_FAILED");
  const bootstrapProjection = strictProjection(bootstrap.body);
  const bootstrapLineage = strictLineage(bootstrap.response, projection.revision);
  if (
    bootstrapProjection.checksum !== projection.checksum ||
    bootstrap.response.headers.get("etag") !== expectedEtag ||
    bootstrapLineage.nativeRevision !== nativeRevision ||
    bootstrapLineage.nativeChecksum !== nativeChecksum
  ) {
    throw new Error("SMPP_PROJECTION_BOOTSTRAP_MISMATCH");
  }

  const watch = await probeWatch(`${routeBase}/watch`, headers, projection, latestLineage);
  const unauthorized = await fetch(`${routeBase}/latest`, {
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  const wrongCredential = await fetch(`${routeBase}/latest`, {
    headers: { authorization: "Bearer invalid-probe-credential" },
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  const missingBootstrap = await fetch(
    `${apiBaseUrl}/api/v1/registry/missing-home-lab/consumers/sdar/v1/sources/${encodeURIComponent(smppSourceId)}/bootstrap`,
    { headers, redirect: "manual", signal: globalThis.AbortSignal.timeout(5_000) },
  );
  const invalidSource = await fetch(
    `${apiBaseUrl}/api/v1/registry/${environment}/consumers/sdar/v1/sources/%40invalid/latest`,
    { headers, redirect: "manual", signal: globalThis.AbortSignal.timeout(5_000) },
  );
  if (
    unauthorized.status !== 401 ||
    wrongCredential.status !== 401 ||
    missingBootstrap.status !== 404 ||
    invalidSource.status !== 400
  ) {
    throw new Error("SMPP_PROJECTION_SECURITY_BOUNDARY_INVALID");
  }

  const manifest = JSON.parse(await readFile(resolve(contractRoot, "MANIFEST.json"), "utf8"));
  report.checks = {
    latest200: true,
    projectionChecksum: true,
    etagQuotedChecksum: true,
    conditional304: true,
    nativeLineageHeaders: true,
    bootstrap200: true,
    bootstrapMissing404: true,
    watchHintOnly: watch.hintOnly,
    bearerAuthentication: true,
    sourceIdValidation: true,
    providerCount: projection.providers.length === 2,
    strictDto: true,
    fixedTtl: true,
    noSecretOrEntityId: true,
  };
  if (!Object.values(report.checks).every(Boolean)) {
    throw new Error("SMPP_PROJECTION_LIVE_GATE_FAILED");
  }
  report.nativeLineage = {
    revision: nativeRevision,
    checksum: nativeChecksum,
  };
  report.projection = {
    revision: projection.revision,
    checksum: projection.checksum,
    etag: expectedEtag,
    generatedAt: projection.generatedAt,
    expiresAt: projection.expiresAt,
    providerIds: projection.providers.map(({ externalProviderId }) => externalProviderId),
    watchEvent: watch.event,
  };
  report.contractAssets = {
    bundleSha256: manifest.bundleSha256,
    projectionSchemaSha256: manifest.projectionSchemaSha256,
  };
  report.liveGoalServiceVerified = true;
  report.status = "passed";
} catch (error) {
  report.errors.push(
    error instanceof Error ? error.message.replace(/[^A-Z0-9_:.-]/gu, "_") : "UNKNOWN_ERROR",
  );
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${report.status === "passed" ? "PASS" : "BLOCKED"} live SDAR Registry projection\n`,
);
process.exitCode = report.status === "passed" ? 0 : 1;

async function managementToken() {
  const descriptor = JSON.parse(
    await readFile(
      resolve(localStateRoot, "pms-continuation/secrets/management-credentials.json"),
      "utf8",
    ),
  );
  const tokenFile = descriptor?.management?.administrator?.[0]?.tokenFile;
  if (typeof tokenFile !== "string") throw new Error("SMPP_MANAGEMENT_TOKEN_REF_INVALID");
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length === 0) throw new Error("SMPP_MANAGEMENT_TOKEN_EMPTY");
  return token;
}

async function requestJson(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("SMPP_PROJECTION_REDIRECT_REJECTED");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON response is represented as null and rejected by the caller.
  }
  return { response, status: response.status, body };
}

function strictProjection(value) {
  const body = object(value, "SMPP_PROJECTION_BODY_INVALID");
  exactKeys(body, ["revision", "checksum", "generatedAt", "expiresAt", "providers"]);
  const revision = positiveInteger(body.revision, "SMPP_PROJECTION_REVISION_INVALID");
  const checksum = hash(body.checksum, "SMPP_PROJECTION_CHECKSUM_INVALID");
  const generatedAt = timestamp(body.generatedAt, "SMPP_PROJECTION_GENERATED_AT_INVALID");
  const expiresAt = timestamp(body.expiresAt, "SMPP_PROJECTION_EXPIRES_AT_INVALID");
  if (!Array.isArray(body.providers)) throw new Error("SMPP_PROJECTION_PROVIDERS_INVALID");
  const providers = body.providers.map((item) => {
    const provider = object(item, "SMPP_PROJECTION_PROVIDER_INVALID");
    exactKeys(provider, [
      "externalProviderId",
      "externalServerId",
      "serverEndpoint",
      "catalogRevision",
      "labels",
    ]);
    const labels = object(provider.labels, "SMPP_PROJECTION_LABELS_INVALID");
    exactKeys(labels, ["environment", "protocolMode"]);
    if (labels.environment !== "home-lab" || labels.protocolMode !== "frozen_v1") {
      throw new Error("SMPP_PROJECTION_LABELS_INVALID");
    }
    const endpoint = new URL(text(provider.serverEndpoint, "SMPP_PROJECTION_ENDPOINT_INVALID"));
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username !== "" ||
      endpoint.password !== ""
    ) {
      throw new Error("SMPP_PROJECTION_ENDPOINT_INVALID");
    }
    const catalogRevision = text(provider.catalogRevision, "SMPP_CATALOG_REVISION_INVALID");
    if (!/^[1-9][0-9]*$/u.test(catalogRevision)) {
      throw new Error("SMPP_CATALOG_REVISION_INVALID");
    }
    return {
      externalProviderId: text(provider.externalProviderId, "SMPP_PROVIDER_ID_INVALID"),
      externalServerId: text(provider.externalServerId, "SMPP_SERVER_ID_INVALID"),
      serverEndpoint: endpoint.toString().replace(/\/$/u, ""),
      catalogRevision,
      labels: { environment: labels.environment, protocolMode: labels.protocolMode },
    };
  });
  if (
    providers.length !== 2 ||
    providers
      .map(({ externalProviderId }) => externalProviderId)
      .sort()
      .join(",") !== "ha-climate-lab,ha-light-lab" ||
    /displayName|entity[_-]?id|password|secret|token|authorization|credential|privateKey/iu.test(
      JSON.stringify(body),
    )
  ) {
    throw new Error("SMPP_PROJECTION_PROVIDER_SET_INVALID");
  }
  return { revision, checksum, generatedAt, expiresAt, providers };
}

function strictLineage(response, projectionRevision) {
  const nativeRevision = positiveInteger(
    Number(response.headers.get("x-smpp-native-revision")),
    "SMPP_NATIVE_REVISION_HEADER_INVALID",
  );
  const nativeChecksum = hash(
    response.headers.get("x-smpp-native-checksum"),
    "SMPP_NATIVE_CHECKSUM_HEADER_INVALID",
  );
  if (
    response.headers.get("x-smpp-projection-contract") !== "sdar-registry-v1" ||
    nativeRevision !== projectionRevision
  ) {
    throw new Error("SMPP_PROJECTION_LINEAGE_HEADER_INVALID");
  }
  return { nativeRevision, nativeChecksum };
}

async function probeWatch(url, headers, projection, lineage) {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      headers: { ...headers, accept: "text/event-stream" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.startsWith("text/event-stream") ||
      response.headers.get("etag") !== `"${projection.checksum}"`
    ) {
      throw new Error("SMPP_PROJECTION_WATCH_HEADERS_INVALID");
    }
    const watchLineage = strictLineage(response, projection.revision);
    if (
      watchLineage.nativeRevision !== lineage.nativeRevision ||
      watchLineage.nativeChecksum !== lineage.nativeChecksum
    ) {
      throw new Error("SMPP_PROJECTION_WATCH_LINEAGE_INVALID");
    }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SMPP_PROJECTION_WATCH_BODY_MISSING");
    const chunk = await reader.read();
    await reader.cancel();
    const source = new TextDecoder().decode(chunk.value ?? new Uint8Array());
    const dataLine = source
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    const hint = dataLine === undefined ? null : JSON.parse(dataLine);
    const hintObject = object(hint, "SMPP_PROJECTION_WATCH_HINT_INVALID");
    exactKeys(hintObject, ["environment", "smppSourceId", "revision", "checksum"]);
    const hintOnly =
      source.includes("retry: 3000") &&
      source.includes("event: revision") &&
      hintObject.environment === environment &&
      hintObject.smppSourceId === smppSourceId &&
      hintObject.revision === projection.revision &&
      hintObject.checksum === projection.checksum &&
      !/providers|serverEndpoint|externalProviderId|tools|task/iu.test(source);
    if (!hintOnly) throw new Error("SMPP_PROJECTION_WATCH_HINT_INVALID");
    return { hintOnly, event: "revision" };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function safeBaseUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("SMPP_PMS_API_URL_INVALID");
  }
  return url.toString().replace(/\/$/u, "");
}

function requireStatus(response, expected, code) {
  if (response.status !== expected) throw new Error(code);
}

function object(value, code) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort().join(",");
  if (actual !== [...expected].sort().join(",")) throw new Error("SMPP_PROJECTION_UNKNOWN_FIELD");
}

function text(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function hash(value, code) {
  const normalized = text(value, code);
  if (!HASH.test(normalized)) throw new Error(code);
  return normalized;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code);
  return value;
}

function timestamp(value, code) {
  const normalized = text(value, code);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return normalized;
}
