import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Reuse an existing dependency directory; never start a server or install packages.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dependencies = createRequire(resolve(process.argv[2] ?? root, "package.json"));
const ts = dependencies("typescript");
const sources = {};
const plain = (value) => JSON.parse(JSON.stringify(value));
function evaluate(path, imports = {}, expose = [], onlyFunctions) {
  const source = readFileSync(resolve(root, path), "utf8");
  sources[path] = createHash("sha256").update(source).digest("hex");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const selected = onlyFunctions
    ?.map((name) => {
      const matches = ast.statements
        .filter(ts.isFunctionDeclaration)
        .filter((n) => n.name?.text === name);
      assert.equal(matches.length, 1, `exact source function ${name}`);
      return matches[0].getText(ast);
    })
    .join("\n");
  const compiled = ts.transpileModule(selected ?? source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(
    compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length,
    0,
  );
  const module = { exports: {} };
  const run = vm.runInNewContext(
    `(function(require,module,exports){${compiled.outputText}\n${expose.map((name) => `exports.${name}=${name};`).join("\n")}\n})`,
    { Buffer, URL, structuredClone, process: { env: {} } },
    { filename: path },
  );
  run(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `unexpected dependency: ${name}`);
      return imports[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const mapper = evaluate("packages/vehicle-provider-core/src/task-state-mapper.ts");
const guard = evaluate("packages/vehicle-mqtt-ingress/src/guard.ts");
const { normalizeMqttObservation } = evaluate("packages/vehicle-mqtt-ingress/src/normalizers.ts", {
  "../../vehicle-provider-core/src/index.js": mapper,
  "./guard.js": guard,
});
const { createUgvSnapshot, applySnapshotPatch } = evaluate(
  "packages/vehicle-provider-core/src/snapshot.ts",
  {
    "node:crypto": dependencies("node:crypto"),
  },
);
const guardNames = ["reconMotionActive", "observedTaskActive", "deviceObservedOccupiedTracks"];
const { deviceObservedOccupiedTracks } = evaluate(
  "apps/ugv-provider-adapter/src/runtime.ts",
  {},
  guardNames,
  guardNames,
);
const unowned = { owner: () => undefined };
function observe(call, prior = createUgvSnapshot()) {
  const wire = plain(call("get_status", {}));
  const normalized = normalizeMqttObservation("status/ugv", wire);
  const snapshot = applySnapshotPatch(
    prior,
    normalized.patch,
    "2026-08-26T06:30:00.000Z",
    normalized.domains,
  );
  return {
    wire: wire.chassis_task,
    track: plain(snapshot.chassis.mission),
    busy: deviceObservedOccupiedTracks(snapshot, unowned).has("chassis"),
  };
}
function boot() {
  let inertListens = 0;
  const { call } = evaluate(
    "apps/mock-ugv-device-mcp/src/main.ts",
    {
      "node:http": {
        createServer: () => ({
          listen: () => {
            inertListens += 1;
          },
        }),
      },
      "@modelcontextprotocol/sdk/server/mcp.js": {},
      "@modelcontextprotocol/sdk/server/streamableHttp.js": {},
      zod: {},
      "../../../packages/vehicle-device-mcp-client/src/index.js": {},
    },
    ["call"],
  );
  assert.equal(inertListens, 1);
  return call;
}

const checks = [];
const cold = boot();
const beforeRead = createUgvSnapshot();
beforeRead.chassis.mission = { id: "previous-observation", state: 4, progress: 100 };
for (let read = 0; read < 2; read += 1) {
  assert.deepEqual(observe(cold, beforeRead), {
    wire: { id: -1, type: -1, state: 0, progress: -1 },
    track: { state: 0 },
    busy: false,
  });
}
checks.push("cold repeated get_status normalizes to idle and clears a prior mission ID");

for (const command of ["ugv_path_follow_mission", "ugv_return_home", "ugv_move_distance"]) {
  const call = boot();
  assert.equal(call(command, { mission_id: 0 }).mission_id, 1001);
  assert.deepEqual(observe(call).track, { id: "1001", state: 0, progress: 0 });
  assert.equal(observe(call).busy, true);
  for (const [action, state, busy] of [
    ["start", 1, true],
    ["pause", 2, true],
    ["terminate", 3, false],
  ]) {
    const result = call("ugv_mission_control", { action, mission_id: 0 });
    assert.equal(result.mission_id, 1001);
    assert.equal(result.state, state);
    assert.deepEqual(observe(call).track, { id: "1001", state, progress: 0 });
    assert.equal(observe(call).busy, busy);
  }
  checks.push(
    `${command}: fallback 1001, accepted/start/pause remain occupied, terminate remains terminal`,
  );
}

const explicit = boot();
assert.equal(explicit("ugv_path_follow_mission", { mission_id: 7301 }).mission_id, 7301);
assert.equal(explicit("ugv_mission_control", { action: "start", mission_id: 0 }).mission_id, 7301);
assert.deepEqual(observe(explicit).track, { id: "7301", state: 1, progress: 0 });
assert.equal(observe(explicit).busy, true);
assert.equal(explicit("ugv_motion_stop", {}).state, 3);
assert.equal(observe(explicit).busy, false);
assert.equal(explicit("ugv_return_home", { mission_id: 0 }).mission_id, 7301);
assert.deepEqual(observe(explicit).track, { id: "7301", state: 0, progress: 0 });
assert.equal(observe(explicit).busy, true);
checks.push("explicit ID, subsequent fallback and motion-stop transitions are preserved");

process.stdout.write(
  `${JSON.stringify(
    {
      status: "PASS",
      scope:
        "actual mock call -> actual composite normalizer -> actual snapshot patch -> source-extracted unchanged occupancy functions; no MCP transport or live admission",
      node: process.version,
      typescript: ts.version,
      checks,
      sources,
    },
    null,
    2,
  )}\n`,
);
