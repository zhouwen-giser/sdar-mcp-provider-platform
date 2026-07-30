/* global console */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { contract, readJson } from "./lib.mjs";

const doc = readJson(path.join(contract, "openapi.yaml"));
const directory = path.join(contract, "schemas");
const files = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith(".schema.json"))
  .sort();
const expectedCount = Object.keys(doc.components.schemas).length + 1;
if (files.length !== expectedCount) {
  throw new Error(`schema file count mismatch: expected ${expectedCount}, found ${files.length}`);
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
for (const file of files) {
  const schema = readJson(path.join(directory, file));
  ajv.compile(schema);
  if (file === "components.schema.json") {
    if (
      JSON.stringify(Object.keys(schema.$defs).sort()) !==
      JSON.stringify(Object.keys(doc.components.schemas).sort())
    ) {
      throw new Error("component schema definitions drift");
    }
    continue;
  }
  const name = file.replace(/\.schema\.json$/, "");
  if (schema.$id !== `urn:sdar:pms-console-api:v1:${name}` || schema.title !== name) {
    throw new Error(`generated schema identity drift: ${name}`);
  }
}
console.log(`AJV JSON Schema 2020-12 compilation passed: ${files.length} files`);
