/**
 * A small consecutive-failure circuit breaker for a semantic provider.
 *
 * State is per process. In a serverless deployment each instance keeps its
 * own breaker, which is the correct failure-isolation behavior for a
 * best-effort shadow signal (documented in docs/semantic/SHADOW_MODE.md);
 * durable provider health comes from the persisted evidence rows instead.
 */
export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.openMs ? "half_open" : "open";
  }

  /** Whether a call may proceed. In half-open state exactly one probe is admitted at a time. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === "closed") return true;
    if (state === "open") return false;
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    this.probeInFlight = false;
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  snapshot(): { state: BreakerState; consecutiveFailures: number } {
    return { state: this.state, consecutiveFailures: this.failures };
  }
}

const registry = new Map<string, CircuitBreaker>();

/** One breaker per provider+model, shared across requests in this process. */
export function breakerFor(key: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = registry.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(options);
    registry.set(key, breaker);
  }
  return breaker;
}

export function resetBreakersForTests(): void {
  registry.clear();
}

export function snapshotBreakers(): { key: string; state: BreakerState; consecutiveFailures: number }[] {
  return [...registry.entries()].map(([key, b]) => ({ key, ...b.snapshot() }));
}
