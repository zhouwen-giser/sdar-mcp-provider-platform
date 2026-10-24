import { Subscriber } from "zeromq";
import { COMPONENTS, type Component, type ObserverSettings } from "./config.js";
import { stamp } from "./model.js";
import type { ZmqObservationObserver } from "./observer.js";

/** Publication subscriptions only. This driver cannot construct a command socket. */
export class ZmqSubscriptionDriver {
  #sockets: Subscriber[] = [];
  #tasks: Promise<void>[] = [];
  #stopped = false;
  #started = false;
  private stopping(): boolean {
    return this.#stopped;
  }
  constructor(
    readonly observer: ZmqObservationObserver,
    readonly settings: ObserverSettings,
  ) {
    observer.onFailure = () => {
      void this.stop();
    };
  }
  async start(): Promise<void> {
    if (this.#started) throw Error("ZMQ_SUBSCRIBER_ALREADY_STARTED");
    this.#started = true;
    if (this.observer.health.status !== "running") throw Error("ZMQ_OBSERVER_NOT_RUNNING");
    try {
      for (const component of COMPONENTS) {
        const socket = new Subscriber({
          receiveTimeout: 250,
          receiveHighWaterMark: this.settings.receiveHighWaterMark,
          maxMessageSize: 70_000,
          linger: 0,
          reconnectInterval: 100,
          reconnectMaxInterval: 1000,
        });
        this.#sockets.push(socket);
        const prefix =
          component === "chassis"
            ? "ipc_message:"
            : `${component === "eo" ? "isr" : "artillery"}/${this.observer.profile.components[component].deviceId}/`;
        const monitor = socket.events;
        socket.subscribe(prefix);
        this.observer.transport(component, "connecting");
        this.#tasks.push(
          (async () => {
            try {
              for await (const event of monitor) {
                if (this.#stopped) break;
                if (event.type === "connect")
                  this.observer.transport(component, "connected", stamp(this.observer.clockId));
                else if (event.type === "disconnect") {
                  const clock = stamp(this.observer.clockId);
                  this.observer.transport(component, "disconnected", clock);
                  this.observer.diagnostic(
                    component,
                    "TRANSPORT_DISCONNECTED_SOURCE_LOSS_UNKNOWN",
                    clock,
                  );
                } else if (event.type.startsWith("handshake:error"))
                  this.observer.diagnostic(component, "TRANSPORT_HANDSHAKE_FAILED");
              }
            } catch {
              if (!this.#stopped) this.observer.fail("ZMQ_MONITOR_FAILED");
            }
          })(),
        );
        socket.connect(this.observer.profile.components[component].publicationEndpoint);
        this.#tasks.push(this.receive(component, socket));
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private async receive(component: Component, socket: Subscriber): Promise<void> {
    try {
      while (!this.stopping()) {
        try {
          const frames = await socket.receive();
          if (this.stopping()) break;
          const clock = stamp(this.observer.clockId);
          if (!this.observer.receive(component, frames, clock)) break;
        } catch (error) {
          if (this.stopping()) break;
          if (error instanceof Error && "code" in error && error.code === "EAGAIN") continue;
          throw error;
        }
      }
    } catch {
      if (!this.#stopped) this.observer.fail("ZMQ_SUBSCRIBER_RECEIVE_FAILED");
    }
  }
  async stop(): Promise<void> {
    if (!this.#stopped) {
      this.#stopped = true;
      for (const socket of this.#sockets) {
        socket.events.close();
        socket.close();
      }
      for (const component of COMPONENTS) this.observer.transport(component, "closed");
    }
    await Promise.allSettled(this.#tasks);
  }
}
