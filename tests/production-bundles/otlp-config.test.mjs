import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const products = Object.freeze([
  Object.freeze({
    id: "ugv",
    common: join(repositoryRoot, "deploy/production-bundles/ugv/bin/common.sh"),
    invoke:
      'set -euo pipefail; export UGV_PRODUCTION_ENV_FILE="$1"; source "$2"; require_external_configuration',
    base: [
      "ALLOW_INSECURE_INTERNAL_TRANSPORT=true",
      "UGV_SIM_DEVICE_MCP_URL=http://device-mcp.intranet.local/mcp",
      "UGV_SIM_MQTT_URL=mqtt://mqtt.intranet.local:1883",
      "UGV_MQTT_WIRE_MODE=ros_bridge_json",
      "UGV_RUNTIME_ADVERTISED_URL=http://192.168.1.7:19100",
    ],
    prefix: "UGV",
  }),
  Object.freeze({
    id: "npc-tank",
    common: join(repositoryRoot, "deploy/production-bundles/npc-tank/bin/common.sh"),
    invoke:
      'set -euo pipefail; export NPC_TANK_PRODUCTION_ENV_FILE="$1"; source "$2"; npc_validate_external_configuration',
    base: [
      "ALLOW_INSECURE_INTERNAL_TRANSPORT=true",
      "NPC_TANK_DEVICE_MCP_URL=http://device-mcp.intranet.local/mcp",
      "NPC_TANK_MQTT_URL=mqtt://mqtt.intranet.local:1883",
      "NPC_TANK_RUNTIME_ADVERTISED_URL=http://192.168.1.7:19103",
    ],
    prefix: "NPC_TANK",
  }),
]);

for (const product of products) {
  test(`${product.id} OTLP environment is backward compatible and fail closed`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `sdar-${product.id}-otlp-`));
    try {
      await assertConfiguration(product, directory, [], true);
      await assertConfiguration(
        product,
        directory,
        [
          `${product.prefix}_OTEL_ENABLED=false`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://REPLACE_WITH_OTLP_COLLECTOR_HOST:4318`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000`,
        ],
        true,
      );
      await assertConfiguration(
        product,
        directory,
        [
          `${product.prefix}_OTEL_ENABLED=true`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.intranet.local:4318/otlp`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=30000`,
        ],
        true,
      );

      for (const overrides of [
        [`${product.prefix}_OTEL_ENABLED=yes`],
        [`${product.prefix}_OTEL_ENABLED=true`],
        [
          `${product.prefix}_OTEL_ENABLED=true`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://REPLACE_WITH_OTLP_COLLECTOR_HOST:4318`,
        ],
        [
          `${product.prefix}_OTEL_ENABLED=true`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.intranet.local:4318`,
        ],
        [
          `${product.prefix}_OTEL_ENABLED=true`,
          `${product.prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.intranet.local:4318/v1/metrics`,
        ],
        [`${product.prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=99`],
        [`${product.prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=60001`],
        [`${product.prefix}_OTEL_ENABLED=false`, `${product.prefix}_OTEL_ENABLED=true`],
      ]) {
        await assertConfiguration(product, directory, overrides, false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function assertConfiguration(product, directory, overrides, expectedSuccess) {
  const environmentFile = join(directory, "deployment.env");
  await writeFile(environmentFile, `${[...product.base, ...overrides].join("\n")}\n`, "utf8");
  const result = spawnSync("bash", ["-c", product.invoke, "_", environmentFile, product.common], {
    encoding: "utf8",
  });
  if (expectedSuccess) {
    assert.equal(result.status, 0, `${product.id}: ${result.stderr}`);
  } else {
    assert.equal(result.status, 2, `${product.id}: ${result.stderr}`);
    assert.match(result.stderr, /BLOCKED_CONFIGURATION:/u);
  }
}
