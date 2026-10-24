import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DeploymentProfile } from "../../packages/vehicle-zmq-contract/src/index.js";
import type { StartControl, ZmqExecution } from "../../packages/vehicle-zmq-control/src/index.js";
import { boot, until } from "./harness.js";
import { camera, navigation } from "../ugv-zmq-control/helpers.js";

interface Input {
  schema: string;
  profile: DeploymentProfile;
  partition: string;
  checkpoint: string;
  request: StartControl;
}
let held = false;
async function checkpoint(name: string) {
  if (held) return;
  held = true;
  process.send?.({ type: "checkpoint", name });
  await new Promise<void>((resolve) => process.once("release-checkpoint", () => resolve()));
}
process.once("message", (input: Input) => {
  void (async () => {
    const databaseUrl = z
      .object({ databaseUrl: z.string() })
      .parse(JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as unknown).databaseUrl;
    const runtime = await boot(databaseUrl, input.schema, input.profile, input.partition, {
      repository: (repository) => {
        const advance = repository.store.advanceMutationJournal.bind(repository.store);
        repository.store.advanceMutationJournal = async (entry, expected) => {
          const result = await advance(entry, expected);
          if (
            input.checkpoint === "before_dispatch" &&
            entry.state === "DISPATCHING" &&
            entry.stepId.startsWith("zmq-camera-")
          )
            await checkpoint(input.checkpoint);
          return result;
        };
        const save = repository.save.bind(repository);
        repository.save = async (e: ZmqExecution) => {
          const last = e.zmqControl.commands.at(-1),
            firstIntent = last?.status === "intent" && e.zmqControl.fallbackStop === null;
          if (input.checkpoint === "before_intent" && firstIntent)
            await checkpoint(input.checkpoint);
          if (
            input.checkpoint === "before_identity" &&
            e.zmqControl.nativeTaskId !== null &&
            e.zmqControl.stage === "ready_wait"
          )
            await checkpoint(input.checkpoint);
          if (input.checkpoint === "before_terminal" && e.state === "SUCCEEDED")
            await checkpoint(input.checkpoint);
          await save(e);
          if (input.checkpoint === "after_intent" && firstIntent)
            await checkpoint(input.checkpoint);
        };
        return repository;
      },
      transport: (native) => ({
        dispatch: async (command, permit) => {
          const result = await native.dispatch(command, permit);
          if (input.checkpoint === "after_send" && command.action === "camera")
            await checkpoint(input.checkpoint);
          return result;
        },
        close: () => native.close(),
      }),
    });
    await until(
      () =>
        runtime.engine.availability(camera).available &&
        runtime.engine.availability(navigation).available,
    );
    await runtime.engine.start(input.request);
  })().catch((error: unknown) => {
    process.send?.({
      type: "failure",
      code:
        error instanceof Error && /^[A-Z0-9_:]+$/.test(error.message)
          ? error.message
          : "CHILD_FAILED",
    });
    process.exitCode = 1;
  });
});
