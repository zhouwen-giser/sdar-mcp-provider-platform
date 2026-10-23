import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const root = resolve(
  process.env.UGV_CONSOLE_STATE_DIR ?? join(homedir(), ".smpp-debug", "ugv-control-console"),
);
if (process.argv.includes("--remove")) {
  const helper = join(root, "network-remove.py");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(
    helper,
    `import subprocess,shlex,json\nmarker='smpp-ugv-control-console'\nremoved=0\nfor table,chain in [('filter','DOCKER-USER'),('nat','OUTPUT'),('nat','POSTROUTING')]:\n prefix=['/usr/sbin/iptables','-w','5','-t',table]\n for line in subprocess.check_output(prefix+['-S',chain],text=True).splitlines():\n  parts=shlex.split(line)\n  if parts[:2]==['-A',chain] and marker in parts:\n   subprocess.run(prefix+['-D',chain]+parts[2:],check=True,capture_output=True);removed+=1\nprint(json.dumps({'status':'REMOVED','removedOwnRules':removed}))\n`,
    { mode: 0o600 },
  );
  const result = docker([
    "run",
    "--rm",
    "--network",
    "host",
    "--cap-add",
    "NET_ADMIN",
    "--user",
    "0",
    "--mount",
    "type=bind,source=/,target=/host,readonly",
    process.env.UGV_CONSOLE_ADMIN_IMAGE ?? "node:22-bookworm-slim",
    "chroot",
    "/host",
    "/usr/bin/python3",
    helper,
  ]);
  console.log(result);
  process.exit(0);
}
const deployment = JSON.parse(readFileSync(join(root, "deployment.json"), "utf8"));
const inspect = (name) => JSON.parse(docker(["inspect", name]))[0];
const consoleContainer = inspect("smpp-ugv-control-console"),
  runtime = inspect(deployment.runtime),
  postgres = inspect(deployment.postgres),
  network = inspect(deployment.network);
const bridge = network.Options["com.docker.network.bridge.name"] ?? `br-${network.Id.slice(0, 12)}`;
const ingressNetworkName = Object.keys(consoleContainer.NetworkSettings.Networks).find(
  (name) => !inspect(name).Internal,
);
if (!ingressNetworkName) throw Error("CONSOLE_PUBLIC_NETWORK_REQUIRED");
const ingressNetwork = inspect(ingressNetworkName);
const ingressBridge =
  ingressNetwork.Options["com.docker.network.bridge.name"] ??
  `br-${ingressNetwork.Id.slice(0, 12)}`;
const ingressIp = consoleContainer.NetworkSettings.Networks[ingressNetworkName].IPAddress;
const ip = consoleContainer.NetworkSettings.Networks[deployment.network].IPAddress;
const targets = [
  { ip: runtime.NetworkSettings.Networks[deployment.network].IPAddress, port: 8080 },
  { ip: postgres.NetworkSettings.Networks[deployment.network].IPAddress, port: 5432 },
];
if (
  !/^br-[a-f0-9]+$/.test(bridge) ||
  !/^br-[a-f0-9]+$/.test(ingressBridge) ||
  [ip, ingressIp, ...targets.map((t) => t.ip)].some((v) => !/^\d+\.\d+\.\d+\.\d+$/.test(v))
)
  throw Error("NETWORK_IDENTITY_INVALID");
const marker = "smpp-ugv-control-console";
const rule = (table, chain, args) => ({
  table,
  chain,
  args: [...args, "-m", "comment", "--comment", marker],
});
const rules = targets.map((t) =>
  rule("filter", "DOCKER-USER", [
    "-i",
    bridge,
    "-o",
    bridge,
    "-s",
    `${ip}/32`,
    "-d",
    `${t.ip}/32`,
    "-p",
    "tcp",
    "--dport",
    String(t.port),
    "-j",
    "ACCEPT",
  ]),
);
rules.push(
  rule("filter", "DOCKER-USER", [
    "-o",
    bridge,
    "-d",
    `${ip}/32`,
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]),
);
rules.push(
  rule("filter", "DOCKER-USER", [
    "-o",
    ingressBridge,
    "-d",
    `${ingressIp}/32`,
    "-p",
    "tcp",
    "--dport",
    "19101",
    "-m",
    "conntrack",
    "--ctorigdstport",
    "19101",
    "-j",
    "ACCEPT",
  ]),
);
rules.push(
  rule("filter", "DOCKER-USER", [
    "-i",
    ingressBridge,
    "-s",
    `${ingressIp}/32`,
    "-p",
    "tcp",
    "--sport",
    "19101",
    "-m",
    "conntrack",
    "--ctstate",
    "RELATED,ESTABLISHED",
    "-j",
    "ACCEPT",
  ]),
);
rules.push(
  rule("nat", "OUTPUT", [
    "-d",
    "127.0.0.1/32",
    "-p",
    "tcp",
    "--dport",
    "19101",
    "-j",
    "DNAT",
    "--to-destination",
    `${ingressIp}:19101`,
  ]),
);
rules.push(
  rule("nat", "POSTROUTING", [
    "-s",
    "127.0.0.0/8",
    "-d",
    `${ingressIp}/32`,
    "-p",
    "tcp",
    "--dport",
    "19101",
    "-j",
    "MASQUERADE",
  ]),
);
const plan = { marker, bridge, consoleIp: ip, ingressBridge, ingressIp, targets, rules };
mkdirSync(root, { recursive: true, mode: 0o700 });
writeFileSync(join(root, "network-plan.json"), JSON.stringify(plan, null, 2) + "\n", {
  mode: 0o600,
});
const remove = process.argv.includes("--remove");
if (!remove && !process.argv.includes("--apply")) {
  console.log(JSON.stringify({ status: "PLAN_ONLY", plan }));
  process.exit(0);
}
const helper = join(root, "network-rules.py");
writeFileSync(
  helper,
  `import subprocess,shlex,json,datetime\nrules=${JSON.stringify(rules)}\nmarker=${JSON.stringify(marker)}\nremove=${remove ? "True" : "False"}\nremoved=0\nfor table,chain in [('filter','DOCKER-USER'),('nat','OUTPUT'),('nat','POSTROUTING')]:\n prefix=['/usr/sbin/iptables','-w','5','-t',table]\n for line in subprocess.check_output(prefix+['-S',chain],text=True).splitlines():\n  parts=shlex.split(line)\n  if parts[:2]==['-A',chain] and marker in parts:\n   subprocess.run(prefix+['-D',chain]+parts[2:],check=True,capture_output=True);removed+=1\nif not remove:\n for r in reversed(rules):\n  prefix=['/usr/sbin/iptables','-w','5','-t',r['table']]\n  subprocess.run(prefix+['-I',r['chain'],'1']+r['args'],check=True,capture_output=True)\n for r in rules:\n  subprocess.run(['/usr/sbin/iptables','-w','5','-t',r['table'],'-C',r['chain']]+r['args'],check=True,capture_output=True)\nprint(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'REMOVED' if remove else 'VERIFIED','ruleCount':0 if remove else len(rules),'removedOldOwnRules':removed}))\n`,
  { mode: 0o600 },
);
const adminImage = process.env.UGV_CONSOLE_ADMIN_IMAGE ?? "node:22-bookworm-slim";
const procFile = `/proc/sys/net/ipv4/conf/${ingressBridge}/route_localnet`;
const previous = readFileSync(procFile, "utf8").trim();
if (!remove && previous !== "1")
  docker([
    "run",
    "--rm",
    "--network",
    "host",
    "--cap-add",
    "NET_ADMIN",
    "--user",
    "0",
    "--mount",
    `type=bind,source=${procFile},target=/run/console-route-localnet`,
    adminImage,
    "node",
    "-e",
    "require('fs').writeFileSync('/run/console-route-localnet','1')",
  ]);
const result = JSON.parse(
  docker([
    "run",
    "--rm",
    "--network",
    "host",
    "--cap-add",
    "NET_ADMIN",
    "--user",
    "0",
    "--mount",
    "type=bind,source=/,target=/host,readonly",
    adminImage,
    "chroot",
    "/host",
    "/usr/bin/python3",
    helper,
  ]),
);
const receipt = {
  ...result,
  plan,
  routeLocalnetBefore: previous,
  routeLocalnetAfter: readFileSync(procFile, "utf8").trim(),
};
writeFileSync(join(root, "network-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", {
  mode: 0o600,
});
console.log(JSON.stringify(receipt));
