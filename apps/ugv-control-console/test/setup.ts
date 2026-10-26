import { fileURLToPath } from "node:url";
// The real Runtime fixture loads repository proto/migration assets, just like its CLI.
process.chdir(fileURLToPath(new URL("../../../", import.meta.url)));
