/* global console */
import path from "node:path";
import { contract, readJson } from "./lib.mjs";
const doc = readJson(path.join(contract, "openapi.yaml"));
const maps = readJson(path.join(contract, "SCHEMA_SOURCE_MAP.json"));
for (const name of Object.keys(doc.components.schemas)) {
  const m = maps[name];
  if (!m) throw new Error(`missing schema source ${name}`);
  if (m.classification !== "TRANSPORT_METADATA" && (!m.sourceFile || !m.sourceSymbol))
    throw new Error(`weak schema source ${name}`);
}
for (const name of Object.keys(maps))
  if (!doc.components.schemas[name]) throw new Error(`orphan schema source ${name}`);
for (const n of [
  "Incident",
  "ChangeRequest",
  "Approval",
  "EnvironmentEntity",
  "GenericOperation",
  "Notification",
  "ConfigurationValidationResult",
  "EffectiveConfiguration",
  "ConfigurationPublication",
])
  if (doc.components.schemas[n]) throw new Error(`forbidden or obsolete schema ${n}`);
console.log(`object source passed: ${Object.keys(maps).length}`);
