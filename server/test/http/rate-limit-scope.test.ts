import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { HEALTH_PATH, classify, isLimited } from '../../src/http/middleware/rate-limit.ts';
import { LIMITS, RateLimiter } from '../../src/http/rate-limit.ts';
import { testApp } from '../helpers/app.ts';

/** Drain the shared anonymous bucket so the next request would be refused. */
function drainAnonymous(limiter: RateLimiter): void {
  for (let i = 0; i < LIMITS.session.perMinute; i++) {
    limiter.take('session:anonymous', LIMITS.session);
  }
}

describe('what the limiter covers (LAI-030)', () => {
  it('limits the API surface', () => {
    expect(isLimited('/api/v1/tasks')).toBe(true);
    expect(isLimited('/api/v1/me')).toBe(true);
    expect(isLimited('/mcp')).toBe(true);
    expect(isLimited('/webhooks/github')).toBe(true);
  });

  it('never limits the liveness probe', () => {
    expect(isLimited(HEALTH_PATH)).toBe(false);
  });

  it('never limits static assets or the SPA document', () => {
    for (const path of ['/', '/board', '/projects/laika/tasks', '/assets/app.css']) {
      expect(isLimited(path), path).toBe(false);
    }
  });
});

describe('the liveness probe survives an exhausted bucket', () => {
  it('answers 200 when every other anonymous request is being refused', async () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const { app } = testApp({ rateLimiter: limiter });

    drainAnonymous(limiter);

    // The bug this prevents: the container HEALTHCHECK calls /api/v1/health every
    // 30s and restarts after three failures, so a rate-limited probe turns a
    // burst of anonymous traffic into a restart loop on a server that was fine.
    const health = await app.request(HEALTH_PATH);
    expect(health.status).toBe(200);

    // Everything else anonymous is still refused, so the exemption is narrow.
    const other = await app.request('/api/v1/nope');
    expect(other.status).toBe(429);
  });

  it('still serves the SPA when the bucket is exhausted', async () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const { app } = testApp({ rateLimiter: limiter });

    drainAnonymous(limiter);

    const spa = await app.request('/board/LAI-1');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('Laika is running.');
  });

  it('does not advertise a budget on an unlimited path', async () => {
    const { app } = testApp();
    const res = await app.request(HEALTH_PATH);

    // Claiming a budget it does not enforce would be a lie a client could act on.
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  });
});

describe('anonymous callers share one bucket, by decision', () => {
  it('spends one budget across every anonymous caller', async () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const { app } = testApp({ rateLimiter: limiter });

    const echo = new Hono();
    echo.get('/', (c) => c.json({ ok: true }));
    app.route('/api/v1/echo', echo);

    // Two "different" anonymous callers — different IPs would not help, because
    // behind a proxy the address is the proxy's unless X-Forwarded-For is
    // trusted, and trusting it unconditionally lets a client forge its identity.
    for (let i = 0; i < LIMITS.session.perMinute; i++) {
      await app.request('/api/v1/echo', { headers: { 'X-Forwarded-For': '10.0.0.1' } });
    }

    const other = await app.request('/api/v1/echo', {
      headers: { 'X-Forwarded-For': '10.0.0.2' },
    });

    expect(other.status).toBe(429);
  });

  it('keys authenticated callers separately from each other and from anonymous', () => {
    expect(classify('/api/v1/tasks', 'u1').key).toBe('session:u1');
    expect(classify('/api/v1/tasks', 'u2').key).toBe('session:u2');
    expect(classify('/api/v1/tasks', null).key).toBe('session:anonymous');
  });
});
