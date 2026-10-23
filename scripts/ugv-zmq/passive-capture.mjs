import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DeploymentProfile } from "../../packages/vehicle-zmq-contract/src/index.js";

if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(
    "node --import tsx scripts/ugv-zmq/passive-capture.mjs --profile FILE --binding-directory DIR --out FILE [--duration-ms 6000]",
  );
  process.exit(0);
}
const args = process.argv.slice(2),
  options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i],
    value = args[i + 1];
  if (
    !["--profile", "--binding-directory", "--out", "--duration-ms"].includes(key) ||
    !value ||
    options.has(key)
  )
    throw Error("ZMQ_PASSIVE_ARGUMENTS_INVALID");
  options.set(key, value);
}
for (const required of ["--profile", "--binding-directory", "--out"])
  if (!options.has(required)) throw Error("ZMQ_PASSIVE_REQUIRED_ARGUMENT_MISSING");
if (existsSync(resolve(options.get("--out")))) throw Error("ZMQ_PASSIVE_OUTPUT_ALREADY_EXISTS");
const durationMs = Number(options.get("--duration-ms") ?? "6000");
if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 60_000)
  throw Error("ZMQ_PASSIVE_DURATION_INVALID");
const profile = DeploymentProfile.parse(
  JSON.parse(readFileSync(resolve(options.get("--profile")), "utf8")),
);
const bindingRoot = resolve(options.get("--binding-directory"));
const metadata = JSON.parse(readFileSync(resolve(bindingRoot, "package.json"), "utf8"));
if (metadata.name !== "zeromq" || metadata.version !== "6.8.0")
  throw Error("ZMQ_PASSIVE_BINDING_VERSION_UNEXPECTED");
const zmq = createRequire(import.meta.url)(bindingRoot);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const startedAt = new Date().toISOString();
const sources = [
  ["chassis", profile.components.chassis.publicationEndpoint, "ipc_message:"],
  ["eo", profile.components.eo.publicationEndpoint, `isr/${profile.components.eo.deviceId}/`],
  [
    "simulationEffect",
    profile.components.simulationEffect.publicationEndpoint,
    `artillery/${profile.components.simulationEffect.deviceId}/`,
  ],
];
const records = await Promise.all(
  sources.map(async ([component, endpoint, prefix]) => {
    const socket = new zmq.Subscriber({
      receiveTimeout: 500,
      linger: 0,
      receiveHighWaterMark: 1000,
      maxMessageSize: 70_000,
    });
    socket.subscribe(prefix);
    socket.connect(endpoint);
    const samples = [],
      counts = {};
    const end = performance.now() + durationMs;
    try {
      while (performance.now() < end) {
        let frames;
        try {
          frames = await socket.receive();
        } catch (error) {
          if (error.code === "EAGAIN") continue;
          throw error;
        }
        const receivedAt = new Date().toISOString();
        let key = frames[0].length <= 128 ? frames[0].toString("utf8") : "oversized_topic";
        if (component === "chassis") {
          const split = frames[0].indexOf(0x3a);
          key =
            split >= 0 && frames[0].length >= split + 25
              ? String(frames[0].readUInt32LE(split + 1))
              : "malformed";
        }
        counts[key] = (counts[key] ?? 0) + 1;
        if (counts[key] <= 2 && samples.length < 32)
          samples.push({
            receivedAt,
            frames: frames.map((bytes) => ({
              bytes: bytes.length,
              base64: bytes.toString("base64"),
              sha256: sha(bytes),
            })),
          });
      }
    } finally {
      socket.close();
    }
    return {
      component,
      endpoint,
      prefix,
      endpointConfirmation: "candidate-not-operator-confirmed",
      counts,
      samples,
    };
  }),
);
const report = {
  schemaVersion: "ugv.zmq-passive-capture/1",
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs,
  businessCommandsSent: 0,
  method: "ZMQ SUB subscriptions only; retain first two messages per observed topic/message ID",
  bindingVersion: `zeromq@${metadata.version}`,
  libzmqVersion: zmq.version,
  records,
};
writeFileSync(resolve(options.get("--out")), JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    startedAt,
    finishedAt: report.finishedAt,
    businessCommandsSent: 0,
    sources: records.map((r) => ({
      component: r.component,
      counts: r.counts,
      samples: r.samples.length,
    })),
  }),
);
