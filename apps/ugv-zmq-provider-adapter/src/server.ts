import { siteControlManifest } from "../../../packages/vehicle-zmq-control/src/site-control-catalog.js";
import { siteControlV13Manifest } from "../../../packages/vehicle-zmq-control/src/site-control-v13.js";
import {
  VehicleProviderGrpcServer,
  type ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import { zmqProviderManifest } from "../../../packages/vehicle-zmq-control/src/catalog.js";
import { type ZmqProviderRuntime, protoTime } from "./runtime.js";
import type { ZmqBusinessEvents } from "./business.js";
export function zmqServer(
  runtime: ZmqProviderRuntime,
  store: ProviderStore,
  events: ZmqBusinessEvents,
  port = 0,
  host = "127.0.0.1",
) {
  const providerId = runtime.engine.scope.profile.providerBinding.providerId ?? "";
  return new VehicleProviderGrpcServer(
    {
      host,
      port,
      tlsMode: "disabled",
      internalErrorCode: "ZMQ_PROVIDER_ERROR",
      manifest: () =>
        (runtime.v13
          ? siteControlV13Manifest
          : runtime.siteReads
            ? siteControlManifest
            : zmqProviderManifest)(providerId, runtime.resourceId, store),
      resource: (s) => ({
        resourceId: runtime.resourceId,
        resourceType: "isr.vehicle.ugv.zmq",
        displayName: "ZMQ UGV",
        enabled: true,
        health: s.archive.status === "running" ? "degraded" : "unknown",
        metadata: jsonToProtoStruct({
          qualification: runtime.siteReads ? "site_control" : "isolated_simulator_only",
          executionModes: runtime.siteReads ? ["live"] : ["simulation"],
          completeEvidence: false,
          catalogProfile: runtime.catalogProfile,
        }),
        lastSeenAt: protoTime(s.generatedAt),
      }),
    },
    runtime,
    store,
    events,
  );
}
