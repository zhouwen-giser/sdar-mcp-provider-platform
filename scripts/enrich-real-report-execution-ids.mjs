import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = resolve(root, ".local/ha-real-device");

for (const name of ["climate", "light"]) {
  const reportPath = resolve(
    root,
    `reports/real-device-preparation/${name}-real-qualification.json`,
  );
  const storePath = resolve(localRoot, `${name}-provider-state.json`);
  if (!existsSync(reportPath) || !existsSync(storePath)) continue;
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const state = JSON.parse(readFileSync(storePath, "utf8"));
  const executions = state.executions ?? {};
  for (const scenario of report.scenarios ?? []) {
    const taskId = scenario.runtimeTaskId;
    if (typeof taskId !== "string") continue;
    const execution = executions[taskId];
    if (typeof execution?.externalExecutionId === "string")
      scenario.adapterExternalExecutionId = execution.externalExecutionId;
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
