interface Entry {
  ready: boolean;
  run(): Promise<void>;
}

/** One writer; controls may pass observations whose durable prerequisite is pending. */
export class MutationQueue {
  readonly #ordered: Entry[] = [];
  readonly #controls: Entry[] = [];
  readonly #idleWaiters = new Set<() => void>();
  #running = false;

  enqueue<T>(work: () => Promise<T>, prerequisite?: Promise<unknown>, control = false): Promise<T> {
    let failure: { error: unknown } | undefined;
    const result = new Promise<T>((resolve, reject) => {
      const entry: Entry = {
        ready: prerequisite === undefined,
        run: async () => {
          try {
            if (failure) throw failure.error;
            resolve(await work());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      };
      (control ? this.#controls : this.#ordered).push(entry);
      if (prerequisite) {
        void prerequisite.then(
          () => {
            entry.ready = true;
            void this.#drain();
          },
          (error: unknown) => {
            failure = { error };
            entry.ready = true;
            void this.#drain();
          },
        );
      }
      void this.#drain();
    });
    return result;
  }

  idle(): Promise<void> {
    if (!this.#running && !this.#ordered.length && !this.#controls.length) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (;;) {
        const queue = this.#controls.length ? this.#controls : this.#ordered;
        if (!queue[0]?.ready) break;
        await queue.shift()?.run();
      }
    } finally {
      this.#running = false;
      if (!this.#ordered.length && !this.#controls.length) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }
}
