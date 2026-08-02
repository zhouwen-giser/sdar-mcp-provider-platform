/* global console */
import fs from "node:fs";
import path from "node:path";
import { contract, readJson, stable, writeJson } from "./lib.mjs";

const doc = readJson(path.join(contract, "openapi.yaml"));
const directory = path.join(contract, "schemas");
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });

function jsonSchemaRefs(value) {
  if (Array.isArray(value)) return value.map(jsonSchemaRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "$ref" && typeof item === "string"
        ? item.replace("#/components/schemas/", "#/$defs/")
        : jsonSchemaRefs(item),
    ]),
  );
}

const definitions = stable(jsonSchemaRefs(doc.components.schemas));
for (const [name, schema] of Object.entries(doc.components.schemas)) {
  writeJson(
    path.join(directory, `${name}.schema.json`),
    stable({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `urn:sdar:pms-console-api:v1:${name}`,
      title: name,
      $defs: definitions,
      ...jsonSchemaRefs(schema),
    }),
  );
}
writeJson(
  path.join(directory, "components.schema.json"),
  stable({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:sdar:pms-console-api:v1:components",
    title: "PMS Console API V1 Components",
    $defs: definitions,
  }),
);
console.log(`standalone JSON Schemas generated: ${Object.keys(doc.components.schemas).length}`);
