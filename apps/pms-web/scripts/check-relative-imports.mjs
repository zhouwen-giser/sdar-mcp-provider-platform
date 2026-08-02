import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [join(appRoot, "src"), join(appRoot, "test"), join(appRoot, "e2e")];
const failures = [];
async function walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const spec = match[1];
        const raw = resolve(dirname(path), spec);
        const stem = raw.endsWith(".js") ? raw.slice(0, -3) : raw;
        const candidates = [
          raw,
          `${stem}.ts`,
          `${stem}.tsx`,
          `${stem}.d.ts`,
          join(stem, "index.ts"),
          join(stem, "index.tsx"),
        ];
        if (!candidates.some(existsSync)) failures.push(`${path}: ${spec}`);
      }
    }
  }
}
for (const root of roots) await walk(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Relative import validation passed");
