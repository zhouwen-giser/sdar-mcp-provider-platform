import { afterEach, describe, expect, it, vi } from "vitest";

const mqtt = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const publish = vi.fn();
  const end = vi.fn();
  const client = {
    connected: true,
    on: vi.fn((event: string, listener: () => void) => {
      handlers.set(event, listener);
      return client;
    }),
    publish,
    end,
  };
  return { client, connect: vi.fn(() => client), handlers, publish };
});

vi.mock("mqtt", () => ({ connect: mqtt.connect }));

import {
  NPC_TANK_MQTT_TOPICS,
  normalizeNpcTankMqttObservation,
  npcTankMqttQos,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mock NPC Tank MQTT publisher regression fixture", () => {
  it("publishes one valid modern payload for every one of the 18 exact topics", async () => {
    // This only protects the local deterministic fixture. It is not Goal 11
    // real-interface evidence and must never be used as qualification proof.
    vi.useFakeTimers();
    vi.spyOn(process, "once").mockReturnValue(process);
    await import("./main.js");

    const onConnect = mqtt.handlers.get("connect");
    if (onConnect === undefined) throw new Error("MOCK_NPC_TANK_CONNECT_HANDLER_MISSING");
    onConnect();

    expect(mqtt.publish).toHaveBeenCalledTimes(18);
    const published = new Map(
      mqtt.publish.mock.calls.map(([topic, payload, options]) => [
        topic as string,
        { payload: payload as string, options: options as { qos: number } },
      ]),
    );
    expect([...published.keys()]).toEqual(NPC_TANK_MQTT_TOPICS);
    for (const topic of NPC_TANK_MQTT_TOPICS) {
      const message = published.get(topic);
      if (message === undefined) throw new Error(`MOCK_NPC_TANK_TOPIC_MISSING:${topic}`);
      expect(message.options.qos, topic).toBe(npcTankMqttQos(topic));
      expect(() =>
        normalizeNpcTankMqttObservation(topic as never, JSON.parse(message.payload) as unknown),
      ).not.toThrow();
    }
  });
});
