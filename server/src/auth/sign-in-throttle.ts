/**
 * Per-account sign-in throttling (SPEC §6.1, LAI-219).
 *
 * ## What was missing, and what already existed
 *
 * better-auth ships a limiter keyed on the **caller**: three rapid failures earn
 * a `429` for about ten seconds. It is real and it is not this. Two gaps:
 *
 *  - **It is keyed on the caller**, so it slows a burst from one address and does
 *    nothing about a slow attempt spread across many against one account.
 *  - **It is off unless `NODE_ENV=production`** — which is what a self-hosted
 *    operator gets by *omitting* the variable. The only brake on the path
 *    evaporates for the deployment most likely to be run by one person.
 *
 * `rateLimitMiddleware` is not it either: it is one shared anonymous bucket at
 * 600/min and it does not fire here in practice. **This is not a second copy of
 * either** — it is the per-account, environment-independent half neither has.
 *
 * ## Delay, not lockout — and the trade is real
 *
 * After `FREE_ATTEMPTS` consecutive failures the account's next attempt is
 * refused with a growing `Retry-After`, doubling from `BASE_DELAY_MS` to
 * `MAX_DELAY_MS`. A success clears the count.
 *
 * **An attacker can keep one account throttled**, by failing against it every
 * few minutes, and that is a denial of service against its owner. It is the
 * chosen trade and here is why:
 *
 *  - A **lockout** — "n failures and the account is closed until an admin
 *    intervenes" — gives that same attacker a permanent outage for the price of
 *    n requests, and Laika is invite-only with a small, known account list
 *    (D-004), so the attacker does not even have to discover an address.
 *  - A **capped delay** bounds the damage: the owner's worst case is
 *    `MAX_DELAY_MS`, it clears itself, and no administrator is needed to undo
 *    it. Meanwhile the attacker's guess rate falls to a handful per hour, which
 *    is the thing that actually had to change.
 *
 * So the answer to "can an attacker lock the owner out" is **no** — they can slow
 * them, temporarily, and only while they keep paying for it.
 *
 * ## It says nothing about whether the address exists
 *
 * The counter is keyed on the **submitted** address, whether or not an account
 * has it, so an unknown address throttles exactly like a real one. Today's
 * sign-in gives an identical answer for both and that property is the reason —
 * a limiter that only engaged for real accounts would turn `429` into an
 * account-existence oracle, which is worse than the brute force it prevents.
 *
 * ## Bounded, because the key comes from the request body
 *
 * An attacker choosing a fresh random address each time would otherwise grow
 * this map without limit. `MAX_TRACKED` entries, oldest-touched evicted first —
 * and eviction is safe in the direction that matters: it forgets a *failure*
 * count, which costs protection for one account and never grants access.
 */

/** Failures allowed before any delay. Generous: people mistype. */
export const FREE_ATTEMPTS = 5;
/** The first delay, after `FREE_ATTEMPTS`. Doubles from here. */
export const BASE_DELAY_MS = 30_000;
/** The cap, and therefore the owner's worst case. */
export const MAX_DELAY_MS = 15 * 60_000;
/**
 * A quiet period this long forgets the account's failures entirely.
 *
 * **Deliberately longer than `MAX_DELAY_MS`.** When they were equal a
 * maxed-out block expired at the same instant the window forgave the count, so
 * an attacker at the cap got a free reset every time they waited it out — the
 * delay stopped growing and the counter never persisted. Found by a test that
 * advanced the clock by the cap and watched the delay fall back to zero.
 */
export const WINDOW_MS = 60 * 60_000;
/** How many accounts are tracked at once. */
export const MAX_TRACKED = 10_000;

export interface ThrottleDecision {
  allowed: boolean;
  /** Whole seconds, for the `Retry-After` header. Only when refused. */
  retryAfterSeconds?: number;
}

interface Attempts {
  failures: number;
  /** When the delay that is currently in force expires. */
  blockedUntil: number;
  lastSeen: number;
}

/** Lowercased and trimmed, so `Ada@Example.test` and `ada@example.test` share a count. */
export function throttleKey(email: string): string {
  return email.trim().toLowerCase();
}

export class SignInThrottle {
  private readonly accounts = new Map<string, Attempts>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** May this account attempt a sign-in? */
  check(email: string): ThrottleDecision {
    const key = throttleKey(email);
    const record = this.accounts.get(key);
    const now = this.now();

    if (record === undefined) return { allowed: true };

    // A quiet window clears the slate. Without this a single bad afternoon
    // would follow somebody for ever.
    if (now - record.lastSeen >= WINDOW_MS) {
      this.accounts.delete(key);
      return { allowed: true };
    }

    if (now < record.blockedUntil) {
      return {
        allowed: false,
        // Rounded **up**: telling a client to retry in 0 seconds when 400ms
        // remain earns them a second refusal and looks like the server lying.
        retryAfterSeconds: Math.ceil((record.blockedUntil - now) / 1000),
      };
    }

    return { allowed: true };
  }

  /** Record a failed attempt and arm the next delay. */
  recordFailure(email: string): void {
    const key = throttleKey(email);
    const now = this.now();
    const record = this.accounts.get(key);

    const failures =
      record === undefined || now - record.lastSeen >= WINDOW_MS ? 1 : record.failures + 1;

    // `FREE_ATTEMPTS` failures are free; the **next attempt** after them waits.
    // So the fifth failure arms `BASE_DELAY_MS`, not the sixth — the doc above
    // says "after `FREE_ATTEMPTS` consecutive failures", and an off-by-one here
    // would give an attacker one extra guess per window for ever.
    const over = failures - FREE_ATTEMPTS;
    const delay = over < 0 ? 0 : Math.min(BASE_DELAY_MS * Math.pow(2, over), MAX_DELAY_MS);

    this.accounts.delete(key);
    this.accounts.set(key, { failures, blockedUntil: now + delay, lastSeen: now });
    this.evict();
  }

  /** A successful sign-in clears the account's history. */
  recordSuccess(email: string): void {
    this.accounts.delete(throttleKey(email));
  }

  /** For tests and for the shutdown path — nothing here survives a restart. */
  get size(): number {
    return this.accounts.size;
  }

  /**
   * Drop the least-recently-touched entries.
   *
   * `Map` iterates in insertion order and every write re-inserts, so the first
   * key is the oldest touched. Evicting forgets a failure count — it costs
   * protection for one account and never grants access to one.
   */
  private evict(): void {
    while (this.accounts.size > MAX_TRACKED) {
      const oldest = this.accounts.keys().next();
      if (oldest.done === true) return;
      this.accounts.delete(oldest.value);
    }
  }
}
