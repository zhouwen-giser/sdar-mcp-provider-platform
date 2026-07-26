import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const example = resolve(root, "examples/mock-adapter-python");
const generated = resolve(example, "generated");
const protoDirectory = resolve(root, "proto/io/sdar/mcp/tasks/adapter/v1");
const temporary = mkdtempSync(resolve(tmpdir(), "sdar-python-adapter-"));
const sitePackages = resolve(temporary, "site-packages");
const python = "python3";
const pythonEnvironment = {
  ...process.env,
  PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(":"),
};

const reservePort = () =>
  new Promise((resolvePort, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a TCP port"));
        return;
      }
      socket.close(() => resolvePort(address.port));
    });
  });

let child;
try {
  execFileSync(
    python,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--target",
      sitePackages,
      "-r",
      resolve(example, "requirements.txt"),
    ],
    { stdio: "inherit", env: pythonEnvironment },
  );
  const grpcInclude = execFileSync(
    python,
    [
      "-c",
      "import pathlib, grpc_tools; print(pathlib.Path(grpc_tools.__file__).parent / '_proto')",
    ],
    { encoding: "utf8", env: pythonEnvironment },
  ).trim();
  execFileSync(
    python,
    [
      "-m",
      "grpc_tools.protoc",
      `-I${protoDirectory}`,
      `-I${grpcInclude}`,
      `--python_out=${generated}`,
      `--grpc_python_out=${generated}`,
      resolve(protoDirectory, "adapter.proto"),
    ],
    { stdio: "inherit", env: pythonEnvironment },
  );
  const grpcModule = resolve(generated, "adapter_pb2_grpc.py");
  writeFileSync(
    grpcModule,
    readFileSync(grpcModule, "utf8").replace("import adapter_pb2", "from . import adapter_pb2"),
  );

  const port = await reservePort();
  child = spawn(python, ["adapter.py"], {
    cwd: example,
    env: {
      ...pythonEnvironment,
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(port),
      PROVIDER_ID: "python-smoke",
    },
    stdio: "inherit",
  });
  const { GrpcAdapterGateway } = await import("../dist/packages/adapter-protocol/src/index.js");
  const gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "python-smoke",
    timeoutMs: 1_000,
  });
  let manifest;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      manifest = await gateway.describeProvider();
      break;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  gateway.close();
  if (manifest?.providerId !== "python-smoke")
    throw lastError ?? new Error("Python Adapter returned an invalid manifest");
  process.stdout.write(`Python Adapter DescribeProvider PASS (${manifest.providerId})\n`);
} finally {
  child?.kill("SIGTERM");
  rmSync(temporary, { recursive: true, force: true });
}
