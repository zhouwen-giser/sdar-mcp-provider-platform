export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

export class BoundedRateLimiter {
  readonly #windows = new Map<string, RateWindow>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxKeys: number,
  ) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    this.#prune(now);
    let window = this.#windows.get(key);
    if (window === undefined) {
      if (this.#windows.size >= this.maxKeys) this.#evictOldest();
      window = { startedAt: now, count: 0 };
      this.#windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
    };
  }

  get size(): number {
    return this.#windows.size;
  }

  #prune(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= this.windowMs) this.#windows.delete(key);
    }
  }

  #evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestStartedAt = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.#windows) {
      if (window.startedAt < oldestStartedAt) {
        oldestKey = key;
        oldestStartedAt = window.startedAt;
      }
    }
    if (oldestKey !== undefined) this.#windows.delete(oldestKey);
  }
}
