import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(appRoot, "src");
const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) await inspect(path);
  }
}

async function inspect(path) {
  const source = await readFile(path, "utf8");
  const name = relative(sourceRoot, path).replaceAll("\\", "/");
  const feature = name.startsWith("features/");
  if (/\bStructuredPlaceholder\b|\bPlatformPage\b/.test(source))
    failures.push(`${name}: public placeholder infrastructure`);
  if (/\bPmsWebDataSource\b|\buseDataQuery\b|\busePmsWebDataSource\b/.test(source))
    failures.push(`${name}: legacy data source compatibility`);
  if (
    feature &&
    /from\s+["'][^"']*(fixtures|prototype\/scenarios|api\/generated|api\/types)/.test(source)
  )
    failures.push(`${name}: feature bypasses Query/Gateway/ViewModel boundary`);
  if (feature && /\bfetch\s*\(/.test(source)) failures.push(`${name}: direct fetch`);
  if (feature && /["']\/api\/console\/v1/.test(source))
    failures.push(`${name}: hard-coded console URL`);
  if (/\bonClick=\{(?:\(\)\s*=>\s*)?\{\s*\}\}/.test(source))
    failures.push(`${name}: empty onClick`);
  if (/\bTODO\b|\bFIXME\b|Coming Soon/.test(source)) failures.push(`${name}: unresolved marker`);
}

await walk(sourceRoot);
const router = await readFile(join(sourceRoot, "app/router.tsx"), "utf8");
if (/pushState|addEventListener\(["']popstate/.test(router))
  failures.push("app/router.tsx: legacy history router");
if (!router.includes("createBrowserRouter"))
  failures.push("app/router.tsx: formal browser router missing");
if (!router.includes("import.meta.env.DEV") || !router.includes("prototypeRoutes"))
  failures.push("app/router.tsx: development-only prototype registration missing");
if (/GenericRoute|feature-routes|StructuredPlaceholder|PlatformPage/.test(router))
  failures.push("app/router.tsx: generic public route remains");
if (existsSync(join(sourceRoot, "data")))
  failures.push("src/data: legacy centralized data source directory remains");
if (!existsSync(join(sourceRoot, "api/generated/contract.d.ts")))
  failures.push("generated contract DTO missing");
if (!existsSync(join(sourceRoot, "gateways/contracts/index.ts")))
  failures.push("gateway contracts missing");
if (
  !existsSync(join(sourceRoot, "queries/hooks.ts")) &&
  !existsSync(join(sourceRoot, "queries/hooks.tsx"))
)
  failures.push("domain query hooks missing");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Architecture validation passed");
