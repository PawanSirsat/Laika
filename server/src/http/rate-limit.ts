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
  /**
   * A collector's reports (§6.3, D-079, LAI-751): a bucket of 30, refilled
   * one every 120 seconds — so a burst of 30, then one every two minutes; up
   * to 60 in a first hour, 30 an hour after that. One sync per ten minutes is
   * what a collector is told to keep to; this is five times that, so only a
   * broken loop meets it.
   */
  localActivity: { perMinute: 0.5, burst: 30 },
  /**
   * OpenTelemetry metrics (LAI-773): Claude Code exports once a minute per
   * running session, so a developer with five open is five a minute. Twelve a
   * minute and a burst of sixty — a retried backlog after an outage — on its
   * own bucket, so telemetry never spends the agent's API budget.
   */
  otlp: { perMinute: 12, burst: 60 },
  /**
   * Devices claiming pairing codes (LAI-1050, plan LAI-1042 §E.8): one bucket
   * for every anonymous claim, **120 at once, then 20 a minute** — sized above
   * `pairingFailures`, so it is the failure budget, not this, that stops a
   * guesser. Kept apart from the shared anonymous bucket so a guessing loop
   * neither spends the sign-in page's budget nor hides in it.
   *
   * **A shared anonymous bucket can always be drained** by anyone willing to
   * send the traffic; that is what "shared" means. The defence is making it
   * large enough that draining takes real, sustained load. Keys per address
   * wait for a trusted-proxy setting (see `rateLimitMiddleware`).
   */
  pairing: { perMinute: 20, burst: 120 },
  /**
   * A device polling one pairing request to complete it (LAI-1050): the CLI
   * asks every two seconds until the owner decides, so per request id.
   */
  pairingComplete: { perMinute: 40, burst: 10 },
  /**
   * Failed claims — a code that is unknown, malformed, expired or finished —
   * on one shared key (LAI-1050). **600 an hour, a burst of 60**, spent only
   * by a failure and checked before every claim.
   *
   * The entropy behind the number: a code is 40 bits, and at most five are
   * live per owner, so one guess hits with probability ≤ 5U / 2^40 on a
   * board of U owners. A guesser holding this bucket empty all day makes
   * 600 × 24 = 14,400 guesses, an expected 14,400 × 5U / 1.1e12 ≈ 6.5e-8 × U
   * hits — about one in 150,000 days on a board of 100 owners, each with
   * five codes open the whole time. Draining it to lock pairing out takes
   * 600 failed claims an hour, sustained.
   *
   * Completing does **not** spend it (PR #205 review): a request id is a
   * ULID nobody guesses, and each request caps its own bad signatures.
   */
  pairingFailures: { perMinute: 10, burst: 60 },
} as const satisfies Record<string, LimitPolicy>;

export type LimitName = keyof typeof LIMITS;

/**
 * How many buckets one limiter holds at most (LAI-1050 review, B2).
 *
 * Bucket keys come from requests — a token id, a user id, a pairing request
 * id an anonymous caller chose — so without a bound the map grows for as long
 * as someone keeps sending new ones. Past the cap, refilled buckets go first,
 * as `prune` does: a full bucket is what a missing key gives back, so dropping
 * one changes nothing. If that is not enough, the least recently used go.
 *
 * Evicting a bucket that is not full **forgets a spend**, so its key starts
 * again from a full bucket. That gives a caller more, never less, and buying
 * it means sending this many requests to new keys first.
 */
export const MAX_BUCKETS = 50_000;

interface StoredBucket extends Bucket {
  capacity: number;
  perMs: number;
}

export class RateLimiter {
  /** Insertion order is use order: every touch moves a key to the end. */
  private readonly buckets = new Map<string, StoredBucket>();
  private readonly now: () => number;
  private readonly maxBuckets: number;
  private lastPruneMs = Number.NEGATIVE_INFINITY;

  constructor(now: () => number = Date.now, maxBuckets: number = MAX_BUCKETS) {
    this.now = now;
    this.maxBuckets = maxBuckets;
  }

  /**
   * Take one token for `key` under `policy`.
   *
   * The key is supplied by the caller — token id, session id, or user id — so
   * this class never has to know how a request was authenticated.
   */
  take(key: string, policy: LimitPolicy): RateLimitDecision {
    const bucket = this.refilled(key, policy);
    const decision = decide(bucket);
    if (decision.allowed) bucket.tokens -= 1;
    this.store(key, bucket);
    return decision.allowed ? { ...decision, remaining: Math.floor(bucket.tokens) } : decision;
  }

  /**
   * Whether `take` would be refused now, without taking anything. For a
   * bucket only failures spend: every attempt asks, only a failure takes.
   */
  peek(key: string, policy: LimitPolicy): RateLimitDecision {
    if (!this.buckets.has(key)) {
      return { allowed: true, retryAfterSeconds: 0, remaining: policy.burst ?? policy.perMinute };
    }
    const bucket = this.refilled(key, policy);
    this.store(key, bucket);
    return decide(bucket);
  }

  /**
   * Drop buckets that have refilled completely, each by its own policy — or,
   * given one, by that policy for all.
   *
   * Without this the map grows once per distinct key forever, which for
   * token-authenticated agents means a slow leak that only shows up in a
   * long-running container — exactly the deployment Laika is.
   */
  prune(policy?: LimitPolicy): number {
    const now = this.now();
    let removed = 0;

    for (const [key, bucket] of this.buckets) {
      const capacity = policy === undefined ? bucket.capacity : (policy.burst ?? policy.perMinute);
      const perMs = policy === undefined ? bucket.perMs : policy.perMinute / 60_000;
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

  /** The bucket for `key`, refilled to now; a new one is full. */
  private refilled(key: string, policy: LimitPolicy): StoredBucket {
    const capacity = policy.burst ?? policy.perMinute;
    const perMs = policy.perMinute / 60_000;
    const now = this.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: capacity,
      lastRefillMs: now,
      capacity,
      perMs,
    };

    // Continuous refill: elapsed time converts straight into tokens, capped.
    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * perMs);
    bucket.lastRefillMs = now;
    bucket.capacity = capacity;
    bucket.perMs = perMs;
    return bucket;
  }

  /** Keep `key` as the most recently used, inside the cap. */
  private store(key: string, bucket: StoredBucket): void {
    this.buckets.delete(key);
    if (this.buckets.size >= this.maxBuckets) {
      // A full scan at most once a second: at the cap, every new key would
      // otherwise cost one, which is its own way to spend the server.
      const now = this.now();
      if (now - this.lastPruneMs >= 1000) {
        this.lastPruneMs = now;
        this.prune();
      }
      for (const oldest of this.buckets.keys()) {
        if (this.buckets.size < this.maxBuckets) break;
        this.buckets.delete(oldest);
      }
    }
    this.buckets.set(key, bucket);
  }
}

function decide(bucket: StoredBucket): RateLimitDecision {
  if (bucket.tokens < 1) {
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      // Always at least a second: `Retry-After: 0` invites an immediate retry
      // that is guaranteed to fail again.
      retryAfterSeconds: Math.max(1, Math.ceil(deficit / bucket.perMs / 1000)),
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: Math.floor(bucket.tokens - 1) };
}
