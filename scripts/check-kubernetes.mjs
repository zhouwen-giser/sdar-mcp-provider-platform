import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const directory = resolve("deploy/kubernetes");
const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
if (files.length === 0) throw new Error("No Kubernetes JSON manifests found");

const resources = files.map((file) => {
  const resource = JSON.parse(readFileSync(resolve(directory, file), "utf8"));
  if (typeof resource.apiVersion !== "string" || typeof resource.kind !== "string") {
    throw new Error(`${file}: apiVersion and kind are required`);
  }
  if (typeof resource.metadata?.name !== "string") {
    throw new Error(`${file}: metadata.name is required`);
  }
  return { file, resource };
});

const deployment = resources.find(({ resource }) => resource.kind === "Deployment")?.resource;
if (deployment === undefined) throw new Error("Runtime Deployment manifest is required");
const container = deployment.spec?.template?.spec?.containers?.find(
  (candidate) => candidate.name === "runtime",
);
if (container === undefined) throw new Error("Deployment must contain runtime container");
if (String(container.image).endsWith(":latest")) throw new Error("Runtime image must be pinned");
if (container.readinessProbe === undefined || container.livenessProbe === undefined) {
  throw new Error("Runtime deployment requires readiness and liveness probes");
}
if (deployment.spec?.template?.spec?.securityContext?.runAsNonRoot !== true) {
  throw new Error("Runtime pod must require a non-root user");
}
if (container.securityContext?.allowPrivilegeEscalation !== false) {
  throw new Error("Runtime container must disable privilege escalation");
}

const kinds = new Set(resources.map(({ resource }) => resource.kind));
for (const required of ["ConfigMap", "Service", "PodDisruptionBudget", "NetworkPolicy"]) {
  if (!kinds.has(required)) throw new Error(`${required} manifest is required`);
}
process.stdout.write(`Validated ${resources.length} Kubernetes manifests\n`);
