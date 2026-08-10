import { readFileSync } from "node:fs";
import { connect, type IClientOptions, type MqttClient } from "mqtt";
import type { VehicleSnapshot } from "../../vehicle-provider-core/src/index.js";
import type { VehicleMqttIngress } from "./ingress.js";
import {
  assertExactNpcTankSubscriptions,
  assertExactSubscriptions,
  npcTankMqttQos,
  NPC_TANK_MQTT_TOPICS,
  ugvMqttQos,
  UGV_MQTT_TOPICS,
} from "./topics.js";

export interface UgvMqttClientOptions {
  url: string;
  clientId: string;
  username?: string;
  passwordFile?: string;
  tlsMode: "disabled" | "required";
  tlsCaPath?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  sessionMode: "clean" | "persistent";
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

export class VehicleMqttClient {
  #client: MqttClient | undefined;
  #subscriptionsReady = false;
  #validIngressObserved = false;
  #connectionGeneration = 0;
  constructor(
    readonly options: UgvMqttClientOptions,
    readonly ingress: VehicleMqttIngress<VehicleSnapshot>,
    readonly topics: readonly string[],
    readonly validateSubscriptions: (topics: readonly string[]) => void,
    readonly qosForTopic: (topic: string) => 0 | 1,
    readonly errorPrefix: "UGV" | "NPC_TANK",
    readonly requireValidatedIngress = false,
  ) {}
  start(): void {
    if (this.#client !== undefined) return;
    this.validateSubscriptions(this.topics);
    const client = connect(this.options.url, mqttOptions(this.options));
    this.#client = client;
    client.on("connect", () => {
      const generation = ++this.#connectionGeneration;
      this.#subscriptionsReady = false;
      this.#validIngressObserved = false;
      if (!this.requireValidatedIngress) {
        this.ingress.setConnected(true);
        for (const topic of this.topics) client.subscribe(topic, { qos: this.qosForTopic(topic) });
        return;
      }
      this.ingress.setConnected(false);
      const subscriptions = Object.fromEntries(
        this.topics.map((topic) => [topic, { qos: this.qosForTopic(topic) }]),
      ) as Record<string, { qos: 0 | 1 }>;
      client.subscribe(subscriptions, (error, granted = []) => {
        if (generation !== this.#connectionGeneration) return;
        if (error !== null) return this.ingress.setConnected(false);
        const grantedTopics = new Set(granted.map((grant) => grant.topic));
        if (
          granted.length !== this.topics.length ||
          grantedTopics.size !== this.topics.length ||
          this.topics.some(
            (topic) =>
              !grantedTopics.has(topic) ||
              granted.find((grant) => grant.topic === topic)?.qos !== this.qosForTopic(topic),
          )
        )
          return this.ingress.setConnected(false);
        this.#subscriptionsReady = true;
        if (this.#validIngressObserved) this.ingress.setConnected(true);
      });
    });
    client.on("offline", () => this.#markDisconnected());
    client.on("close", () => this.#markDisconnected());
    client.on("error", () => this.#markDisconnected());
    client.on("message", (topic, payload, packet) => {
      try {
        this.ingress.handle(topic, payload, packet.retain);
        if (this.requireValidatedIngress) {
          this.#validIngressObserved = true;
          if (this.#subscriptionsReady) this.ingress.setConnected(true);
        }
      } catch {
        // Malformed messages are isolated; callers observe rejection telemetry separately.
      }
    });
  }
  async stop(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    if (client !== undefined)
      await new Promise<void>((resolve, reject) =>
        client.end(false, {}, (error) => (error === undefined ? resolve() : reject(error))),
      );
    this.#markDisconnected();
  }

  #markDisconnected(): void {
    this.#connectionGeneration++;
    this.#subscriptionsReady = false;
    this.#validIngressObserved = false;
    this.ingress.setConnected(false);
  }
}

export class UgvMqttClient extends VehicleMqttClient {
  constructor(options: UgvMqttClientOptions, ingress: VehicleMqttIngress) {
    super(options, ingress, UGV_MQTT_TOPICS, assertExactSubscriptions, ugvMqttQos, "UGV", true);
  }
}

export class NpcTankMqttClient extends VehicleMqttClient {
  constructor(options: UgvMqttClientOptions, ingress: VehicleMqttIngress<VehicleSnapshot>) {
    super(
      options,
      ingress,
      NPC_TANK_MQTT_TOPICS,
      assertExactNpcTankSubscriptions,
      npcTankMqttQos,
      "NPC_TANK",
    );
  }
}

function mqttOptions(options: UgvMqttClientOptions): IClientOptions {
  if (!options.clientId) throw new Error("UGV_MQTT_CLIENT_ID_REQUIRED");
  if (
    options.tlsMode === "required" &&
    (!options.tlsCaPath || !options.tlsCertPath || !options.tlsKeyPath)
  )
    throw new Error("UGV_MQTT_MTLS_FILES_REQUIRED");
  return {
    clientId: options.clientId,
    clean: options.sessionMode === "clean",
    reconnectPeriod: options.reconnectMinMs,
    connectTimeout: options.reconnectMaxMs,
    ...(options.username === undefined ? {} : { username: options.username }),
    ...(options.passwordFile === undefined
      ? {}
      : { password: readFileSync(options.passwordFile, "utf8").trim() }),
    ...(options.tlsCaPath === undefined ? {} : { ca: readFileSync(options.tlsCaPath) }),
    ...(options.tlsCertPath === undefined ? {} : { cert: readFileSync(options.tlsCertPath) }),
    ...(options.tlsKeyPath === undefined ? {} : { key: readFileSync(options.tlsKeyPath) }),
    rejectUnauthorized: options.tlsMode === "required",
    resubscribe: true,
  };
}
