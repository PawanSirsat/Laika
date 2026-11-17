import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import {
  EMAIL_PREFS_DEFAULT,
  emailPrefsFor,
  getEmailPrefs,
  setEmailPrefs,
} from '../../src/services/email-prefs.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';
import { loadActor } from '../../src/auth/resolve-actor.ts';

/**
 * A person's own email switches (§4.94, D-153, LAI-1313): both on until they
 * say otherwise, their own row only, and signed in only.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let userId: string;

beforeEach(async () => {
  h = authHarness();
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
  userId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
});
afterEach(() => {
  h.close();
});

function call(
  method: string,
  body?: unknown,
  headers: Record<string, string> = { Cookie: cookie },
) {
  return h.app.request('/api/v1/me/email-prefs', {
    method,
    headers: jsonHeaders(headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('the service', () => {
  it('reads both on with no row, and keeps what is not given', () => {
    const me = loadActor(h.db, userId)!;
    expect(getEmailPrefs(h.db, me)).toEqual(EMAIL_PREFS_DEFAULT);
    expect(setEmailPrefs(h.db, me, { digest: false })).toEqual({ instant: true, digest: false });
    expect(setEmailPrefs(h.db, me, { instant: false })).toEqual({ instant: false, digest: false });
    expect(emailPrefsFor(h.db, [userId, 'nobody'])).toEqual(
      new Map([
        [userId, { instant: false, digest: false }],
        ['nobody', { instant: true, digest: true }],
      ]),
    );
  });
});

describe('GET and PUT /me/email-prefs', () => {
  it('answers the defaults, then what was set', async () => {
    const first = await call('GET');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ instant: true, digest: true });

    const put = await call('PUT', { instant: false });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ instant: false, digest: true });
    expect(await (await call('GET')).json()).toEqual({ instant: false, digest: true });
  });

  it('refuses a body that says nothing, and an unknown field', async () => {
    expect((await call('PUT', {})).status).toBe(400);
    expect((await call('PUT', { instant: true, weekly: true })).status).toBe(422);
  });

  it('refuses the person’s own token: whether they hear from Laika is theirs, signed in', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'An agent', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', { digest: false }],
    ] as const) {
      const res = await call(method, body, { Authorization: `Bearer ${secret}` });
      expect(res.status, method).toBe(403);
      expect(((await res.json()) as { error: { details: unknown } }).error.details).toEqual({
        action: 'email_prefs.own',
        reason: 'session_required',
      });
    }
    expect(await (await call('GET')).json()).toEqual({ instant: true, digest: true });
  });
});
