interface Entry {
  run(): Promise<void>;
}
/** Work is one bounded store/send step. Long observation waits never enter this queue. */
export class ControlLane {
  #ordinary: Entry[] = [];
  #priority: Entry[] = [];
  #running = false;
  #waiters: (() => void)[] = [];
  enqueue<T>(work: () => Promise<T>, priority = false): Promise<T> {
    if (!priority && this.#ordinary.length >= 64)
      return Promise.reject(Error("ZMQ_CONTROL_QUEUE_EXHAUSTED"));
    return new Promise<T>((resolve, reject) => {
      (priority ? this.#priority : this.#ordinary).push({
        run: async () => {
          try {
            resolve(await work());
          } catch (error) {
            reject(error instanceof Error ? error : Error("ZMQ_QUEUE_WORK_FAILED"));
          }
        },
      });
      void this.drain();
    });
  }
  private async drain() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#priority.length || this.#ordinary.length)
        await (this.#priority.shift() ?? this.#ordinary.shift())?.run();
    } finally {
      this.#running = false;
      for (const resolve of this.#waiters.splice(0)) resolve();
    }
  }
  idle(): Promise<void> {
    return this.#running
      ? new Promise((resolve) => this.#waiters.push(resolve))
      : Promise.resolve();
  }
}
