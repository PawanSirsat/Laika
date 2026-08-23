import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/http/errors.ts';
import {
  changedSince,
  isTombstone,
  parseUpdatedSince,
  tombstone,
  withTombstones,
} from '../../src/http/updated-since.ts';
import { parseBody, strictObject, requireJsonObject, z } from '../../src/http/validation.ts';
import { LIMITS, RateLimiter } from '../../src/http/rate-limit.ts';

describe('updated_since (SPEC §6.3)', () => {
  it('parses a unix-ms timestamp and treats absence as "everything"', () => {
    expect(parseUpdatedSince(undefined)).toBeNull();
    expect(parseUpdatedSince('')).toBeNull();
    expect(parseUpdatedSince('1700000000000')).toBe(1_700_000_000_000);
  });

  it('rejects anything that is not a plain integer', () => {
    for (const bad of ['yesterday', '-1', '1.5', '2026-08-24']) {
      expect(() => parseUpdatedSince(bad), bad).toThrow(ApiError);
    }
  });

  it('is inclusive, so a row changing within the watermark millisecond is not lost', () => {
    expect(changedSince(1_000, 1_000)).toBe(true);
    expect(changedSince(1_001, 1_000)).toBe(true);
    expect(changedSince(999, 1_000)).toBe(false);
    expect(changedSince(1, null)).toBe(true);
  });

  it('turns soft-deleted rows into tombstones and leaves the rest alone', () => {
    const rows = [
      { id: 'a', title: 'kept', deletedAt: null },
      { id: 'b', title: 'gone', deletedAt: 1_700_000_000_000 },
      { id: 'c', title: 'also kept' },
    ];

    const result = withTombstones(rows);

    expect(result[0]).toEqual(rows[0]);
    expect(result[1]).toEqual({ id: 'b', deleted: true });
    expect(result[2]).toEqual(rows[2]);
  });

  it('recognises its own tombstones', () => {
    expect(isTombstone(tombstone('x'))).toBe(true);
    expect(isTombstone({ id: 'x' })).toBe(false);
    expect(isTombstone(null)).toBe(false);
  });
});

describe('validation (SPEC §6.3)', () => {
  const schema = strictObject({ title: z.string().min(1), priority: z.enum(['p1', 'p2', 'p3']) });

  it('accepts a valid body and returns the inferred type', () => {
    expect(parseBody(schema, { title: 'Ship it', priority: 'p1' })).toEqual({
      title: 'Ship it',
      priority: 'p1',
    });
  });

  it('rejects unknown fields rather than dropping them', () => {
    // The failure this prevents: a client sets `assignee`, the server ignores it,
    // and the mismatch surfaces much later as missing data.
    let thrown: unknown;
    try {
      parseBody(schema, { title: 'x', priority: 'p1', assignee: 'someone' });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('unprocessable');
    expect(JSON.stringify((thrown as ApiError).details)).toContain('assignee');
  });

  it('reports every failing field, not just the first', () => {
    try {
      parseBody(schema, { title: '', priority: 'urgent' });
    } catch (err) {
      const issues = (err as ApiError).details as { issues: { path: string }[] };
      expect(issues.issues.map((i) => i.path).sort()).toEqual(['priority', 'title']);
    }
  });

  it('names a non-object body instead of failing obscurely', () => {
    for (const bad of ['a string', 42, null, ['an', 'array']]) {
      expect(() => requireJsonObject(bad)).toThrow(ApiError);
    }
    expect(requireJsonObject({ ok: true })).toEqual({ ok: true });
  });
});

describe('rate limiting (SPEC §6.3)', () => {
  it('uses the limits the spec states', () => {
    expect(LIMITS.token.perMinute).toBe(120);
    expect(LIMITS.session.perMinute).toBe(600);
    expect(LIMITS.heartbeat.perMinute).toBe(30);
  });

  it('allows a burst up to capacity, then denies', () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const policy = { perMinute: 5 };

    for (let i = 0; i < 5; i++) {
      expect(limiter.take('k', policy).allowed, `request ${String(i)}`).toBe(true);
    }

    const denied = limiter.take('k', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('refills continuously rather than in a jump at the window edge', () => {
    // A fixed window would allow a full burst at the end of one window and
    // another at the start of the next — twice the rate across the boundary.
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const policy = { perMinute: 60 };

    for (let i = 0; i < 60; i++) limiter.take('k', policy);
    expect(limiter.take('k', policy).allowed).toBe(false);

    now += 1_000;
    expect(limiter.take('k', policy).allowed).toBe(true);
    expect(limiter.take('k', policy).allowed).toBe(false);
  });

  it('never returns Retry-After: 0, which would invite an instant failing retry', () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const policy = { perMinute: 60 };

    for (let i = 0; i < 61; i++) limiter.take('k', policy);

    expect(limiter.take('k', policy).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('keeps buckets separate per key', () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const policy = { perMinute: 2 };

    limiter.take('a', policy);
    limiter.take('a', policy);

    expect(limiter.take('a', policy).allowed).toBe(false);
    expect(limiter.take('b', policy).allowed).toBe(true);
  });

  it('prunes refilled buckets so the map does not grow forever', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const policy = { perMinute: 60 };

    for (let i = 0; i < 50; i++) limiter.take(`key-${String(i)}`, policy);
    expect(limiter.size).toBe(50);

    // Not yet refilled.
    expect(limiter.prune(policy)).toBe(0);

    now += 60_000;
    expect(limiter.prune(policy)).toBe(50);
    expect(limiter.size).toBe(0);
  });
});

describe('rate limiting over HTTP', () => {
  it('returns 429 with Retry-After in the §6.3 envelope', async () => {
    const { testApp } = await import('../helpers/app.ts');
    const { RateLimiter } = await import('../../src/http/rate-limit.ts');

    const now = 0;
    // A tiny budget so exhaustion is two requests rather than six hundred.
    const limiter = new RateLimiter(() => now);
    const { app } = testApp({ rateLimiter: limiter });

    // Drain the session bucket directly, then make a real request.
    for (let i = 0; i < LIMITS.session.perMinute; i++) {
      limiter.take('session:anonymous', LIMITS.session);
    }

    // Not /api/v1/health — the liveness probe is exempt by decision (LAI-030).
    const res = await app.request('/api/v1/some-endpoint');

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);

    const body = (await res.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details).toMatchObject({ retry_after_seconds: expect.any(Number) as number });
  });

  it('advertises the budget on a successful request', async () => {
    const { testApp } = await import('../helpers/app.ts');
    const { app } = testApp();

    // A limited path: /api/v1/health advertises no budget because it enforces none.
    const res = await app.request('/api/v1/not-a-route');

    expect(res.status).toBe(404);
    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(LIMITS.session.perMinute));
    expect(Number(res.headers.get('X-RateLimit-Remaining'))).toBeGreaterThanOrEqual(0);
  });

  it('gives heartbeats their own budget so presence cannot starve the API', async () => {
    const { classify } = await import('../../src/http/middleware/rate-limit.ts');

    expect(classify('/api/v1/heartbeats', 'u1')).toEqual({
      key: 'heartbeat:u1',
      policy: LIMITS.heartbeat,
    });
    expect(classify('/api/v1/tasks', 'u1')).toEqual({ key: 'session:u1', policy: LIMITS.session });
  });
});
