import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createAuth, SESSION_EXPIRES_IN } from '../../src/auth/auth.ts';
import { sessions } from '../../src/db/schema.ts';
import { readEnv } from '../../src/env.ts';
import { ActivityFeed } from '../../src/services/activity-feed.ts';
import { captureLog, withTempDir } from '../helpers/app.ts';
import { TEST_SECRET } from '../helpers/auth.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Signed out too often (LAI-811).
 *
 * Two lifetime defects and one trap. A remembered session's database expiry slid
 * on use while its cookie kept the `Max-Age` it got at sign-in, because the
 * renewed `Set-Cookie` was dropped on the floor; "Keep me signed in" started
 * unticked (pinned in `server/web/test/auth-states.test.ts`); and the `Secure`
 * decision lived in an attribute block better-auth never read, cancelling out a
 * `secureCookies` that was wrong for `http://<IP>`.
 *
 * Everything here goes through the real app, real better-auth and a real
 * database, and asserts on the headers a browser would act on.
 */

const PASSWORD = 'correct-horse-battery-staple';
const EMAIL = 'ada@example.test';

/** Production today: plain http on a bare address. */
const HTTP_IP = 'http://203.0.113.7:3000';
const HTTPS_HOST = 'https://laika.example.test';

const DAY = 24 * 60 * 60;

interface Instance {
  app: ReturnType<typeof createApp>;
  auth: ReturnType<typeof createAuth>;
  origin: string;
  close(): void;
}

/**
 * An app wired the way `index.ts` wires it: `createAuth` gets the public URL as
 * its `baseUrl` and the `secureCookies` it is told. A second instance over the
 * same database is a server restart.
 */
function instance(t: TestDb, origin: string, secureCookies: boolean, publicDir?: string): Instance {
  const log = captureLog();
  const activityFeed = new ActivityFeed({ db: t.db });
  const auth = createAuth({
    db: t.db,
    sqlite: t.sqlite,
    secret: TEST_SECRET,
    baseUrl: origin,
    secureCookies,
  });
  const app = createApp({
    version: '0.0.0-test',
    logger: log.logger,
    auth,
    db: t.db,
    sqlite: t.sqlite,
    publicUrl: origin,
    serverSecret: TEST_SECRET,
    activityFeed,
    ...(publicDir === undefined ? {} : { publicDir }),
  });

  return { app, auth, origin, close: () => activityFeed.closeAll() };
}

/** What production's environment resolves for `LAIKA_PUBLIC_URL`. */
function secureCookiesFor(publicUrl: string): boolean {
  return readEnv({
    NODE_ENV: 'production',
    LAIKA_SECRET: TEST_SECRET,
    LAIKA_PUBLIC_URL: publicUrl,
    LAIKA_DB_PATH: '/nonexistent/laika.db',
  }).secureCookies;
}

async function post(i: Instance, path: string, body: unknown, cookie?: string): Promise<Response> {
  return await i.app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: i.origin,
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });
}

/** Asserts its own status, so a broken setup cannot pass as a test (CLAUDE.md §5). */
async function setUp(i: Instance): Promise<void> {
  const res = await post(i, '/api/v1/setup', {
    org_name: 'Laika',
    owner_name: 'Ada',
    owner_email: EMAIL,
    owner_password: PASSWORD,
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

/** Signs in the way the SPA does with the box ticked. Returns the response. */
async function signIn(i: Instance): Promise<Response> {
  const res = await post(i, '/api/v1/auth/sign-in/email', {
    email: EMAIL,
    password: PASSWORD,
    rememberMe: true,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

async function me(i: Instance, headers: Record<string, string>): Promise<Response> {
  return await i.app.request('/api/v1/me', { headers });
}

interface ParsedCookie {
  name: string;
  value: string;
  /** Lower-cased attribute name → value (`''` for a flag such as `HttpOnly`). */
  attributes: Map<string, string>;
}

function parse(setCookie: string): ParsedCookie {
  const [pair = '', ...rest] = setCookie.split(';').map((part) => part.trim());
  const eq = pair.indexOf('=');
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const at = part.indexOf('=');
    if (at === -1) attributes.set(part.toLowerCase(), '');
    else attributes.set(part.slice(0, at).toLowerCase(), part.slice(at + 1));
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes };
}

/** Every `Set-Cookie` on the response that carries the session token. */
function sessionCookies(res: Response): ParsedCookie[] {
  return res.headers
    .getSetCookie()
    .map(parse)
    .filter((c) => c.name.endsWith('better-auth.session_token'));
}

/** The one session cookie on the response; fails the test if there is not exactly one. */
function sessionCookie(res: Response): ParsedCookie {
  const found = sessionCookies(res);
  expect(found.map((c) => c.name)).toHaveLength(1);
  const [only] = found;
  if (only === undefined) throw new Error('no session cookie on the response');
  return only;
}

function asRequestCookie(c: ParsedCookie): string {
  return `${c.name}=${c.value}`;
}

/** As if the session were last issued or renewed `ageSeconds` ago. */
function age(t: TestDb, ageSeconds: number): void {
  const result = t.db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() + (SESSION_EXPIRES_IN - ageSeconds) * 1000) })
    .run();
  expect(result.changes).toBeGreaterThan(0);
}

/** As if the session had run out a minute ago. */
function kill(t: TestDb): void {
  const result = t.db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .run();
  expect(result.changes).toBeGreaterThan(0);
}

function expiries(t: TestDb): number[] {
  return t.db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .all()
    .map((row) => row.expiresAt.getTime());
}

let t: TestDb;
const open: Instance[] = [];

function start(origin: string, secureCookies: boolean, publicDir?: string): Instance {
  const i = instance(t, origin, secureCookies, publicDir);
  open.push(i);
  return i;
}

beforeEach(() => {
  t = freshDb();
});

afterEach(() => {
  for (const i of open.splice(0)) i.close();
  t.close();
});

describe('the session lifetime (LAI-811)', () => {
  it('is 30 days idle and renews after a day — as better-auth resolved it', async () => {
    const i = start(HTTP_IP, false);
    const context = await i.auth.$context;

    // Resolved, not configured: an assertion on the options we pass would only
    // prove we passed them.
    expect(context.sessionConfig.expiresIn).toBe(30 * DAY);
    expect(context.sessionConfig.updateAge).toBe(DAY);
  });

  it('issues a 30-day cookie and a 30-day session at sign-in', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);

    const before = Date.now();
    const cookie = sessionCookie(await signIn(i));

    expect(cookie.attributes.get('max-age')).toBe(String(30 * DAY));
    // The sign-in session is the newest row; setup made the other.
    const newest = Math.max(...expiries(t));
    expect(newest - before).toBeGreaterThanOrEqual(30 * DAY * 1000 - 5_000);
    expect(newest - before).toBeLessThanOrEqual(30 * DAY * 1000 + 5_000);
  });
});

describe('a remembered session renews its cookie (LAI-811)', () => {
  it('gives a session older than updateAge a renewed cookie with the full lifetime, on /me', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const signedIn = sessionCookie(await signIn(i));

    age(t, 2 * DAY);
    const before = Date.now();
    const res = await me(i, { Cookie: asRequestCookie(signedIn) });

    expect(res.status).toBe(200);
    const renewed = sessionCookie(res);
    expect(renewed.name).toBe('better-auth.session_token');
    expect(renewed.attributes.get('max-age')).toBe(String(30 * DAY));
    expect(renewed.attributes.get('path')).toBe('/');
    expect(renewed.attributes.get('samesite')?.toLowerCase()).toBe('lax');
    expect(renewed.attributes.has('httponly')).toBe(true);
    // The same session, re-sent — not a new one.
    expect(renewed.value).toBe(signedIn.value);

    // And the database agrees with the cookie: 30 days from now, not from sign-in.
    expect(Math.max(...expiries(t)) - before).toBeGreaterThanOrEqual(30 * DAY * 1000 - 5_000);

    expect((await me(i, { Cookie: asRequestCookie(renewed) })).status).toBe(200);
  });

  it('renews once a day, not on every request', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

    // Fresh: nothing to renew.
    const fresh = await me(i, { Cookie: signedIn });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.getSetCookie()).toEqual([]);

    // Just under a day old: still nothing.
    age(t, DAY - 60 * 60);
    const underADay = await me(i, { Cookie: signedIn });
    expect(underADay.status).toBe(200);
    expect(underADay.headers.getSetCookie()).toEqual([]);

    // Just over: renewed — the precondition that makes the absences above mean
    // something on code that never sends a cookie at all.
    age(t, DAY + 60 * 60);
    const overADay = await me(i, { Cookie: signedIn });
    expect(overADay.status).toBe(200);
    expect(sessionCookie(overADay).attributes.get('max-age')).toBe(String(30 * DAY));

    // And the request after a renewal does not renew again.
    const next = await me(i, { Cookie: signedIn });
    expect(next.status).toBe(200);
    expect(next.headers.getSetCookie()).toEqual([]);
  });

  it('does not undo a sign-out: the expiring cookie is the only session cookie on the response', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

    // Old enough that resolving the actor on the way in renews it.
    age(t, 2 * DAY);
    const out = await post(i, '/api/v1/auth/sign-out', {}, signedIn);

    expect(out.status).toBe(200);
    const cookie = sessionCookie(out);
    expect(cookie.attributes.get('max-age')).toBe('0');
    expect((await me(i, { Cookie: signedIn })).status).toBe(401);
  });

  it('does not undo a sign-in: the new session is the only session cookie on the response', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const first = sessionCookie(await signIn(i));

    age(t, 2 * DAY);
    const again = await post(
      i,
      '/api/v1/auth/sign-in/email',
      { email: EMAIL, password: PASSWORD, rememberMe: true },
      asRequestCookie(first),
    );

    expect(again.status).toBe(200);
    const issued = sessionCookie(again);
    expect(issued.value).not.toBe(first.value);
    expect(issued.attributes.get('max-age')).toBe(String(30 * DAY));
  });
});

describe('a bearer token never gets a cookie (LAI-811)', () => {
  it('answers a token with no Set-Cookie, even with a renewable session cookie attached', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

    const minted = await post(i, '/api/v1/tokens', { name: 'cli', scope: 'full' }, signedIn);
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    age(t, 2 * DAY);
    const withToken = await me(i, { Authorization: `Bearer ${secret}`, Cookie: signedIn });

    expect(withToken.status).toBe(200);
    expect(withToken.headers.getSetCookie()).toEqual([]);

    // The cookie *was* renewable: presented alone, it is renewed. Without this,
    // the absence above would hold on code that never renews anything.
    const withCookie = await me(i, { Cookie: signedIn });
    expect(withCookie.status).toBe(200);
    expect(sessionCookie(withCookie).attributes.get('max-age')).toBe(String(30 * DAY));
  });
});

describe('Secure follows the scheme, and the cookie keeps its name (LAI-811)', () => {
  it('http://<IP>: no Secure, the name every existing session carries, and it survives a restart', async () => {
    const secure = secureCookiesFor(HTTP_IP);
    expect(secure).toBe(false);

    const i = start(HTTP_IP, secure);
    await setUp(i);
    const cookie = sessionCookie(await signIn(i));

    expect(cookie.name).toBe('better-auth.session_token');
    expect(cookie.attributes.has('secure')).toBe(false);

    // A cookie a browser already holds is presented by its literal name, and
    // a restarted server (a new instance over the same database) accepts it.
    const restarted = start(HTTP_IP, secureCookiesFor(HTTP_IP));
    const res = await me(restarted, { Cookie: `better-auth.session_token=${cookie.value}` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe(EMAIL);
  });

  it('https: Secure, under the __Secure- prefix', async () => {
    const secure = secureCookiesFor(HTTPS_HOST);
    expect(secure).toBe(true);

    const i = start(HTTPS_HOST, secure);
    await setUp(i);
    const cookie = sessionCookie(await signIn(i));

    expect(cookie.name).toBe('__Secure-better-auth.session_token');
    expect(cookie.attributes.has('secure')).toBe(true);
    expect((await me(i, { Cookie: asRequestCookie(cookie) })).status).toBe(200);
  });

  it('is decided by the secureCookies flag, which better-auth now reads', async () => {
    // Deliberately against each URL's scheme, so the flag and the URL cannot
    // both be the reason. Before LAI-811 the flag went into a block better-auth
    // never read, and the URL decided alone.
    const flagOn = start(HTTP_IP, true);
    await setUp(flagOn);
    const on = sessionCookie(await signIn(flagOn));
    expect(on.name).toBe('__Secure-better-auth.session_token');
    expect(on.attributes.has('secure')).toBe(true);

    const other = freshDb();
    try {
      const flagOff = instance(other, HTTPS_HOST, false);
      try {
        await setUp(flagOff);
        const res = await post(flagOff, '/api/v1/auth/sign-in/email', {
          email: EMAIL,
          password: PASSWORD,
          rememberMe: true,
        });
        expect(res.status).toBe(200);
        const off = sessionCookie(res);
        expect(off.name).toBe('better-auth.session_token');
        expect(off.attributes.has('secure')).toBe(false);
      } finally {
        flagOff.close();
      }
    } finally {
      other.close();
    }
  });
});

describe('a session cookie never rides on a response a cache may keep (LAI-811 review round 1)', () => {
  const HASHED_JS = '/assets/index-DfSpNg7Z.js';
  const IMMUTABLE = 'public, max-age=31536000, immutable';

  /** A build output this test owns: the SPA document and one hashed bundle. */
  async function withBuild(fn: (i: Instance) => Promise<void>): Promise<void> {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'assets'));
      await writeFile(join(dir, 'index.html'), '<!doctype html><title>built spa</title>', 'utf8');
      await writeFile(join(dir, HASHED_JS), 'export const built = true;\n', 'utf8');
      await fn(start(HTTP_IP, false, dir));
    });
  }

  it('serves a hashed asset to an aged session with no Set-Cookie and its immutable Cache-Control', async () => {
    await withBuild(async (i) => {
      await setUp(i);
      const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

      age(t, 2 * DAY);
      const asset = await i.app.request(HASHED_JS, { headers: { Cookie: signedIn } });

      expect(asset.status).toBe(200);
      expect(asset.headers.getSetCookie()).toEqual([]);
      expect(asset.headers.get('cache-control')).toBe(IMMUTABLE);
      // Nor did it renew the session behind the browser's back: the database
      // and the cookie move together, or not at all.
      expect(Math.max(...expiries(t)) - Date.now()).toBeLessThan(28 * DAY * 1000 + 5_000);

      // The SPA reads /api/v1/me on load, and that is where the renewal lands.
      const onLoad = await me(i, { Cookie: signedIn });
      expect(onLoad.status).toBe(200);
      expect(sessionCookie(onLoad).attributes.get('max-age')).toBe(String(30 * DAY));
      expect(Math.max(...expiries(t)) - Date.now()).toBeGreaterThan(30 * DAY * 1000 - 5_000);
    });
  });

  it('serves the SPA document, and its 304, to an aged session with no Set-Cookie', async () => {
    await withBuild(async (i) => {
      await setUp(i);
      const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

      age(t, 2 * DAY);
      const page = await i.app.request('/board', { headers: { Cookie: signedIn } });

      expect(page.status).toBe(200);
      expect(page.headers.getSetCookie()).toEqual([]);
      expect(page.headers.get('cache-control')).toBe('no-cache');
      const etag = page.headers.get('etag');
      expect(etag).toMatch(/^"[^"]+"$/);

      // Aged again, so a renewal that the first request had already spent
      // cannot be why this one carries nothing.
      age(t, 2 * DAY);
      const unchanged = await i.app.request('/board', {
        headers: { Cookie: signedIn, 'If-None-Match': etag ?? '' },
      });

      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.getSetCookie()).toEqual([]);
    });
  });

  it('renews on /api/v1/me, and makes that response private, no-store', async () => {
    const i = start(HTTP_IP, false);
    await setUp(i);
    const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

    age(t, 2 * DAY);
    const res = await me(i, { Cookie: signedIn });

    expect(res.status).toBe(200);
    expect(sessionCookie(res).attributes.get('max-age')).toBe(String(30 * DAY));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('sends no expiring cookie for a dead session on an asset; the next API request clears it, uncacheably', async () => {
    await withBuild(async (i) => {
      await setUp(i);
      const signedIn = asRequestCookie(sessionCookie(await signIn(i)));

      kill(t);
      const asset = await i.app.request(HASHED_JS, { headers: { Cookie: signedIn } });

      expect(asset.status).toBe(200);
      expect(asset.headers.getSetCookie()).toEqual([]);
      expect(asset.headers.get('cache-control')).toBe(IMMUTABLE);

      const res = await me(i, { Cookie: signedIn });
      expect(res.status).toBe(401);
      expect(sessionCookie(res).attributes.get('max-age')).toBe('0');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    });
  });
});
