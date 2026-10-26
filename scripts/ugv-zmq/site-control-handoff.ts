import { readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { loadGowmStorageConfig } from "../../packages/gowm-shared-storage-adapter/src/index.js";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  planHandoff,
  applyHandoff,
  verifySiteGrant,
} from "../../packages/vehicle-zmq-control/src/site-handoff.js";
import { canonical, sha256 } from "../../packages/vehicle-zmq-observer/src/config.js";
const args = process.argv.slice(2),
  mode = args.shift();
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (
    ![
      "--config",
      "--plan",
      "--grant",
      "--command-id",
      "--actor",
      "--reason",
      "--plan-hash",
    ].includes(args[i] ?? "") ||
    !args[i + 1] ||
    options.has(args[i] ?? "")
  )
    throw Error("HANDOFF_ARGUMENTS_INVALID");
  options.set(args[i] ?? "", args[i + 1] ?? "");
}
function read(path: string | undefined): unknown {
  if (!path || statSync(path).mode & 0o077) throw Error("PRIVATE_CONFIG_REQUIRED");
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
const c = z
  .object({
    ownerEnvironmentFile: z.string(),
    profileFile: z.string(),
    oldWriterContainers: z.array(z.string().min(1)).min(1).max(16),
  })
  .strict()
  .parse(read(options.get("--config")));
const owner = loadGowmStorageConfig(read(c.ownerEnvironmentFile) as NodeJS.ProcessEnv);
if (!owner) throw Error("GOWM_OWNER_REQUIRED");
const store = new PostgresProviderStore(owner.databaseUrl, 4, "ugv", owner),
  profile = read(c.profileFile);
const inspect = () => {
  const rows = JSON.parse(
    execFileSync("docker", ["inspect", ...c.oldWriterContainers], { encoding: "utf8" }),
  ) as {
    Id: string;
    Image: string;
    State: { Running: boolean };
    HostConfig: { RestartPolicy: { Name: string } };
  }[];
  return rows.map((r) => ({
    id: r.Id,
    image: r.Image,
    running: r.State.Running,
    restartPolicy: r.HostConfig.RestartPolicy.Name,
  }));
};
const save = (path: string | undefined, value: unknown) => {
  if (!path) throw Error("OUTPUT_PATH_REQUIRED");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
};
try {
  await store.initialize();
  if (mode === "plan") {
    const plan = await planHandoff(store, profile, inspect());
    save(options.get("--plan"), plan);
    console.log(
      JSON.stringify({
        mode,
        planHash: plan.planHash,
        runtimeActive: plan.snapshot.runtime.length,
        providerActive: plan.snapshot.provider.length,
        pendingCommands: plan.snapshot.commands.length,
      }),
    );
  } else if (mode === "apply") {
    const plan = read(options.get("--plan")) as Awaited<ReturnType<typeof planHandoff>>;
    if (options.get("--plan-hash") !== plan.planHash) throw Error("HANDOFF_PLAN_HASH_REQUIRED");
    const { planHash, ...data } = plan;
    if (sha256(canonical(data)) !== planHash) throw Error("HANDOFF_PLAN_HASH_INVALID");
    z.uuid().parse(options.get("--command-id"));
    z.string().trim().min(1).max(128).parse(options.get("--actor"));
    z.string().trim().min(1).max(1024).parse(options.get("--reason"));
    const current = inspect();
    if (
      JSON.stringify(current.map(({ id, image }) => ({ id, image }))) !==
      JSON.stringify(plan.oldWriters)
    )
      throw Error("OLD_WRITER_IDENTITY_CHANGED");
    for (const w of current) {
      execFileSync("docker", ["update", "--restart=no", w.id], { stdio: "pipe" });
      if (w.running)
        execFileSync("docker", ["stop", "--time", "20", w.id], { stdio: "pipe", timeout: 30000 });
    }
    const grant = await applyHandoff(store, profile, plan, {
      commandId: options.get("--command-id") ?? "",
      actor: options.get("--actor") ?? "",
      reason: options.get("--reason") ?? "",
      writers: inspect(),
    });
    save(options.get("--grant"), grant);
    console.log(
      JSON.stringify({
        mode,
        commandId: grant.commandId,
        retiredTasks: grant.retiredTasks,
        deviceOutcome: "unknown",
        oldWritersStopped: true,
      }),
    );
  } else if (mode === "verify") {
    const grant = await verifySiteGrant(store, profile, read(options.get("--grant")));
    const current = inspect();
    if (
      current.some((w) => w.running || w.restartPolicy !== "no") ||
      JSON.stringify(current.map(({ id, image }) => ({ id, image }))) !==
        JSON.stringify(grant.oldWriters.map(({ id, image }) => ({ id, image })))
    )
      throw Error("OLD_WRITER_NOT_STOPPED");
    console.log(JSON.stringify({ mode, commandId: grant.commandId, verified: true }));
  } else throw Error("HANDOFF_MODE_INVALID");
} finally {
  await store.close();
}
