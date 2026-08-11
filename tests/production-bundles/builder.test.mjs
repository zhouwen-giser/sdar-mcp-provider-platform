import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_IDS,
  bundleImageEnvironment,
  productCatalog,
} from "../../scripts/production-bundles/catalog.mjs";
import {
  ProductionBundleError,
  assertArchivePathSafety,
  assertNoBuildFields,
  assertNoRealEnvironmentEntries,
  imageLoaderScript,
  parseBuilderArguments,
  validateComposeDocument,
} from "../../scripts/production-bundles/lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const revision = "a".repeat(40);
const postgres = Object.freeze({
  reference: "sdar/production-postgres:17-alpine-bbbbbbbbbbbb",
  digest: `sha256:${"b".repeat(64)}`,
  digest12: "b".repeat(12),
});

const inventories = Object.freeze({
  ugv: Object.freeze({
    persistent: Object.freeze([
      "pms-postgres",
      "pms-api",
      "pms-worker",
      "pms-web",
      "ugv-adapter-postgres",
      "ugv-runtime-postgres",
      "ugv-adapter",
      "ugv-runtime",
    ]),
    deployDirectory: "ugv",
  }),
  "npc-tank": Object.freeze({
    persistent: Object.freeze([
      "pms-postgres",
      "pms-api",
      "pms-worker",
      "pms-web",
      "npc-adapter-postgres",
      "npc-runtime-postgres",
      "npc-tank-adapter",
      "npc-tank-runtime",
    ]),
    deployDirectory: "npc-tank",
  }),
});

test("catalog locks both standalone products to the strict intranet plaintext profile", () => {
  assert.deepEqual(PRODUCT_IDS, ["ugv", "npc-tank"]);
  for (const productId of PRODUCT_IDS) {
    const profile = productCatalog(productId).transportProfile;
    assert.deepEqual(profile, {
      id: "strict-intranet-plaintext",
      allowInsecureInternalTransport: true,
      tlsRequired: false,
      httpsRequired: false,
      mqttTlsRequired: false,
    });
  }
});

for (const productId of PRODUCT_IDS) {
  test(`${productId} Compose is offline, complete, and explicitly plaintext`, async () => {
    const inventory = inventories[productId];
    const bundleDirectory = join(
      repositoryRoot,
      "deploy/production-bundles",
      inventory.deployDirectory,
    );
    const compose = await readFile(join(bundleDirectory, "compose.yaml"), "utf8");
    const validated = validateComposeDocument({
      source: compose,
      product: productCatalog(productId),
      revision,
      postgres,
    });

    assert.deepEqual(validated.persistentServices, [...inventory.persistent].sort());
    assert.deepEqual(validated.seedServices, ["pms-seed"]);
    assert.match(compose, /RUNTIME_ENV:\s*production/);
    assert.match(compose, /ALLOW_INSECURE_INTERNAL_TRANSPORT:/);
    assert.match(compose, /ADAPTER_TLS_MODE:\s*(?:"?disabled"?)/);
    assert.match(compose, /PROVIDER_TELEMETRY_TLS_MODE:\s*(?:"?disabled"?)/);
    assert.doesNotMatch(compose, /TLS_MODE:\s*(?:"?required"?)/);
    assert.doesNotMatch(compose, /TLS_(?:CA|CERT|KEY)_PATH|NODE_EXTRA_CA_CERTS/);
    assert.doesNotMatch(compose, /\.crt\b|\.pem\b|internal-pki/i);

    const example = await readFile(join(bundleDirectory, ".env.example"), "utf8");
    assert.match(example, /ALLOW_INSECURE_INTERNAL_TRANSPORT=true/);
    assert.match(example, /DEVICE_MCP_URL=http:\/\//);
    assert.match(example, /MQTT_URL=mqtt:\/\//);
    assert.match(example, /PMS_WEB_BIND_ADDRESS=0\.0\.0\.0/);
    assert.doesNotMatch(example, /https:\/\/|mqtts:\/\/|wss:\/\//);
    assert.doesNotMatch(example, /(?:TLS|HEADERS|PASSWORD)_(?:CA_|CERT_|KEY_)?FILE=/);

    for (const script of ["init.sh", "up.sh", "down.sh", "status.sh", "smoke.sh"]) {
      const metadata = await stat(join(bundleDirectory, "bin", script));
      assert.notEqual(metadata.mode & 0o111, 0, `${productId}/${script} must be executable`);
    }
  });
}

test("immutable image environment cannot represent an arbitrary revision", () => {
  assert.throws(
    () => bundleImageEnvironment("latest", postgres, true),
    (error) => error instanceof Error && error.message === "PRODUCTION_BUNDLE_REVISION_INVALID",
  );
  const value = bundleImageEnvironment(revision, postgres, true);
  assert.match(value, new RegExp(`^BUNDLE_REVISION=${revision}$`, "m"));
  assert.match(value, /^BUNDLE_DEPLOYABLE=true$/m);
});

test("argument and archive safety checks fail closed", () => {
  assert.deepEqual(parseBuilderArguments(["--stage-only", "--product", "ugv"]).products, ["ugv"]);
  assert.throws(
    () => parseBuilderArguments(["--product", "unknown"]),
    (error) =>
      error instanceof Error && error.message.includes("PRODUCTION_BUNDLE_PRODUCT_UNKNOWN"),
  );
  assert.throws(
    () => assertArchivePathSafety(["bundle/../../escape"], "UNSAFE"),
    (error) => error instanceof ProductionBundleError && error.code === "UNSAFE",
  );
  assert.throws(
    () => assertNoRealEnvironmentEntries(["bundle/deploy/.env"]),
    (error) =>
      error instanceof ProductionBundleError &&
      error.code === "PRODUCTION_BUNDLE_REAL_ENV_FORBIDDEN",
  );
  assert.throws(
    () => assertNoBuildFields({ services: { runtime: { build: "." } } }),
    (error) =>
      error instanceof ProductionBundleError &&
      error.code === "PRODUCTION_BUNDLE_COMPOSE_BUILD_FIELD_FORBIDDEN",
  );
});

test("generated offline image loader is valid Bash and verifies immutable image metadata", () => {
  const loader = imageLoaderScript();
  const syntax = spawnSync("bash", ["-n", "-c", loader], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(loader, /sha256sum --check --strict SHA256SUMS/);
  assert.match(loader, /docker image load --input "\$archive"/);
  assert.match(loader, /\[\[ "\$actual_id" == "\$expected_id" \]\]/);
  assert.match(loader, /\[\[ "\$count" -eq 6 \]\]/);
});
