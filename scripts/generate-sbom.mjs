import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const outputPath = resolve("reports/sbom/runtime-v1.cdx.json");
const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const checking = process.argv.includes("--check");
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  throw new Error("Run this script through pnpm so npm_execpath identifies the package manager");
}

const listed = JSON.parse(
  execFileSync(process.execPath, [pnpmEntry, "list", "--prod", "--json", "--depth", "Infinity"], {
    encoding: "utf8",
  }),
);
const components = new Map();

function collect(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = dependency.version ?? "workspace";
    const key = `${name}@${version}`;
    components.set(key, {
      type: "library",
      name,
      version,
      purl: npmPurl(name, version),
    });
    collect(dependency.dependencies);
  }
}

for (const project of listed) collect(project.dependencies);
const normalizedLock = readFileSync("pnpm-lock.yaml", "utf8").replaceAll("\r\n", "\n");
const lockHash = createHash("sha256").update(normalizedLock).digest("hex");
const document = {
  $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "sdar-mcp-tasks-provider-runtime",
      version: rootPackage.version,
    },
    properties: [{ name: "sdar:pnpm-lock-sha256", value: lockHash }],
  },
  components: [...components.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  ),
};
const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (checking) {
  const committed = readFileSync(outputPath, "utf8");
  if (committed !== serialized) {
    throw new Error("SBOM is stale; run pnpm sbom:generate and commit the result");
  }
  process.stdout.write(`SBOM current: ${document.components.length} production components\n`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, { mode: 0o644 });
  process.stdout.write(`Wrote ${outputPath} with ${document.components.length} components\n`);
}

function npmPurl(name, version) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.slice(1).split("/");
    return `pkg:npm/%40${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}
