import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memberNotices, orgs, timeEntries, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `POST /people/:id/time-entries`, `PATCH`/`DELETE …/:entryId` and `GET
 * …/:entryId/revisions` (SPEC §3.1, §6.4, D-143, LAI-1165): an owner's or
 * admin's change to a member's confirmed time, over HTTP. Every refusal is
 * asserted by status **and** code, so a route that never reached the service
 * cannot pass.
 */

const PASSWORD = 'correct-horse-battery-staple';
const DAY = new Date().toISOString().slice(0, 10);

let h: AuthHarness;
let owner: { cookie: string; id: string };
let admin: { cookie: string; id: string };
let bob: { cookie: string; id: string };
let carol: { cookie: string; id: string };

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, { ...init, headers: jsonHeaders(credential) });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
}

async function refused(res: Response, status: number, code: string, reason?: string) {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  const body = JSON.parse(text) as { error: { code: string; details?: { reason?: string } } };
  expect(body.error.code).toBe(code);
  if (reason !== undefined) expect(body.error.details?.reason).toBe(reason);
}

async function join(email: string, orgRole: 'admin' | 'member') {
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const token = seedInvite(h.db, { orgId, createdBy: owner.id, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

/** An entry of the caller's own, typed on their own day. */
async function ownEntry(cookie: string, minutes = 30): Promise<string> {
  const made = await ok(
    await req(
      '/api/v1/me/time-entries',
      { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes }) },
      cookie,
    ),
    201,
  );
  return String(made.id);
}

const entries = (userId: string) => `/api/v1/people/${userId}/time-entries`;

beforeEach(async () => {
  h = authHarness();
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(setup.status).toBe(201);
  owner = {
    cookie: cookieFrom(setup),
    id: h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '',
  };
  admin = await join('al@example.test', 'admin');
  bob = await join('bob@example.test', 'member');
  carol = await join('carol@example.test', 'member');
  await ok(
    await req(
      '/api/v1/org/time',
      { method: 'PUT', body: JSON.stringify({ mode: 'manual' }) },
      owner.cookie,
    ),
  );
});

afterEach(() => {
  h.close();
});

describe('an owner changes a member’s confirmed time', () => {
  it('adds, lengthens and deletes, each a revision by the owner, and Bob is told each time', async () => {
    const made = await ok(
      await req(
        entries(bob.id),
        { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 30 }) },
        owner.cookie,
      ),
      201,
    );
    const id = String(made.id);
    expect(h.db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()?.userId).toBe(
      bob.id,
    );

    const changed = await ok(
      await req(
        `${entries(bob.id)}/${id}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 45 }) },
        owner.cookie,
      ),
    );
    expect(changed.minutes).toBe(45);

    const history = (await ok(await req(`${entries(bob.id)}/${id}/revisions`, {}, owner.cookie)))
      .revisions as { change: string; changed_by: string; changed_by_name: string }[];
    expect(history.map((r) => [r.change, r.changed_by, r.changed_by_name])).toEqual([
      ['created', owner.id, 'Ada'],
      ['edited', owner.id, 'Ada'],
    ]);

    await ok(await req(`${entries(bob.id)}/${id}`, { method: 'DELETE' }, owner.cookie), 204);

    // Bob reads his own: three notices, each naming Ada.
    const page = await ok(await req('/api/v1/me/notices', {}, bob.cookie));
    const notices = page.data as { kind: string; actor: { name: string }; subject: string }[];
    expect(notices.map((n) => [n.kind, n.actor.name, n.subject])).toEqual([
      ['time_changed', 'Ada', `deleted ${DAY} -45`],
      ['time_changed', 'Ada', `edited ${DAY} +15`],
      ['time_changed', 'Ada', `created ${DAY} +30`],
    ]);
    // Bob's own history of the entry names Ada too.
    const own = (await ok(await req(`/api/v1/me/time-entries/${id}/revisions`, {}, bob.cookie)))
      .revisions as { changed_by_name: string }[];
    expect(own.map((r) => r.changed_by_name)).toEqual(['Ada', 'Ada', 'Ada']);
  });

  it('carries no Undo: the person’s Undo is their own', async () => {
    const res = await req(
      entries(bob.id),
      { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 30 }) },
      owner.cookie,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Undo-Id')).toBeNull();
    // The control: the person's own add does answer with one.
    const own = await req(
      '/api/v1/me/time-entries',
      { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 30 }) },
      bob.cookie,
    );
    expect(own.status).toBe(201);
    expect(own.headers.get('X-Undo-Id')).toMatch(/\S/);
  });
});

describe('who may, and on whom', () => {
  it('an admin may change a member’s time and never the owner’s', async () => {
    const bobs = await ownEntry(bob.cookie);
    await ok(
      await req(
        `${entries(bob.id)}/${bobs}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 20 }) },
        admin.cookie,
      ),
    );

    const owners = await ownEntry(owner.cookie);
    await refused(
      await req(
        `${entries(owner.id)}/${owners}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 5 }) },
        admin.cookie,
      ),
      403,
      'forbidden',
      'not_for_owner',
    );
    await refused(
      await req(`${entries(owner.id)}/${owners}`, { method: 'DELETE' }, admin.cookie),
      403,
      'forbidden',
      'not_for_owner',
    );
    await refused(
      await req(
        entries(owner.id),
        { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 5 }) },
        admin.cookie,
      ),
      403,
      'forbidden',
      'not_for_owner',
    );
    // The owner's entry is untouched and nobody told the owner anything.
    expect(h.db.select().from(timeEntries).where(eq(timeEntries.id, owners)).get()?.minutes).toBe(
      30,
    );
    expect(
      h.db.select().from(memberNotices).where(eq(memberNotices.userId, owner.id)).all(),
    ).toEqual([]);
  });

  it('a member may not, and the path is not for yourself', async () => {
    const bobs = await ownEntry(bob.cookie);
    await refused(
      await req(
        `${entries(bob.id)}/${bobs}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 5 }) },
        carol.cookie,
      ),
      403,
      'forbidden',
    );
    await refused(
      await req(`${entries(bob.id)}/${bobs}/revisions`, {}, carol.cookie),
      403,
      'forbidden',
    );
    await refused(
      await req(
        `${entries(bob.id)}/${bobs}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 5 }) },
        bob.cookie,
      ),
      422,
      'unprocessable',
      'use_own_time',
    );
  });

  it('another person’s entry under the member’s id is 404, as none is', async () => {
    const carols = await ownEntry(carol.cookie);
    await refused(
      await req(
        `${entries(bob.id)}/${carols}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 5 }) },
        owner.cookie,
      ),
      404,
      'not_found',
    );
    await refused(
      await req(`${entries(bob.id)}/${carols}`, { method: 'DELETE' }, owner.cookie),
      404,
      'not_found',
    );
  });

  it('refuses every token, the owner’s full one included', async () => {
    const bobs = await ownEntry(bob.cookie);
    const minted = await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        owner.cookie,
      ),
      201,
    );
    await refused(
      await req(
        `${entries(bob.id)}/${bobs}`,
        { method: 'PATCH', body: JSON.stringify({ minutes: 5 }) },
        String(minted.secret),
      ),
      403,
      'forbidden',
      'session_required',
    );
  });

  it('takes the /me body and nothing more', async () => {
    await refused(
      await req(
        entries(bob.id),
        {
          method: 'POST',
          body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 30, user_id: carol.id }),
        },
        owner.cookie,
      ),
      422,
      'unprocessable',
    );
  });
});
