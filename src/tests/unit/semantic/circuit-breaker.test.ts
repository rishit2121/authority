import { describe, expect, it } from "vitest";

import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";

describe("CircuitBreaker", () => {
  it("opens after the threshold of consecutive failures and blocks calls", () => {
    const t = 0;
    const b = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, now: () => t });
    for (let i = 0; i < 2; i += 1) {
      expect(b.tryAcquire()).toBe(true);
      b.recordFailure();
    }
    expect(b.state).toBe("closed");
    b.tryAcquire();
    b.recordFailure();
    expect(b.state).toBe("open");
    expect(b.tryAcquire()).toBe(false);
  });

  it("a success resets the failure streak", () => {
    const b = new CircuitBreaker({ failureThreshold: 2 });
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    expect(b.state).toBe("closed");
  });

  it("goes half-open after the cool-down and admits exactly one probe", () => {
    let t = 0;
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, now: () => t });
    b.recordFailure();
    t = 1500;
    expect(b.state).toBe("half_open");
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
  });

  it("closes again when the probe succeeds and re-opens when it fails", () => {
    let t = 0;
    const b = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, now: () => t });
    b.recordFailure();
    t = 1500;
    b.tryAcquire();
    b.recordSuccess();
    expect(b.state).toBe("closed");
    b.recordFailure();
    t = 3000;
    b.tryAcquire();
    b.recordFailure();
    expect(b.state).toBe("open");
    expect(b.tryAcquire()).toBe(false);
  });
});
