export const BUNDLE_SCHEMA_VERSION = 1;
export const IMAGE_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_POSTGRES_IMAGE = "postgres:17-alpine";

const sharedWebImage = Object.freeze({
  role: "pms-web",
  target: "pms-web-production",
  repository: "sdar/production-pms-web",
});

export const PRODUCTS = Object.freeze({
  ugv: Object.freeze({
    id: "ugv",
    title: "SDAR UGV Production Deployment",
    deployDirectory: "ugv",
    archiveName: "sdar-ugv-production-delivery.zip",
    stageOnlyArchiveName: "sdar-ugv-production-stage-only.zip",
    bundleRootName: "sdar-ugv-production",
    qualificationStatus: "UGV_SIMULATION_PARTIAL",
    runtimeAuthority: "direct_container",
    registryAuthority: "pms_worker",
    transportProfile: Object.freeze({
      id: "strict-intranet-plaintext",
      allowInsecureInternalTransport: true,
      tlsRequired: false,
      httpsRequired: false,
      mqttTlsRequired: false,
    }),
    providerPackage: Object.freeze({
      packageId: "builtin.isr.vehicle.ugv",
      version: "1.0.0",
      realResourceStatus: "pending",
    }),
    images: Object.freeze([
      Object.freeze({
        role: "pms-api",
        target: "pms-api-ugv-production",
        repository: "sdar/production-ugv-pms-api",
      }),
      Object.freeze({
        role: "pms-worker",
        target: "pms-worker-ugv-production",
        repository: "sdar/production-ugv-pms-worker",
      }),
      sharedWebImage,
      Object.freeze({
        role: "runtime",
        target: "ugv-production-runtime",
        repository: "sdar/production-ugv-runtime",
      }),
      Object.freeze({
        role: "adapter",
        target: "ugv-production-adapter",
        repository: "sdar/production-ugv-adapter",
      }),
    ]),
  }),
  "npc-tank": Object.freeze({
    id: "npc-tank",
    title: "SDAR NPC Tank Production Deployment",
    deployDirectory: "npc-tank",
    archiveName: "sdar-npc-tank-production-delivery.zip",
    stageOnlyArchiveName: "sdar-npc-tank-production-stage-only.zip",
    bundleRootName: "sdar-npc-tank-production",
    qualificationStatus: "NPC_TANK_SIMULATION_PARTIAL",
    runtimeAuthority: "direct_container",
    registryAuthority: "pms_worker",
    transportProfile: Object.freeze({
      id: "strict-intranet-plaintext",
      allowInsecureInternalTransport: true,
      tlsRequired: false,
      httpsRequired: false,
      mqttTlsRequired: false,
    }),
    providerPackage: Object.freeze({
      packageId: "builtin.isr.vehicle.npc-tank",
      version: "0.1.0",
      realResourceStatus: "pending",
    }),
    images: Object.freeze([
      Object.freeze({
        role: "pms-api",
        target: "pms-api-npc-tank-production",
        repository: "sdar/production-npc-tank-pms-api",
      }),
      Object.freeze({
        role: "pms-worker",
        target: "pms-worker-npc-tank-production",
        repository: "sdar/production-npc-tank-pms-worker",
      }),
      sharedWebImage,
      Object.freeze({
        role: "runtime",
        target: "npc-tank-production-runtime",
        repository: "sdar/production-npc-tank-runtime",
      }),
      Object.freeze({
        role: "adapter",
        target: "npc-tank-production-adapter",
        repository: "sdar/production-npc-tank-adapter",
      }),
    ]),
  }),
});

export const PRODUCT_IDS = Object.freeze(Object.keys(PRODUCTS));

export function productCatalog(productId) {
  const product = PRODUCTS[productId];
  if (product === undefined) throw new Error(`PRODUCTION_BUNDLE_PRODUCT_UNKNOWN:${productId}`);
  return product;
}

export function applicationImageReference(image, revision) {
  return `${image.repository}:${revision}`;
}

export function bundleImageEnvironment(revision, postgres, deployable) {
  if (!/^[0-9a-f]{40,64}$/.test(revision)) throw new Error("PRODUCTION_BUNDLE_REVISION_INVALID");
  const values = {
    BUNDLE_REVISION: revision,
    POSTGRES_IMAGE: postgres.reference,
    POSTGRES_DIGEST: postgres.digest,
    POSTGRES_DIGEST12: postgres.digest12,
    BUNDLE_DEPLOYABLE: deployable ? "true" : "false",
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
}
