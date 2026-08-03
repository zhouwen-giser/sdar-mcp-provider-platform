import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_RUNTIME_RELEASE_MANIFEST,
  CURRENT_RUNTIME_VERSION,
  FIXED_RUNTIME_ENTRY,
  RuntimeReleaseResolver,
  loadRuntimeReleaseManifest,
} from "../src/index.js";

describe("RuntimeReleaseResolver", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("maps the current baseline version to the only fixed readable executable entry", async () => {
    const root = await releaseRoot();
    const resolver = new RuntimeReleaseResolver(root, CURRENT_RUNTIME_RELEASE_MANIFEST);

    const release = await resolver.resolve(CURRENT_RUNTIME_VERSION);

    expect(release).toMatchObject({
      version: "2.0.0-rc.1",
      releaseDirectory: resolve(root, "2.0.0-rc.1"),
      runtimeEntry: resolve(root, "2.0.0-rc.1", FIXED_RUNTIME_ENTRY),
    });
    expect(release.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    { version: "../escape", code: "RUNTIME_RELEASE_VERSION_INVALID" },
    { version: "/tmp/escape", code: "RUNTIME_RELEASE_VERSION_INVALID" },
    { version: "2.0.0/../../escape", code: "RUNTIME_RELEASE_VERSION_INVALID" },
    { version: "9.9.9", code: "RUNTIME_RELEASE_VERSION_UNKNOWN" },
  ])("rejects invalid or unknown version $version", async ({ version, code }) => {
    const root = await releaseRoot();
    await expect(
      new RuntimeReleaseResolver(root, CURRENT_RUNTIME_RELEASE_MANIFEST).resolve(version),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a manifest directory traversal and a release symlink escape", async () => {
    const root = await releaseRoot();
    expect(
      () =>
        new RuntimeReleaseResolver(root, {
          schemaVersion: 1,
          releases: [{ version: CURRENT_RUNTIME_VERSION, directory: "../outside" }],
        }),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_RELEASE_MANIFEST_INVALID" }));

    await rm(resolve(root, CURRENT_RUNTIME_VERSION), { recursive: true });
    const outside = await mkdtemp(resolve(tmpdir(), "sdar-release-outside-"));
    temporaryRoots.push(outside);
    await symlink(outside, resolve(root, CURRENT_RUNTIME_VERSION));
    await expect(
      new RuntimeReleaseResolver(root, CURRENT_RUNTIME_RELEASE_MANIFEST).resolve(
        CURRENT_RUNTIME_VERSION,
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_RELEASE_PATH_ESCAPE" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects an entry that is not both readable and executable",
    async () => {
      const root = await releaseRoot(0o400);
      await expect(
        new RuntimeReleaseResolver(root, CURRENT_RUNTIME_RELEASE_MANIFEST).resolve(
          CURRENT_RUNTIME_VERSION,
        ),
      ).rejects.toMatchObject({ code: "RUNTIME_RELEASE_ENTRY_NOT_EXECUTABLE" });

      const unreadableRoot = await releaseRoot(0o100);
      await expect(
        new RuntimeReleaseResolver(unreadableRoot, CURRENT_RUNTIME_RELEASE_MANIFEST).resolve(
          CURRENT_RUNTIME_VERSION,
        ),
      ).rejects.toMatchObject({ code: "RUNTIME_RELEASE_ENTRY_UNREADABLE" });
    },
  );

  it("accepts the fixed readable JavaScript entry on Windows", async () => {
    const root = await releaseRoot(0o400);
    const release = await new RuntimeReleaseResolver(
      root,
      CURRENT_RUNTIME_RELEASE_MANIFEST,
    ).resolve(CURRENT_RUNTIME_VERSION);
    expect(release.runtimeEntry).toBe(resolve(root, CURRENT_RUNTIME_VERSION, FIXED_RUNTIME_ENTRY));
  });

  it("loads only the fixed contained manifest file and rejects extra fields", async () => {
    const root = await releaseRoot();
    await writeFile(
      resolve(root, "runtime-releases.json"),
      JSON.stringify(CURRENT_RUNTIME_RELEASE_MANIFEST),
    );
    expect(await loadRuntimeReleaseManifest(root)).toEqual(CURRENT_RUNTIME_RELEASE_MANIFEST);

    await writeFile(
      resolve(root, "runtime-releases.json"),
      JSON.stringify({ ...CURRENT_RUNTIME_RELEASE_MANIFEST, command: "forbidden" }),
    );
    await expect(loadRuntimeReleaseManifest(root)).rejects.toMatchObject({
      code: "RUNTIME_RELEASE_MANIFEST_INVALID",
    });
  });

  async function releaseRoot(mode = 0o500): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "sdar-release-root-"));
    temporaryRoots.push(root);
    const entry = resolve(root, CURRENT_RUNTIME_VERSION, FIXED_RUNTIME_ENTRY);
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "export {};\n", { mode });
    await chmod(entry, mode);
    return root;
  }
});
