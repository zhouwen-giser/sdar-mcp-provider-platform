import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_SCHEMA_VERSION,
  IMAGE_MANIFEST_SCHEMA_VERSION,
  PRODUCT_IDS,
  bundleImageEnvironment,
  productCatalog,
} from "../../scripts/production-bundles/catalog.mjs";
import {
  ProductionBundleError,
  assertArchivePathSafety,
  assertComposeRunOptionCompatibility,
  assertNoBuildFields,
  assertNoRealEnvironmentEntries,
  assertOfflineImagePlatform,
  bundleReadmeText,
  imageLoaderScript,
  parseBuilderArguments,
  validateComposeDocument,
  validateOtlpBundleConfiguration,
} from "../../scripts/production-bundles/lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const revision = "a".repeat(40);
const postgres = Object.freeze({
  reference: "sdar/production-postgres:17-alpine-bbbbbbbbbbbb",
  digest: `sha256:${"b".repeat(64)}`,
  digest12: "b".repeat(12),
});

test("offline bundle schema v2 locks linux/amd64 image identity", () => {
  assert.equal(BUNDLE_SCHEMA_VERSION, 2);
  assert.equal(IMAGE_MANIFEST_SCHEMA_VERSION, 2);
  assert.doesNotThrow(() =>
    assertOfflineImagePlatform({ Os: "linux", Architecture: "amd64" }, "expected"),
  );
  for (const inspected of [
    { Os: "linux", Architecture: "arm64" },
    { Os: "windows", Architecture: "amd64" },
    { Os: "linux" },
  ]) {
    assert.throws(
      () => assertOfflineImagePlatform(inspected, "unexpected"),
      (error) =>
        error instanceof ProductionBundleError &&
        error.code === "PRODUCTION_BUNDLE_IMAGE_PLATFORM_INVALID",
    );
  }
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

const otlpProfiles = Object.freeze({
  ugv: Object.freeze({
    environmentPrefix: "UGV",
    runtimeService: "ugv-runtime",
    instanceId: "production-ugv-direct-1",
  }),
  "npc-tank": Object.freeze({
    environmentPrefix: "NPC_TANK",
    runtimeService: "npc-tank-runtime",
    instanceId: "production-npc-tank-direct-1",
  }),
});

test("catalog locks both standalone products to the strict intranet plaintext profile", () => {
  assert.deepEqual(PRODUCT_IDS, ["ugv", "npc-tank"]);
  for (const productId of PRODUCT_IDS) {
    const product = productCatalog(productId);
    const profile = product.transportProfile;
    assert.deepEqual(profile, {
      id: "strict-intranet-plaintext",
      allowInsecureInternalTransport: true,
      tlsRequired: false,
      httpsRequired: false,
      mqttTlsRequired: false,
    });
    assert.equal(product.runtimeAuthority, "direct_container");
    assert.equal(product.registryAuthority, "pms_worker");
  }
});

test("bundle README reports the real-resource status rather than the aggregate qualification", () => {
  for (const productId of PRODUCT_IDS) {
    const product = productCatalog(productId);
    const readme = bundleReadmeText(product, {
      source: { revision },
      qualification: {
        status: product.qualificationStatus,
        realResourceStatus: product.providerPackage.realResourceStatus,
      },
    });
    assert.match(readme, /inherited real-resource status is `pending`/);
    assert.match(readme, /PMS Web `\/api\/v1\/\*\*` proxy/);
    assert.match(readme, /Runtime `\/mcp` endpoint is anonymous/);
    assert.match(readme, /Runtime OTLP\/HTTP export is configurable/);
    assert.match(readme, /\/v1\/traces.*\/v1\/logs.*\/v1\/metrics/s);
    assert.equal(
      readme.includes("real-resource status is `" + product.qualificationStatus + "`"),
      false,
    );
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
    await assert.doesNotReject(() =>
      validateOtlpBundleConfiguration(bundleDirectory, productCatalog(productId)),
    );
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
    assert.match(compose, /PMS_API_MANAGEMENT_AUTH_MODE:\s*anonymous_intranet/);
    assert.match(compose, /PMS_WEB_RAW_API_PROXY_ENABLED:\s*"true"/);
    assert.match(compose, /PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE:\s*anonymous_intranet/);
    assert.match(compose, /AUTH_MODE:\s*anonymous/);
    assert.match(compose, /ADAPTER_TLS_MODE:\s*(?:"?disabled"?)/);
    assert.match(compose, /PROVIDER_TELEMETRY_TLS_MODE:\s*(?:"?disabled"?)/);
    assert.doesNotMatch(compose, /TLS_MODE:\s*(?:"?required"?)/);
    assert.doesNotMatch(compose, /TLS_(?:CA|CERT|KEY)_PATH|NODE_EXTRA_CA_CERTS/);
    assert.doesNotMatch(compose, /\.crt\b|\.pem\b|internal-pki/i);
    assert.match(compose, /command:\s*\["node",\s*"\/app\/pms-seed\.mjs"\]/);
    assert.match(compose, /target:\s*\/app\/pms-seed\.mjs/);
    assert.match(
      compose,
      /runtimeAuthority:\s*"direct_container"|PMS_SEED_RUNTIME_CONTROL_ENDPOINT/,
    );
    assert.doesNotMatch(compose, /PMS_MANAGEMENT_CREDENTIAL_FILE/);
    assert.doesNotMatch(compose, /PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE/);
    assert.doesNotMatch(compose, /JWT_HS256_SECRET|JWT_ISSUER|JWT_AUDIENCE/);
    assert.match(compose, /PMS_RUNTIME_REGISTRATION_URL/);
    assert.match(compose, /PMS_RUNTIME_REGISTRATION_TOKEN_FILE/);
    assert.doesNotMatch(compose, /PMS_RUNTIME_CONFIG_URL/);

    const otlp = otlpProfiles[productId];
    const expectedOtlpEnvironment = Object.freeze({
      enabled: `OTEL_ENABLED: \${${otlp.environmentPrefix}_OTEL_ENABLED:-false}`,
      endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT: \${${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}`,
      timeout: `OTEL_EXPORTER_OTLP_TIMEOUT_MS: \${${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS:-10000}`,
      tlsMode: "OTEL_EXPORTER_OTLP_TLS_MODE: disabled",
      instanceId: `OTEL_SERVICE_INSTANCE_ID: ${otlp.instanceId}`,
    });
    for (const [name, expected] of Object.entries(expectedOtlpEnvironment)) {
      assert.ok(
        compose.includes(expected),
        `${otlp.runtimeService} must expose the production OTLP ${name} contract`,
      );
    }
    assert.doesNotMatch(
      compose,
      /OTEL_EXPORTER_OTLP_(?:CA_PATH|CERT_PATH|KEY_PATH|HEADERS_FILE)\s*:/,
    );

    const otlpContractMutations = [
      compose.replace(expectedOtlpEnvironment.enabled, 'OTEL_ENABLED: "true"'),
      compose.replace(
        expectedOtlpEnvironment.endpoint,
        `OTEL_EXPORTER_OTLP_ENDPOINT: \${${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4319}`,
      ),
      compose.replace(
        expectedOtlpEnvironment.timeout,
        `OTEL_EXPORTER_OTLP_TIMEOUT_MS: \${${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS:-10001}`,
      ),
      compose.replace(expectedOtlpEnvironment.tlsMode, "OTEL_EXPORTER_OTLP_TLS_MODE: required"),
      compose.replace(
        expectedOtlpEnvironment.instanceId,
        "OTEL_SERVICE_INSTANCE_ID: wrong-instance",
      ),
      ...["CA_PATH", "CERT_PATH", "KEY_PATH", "HEADERS_FILE"].map((suffix) =>
        compose.replace(
          expectedOtlpEnvironment.tlsMode,
          `${expectedOtlpEnvironment.tlsMode}\n      OTEL_EXPORTER_OTLP_${suffix}: /run/secrets/otel-${suffix.toLowerCase()}`,
        ),
      ),
    ];
    for (const mutation of otlpContractMutations) {
      assert.notEqual(mutation, compose, "OTLP negative-test mutation must change Compose");
      assert.throws(
        () =>
          validateComposeDocument({
            source: mutation,
            product: productCatalog(productId),
            revision,
            postgres,
          }),
        (error) => error instanceof ProductionBundleError,
      );
    }

    for (const [mutation, code] of [
      [
        compose.replace(
          "PMS_API_MANAGEMENT_AUTH_MODE: anonymous_intranet",
          "PMS_API_MANAGEMENT_AUTH_MODE: file_credentials",
        ),
        "PRODUCTION_BUNDLE_PMS_API_AUTH_MODE_INVALID",
      ],
      [
        compose.replace(
          'PMS_WEB_RAW_API_PROXY_ENABLED: "true"',
          'PMS_WEB_RAW_API_PROXY_ENABLED: "false"',
        ),
        "PRODUCTION_BUNDLE_PMS_WEB_RAW_PROXY_INVALID",
      ],
      [
        compose.replace("\n      AUTH_MODE: anonymous", "\n      AUTH_MODE: jwt_hs256"),
        "PRODUCTION_BUNDLE_RUNTIME_AUTH_MODE_INVALID",
      ],
      [
        compose.replace(
          "PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE: anonymous_intranet",
          "PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE: file_credentials",
        ),
        "PRODUCTION_BUNDLE_PMS_WORKER_CATALOG_AUTH_MODE_INVALID",
      ],
      [
        compose.replace(
          "PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE: anonymous_intranet",
          "PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE: anonymous_intranet\n      PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE: /run/secrets/external-runtime-catalog.json",
        ),
        "PRODUCTION_BUNDLE_PMS_WORKER_CATALOG_CREDENTIAL_FORBIDDEN",
      ],
      [
        compose.replace(
          "PMS_API_MANAGEMENT_AUTH_MODE: anonymous_intranet",
          "PMS_API_MANAGEMENT_AUTH_MODE: anonymous_intranet\n      PMS_MANAGEMENT_CREDENTIAL_FILE: /run/secrets/management.json",
        ),
        "PRODUCTION_BUNDLE_PMS_MANAGEMENT_CREDENTIAL_FORBIDDEN",
      ],
    ]) {
      assert.throws(
        () =>
          validateComposeDocument({
            source: mutation,
            product: productCatalog(productId),
            revision,
            postgres,
          }),
        (error) => error instanceof ProductionBundleError && error.code === code,
      );
    }

    const example = await readFile(join(bundleDirectory, ".env.example"), "utf8");
    assert.match(example, /ALLOW_INSECURE_INTERNAL_TRANSPORT=true/);
    assert.match(example, /DEVICE_MCP_URL=http:\/\//);
    assert.match(example, /MQTT_URL=mqtt:\/\//);
    assert.match(example, /PMS_WEB_BIND_ADDRESS=0\.0\.0\.0/);
    assert.match(example, /RUNTIME_ADVERTISED_URL=http:\/\//);
    assert.match(example, new RegExp(`^${otlp.environmentPrefix}_OTEL_ENABLED=false$`, "m"));
    assert.match(
      example,
      new RegExp(
        `^${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://[^\\s]*(?:REPLACE|invalid)[^\\s]*:4318/?$`,
        "im",
      ),
    );
    assert.match(
      example,
      new RegExp(`^${otlp.environmentPrefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000$`, "m"),
    );
    assert.doesNotMatch(
      example,
      new RegExp(`^${otlp.environmentPrefix}_OTEL_SERVICE_INSTANCE_ID=`, "m"),
    );
    assert.doesNotMatch(example, /https:\/\/|mqtts:\/\/|wss:\/\//);
    assert.doesNotMatch(example, /(?:TLS|HEADERS|PASSWORD)_(?:CA_|CERT_|KEY_)?FILE=/);
    assert.doesNotMatch(example, /OTEL_EXPORTER_OTLP_(?:CA_PATH|CERT_PATH|KEY_PATH|HEADERS_FILE)=/);

    if (productId === "npc-tank") {
      const deploymentReadme = await readFile(join(bundleDirectory, "README.md"), "utf8");
      assert.match(deploymentReadme, /五个持久卷/);
      assert.doesNotMatch(deploymentReadme, /四个持久卷/);
    }

    const upScript = await readFile(join(bundleDirectory, "bin", "up.sh"), "utf8");
    const initScript = await readFile(join(bundleDirectory, "bin", "init.sh"), "utf8");
    const seedScript = await readFile(join(bundleDirectory, "bin", "pms-seed.mjs"), "utf8");
    const smokeScript = await readFile(join(bundleDirectory, "bin", "smoke.sh"), "utf8");
    const runtimeSmoke = await readFile(
      join(
        bundleDirectory,
        "bin",
        productId === "ugv" ? "runtime-smoke.mjs" : "runtime-read-smoke.mjs",
      ),
      "utf8",
    );
    assert.match(initScript, /"runtimeConfig":\s*\[\]/);
    assert.match(initScript, /"runtimeRegistration":\s*\[/);
    assert.doesNotMatch(initScript, /external-runtime-catalog\.json/);
    assert.doesNotMatch(initScript, /management-(?:admin|reader)\.token|runtime-jwt\.key/);
    assert.match(seedScript, /runtimeAuthority:\s*"direct_container"/);
    assert.match(seedScript, /updateResourceMetadata/);
    assert.match(seedScript, /OPTIMISTIC_CONCURRENCY_CONFLICT/);
    assert.match(seedScript, /providerManagement\.getResource/);
    const webSmoke = await readFile(join(bundleDirectory, "bin", "pms-web-smoke.mjs"), "utf8");
    assert.match(webSmoke, /\/api\/console\/v1\/runtime-deployments/);
    assert.match(webSmoke, /\/api\/console\/v1\/runtime-processes/);
    assert.match(webSmoke, /\/api\/console\/v1\/registry\/production\/latest/);
    assert.match(webSmoke, /process\.env\.PMS_WEB_SMOKE_ORIGIN/);
    assert.match(webSmoke, /\/api\/v1\/providers\//);
    assert.match(
      webSmoke,
      new RegExp(
        `/api/v1/registry/production/consumers/sdar/v1/sources/${productId === "ugv" ? "ugv-smpp" : "npc-tank-smpp"}/latest`,
      ),
    );
    assert.doesNotMatch(webSmoke, /\bauthorization\b/i);
    assert.doesNotMatch(seedScript, /\bauthorization\b/i);
    assert.doesNotMatch(runtimeSmoke, /\bauthorization\b/i);
    assert.match(smokeScript, /PMS_WEB_SMOKE_ORIGIN=/);
    assert.match(smokeScript, /docker run --rm --network host/);
    assert.doesNotMatch(smokeScript, /docker run[^\n]*--pull/);
    assert.match(smokeScript, /pms-web-smoke\.mjs:ro/);
    assert.match(smokeScript, /sdar\/production-pms-web:\$\((?:npc_)?bundle_revision\)/);
    assert.match(smokeScript, /== "0\.0\.0\.0" \]\] && pms_web_smoke_host="127\.0\.0\.1"/);
    assert.doesNotMatch(smokeScript, /^\s*(?:curl|node)\b/m);
    assert.match(webSmoke, /not_applicable/);
    assert.match(seedScript, /directContainer:\s*\{/);
    assert.match(seedScript, /registrationFreshness\s*!==\s*"registered"/);
    assert.match(seedScript, /registryAuthority:\s*"pms_worker"/);
    assert.match(smokeScript, /runtime-smoke\.mjs|runtime-read-smoke\.mjs/);
    assert.match(
      upScript,
      /^\s*(?:compose|npc_compose)\s+up\b[^\n]*--pull\s+never\b/m,
      `${productId}/up.sh must keep the persistent-service no-pull policy`,
    );
    assert.doesNotMatch(
      upScript,
      /\brun\b[^\n]*--no-build\b/,
      `${productId}/up.sh must only use Compose run options supported by Compose v2`,
    );
    assert.doesNotMatch(
      upScript,
      /\brun\b[^\n]*--pull\b/,
      `${productId}/up.sh must not pass the unsupported --pull option to Compose run`,
    );

    const imagePreflight =
      productId === "ugv"
        ? upScript.indexOf('docker image inspect "$image"')
        : upScript.indexOf("npc_verify_images");
    const persistentStartup = upScript.search(/^\s*(?:compose|npc_compose)\s+up\b/m);
    assert.ok(imagePreflight >= 0, `${productId}/up.sh must preflight its local images`);
    assert.ok(
      persistentStartup > imagePreflight,
      `${productId}/up.sh must preflight images before starting persistent services`,
    );

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

test("bundle lifecycle verifier rejects Compose run flags unavailable on older v2 releases", () => {
  assert.doesNotThrow(() =>
    assertComposeRunOptionCompatibility(
      "compose --profile seed run --rm --no-deps pms-seed\ncompose up --pull never",
      "UNSUPPORTED",
    ),
  );
  for (const command of [
    "compose --profile seed run --rm --pull never pms-seed",
    "npc_compose --profile seed run \\\n      --no-build --rm pms-seed",
  ]) {
    assert.throws(
      () => assertComposeRunOptionCompatibility(command, "UNSUPPORTED"),
      (error) => error instanceof ProductionBundleError && error.code === "UNSUPPORTED",
    );
  }
});

test("generated offline image loader is valid Bash and verifies immutable image metadata", () => {
  const loader = imageLoaderScript();
  const syntax = spawnSync("bash", ["-n", "-c", loader], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(loader, /sha256sum --check --strict SHA256SUMS/);
  assert.match(loader, /docker image load --input "\$archive"/);
  assert.match(loader, /\[\[ "\$actual_id" == "\$expected_id" \]\]/);
  assert.match(loader, /actual_os=.*\.Os/);
  assert.match(loader, /actual_arch=.*\.Architecture/);
  assert.match(loader, /"\$expected_os" == "linux"/);
  assert.match(loader, /"\$expected_arch" == "amd64"/);
  assert.match(loader, /image platform mismatch/);
  assert.match(loader, /\[\[ "\$count" -eq 6 \]\]/);
});
