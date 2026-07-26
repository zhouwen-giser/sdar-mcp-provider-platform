import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  writeAdapterComponentReport,
  writeProtocolV1Summary,
} from "./protocol/component-conformance-reports.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for conformance");

const root = process.cwd();
const temporary = mkdtempSync(resolve(tmpdir(), "sdar-conformance-"));
const reportsDirectory = resolve(root, "reports/conformance");
mkdirSync(reportsDirectory, { recursive: true });
const validateReport = new Ajv2020({
  strict: true,
  formats: { "date-time": true },
}).compile(
  JSON.parse(
    readFileSync(resolve(root, "packages/conformance-testkit/report.schema.json"), "utf8"),
  ),
);

const { GrpcAdapterGateway } = await import("../dist/packages/adapter-protocol/src/index.js");
const { runConformance, seedAndVerifyAdapterBinding, verifyAdapterBinding } =
  await import("../dist/packages/conformance-testkit/src/index.js");
const { bindMockAdapter, createMockAdapterServer } =
  await import("../dist/examples/mock-adapter-typescript/src/server.js");

const reports = [];
let typescriptServer;
let pythonChild;
try {
  const typescriptState = resolve(temporary, "typescript-state.json");
  const firstTypescriptPort = await reservePort();
  typescriptServer = createMockAdapterServer({
    providerId: "conformance-typescript",
    statePath: typescriptState,
  });
  await bindMockAdapter(typescriptServer, `127.0.0.1:${String(firstTypescriptPort)}`);
  const typescriptBinding = await seedAndVerifyAdapterBinding(
    `127.0.0.1:${String(firstTypescriptPort)}`,
    "conformance-typescript",
  );
  await shutdownGrpcServer(typescriptServer);
  const secondTypescriptPort = await reservePort();
  typescriptServer = createMockAdapterServer({
    providerId: "conformance-typescript",
    statePath: typescriptState,
  });
  await bindMockAdapter(typescriptServer, `127.0.0.1:${String(secondTypescriptPort)}`);
  const typescriptEndpoint = `127.0.0.1:${String(secondTypescriptPort)}`;
  await verifyAdapterBinding(typescriptEndpoint, "conformance-typescript", typescriptBinding);
  reports.push(
    await runConformance({
      language: "typescript",
      endpoint: typescriptEndpoint,
      providerId: "conformance-typescript",
      databaseUrl,
      restartBindingVerified: true,
    }),
  );
  await shutdownGrpcServer(typescriptServer);
  typescriptServer = undefined;

  const python = preparePython(temporary);
  const pythonState = resolve(temporary, "python-state.json");
  const firstPythonPort = await reservePort();
  pythonChild = startPython(python, firstPythonPort, pythonState);
  await waitForAdapter(`127.0.0.1:${String(firstPythonPort)}`, "conformance-python");
  const pythonBinding = await seedAndVerifyAdapterBinding(
    `127.0.0.1:${String(firstPythonPort)}`,
    "conformance-python",
  );
  await stopChild(pythonChild);
  const secondPythonPort = await reservePort();
  pythonChild = startPython(python, secondPythonPort, pythonState);
  const pythonEndpoint = `127.0.0.1:${String(secondPythonPort)}`;
  await waitForAdapter(pythonEndpoint, "conformance-python");
  await verifyAdapterBinding(pythonEndpoint, "conformance-python", pythonBinding);
  reports.push(
    await runConformance({
      language: "python",
      endpoint: pythonEndpoint,
      providerId: "conformance-python",
      databaseUrl,
      restartBindingVerified: true,
    }),
  );

  for (const report of reports) {
    if (!validateReport(report)) {
      throw new Error(
        `Invalid ${report.adapterLanguage} conformance report: ${JSON.stringify(validateReport.errors)}`,
      );
    }
    const caseCount = report.groups.reduce((total, group) => total + group.tests.length, 0);
    if (
      caseCount < 17 ||
      report.scopes.adapterProtocol.status !== "passed" ||
      report.scopes.runtimeProfile.status !== "partial" ||
      report.scopes.resourceSpecificSafety.status !== "not_claimed"
    ) {
      throw new Error(
        `${report.adapterLanguage} conformance scope/count guard failed: ${JSON.stringify({
          caseCount,
          adapterProtocol: report.scopes.adapterProtocol.status,
          runtimeProfile: report.scopes.runtimeProfile.status,
          resourceSpecificSafety: report.scopes.resourceSpecificSafety.status,
          failedTests: report.groups.flatMap((group) =>
            group.tests
              .filter((test) => test.status === "failed")
              .map((test) => ({ group: group.id, name: test.name, error: test.error })),
          ),
        })}`,
      );
    }
    writeFileSync(
      resolve(reportsDirectory, `${report.adapterLanguage}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    writeAdapterComponentReport(report, root);
  }
  writeProtocolV1Summary(root);
  const failed = reports.filter((report) => report.status !== "passed");
  if (failed.length > 0) {
    for (const report of failed) {
      for (const group of report.groups) {
        for (const test of group.tests.filter((value) => value.status === "failed")) {
          process.stderr.write(
            `::error file=reports/conformance/${report.adapterLanguage}.json::${report.adapterLanguage} ${group.id} ${test.name}: ${test.error ?? "failed"}\n`,
          );
        }
      }
    }
    throw new Error(
      `Conformance failed: ${failed.map((report) => report.adapterLanguage).join(", ")}`,
    );
  }
  process.stdout.write(
    `Expanded Adapter conformance PASS; Runtime Profile scope is partial and resource safety is not claimed (${reports.map((report) => report.adapterLanguage).join(", ")})\n`,
  );
} finally {
  if (typescriptServer) await shutdownGrpcServer(typescriptServer);
  if (pythonChild) await stopChild(pythonChild);
  rmSync(temporary, { recursive: true, force: true });
}

function preparePython(directory) {
  const python =
    process.env.SDAR_CONFORMANCE_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const sitePackages = resolve(directory, "site-packages");
  const example = resolve(root, "examples/mock-adapter-python");
  const generated = resolve(example, "generated");
  const protoDirectory = resolve(root, "proto/io/sdar/mcp/tasks/adapter/v1");
  const telemetryProtoDirectory = resolve(root, "proto/io/sdar/mcp/tasks/telemetry/v1");
  const environment = {
    ...process.env,
    PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
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
    { stdio: "inherit", env: environment },
  );
  const grpcInclude = execFileSync(
    python,
    [
      "-c",
      "import pathlib, grpc_tools; print(pathlib.Path(grpc_tools.__file__).parent / '_proto')",
    ],
    { encoding: "utf8", env: environment },
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
    { stdio: "inherit", env: environment },
  );
  const grpcModule = resolve(generated, "adapter_pb2_grpc.py");
  writeFileSync(
    grpcModule,
    readFileSync(grpcModule, "utf8").replace("import adapter_pb2", "from . import adapter_pb2"),
  );
  execFileSync(
    python,
    [
      "-m",
      "grpc_tools.protoc",
      `-I${telemetryProtoDirectory}`,
      `-I${grpcInclude}`,
      `--python_out=${generated}`,
      `--grpc_python_out=${generated}`,
      resolve(telemetryProtoDirectory, "provider_telemetry.proto"),
    ],
    { stdio: "inherit", env: environment },
  );
  const telemetryGrpcModule = resolve(generated, "provider_telemetry_pb2_grpc.py");
  writeFileSync(
    telemetryGrpcModule,
    readFileSync(telemetryGrpcModule, "utf8").replace(
      "import provider_telemetry_pb2",
      "from . import provider_telemetry_pb2",
    ),
  );
  const telemetrySelfTest = execFileSync(python, ["provider_telemetry.py", "--self-test"], {
    cwd: example,
    encoding: "utf8",
    env: environment,
  });
  const telemetryResult = JSON.parse(telemetrySelfTest);
  if (telemetryResult.eventCount !== 4) {
    throw new Error("Python Provider telemetry conformance did not construct all event classes");
  }
  return { executable: python, environment, example };
}

function startPython(python, port, statePath) {
  return spawn(python.executable, ["adapter.py"], {
    cwd: python.example,
    env: {
      ...python.environment,
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(port),
      ADAPTER_STATE_PATH: statePath,
      PROVIDER_ID: "conformance-python",
    },
    stdio: "inherit",
  });
}

async function waitForAdapter(endpoint, providerId) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const gateway = new GrpcAdapterGateway({ endpoint, providerId, timeoutMs: 500 });
    try {
      await gateway.describeProvider();
      gateway.close();
      return;
    } catch (error) {
      lastError = error;
      gateway.close();
      await delay(250);
    }
  }
  throw lastError ?? new Error(`Adapter ${providerId} did not start`);
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
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
}

function shutdownGrpcServer(server) {
  return new Promise((resolveShutdown) => server.tryShutdown(() => resolveShutdown()));
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}
