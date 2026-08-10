import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());

vi.mock("mqtt", () => ({ connect: connectMock }));

import {
  UgvMqttClient,
  UGV_MQTT_TOPICS,
  ugvMqttQos,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

describe("UGV MQTT readiness", () => {
  afterEach(() => connectMock.mockReset());

  it("requires complete SUBACK grants and one valid ingress observation", () => {
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);
    const ingress = new VehicleMqttIngress("direct_domain_json", limits());
    const client = new UgvMqttClient(options(), ingress);
    client.start();

    fake.emit("connect", { sessionPresent: false });
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);
    const callback = fake.subscriptionCallback();
    callback(
      null,
      UGV_MQTT_TOPICS.map((topic) => ({ topic, qos: ugvMqttQos(topic) })),
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);

    fake.emit("message", "/ugv/gnss", Buffer.from("not-json"), { retain: false });
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);
    fake.emit(
      "message",
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30,"longitude":114}'),
      { retain: false },
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(true);
    expect(ingress.ingestSequence()).toBe(1);
  });

  it("keeps MQTT unavailable when any subscription grant is missing", () => {
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);
    const ingress = new VehicleMqttIngress("direct_domain_json", limits());
    new UgvMqttClient(options(), ingress).start();

    fake.emit("connect", { sessionPresent: false });
    fake.subscriptionCallback()(
      null,
      UGV_MQTT_TOPICS.slice(1).map((topic) => ({ topic, qos: ugvMqttQos(topic) })),
    );
    fake.emit(
      "message",
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30,"longitude":114}'),
      { retain: false },
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);
  });

  it("rejects duplicate SUBACK grants that hide a missing topic", () => {
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);
    const ingress = new VehicleMqttIngress("direct_domain_json", limits());
    new UgvMqttClient(options(), ingress).start();

    fake.emit("connect", { sessionPresent: false });
    const grants = completeGrants();
    grants[grants.length - 1] = required(grants[0]);
    fake.subscriptionCallback()(null, grants);
    fake.emit(
      "message",
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30,"longitude":114}'),
      { retain: false },
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);
  });

  it("reconnects in the same process, resubscribes, and ignores a stale SUBACK", async () => {
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);
    const ingress = new VehicleMqttIngress("direct_domain_json", limits());
    const client = new UgvMqttClient(options(), ingress);
    client.start();

    fake.emit("connect", { sessionPresent: false });
    const staleCallback = fake.subscriptionCallback(0);
    fake.emit("offline");
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);

    fake.emit("connect", { sessionPresent: true });
    expect(fake.subscribe).toHaveBeenCalledTimes(2);
    staleCallback(null, completeGrants());
    fake.emit(
      "message",
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30,"longitude":114}'),
      { retain: false },
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);

    fake.subscriptionCallback(1)(null, completeGrants());
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(true);
    expect(connectMock).toHaveBeenCalledTimes(1);

    await client.stop();
    expect(fake.end).toHaveBeenCalledTimes(1);
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);
  });
});

function fakeMqttClient() {
  type SubscriptionCallback = (
    error: Error | null,
    grants?: { topic: string; qos: 0 | 1 }[],
  ) => void;
  const callbacks: SubscriptionCallback[] = [];
  const subscribe = vi.fn((_subscriptions: unknown, callback: SubscriptionCallback): void => {
    callbacks.push(callback);
  });
  const end = vi.fn(
    (_force: boolean, _options: Record<string, never>, callback: (error?: Error) => void): void => {
      callback();
    },
  );
  const emitter = Object.assign(new EventEmitter(), {
    subscribe,
    end,
    subscriptionCallback(index = 0): SubscriptionCallback {
      const callback = callbacks[index];
      if (callback === undefined) throw new Error("TEST_SUBSCRIPTION_CALLBACK_MISSING");
      return callback;
    },
  });
  return emitter;
}

function completeGrants() {
  return UGV_MQTT_TOPICS.map((topic) => ({ topic, qos: ugvMqttQos(topic) }));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("TEST_VALUE_REQUIRED");
  return value;
}

function options() {
  return {
    url: "mqtt://127.0.0.1:1883",
    clientId: "ugv-readiness-test",
    tlsMode: "disabled" as const,
    sessionMode: "clean" as const,
    reconnectMinMs: 100,
    reconnectMaxMs: 1_000,
  };
}

function limits() {
  return { maxPayloadBytes: 65_536, maxDepth: 16, maxNodes: 4_096, maxStringBytes: 16_384 };
}
