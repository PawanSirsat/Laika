/**
 * In-process token bucket (SPEC §6.3, D-002 — no Redis).
 *
 * One process, one map. That is a real constraint and worth stating: the limits
 * are per-process, so they are exact for Laika's single-container deployment and
 * would need rethinking the day that stops being true. §1 makes that a product
 * commitment rather than an accident, so the simple thing is the correct thing.
 *
 * A token bucket rather than a fixed window because a fixed window lets a client
 * spend its whole allowance in the last instant of one window and again in the
 * first instant of the next — twice the intended rate across the boundary. A
 * bucket refills continuously, so the limit holds everywhere.
 */

export interface Bucket {
  /** Tokens available, fractional between refills. */
  tokens: number;
  lastRefillMs: number;
}

export interface LimitPolicy {
  /** Sustained rate. */
  perMinute: number;
  /** Burst size. Defaults to one minute's worth. */
  burst?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until one token is available. Only meaningful when denied. */
  retryAfterSeconds: number;
  remaining: number;
}

/** SPEC §6.3, verbatim. */
export const LIMITS = {
  /** Per personal access token — keyed on the token, not its owner (LAI-138). */
  token: { perMinute: 120 },
  /** Per cookie session. */
  session: { perMinute: 600 },
  /** Heartbeats are frequent and cheap, and get their own budget (§9.1). */
  heartbeat: { perMinute: 30 },
} as const satisfies Record<string, LimitPolicy>;

export type LimitName = keyof typeof LIMITS;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Take one token for `key` under `policy`.
   *
   * The key is supplied by the caller — token id, session id, or user id — so
   * this class never has to know how a request was authenticated.
   */
  take(key: string, policy: LimitPolicy): RateLimitDecision {
    const capacity = policy.burst ?? policy.perMinute;
    const perMs = policy.perMinute / 60_000;
    const now = this.now();

    const bucket = this.buckets.get(key) ?? { tokens: capacity, lastRefillMs: now };

    // Continuous refill: elapsed time converts straight into tokens, capped.
    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * perMs);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      this.buckets.set(key, bucket);

      return {
        allowed: false,
        // Always at least a second: `Retry-After: 0` invites an immediate retry
        // that is guaranteed to fail again.
        retryAfterSeconds: Math.max(1, Math.ceil(deficit / perMs / 1000)),
        remaining: 0,
      };
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);

    return { allowed: true, retryAfterSeconds: 0, remaining: Math.floor(bucket.tokens) };
  }

  /**
   * Drop buckets that have refilled completely.
   *
   * Without this the map grows once per distinct key forever, which for
   * token-authenticated agents means a slow leak that only shows up in a
   * long-running container — exactly the deployment Laika is.
   */
  prune(policy: LimitPolicy = LIMITS.session): number {
    const capacity = policy.burst ?? policy.perMinute;
    const perMs = policy.perMinute / 60_000;
    const now = this.now();
    let removed = 0;

    for (const [key, bucket] of this.buckets) {
      const refilled = bucket.tokens + (now - bucket.lastRefillMs) * perMs;
      if (refilled >= capacity) {
        this.buckets.delete(key);
        removed++;
      }
    }

    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
