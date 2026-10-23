import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const image = process.env.UGV_CONSOLE_IMAGE;
if (!image) throw Error("UGV_CONSOLE_IMAGE_REQUIRED");
const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const output = resolve(process.argv[2] ?? "/mnt/data/ugv-control-console-20261022");
mkdirSync(output, { recursive: true });
const root = join(output, `ugv-control-console-${source.slice(0, 12)}`);
mkdirSync(root, { recursive: true });
for (const name of [
  "deploy.mjs",
  "repair-network.mjs",
  "network-policy.mjs",
  "README.md",
  "Dockerfile",
])
  copyFileSync(join("deploy/ugv-control-console", name), join(root, name));
execFileSync("docker", ["image", "save", "-o", join(root, "image.tar"), image], {
  stdio: "inherit",
});
execFileSync("git", [
  "archive",
  "--format=tar.gz",
  `--output=${join(root, "source.tar.gz")}`,
  source,
  "apps/ugv-control-console",
  "deploy/ugv-control-console",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
]);
const hashes = Object.fromEntries(
  [
    "image.tar",
    "source.tar.gz",
    "deploy.mjs",
    "repair-network.mjs",
    "network-policy.mjs",
    "README.md",
    "Dockerfile",
  ].map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(join(root, name)))
      .digest("hex"),
  ]),
);
writeFileSync(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: "smpp.ugv-console-deployment/1",
      source,
      image,
      imageId: execFileSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
        encoding: "utf8",
      }).trim(),
      hashes,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(root, "SHA256SUMS"),
  Object.entries(hashes)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n") + "\n",
);
const archive = `${root}.tar.gz`;
execFileSync("tar", ["-C", output, "-czf", archive, root.slice(output.length + 1)]);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${digest}  ${archive.split("/").at(-1)}\n`);
console.log(JSON.stringify({ archive, sha256: digest, source, image }));
