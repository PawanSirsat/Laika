import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createAuth } from '../../src/auth/auth.ts';
import { createLogger } from '../../src/log.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * LAI-090, over a **real socket**.
 *
 * ## Why this file binds a port when nothing else here does
 *
 * Hono's test client does not reproduce the failure. Driving these exact
 * requests through `app.request()` returns `200` for **every** origin, trusted
 * or not — better-auth's origin check needs the request shape a real connection
 * produces. So a unit test at that level would have asserted the fix while the
 * bug carried on happening to the owner, which is the worst possible outcome for
 * a test.
 *
 * I found that out by measuring: the harness said `200` where the running
 * container said `403`, and the difference was the socket.
 */

const PUBLIC_URL_PORT = 0; // Bound at listen time; the URL is rewritten below.

let t: TestDb;
let server: ReturnType<typeof serve>;
let base: string;

/** The address the instance believes it is published at. */
let configuredUrl: string;

beforeAll(async () => {
  t = freshDb();

  // Bind first so the port is known, then build the app around that URL: the
  // whole test is about the relationship between the configured URL and the
  // one a caller uses.
  const port = await new Promise<number>((resolve) => {
    const probe = serve({ fetch: () => new Response('probe'), port: PUBLIC_URL_PORT }, (info) => {
      const { port: bound } = info;
      probe.close(() => {
        resolve(bound);
      });
    });
  });

  configuredUrl = `http://localhost:${String(port)}`;
  // The caller knocks on the *other* loopback spelling — exactly what the owner
  // did — so the trusted-origin fix is what this exercises.
  base = `http://127.0.0.1:${String(port)}`;

  const auth = createAuth({
    db: t.db,
    sqlite: t.sqlite,
    secret: 'a-test-secret-that-is-long-enough-to-pass',
    baseUrl: configuredUrl,
    secureCookies: false,
  });

  const app = createApp({
    version: '0.0.0-test',
    logger: createLogger(() => undefined),
    auth,
    db: t.db,
    sqlite: t.sqlite,
    publicUrl: configuredUrl,
  });

  server = serve({ fetch: app.fetch, port });

  await post('/api/v1/setup', configuredUrl, {
    org_name: 'Kvell',
    owner_name: 'Ada',
    owner_email: 'ada@example.test',
    owner_password: 'correct-horse-battery',
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  t.close();
});

async function post(path: string, origin: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;

  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function signIn(origin: string | null, password: string): Promise<Response> {
  return post('/api/v1/auth/sign-in/email', origin, {
    email: 'ada@example.test',
    password,
  });
}

interface Envelope {
  error: { code: string; message: string; details: unknown };
}

describe('the three outcomes are distinguishable (AC4)', () => {
  it('right credentials from the configured origin: signed in', async () => {
    const res = await signIn(configuredUrl, 'correct-horse-battery');

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('right credentials from the other loopback spelling: also signed in', async () => {
    // The bug. `localhost` was configured, the owner typed `127.0.0.1`, and this
    // was a 403 reported to them as a wrong password.
    const res = await signIn(base, 'correct-horse-battery');

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('wrong credentials from a trusted origin: says the credentials are wrong', async () => {
    const res = await signIn(configuredUrl, 'not-the-right-password');
    const body = (await res.json()) as Envelope;

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.message).toMatch(/password/i);
  });

  it('right credentials from a genuinely foreign origin: says the origin is wrong', async () => {
    const res = await signIn('https://evil.example', 'correct-horse-battery');
    const body = (await res.json()) as Envelope;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('forbidden');

    // The criterion, stated as an assertion: this must not read like a
    // credential failure.
    expect(body.error.message.toLowerCase()).not.toMatch(/password|email/);
    expect(body.error.message).toContain(configuredUrl);
    expect(body.error.message).toContain('https://evil.example');
    expect(body.error.details).toMatchObject({ reason: 'origin_mismatch' });
  });

  it('the credential failure and the origin failure differ in every field', async () => {
    const [bad, foreign] = await Promise.all([
      signIn(configuredUrl, 'not-the-right-password'),
      signIn('https://evil.example', 'correct-horse-battery'),
    ]);

    const badBody = (await bad.json()) as Envelope;
    const foreignBody = (await foreign.json()) as Envelope;

    expect(bad.status).not.toBe(foreign.status);
    expect(badBody.error.code).not.toBe(foreignBody.error.code);
    expect(badBody.error.message).not.toBe(foreignBody.error.message);
  });

  it('a foreign origin is still refused — the CSRF check is not the defect', async () => {
    // AC3. Widening to "any origin" would have made this pass by deleting the
    // protection, so it is asserted rather than assumed.
    expect((await signIn('https://evil.example', 'correct-horse-battery')).status).toBe(403);
    expect((await signIn('http://192.168.1.9:9999', 'correct-horse-battery')).status).toBe(403);
  });
});

describe('every auth failure speaks the §6.3 envelope', () => {
  it('so a client never has to parse a second error shape', async () => {
    for (const [origin, password] of [
      [configuredUrl, 'not-the-right-password'],
      ['https://evil.example', 'correct-horse-battery'],
    ] as const) {
      const body: unknown = await (await signIn(origin, password)).json();

      expect(body).toHaveProperty('error.code');
      expect(body).toHaveProperty('error.message');
      expect(body).toHaveProperty('error.details');
    }
  });

  it('carries the message where the web client actually reads it', async () => {
    // `api/auth.ts`'s `signIn` reads `details.message`; without this the UI falls
    // back to "Email or password is wrong." for every failure, which is how this
    // bug reached the owner. LAI-125 lets the client read `error.message`.
    const body = (await (await signIn('https://evil.example', 'correct-horse-battery')).json()) as {
      error: { message: string; details: { message?: string } };
    };

    expect(body.error.details.message).toBe(body.error.message);
  });
});

describe('the rest of the API is not origin-checked', () => {
  it('a plain GET from a foreign origin is not refused by an origin rule', async () => {
    // Answering the Notes' question. Only better-auth's own endpoints enforce
    // trusted origins; `/health` and the REST routes do not, and CSRF for those
    // is the `SameSite=Lax` cookie (§6.1). So a proxy that rewrites `Origin`
    // breaks sign-in and **not** the board or the SSE stream — worth knowing,
    // because the reverse would have been much harder to diagnose.
    const res = await fetch(`${base}/api/v1/health`, {
      headers: { Origin: 'https://evil.example' },
    });

    expect(res.status).toBe(200);
  });

  it('the SSE stream is reachable from a foreign origin too', async () => {
    // Unauthenticated, so it answers 401 rather than 403-for-origin — the point
    // is which failure it is, not that it succeeds.
    const res = await fetch(`${base}/api/v1/events`, {
      headers: { Origin: 'https://evil.example', Accept: 'text/event-stream' },
    });
    await res.body?.cancel();

    expect(res.status).not.toBe(403);
  });
});
