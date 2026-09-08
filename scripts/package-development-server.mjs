import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/package-development-server.mjs [--output-dir DIRECTORY] [--site sz-gowm]\nPackages source without credentials; sz-gowm profile reuses the deployed GOWM database/network.",
  );
  process.exit(0);
}
let outputDir, site;
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === "--output-dir" && args[i + 1]) outputDir = args[i + 1];
  else if (args[i] === "--site" && args[i + 1] === "sz-gowm") site = args[i + 1];
  else throw Error("Invalid arguments; use --help");
}
const out = resolve(outputDir ?? resolve(root, "artifacts"));
execFileSync(
  process.execPath,
  [resolve(root, "deploy/development/server/package.mjs"), "check-template"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean),
  ),
]
  .filter(
    (p) =>
      !/(^|\/)(reports|artifacts|node_modules|\.git|\.codex|\.agents|state|secrets)(\/|$)/.test(
        p,
      ) &&
      (!/(^|\/)\.env($|\.(?!example$))/.test(p) ||
        p === "deploy/development/server/.env.gowm.example") &&
      p !== "SOURCE_REVISION" &&
      !p.startsWith("deploy/development/server/config/") &&
      !resolve(root, p).startsWith(`${out}/`) &&
      !/\.(token|pem|key|pfx|p12|log)$/.test(p),
  )
  .filter((p) => {
    try {
      return lstatSync(resolve(root, p)).isFile();
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  });
mkdirSync(out, { recursive: true });
const staging = mkdtempSync(resolve(tmpdir(), "smpp-source-package-"));
try {
  const sourceHash = createHash("sha256");
  for (const p of files.sort()) {
    const dest = resolve(staging, p);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(resolve(root, p), dest);
    const data = readFileSync(dest);
    sourceHash.update(JSON.stringify([p, lstatSync(dest).mode & 0o777, data.length])).update(data);
  }
  if (site) {
    writeFileSync(resolve(staging, "DEPLOYMENT_PROFILE"), site + "\n");
    files.push("DEPLOYMENT_PROFILE");
    sourceHash.update(site);
  }
  const suffix = sourceHash.digest("hex").slice(0, 12);
  writeFileSync(resolve(staging, "SOURCE_REVISION"), `${revision}-worktree-${suffix}\n`, {
    mode: 0o644,
  });
  files.push("SOURCE_REVISION");
  const archive = resolve(
    out,
    `smpp-${site ?? "development-server"}-${revision.slice(0, 12)}-${suffix}.tar.gz`,
  );
  execFileSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--null",
      "--verbatim-files-from",
      "-T",
      "-",
      "-czf",
      archive,
    ],
    { cwd: staging, input: files.sort().join("\0") + "\0" },
  );
  const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${hash}  ${archive.split("/").pop()}\n`);
  writeFileSync(
    `${archive}.json`,
    JSON.stringify(
      {
        site: site ?? null,
        baseRevision: revision,
        sourceTreeHash: suffix,
        uncommittedChangesIncluded: true,
        archive,
        sha256: hash,
        files: files.length,
      },
      null,
      2,
    ),
  );
  console.log(archive);
  console.log(`sha256:${hash}`);
} finally {
  // Remove only the exact temporary snapshot created above, never source/data.
  rmSync(staging, { recursive: true, force: true });
}
