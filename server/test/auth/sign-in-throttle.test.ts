import { describe, expect, it } from 'vitest';
import {
  BASE_DELAY_MS,
  FREE_ATTEMPTS,
  MAX_DELAY_MS,
  MAX_TRACKED,
  SignInThrottle,
  throttleKey,
  WINDOW_MS,
} from '../../src/auth/sign-in-throttle.ts';

/**
 * Per-account sign-in throttling (§6.1, LAI-219).
 *
 * **The clock is injected**, so every rule here is an assertion about the policy
 * rather than about a sleep. "After five failures the sixth waits 30 seconds"
 * cannot be proved against `Date.now()` without waiting 30 seconds.
 */

const T0 = 1_800_000_000_000;

function throttle(start = T0): { t: SignInThrottle; advance: (ms: number) => void } {
  let now = start;
  return {
    t: new SignInThrottle(() => now),
    advance: (ms) => {
      now += ms;
    },
  };
}

const ADA = 'ada@example.test';

describe('the free attempts', () => {
  it('allows the first five failures without delay', () => {
    const { t } = throttle();

    for (let i = 0; i < FREE_ATTEMPTS; i += 1) {
      expect(t.check(ADA).allowed, `attempt ${i + 1}`).toBe(true);
      t.recordFailure(ADA);
    }

    // People mistype. Five is generous on purpose — the thing that had to change
    // is the *rate*, not the first honest mistake.
    expect(t.check(ADA).allowed).toBe(false);
  });

  it('refuses the attempt after them, with the base delay', () => {
    const { t } = throttle();
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) t.recordFailure(ADA);

    expect(t.check(ADA)).toEqual({
      allowed: false,
      retryAfterSeconds: BASE_DELAY_MS / 1000,
    });
  });
});

describe('the delay grows and is capped', () => {
  it('doubles with each further failure', () => {
    const { t, advance } = throttle();
    for (let i = 0; i < FREE_ATTEMPTS - 1; i += 1) t.recordFailure(ADA);

    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      t.recordFailure(ADA);
      seen.push(t.check(ADA).retryAfterSeconds ?? 0);
      // Past the block but **inside** the window, so the count keeps growing.
      // Advancing by a whole window here would forgive the account and the
      // delays would read 30, 30, 30 — which is how I found that `WINDOW_MS`
      // and `MAX_DELAY_MS` must not be equal.
      advance(MAX_DELAY_MS + 1);
    }

    expect(seen).toEqual([30, 60, 120, 240]);
  });

  it('never exceeds the cap, which is the owner’s worst case', () => {
    const { t } = throttle();
    for (let i = 0; i < 40; i += 1) t.recordFailure(ADA);

    // The cap is the answer to "can an attacker lock the owner out": no — they
    // can slow them, to a bounded, self-clearing maximum, and only while they
    // keep paying for it.
    expect(t.check(ADA).retryAfterSeconds).toBe(MAX_DELAY_MS / 1000);
  });

  it('rounds the retry up, never to zero', () => {
    const { t, advance } = throttle();
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) t.recordFailure(ADA);

    advance(BASE_DELAY_MS - 400);

    // Telling a client to retry in 0 seconds when 400ms remain earns them a
    // second refusal and looks like the server lying.
    expect(t.check(ADA).retryAfterSeconds).toBe(1);
  });
});

describe('what clears the count', () => {
  it('a success', () => {
    const { t } = throttle();
    for (let i = 0; i < 20; i += 1) t.recordFailure(ADA);
    expect(t.check(ADA).allowed).toBe(false);

    t.recordSuccess(ADA);

    expect(t.check(ADA).allowed).toBe(true);
  });

  it('a quiet window', () => {
    const { t, advance } = throttle();
    for (let i = 0; i < 20; i += 1) t.recordFailure(ADA);

    advance(WINDOW_MS);

    // Without this a single bad afternoon would follow somebody for ever.
    expect(t.check(ADA).allowed).toBe(true);
  });

  it('and a quiet window resets the *count*, not just the block', () => {
    const { t, advance } = throttle();
    for (let i = 0; i < 20; i += 1) t.recordFailure(ADA);
    advance(WINDOW_MS);

    // If only the block cleared, the next failure would resume at the cap.
    t.recordFailure(ADA);

    expect(t.check(ADA).allowed).toBe(true);
  });
});

describe('it is not an account-existence oracle', () => {
  it('throttles an address no account has, exactly like one that exists', () => {
    const { t } = throttle();
    const real = 'ada@example.test';
    const fake = 'nobody@example.test';

    for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) {
      t.recordFailure(real);
      t.recordFailure(fake);
    }

    // The counter is keyed on the **submitted** address and knows nothing about
    // the user table. A limiter that engaged only for real accounts would turn
    // `429` into an oracle — worse than the brute force it prevents.
    expect(t.check(fake)).toEqual(t.check(real));
  });

  it('treats case and surrounding space as the same account', () => {
    const { t } = throttle();
    for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) t.recordFailure('Ada@Example.test');

    // Otherwise the counter is bypassed by holding down shift.
    expect(t.check('  ada@example.test  ').allowed).toBe(false);
    expect(throttleKey('  Ada@Example.TEST ')).toBe('ada@example.test');
  });
});

describe('it is bounded, because the key comes from the request body', () => {
  it('evicts the oldest rather than growing without limit', () => {
    const { t } = throttle();

    for (let i = 0; i < MAX_TRACKED + 100; i += 1) t.recordFailure(`user${i}@example.test`);

    expect(t.size).toBe(MAX_TRACKED);
  });

  it('evicts the least recently touched, and eviction only ever forgets', () => {
    const { t } = throttle();
    for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) t.recordFailure(ADA);
    expect(t.check(ADA).allowed).toBe(false);

    for (let i = 0; i < MAX_TRACKED; i += 1) t.recordFailure(`filler${i}@example.test`);

    // Ada is forgotten, which costs protection for one account and never grants
    // access to one. That is the safe direction for a bound to fail in.
    expect(t.check(ADA).allowed).toBe(true);
  });
});
