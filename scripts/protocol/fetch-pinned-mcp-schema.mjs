import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const SOURCE_REPOSITORY = "modelcontextprotocol/modelcontextprotocol";
const SOURCE_COMMIT = "26897cc322f356487da89113451bd16b520b9288";
const SOURCE_SCHEMA_PATH = "schema/draft/schema.json";
const SOURCE_SCHEMA_GIT_BLOB = "cc44564e33305dbc07e820cdd0a97648f3852019";
const OUTPUT_PATH = resolve("protocol/upstream/mcp-2026-07-28/schema.json");
const SOURCE_URL = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}/${SOURCE_SCHEMA_PATH}`;

const checkOnly = process.argv.includes("--check");
const bytes = checkOnly ? readFileSync(OUTPUT_PATH) : await fetchPinnedSchema();
verifySchema(bytes);

if (!checkOnly) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o644 });
    renameSync(temporaryPath, OUTPUT_PATH);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

const sha256 = digest("sha256", bytes);
process.stdout.write(
  `${checkOnly ? "Verified" : "Vendored"} ${SOURCE_SCHEMA_PATH} from ${SOURCE_COMMIT}\n` +
    `Git blob: ${SOURCE_SCHEMA_GIT_BLOB}\nSHA-256: ${sha256}\n`,
);

async function fetchPinnedSchema() {
  const response = await globalThis.fetch(SOURCE_URL, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Pinned MCP schema fetch failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function verifySchema(bytes) {
  const actualBlob = gitBlobHash(bytes);
  if (actualBlob !== SOURCE_SCHEMA_GIT_BLOB) {
    throw new Error(
      `Pinned MCP schema Git blob mismatch: expected ${SOURCE_SCHEMA_GIT_BLOB}, received ${actualBlob}`,
    );
  }

  let schema;
  try {
    schema = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("Pinned MCP schema is not valid UTF-8 JSON", { cause: error });
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Pinned MCP schema root must be a JSON object");
  }
}

function gitBlobHash(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}
