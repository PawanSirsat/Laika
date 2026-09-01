import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FREE_ATTEMPTS, SignInThrottle } from '../../src/auth/sign-in-throttle.ts';
import { type AuthHarness, authHarness, jsonHeaders } from '../helpers/auth.ts';

/**
 * Per-account sign-in throttling, through the real endpoint (§6.1, LAI-219).
 *
 * The policy is proved in `test/auth/sign-in-throttle.test.ts`. What is left
 * here is that it is **wired**: that repeated real failures engage it, that the
 * response is §6.3's envelope with a `Retry-After`, and that it says nothing
 * about whether the address exists.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let clock: number;

beforeEach(async () => {
  clock = 1_800_000_000_000;
  h = authHarness({ signInThrottle: new SignInThrottle(() => clock) });

  // Through first-boot rather than `signUp`: sign-up is gated until setup has
  // run, which is D-004's invite-only posture and is what a real instance does.
  const created = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
});
afterEach(() => {
  h.close();
});

async function attempt(email: string, password = 'wrong-password-entirely'): Promise<Response> {
  return h.app.request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
}

describe('repeated failures engage the throttle', () => {
  it('lets the free attempts through as 401 and then answers 429', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) {
      const res = await attempt('ada@example.test');
      expect(res.status, `attempt ${i + 1}`).not.toBe(429);
    }

    const blocked = await attempt('ada@example.test');

    expect(blocked.status).toBe(429);
  });

  it('carries §6.3’s envelope and a retry the user can act on', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) await attempt('ada@example.test');

    const blocked = await attempt('ada@example.test');
    const body = (await blocked.json()) as {
      error: { code: string; details?: { retry_after_seconds?: number } };
    };

    // A legitimate user is told how long. Without it the honest answer to "how
    // long do I wait" is "try again and find out", which trains people to
    // hammer.
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details?.retry_after_seconds).toBeGreaterThan(0);
  });

  it('lets the account back in once the delay passes', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) await attempt('ada@example.test');
    expect((await attempt('ada@example.test')).status).toBe(429);

    clock += 60_000;

    // Not a lockout. The owner is never left needing an administrator, which is
    // the whole reason a capped delay was chosen over one.
    const ok = await attempt('ada@example.test', PASSWORD);
    expect(ok.status).toBe(200);
  });

  it('a success clears the count', async () => {
    for (let i = 0; i < FREE_ATTEMPTS - 1; i += 1) await attempt('ada@example.test');
    expect((await attempt('ada@example.test', PASSWORD)).status).toBe(200);

    // Four failures then a success must not leave the account one mistake from
    // a delay.
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) {
      expect((await attempt('ada@example.test')).status, `after success ${i}`).not.toBe(429);
    }
  });
});

describe('it tells an attacker nothing about which addresses exist', () => {
  it('answers identically for a real account and an unknown one', async () => {
    const real: number[] = [];
    const fake: number[] = [];

    for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) {
      real.push((await attempt('ada@example.test')).status);
      fake.push((await attempt('nobody@example.test')).status);
    }

    // Verified, not assumed — AC2. A limiter that engaged only for real accounts
    // would turn `429` into an account-existence oracle, which is worse than the
    // brute force it prevents.
    expect(fake).toEqual(real);
  });

  it('and the throttled bodies are identical too', async () => {
    for (let i = 0; i < FREE_ATTEMPTS + 1; i += 1) {
      await attempt('ada@example.test');
      await attempt('nobody@example.test');
    }

    const realBody = await (await attempt('ada@example.test')).text();
    const fakeBody = await (await attempt('nobody@example.test')).text();

    // Status parity is not enough: a difference in the message is the same
    // oracle, one layer down.
    expect(fakeBody).toBe(realBody);
  });
});

describe('it throttles sign-in and nothing else', () => {
  it('does not count a sign-out towards the account', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) await attempt('ada@example.test');

    // Sign-out shares the `/auth/*` prefix and is not a guessing attempt. If it
    // shared the counter, a client with a stale cookie could throttle its own
    // user out.
    const out = await h.app.request('/api/v1/auth/sign-out', {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect([200, 401]).toContain(out.status);
    clock += 60_000;
    expect((await attempt('ada@example.test', PASSWORD)).status).toBe(200);
  });

  it('does not count a request the origin check refused', async () => {
    // **The cheaper denial of service.** A foreign origin is rejected (§6.1)
    // before any password is looked at — so if those counted, an attacker could
    // throttle any account from anywhere **without ever submitting a guess**,
    // which is strictly worse than the bounded delay the design accepts.
    for (let i = 0; i < FREE_ATTEMPTS * 3; i += 1) {
      const res = await h.app.request('/api/v1/auth/sign-in/email', {
        method: 'POST',
        headers: jsonHeaders({ Origin: 'https://attacker.example' }),
        body: JSON.stringify({ email: 'ada@example.test', password: 'anything' }),
      });
      expect(res.status, `origin attempt ${i + 1}`).toBe(403);
    }

    // The account is untouched: the real owner signs in first time.
    expect((await attempt('ada@example.test', PASSWORD)).status).toBe(200);
  });

  it('passes a body it cannot read straight through', async () => {
    const res = await h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: 'not json at all',
    });

    // No email to count against, so better-auth rejects it as it always did.
    // The throttle must not turn a malformed body into a 429.
    expect(res.status).not.toBe(429);
  });
});
