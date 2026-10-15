import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  receptionJournal?: VehicleReceptionJournal;
}

export interface RawMqttReception {
  receptionId: string;
  receivedAt: string;
  monotonicNanoseconds: string;
  topic: string;
  payload: Buffer;
  qos: 0 | 1 | 2;
  packetId: number | null;
  duplicateDeliveryHint: boolean;
  retainedDelivery: boolean;
}

/** Optional entrance journal; returns true only for a durably retained source-scope receipt. */
export interface VehicleReceptionJournal {
  record(reception: RawMqttReception): Promise<boolean>;
  disconnected(): Promise<void>;
  failed(): Promise<void>;
  stopped(): Promise<void>;
}

export class VehicleMqttClient {
  #client: MqttClient | undefined;
  #subscriptionsReady = false;
  #validIngressObserved = false;
  #connectionGeneration = 0;
  #disconnectRecorded = true;
  readonly #pendingReceptions = new WeakMap<object, Promise<void>>();
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
    // MQTT.js drains buffered packets via nextTick. Yield between packets so a
    // continuous simulator feed cannot starve database, gRPC, or timer callbacks.
    // Keep its serial completion/acknowledgement path; do not drop lifecycle events.
    client.handleMessage = (packet, callback) => {
      const pending = this.#pendingReceptions.get(packet);
      if (!pending) {
        setImmediate(callback);
        return;
      }
      void pending.then(
        () => setImmediate(callback),
        () => callback(new Error("VEHICLE_RECEPTION_JOURNAL_FAILED")),
      );
    };
    this.#client = client;
    client.on("connect", () => {
      this.#disconnectRecorded = false;
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
    if (this.requireValidatedIngress) client.on("error", () => this.#markDisconnected());
    client.on("message", (topic, payload, packet) => {
      const journal = this.options.receptionJournal;
      if (journal) {
        // Capture before parsing or asynchronous queuing. MQTT acknowledgement
        // waits for durable admission; the default non-journal path stays intact.
        const receivedAt = new Date().toISOString();
        const monotonicNanoseconds = process.hrtime.bigint().toString();
        const reception: RawMqttReception = {
          receptionId: randomUUID(),
          receivedAt,
          monotonicNanoseconds,
          topic,
          payload: Buffer.from(payload),
          qos: packet.qos,
          packetId: packet.messageId ?? null,
          duplicateDeliveryHint: packet.dup,
          retainedDelivery: packet.retain,
        };
        const pending = Promise.resolve()
          .then(() => journal.record(reception))
          .then((retained) => {
            try {
              this.ingress.handle(
                topic,
                reception.payload,
                packet.retain,
                reception.receivedAt,
                retained ? reception.receptionId : undefined,
              );
              this.#recordValidatedIngress();
            } catch {
              // Rejected input remains in the journal; no invalid state is applied.
            }
          })
          .catch(async () => {
            this.#markDisconnected();
            await journal.failed().catch(() => undefined);
            // Durable capture failure requires a fresh writer session. Close
            // this transport so unacknowledged QoS frames can be redelivered.
            client.options.reconnectPeriod = 0;
            client.end(true);
            throw Error("VEHICLE_RECEPTION_JOURNAL_FAILED");
          });
        this.#pendingReceptions.set(packet, pending);
        void pending.catch(() => undefined);
        return;
      }
      try {
        this.ingress.handle(topic, payload, packet.retain);
        this.#recordValidatedIngress();
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
    await this.options.receptionJournal?.stopped();
  }

  #recordValidatedIngress(): void {
    if (this.requireValidatedIngress) {
      this.#validIngressObserved = true;
      if (this.#subscriptionsReady) this.ingress.setConnected(true);
    }
  }

  #markDisconnected(): void {
    if (this.options.receptionJournal && !this.#disconnectRecorded)
      void this.options.receptionJournal.disconnected().catch(() => undefined);
    this.#disconnectRecorded = true;
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
      true,
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
