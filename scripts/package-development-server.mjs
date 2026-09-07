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
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "Usage: node scripts/package-development-server.mjs [--output-dir DIRECTORY]\nPackages current source; does not build or deploy.",
  );
  process.exit(0);
}
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output-dir" || !args[1]))
  throw new Error("Invalid arguments; use --help");
const out = resolve(args[1] ?? resolve(root, "artifacts"));
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
      !/(^|\/)\.env($|\.(?!example$))/.test(p) &&
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
  const suffix = sourceHash.digest("hex").slice(0, 12);
  writeFileSync(resolve(staging, "SOURCE_REVISION"), `${revision}-worktree-${suffix}\n`, {
    mode: 0o644,
  });
  files.push("SOURCE_REVISION");
  const archive = resolve(out, `smpp-development-server-${revision.slice(0, 12)}-${suffix}.tar.gz`);
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
