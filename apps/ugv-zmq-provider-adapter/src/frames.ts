import { randomUUID } from "node:crypto";
import {
  FrameSettings,
  FrameObservationIndex,
  FrameService,
  NativeFrameClient,
} from "../../../packages/vehicle-zmq-frames/src/index.js";
import type { ZmqObservationObserver } from "../../../packages/vehicle-zmq-observer/src/index.js";
import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/types.js";
export function openFrames(
  observer: ZmqObservationObserver,
  store: ProviderStore,
  settingsInput?: unknown,
) {
  const eo = observer.profile.components.eo;
  if (eo.protocolVersion !== "2.3") {
    if (settingsInput !== undefined) throw Error("ZMQ_FRAME_NATIVE_VERSION_REQUIRED");
    return undefined;
  }
  const settings = FrameSettings.parse(settingsInput ?? {});
  if (!eo.framePullEndpoint) return undefined;
  const index = new FrameObservationIndex();
  const unsubscribe = observer.subscribeCommitted((entry) => {
    if (entry.payload.type === "reception" && observer.sessionId)
      index.observe(entry.payload, observer.sessionId);
  });
  const service = new FrameService(
    observer.profile.providerBinding.resourceId ?? "",
    new NativeFrameClient(eo.framePullEndpoint, eo.deviceId, settings),
    index,
    settings,
    async (record) => {
      const at = new Date().toISOString();
      await store.putSnapshot({
        revision: `frame-access:${randomUUID()}`,
        observedAt: at,
        channel: "zmq_control",
        snapshot: { ...record, recordedAt: at },
      });
    },
  );
  return {
    service,
    close() {
      unsubscribe();
      service.close();
    },
  };
}
