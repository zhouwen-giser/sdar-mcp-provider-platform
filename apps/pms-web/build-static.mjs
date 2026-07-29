import { access, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const output = resolve(root, "dist");
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(resolve(root, "index.html"), resolve(output, "index.html")),
  copyFile(resolve(root, "src/styles.css"), resolve(output, "styles.css")),
]);
await Promise.all([
  access(resolve(output, "assets/main.js")),
  access(resolve(output, "assets/server.js")),
  access(resolve(output, "index.html")),
  access(resolve(output, "styles.css")),
]);
