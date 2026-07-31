import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../src");
const failures=[];
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(ts|tsx)$/.test(entry.name)){const source=await readFile(path,"utf8");if(/\bTODO\b|\bFIXME\b|Coming Soon/.test(source))failures.push(`${path}: unresolved marker`);if(/[ \t]+$/m.test(source))failures.push(`${path}: trailing whitespace`);if(/console\.(log|debug)\(/.test(source))failures.push(`${path}: debug console statement`);}}}
await walk(root);if(failures.length){console.error(failures.join("\n"));process.exit(1)}console.log("Source lint passed");
