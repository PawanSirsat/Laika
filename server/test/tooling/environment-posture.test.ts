import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';
import { authHarness } from '../helpers/auth.ts';
import { packagesBranchingOnEnvironment } from '../helpers/runtime-closure.ts';
import { isLimited } from '../../src/http/middleware/rate-limit.ts';
import { AUTH_BASE_PATH } from '../../src/auth/auth.ts';

/**
 * What `NODE_ENV` changes, and why each difference is acceptable (LAI-096).
 *
 * ## Why this file exists
 *
 * LAI-090 found that **better-auth disables its origin check under
 * `NODE_ENV=test`**, which vitest sets. The suite therefore ran with a weaker
 * security posture than production, and no test at any level could have caught
 * the bug that locked the owner out — every request was accepted regardless of
 * `Origin`. It was found by accident, because an acceptance test returned `200`
 * for `https://evil.example` and that could not be explained.
 *
 * **A test that cannot fail is indistinguishable from a test that passes.** So
 * the specific hole being pinned is not the interesting part; the interesting
 * part is that we could not have seen it. This file is the answer to "what else",
 * and it is written so the answer stays true after a dependency upgrade.
 *
 * ## Three kinds of assertion here
 *
 *  1. **Resolved, not configured.** `auth.$context` is better-auth's own
 *     resolved configuration, so asserting it catches a changed *default*. An
 *     assertion against the options we pass in would only prove we passed them —
 *     the tautology LAI-048 shipped once already.
 *  2. **The property, not the mechanism.** Where a relaxation is safe because
 *     something else covers it, the something else is asserted.
 *  3. **Completeness.** The last block re-scans the runtime closure, so a
 *     package that *starts* branching on the environment fails rather than
 *     joining the set of things nobody knew about.
 */

// ------------------------------------------------------- what we pin, and why

/**
 * Every environment-dependent behaviour in the shipped process, with a decision.
 *
 * `verdict: 'pinned'` — we override the default so it is identical everywhere.
 * `verdict: 'safe'`   — the difference stands, and the reason is not convenience.
 *
 * "It is only a test convenience" is not an accepted reason. That is exactly
 * what the origin check was.
 */
interface Difference {
  readonly what: string;
  readonly where: string;
  readonly trigger: string;
  readonly verdict: 'pinned' | 'safe';
  readonly reason: string;
}

export const DIFFERENCES: readonly Difference[] = [
  {
    what: 'origin check (CSRF)',
    where: 'better-auth create-context.mjs — skipOriginCheck',
    trigger: 'NODE_ENV=test, or a truthy TEST variable in any environment',
    verdict: 'pinned',
    reason:
      'LAI-090. Off under test, so the suite accepted every Origin and the bug that locked the owner out was invisible. `disableOriginCheck: false` is now explicit.',
  },
  {
    what: "better-auth's own rate limiting",
    where: 'better-auth create-context.mjs — rateLimit.enabled ?? isProduction',
    trigger: 'anything other than NODE_ENV=production, including unset',
    verdict: 'safe',
    reason:
      'Our own limiter (http/middleware/rate-limit.ts) runs in every environment and covers /api/v1/auth/* — asserted below. better-auth would add a second limiter keyed on IP, which the same library makes useless outside production by returning a fixed localhost IP.',
  },
  {
    what: 'client IP resolution',
    where: '@better-auth/core utils/ip.mjs — returns LOCALHOST_IP',
    trigger: 'NODE_ENV=test or development',
    verdict: 'safe',
    reason:
      'Nothing in Laika keys on it. Our limiter shares one bucket for anonymous callers by design (no trusted-proxy config yet), and sessions.ip_address is written but read by nothing. It becomes load-bearing the day either changes.',
  },
  {
    what: 'default-secret refusal',
    where: 'better-auth create-context.mjs — `if (isTest()) return`',
    trigger: 'NODE_ENV=test, or a truthy TEST variable',
    verdict: 'safe',
    reason:
      'env.ts requires LAIKA_SECRET in every environment with no default and no auto-generation (D-018), so better-auth never sees its own default secret to refuse. The check is dead code for us rather than a relaxation.',
  },
  {
    what: '__Secure- cookie prefix',
    where: 'better-auth cookies/index.mjs — falls back to isProduction',
    trigger: 'only when baseURL is unset',
    verdict: 'safe',
    reason:
      'createAuth always passes baseUrl, so the prefix is decided by that URL’s scheme and never reaches the isProduction fallback. Asserted below, because it stops being true the moment baseUrl becomes optional.',
  },
  {
    what: 'default error page detail',
    where: 'better-auth api/routes/error.mjs',
    trigger: 'anything other than NODE_ENV=production',
    verdict: 'safe',
    reason:
      'Cosmetic, and unreachable: every auth failure is re-emitted through our own envelope (http/auth-errors.ts, LAI-090) before it reaches a client.',
  },
  {
    what: 'development-only warnings',
    where: 'better-auth sign-up/link-account, nanostores',
    trigger: 'NODE_ENV !== production',
    verdict: 'safe',
    reason: 'Logging only. No behaviour depends on it.',
  },
];

describe('the security-relevant switches are on, whatever NODE_ENV says', () => {
  it('resolves skipOriginCheck to false — read from better-auth, not from our options', async () => {
    const h = authHarness();
    try {
      const context = await h.auth.$context;

      // The resolved value. Asserting the option we passed would prove only that
      // we passed it, and would keep passing if the default flipped underneath.
      expect(context.skipOriginCheck).toBe(false);
    } finally {
      h.close();
    }
  });

  it('does not trust a foreign origin, in the environment the suite runs in', async () => {
    const h = authHarness();
    try {
      const context = await h.auth.$context;

      expect(context.isTrustedOrigin('https://evil.example')).toBe(false);
      expect(context.isTrustedOrigin('http://192.168.1.9:3000')).toBe(false);
      // And the loopback equivalence of LAI-090 still holds.
      expect(context.isTrustedOrigin('http://127.0.0.1:3000')).toBe(true);
    } finally {
      h.close();
    }
  });

  it('decides the cookie prefix from the configured URL, never from NODE_ENV', async () => {
    const h = authHarness();
    try {
      const context = await h.auth.$context;

      // baseURL is always set, so the `isProduction` fallback in better-auth's
      // cookie naming is unreachable. This fails if baseUrl ever becomes optional.
      expect(context.baseURL).not.toBe('');
      expect(context.baseURL).toContain('http');
    } finally {
      h.close();
    }
  });
});

describe("better-auth's rate limiting is off outside production, and that is covered", () => {
  it('is genuinely off in this environment — stated rather than assumed', async () => {
    const h = authHarness();
    try {
      const context = await h.auth.$context;

      // Not a wish: this is the relaxation, asserted so the justification below
      // is answering a real condition. If a future version enables it by
      // default, this fails and the reasoning gets revisited.
      expect(context.rateLimit.enabled).toBe(false);
    } finally {
      h.close();
    }
  });

  it('our own limiter covers the auth endpoints in every environment', () => {
    // This is what makes the relaxation safe. `rateLimitMiddleware` is built
    // unconditionally in `createApp` and keys on the actor, not the environment.
    for (const path of [
      `${AUTH_BASE_PATH}/sign-in/email`,
      `${AUTH_BASE_PATH}/sign-up/email`,
      `${AUTH_BASE_PATH}/sign-out`,
    ]) {
      expect(isLimited(path), path).toBe(true);
    }
  });

  it('and still exempts only the liveness probe', () => {
    // The one carve-out (LAI-030). If this list grows, the justification above
    // stops covering whatever was added.
    expect(isLimited('/api/v1/health')).toBe(false);
    expect(isLimited('/api/v1/events')).toBe(true);
    expect(isLimited('/api/v1/tasks')).toBe(true);
  });
});

// -------------------------------------- what the other environments resolve to

interface Posture {
  readonly nodeEnv: string | null;
  readonly skipOriginCheck: boolean;
  readonly skipCSRFCheck: boolean;
  readonly rateLimitEnabled: boolean;
  readonly trustsForeignOrigin: boolean;
  readonly trustsLoopback: boolean;
}

/**
 * `tsx` directly rather than through `npx`.
 *
 * `npx` re-resolves the binary on every call and measured ~35% slower per spawn
 * (0.73-1.05s against 0.52-0.92s). That is not micro-optimisation here: spawn
 * cost is the entire runtime of this block, and it is what made the first
 * version load-sensitive.
 */
function tsxBinary(): { command: string; leading: readonly string[] } {
  for (const candidate of [
    join(SERVER_ROOT, 'node_modules', '.bin', 'tsx'),
    join(SERVER_ROOT, '..', 'node_modules', '.bin', 'tsx'),
  ]) {
    if (existsSync(candidate)) return { command: candidate, leading: [] };
  }

  return { command: 'npx', leading: ['tsx'] };
}

/**
 * Ask a child process what it resolves to.
 *
 * `@better-auth/core` captures `NODE_ENV` into a module-level constant at import
 * time, so reassigning `process.env.NODE_ENV` inside a test does nothing — a
 * test that tried would pass while measuring the environment vitest set. Going
 * and being the environment is the only honest way to know.
 */
function postureUnder(nodeEnv: string): Posture {
  const { command, leading } = tsxBinary();

  const output = execFileSync(command, [...leading, join('test', 'helpers', 'posture-probe.ts')], {
    cwd: SERVER_ROOT,
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf8',
  });

  const last = output.trim().split('\n').at(-1) ?? '{}';
  return JSON.parse(last) as Posture;
}

/**
 * Every spawn happens **once, here**, and the tests below only read the result.
 *
 * The first version called `postureUnder` inside each `it`, which was five
 * spawns at roughly 0.8s each — about 4s against vitest's 5s default. It passed
 * alone and failed in PM's full parallel run at 5135ms, which is the worst kind
 * of gate: one that trains people to re-run rather than read. Two spawns in a
 * hook with a generous explicit budget cannot do that.
 *
 * The timeout is on the **spawning**, not on any assertion. If this ever trips,
 * something is genuinely wrong with the child process — not with the machine
 * being busy.
 */
const SPAWN_BUDGET_MS = 60_000;

describe('development and production resolve the same posture as test (AC4)', () => {
  const measured = new Map<string, Posture>();

  beforeAll(() => {
    for (const nodeEnv of ['development', 'production']) {
      measured.set(nodeEnv, postureUnder(nodeEnv));
    }
  }, SPAWN_BUDGET_MS);

  const posture = (nodeEnv: string): Posture => {
    const found = measured.get(nodeEnv);
    if (found === undefined) throw new Error(`no posture measured for ${nodeEnv}`);
    return found;
  };

  for (const nodeEnv of ['development', 'production'] as const) {
    it(`${nodeEnv}: the origin check is on and no foreign origin is trusted`, () => {
      const posture_ = posture(nodeEnv);

      expect(posture_.nodeEnv).toBe(nodeEnv);
      expect(posture_.skipOriginCheck).toBe(false);
      expect(posture_.skipCSRFCheck).toBe(false);
      expect(posture_.trustsForeignOrigin).toBe(false);
      // LAI-090's fix must hold everywhere too, not only where it was tested.
      expect(posture_.trustsLoopback).toBe(true);
    });
  }

  it('leaves exactly one difference, and it is the one that is written down', () => {
    const dev = posture('development');
    const prod = posture('production');

    const differing = (Object.keys(prod) as (keyof Posture)[]).filter(
      (key) => key !== 'nodeEnv' && dev[key] !== prod[key],
    );

    // If a second difference ever appears, this fails and it gets a row in
    // DIFFERENCES with a verdict — rather than being discovered by accident the
    // way the origin check was.
    expect(differing).toEqual(['rateLimitEnabled']);
    expect(prod.rateLimitEnabled).toBe(true);
    expect(dev.rateLimitEnabled).toBe(false);
  });

  it('a builder running `pnpm dev` is not exercising a weaker product', () => {
    // AC4 in one line. The only thing `pnpm dev` relaxes is better-auth's own
    // limiter, and ours covers the same paths — asserted above.
    const dev = posture('development');

    expect(dev.skipOriginCheck).toBe(false);
    expect(dev.trustsForeignOrigin).toBe(false);
  });
});

describe('the list of differences stays honest', () => {
  it('gives every difference a verdict and a reason someone can disagree with', () => {
    const weak = DIFFERENCES.filter(
      (d) => d.reason.trim().length < 40 || d.trigger.trim() === '',
    ).map((d) => d.what);

    expect(weak).toEqual([]);
  });

  it('never accepts "only a test convenience" as a reason', () => {
    // The origin check was exactly that, and it cost the owner a session.
    const excuses = DIFFERENCES.filter((d) =>
      /only a test|just a test|test convenience|harmless in test/i.test(d.reason),
    ).map((d) => d.what);

    expect(excuses).toEqual([]);
  });

  it('covers every package in the runtime closure that branches on the environment', () => {
    // The completeness check, and the reason this file is not just a list. A
    // dependency upgrade that starts reading NODE_ENV somewhere new fails here
    // rather than joining the set of things nobody knew about.
    //
    // Scoped to what the shipped process loads — 28 packages, not the 139 in
    // node_modules, most of which are vitest and esbuild and never run.
    const known = new Set([
      'better-auth',
      '@better-auth/core',
      '@better-auth/telemetry',
      'nanostores',
    ]);
    const found = packagesBranchingOnEnvironment();

    const unreviewed = found.filter((name) => !known.has(name));
    expect(
      unreviewed,
      'a runtime dependency started branching on NODE_ENV — read it and add it to DIFFERENCES',
    ).toEqual([]);

    // The other direction: a package that stopped branching should leave the
    // list, or the list rots into a place where stale entries hide new ones.
    const gone = [...known].filter((name) => !found.includes(name));
    expect(gone, 'these no longer branch on the environment — drop them').toEqual([]);
  });
});
