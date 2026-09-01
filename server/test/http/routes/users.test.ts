import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let cookie: string;
let ownerId: string;

const PASSWORD = 'correct-horse-battery-staple';

interface UserBody {
  id: string;
  name: string;
  email: string;
  org_role: string;
  is_active: boolean;
}

interface UserPage {
  data: UserBody[];
  next_cursor: string | null;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function page(path: string): Promise<UserPage> {
  const res = await req(path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as UserPage;
}

/** Another person in the org, added directly — there is no invites API yet. */
function seedPerson(name: string, isActive = 1): string {
  const id = `usr_${name.replace(/\s+/g, '')}`;
  const now = Date.now();
  h.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
      name,
      orgRole: 'member',
      isActive,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

beforeEach(async () => {
  h = authHarness();

  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada Lovelace',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status).toBe(201);
  cookie = cookieFrom(setup);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
});
afterEach(() => {
  h.close();
});

describe('the endpoint §6.4 already specified (AC1)', () => {
  it('lists the org, in the §6.3 page envelope', async () => {
    seedPerson('Bob Badger');

    const body = await page('/api/v1/users');

    expect(Object.keys(body).sort()).toEqual(['data', 'next_cursor']);
    expect(body.data.map((u) => u.name)).toEqual(['Ada Lovelace', 'Bob Badger']);
    expect(body.data[0]).toMatchObject({
      id: ownerId,
      email: 'ada@example.test',
      org_role: 'owner',
      is_active: true,
    });
    // `avatar_color` is gone (LAI-148): the client derives its own, theme-aware,
    // from the id — a stored value cannot be legible in both themes (§5.1).
    expect('avatar_color' in (body.data[0] ?? {})).toBe(false);
  });

  it('gives a caller the id that POST /members needs — the whole point', async () => {
    const bob = seedPerson('Bob Badger');
    const body = await page('/api/v1/users');

    const found = body.data.find((u) => u.name === 'Bob Badger');
    expect(found?.id).toBe(bob);

    // And that id is accepted where it was previously unobtainable.
    const added = await req('/api/v1/projects/laika/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: found!.id, role: 'member' }),
    });
    expect(added.status).toBe(201);
  });

  it('401s an anonymous caller', async () => {
    expect((await h.app.request('/api/v1/users')).status).toBe(401);
  });
});

describe('read-only for now (AC2)', () => {
  it('405s the write methods on the collection', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const res = await req('/api/v1/users', { method, body: JSON.stringify({}) });

      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET');
    }
  });

  it('405s the unbuilt methods on /users/:id, now that PATCH is registered', async () => {
    // **This changed with LAI-222.** It used to be `404` with no `Allow`, and
    // that was correct: no route was registered on the path at all, so "no such
    // endpoint" was the honest answer. `PATCH` now exists, so the path does too,
    // and `405` with the methods that *are* built is the accurate answer for the
    // ones that are not.
    //
    // Kept rather than deleted, because the distinction it pins — 404 for an
    // unregistered path, 405 for an unbuilt method on a registered one — is the
    // thing worth not losing (D-021).
    for (const method of ['GET', 'DELETE']) {
      const res = await req('/api/v1/users/usr_someone', {
        method,
        // No body on GET — `fetch` refuses one, which is a Request-level rule and
        // nothing to do with the route.
        ...(method === 'GET' ? {} : { body: JSON.stringify({}) }),
      });

      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow'), method).toContain('PATCH');
    }
  });
});

describe('deactivated people (AC3)', () => {
  it('are hidden by default and shown on request, flagged', async () => {
    seedPerson('Yves Inactive', 0);

    expect((await page('/api/v1/users')).data.map((u) => u.name)).toEqual(['Ada Lovelace']);

    const all = await page('/api/v1/users?include_inactive=true');
    expect(all.data.map((u) => u.name)).toEqual(['Ada Lovelace', 'Yves Inactive']);
    expect(all.data.find((u) => u.name === 'Yves Inactive')?.is_active).toBe(false);
  });

  it('rejects a nonsense include_inactive rather than guessing', async () => {
    const res = await req('/api/v1/users?include_inactive=perhaps');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });
});

describe('paging and catch-up (AC3)', () => {
  it('pages alphabetically without repeating or losing anyone', async () => {
    for (const name of ['Bea Bee', 'Cal Cat', 'Dee Dog', 'Eli Elk']) seedPerson(name);

    const whole = await page('/api/v1/users?limit=200');
    const walked: string[] = [];
    let cursor: string | null = null;

    for (let i = 0; i < 10; i++) {
      const url: string =
        cursor === null ? '/api/v1/users?limit=2' : `/api/v1/users?limit=2&cursor=${cursor}`;
      const got = await page(url);
      walked.push(...got.data.map((u) => u.id));
      cursor = got.next_cursor;
      if (cursor === null) break;
    }

    expect(walked).toEqual(whole.data.map((u) => u.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('returns a deactivation to an updated_since catch-up', async () => {
    const yves = seedPerson('Yves Inactive');
    const before = Date.now();
    h.db
      .update(users)
      .set({ isActive: 0, updatedAt: new Date(before + 1000) })
      .where(eq(users.id, yves))
      .run();

    const caught = await page(`/api/v1/users?updated_since=${String(before + 1000)}`);

    expect(caught.data.map((u) => u.id)).toEqual([yves]);
    expect(caught.data[0]?.is_active).toBe(false);
    // Not a tombstone: §4.1 keeps the row, so `{ id, deleted: true }` would lie.
    expect(caught.data[0]).toHaveProperty('name');
  });

  it('rejects a malformed updated_since and a malformed cursor', async () => {
    expect((await req('/api/v1/users?updated_since=lately')).status).toBe(400);
    expect((await req('/api/v1/users?cursor=nonsense')).status).toBe(400);
  });
});

/**
 * `PATCH /api/v1/users/:id` (§6.4, §3.1, LAI-222).
 *
 * The service owns the rules and drives each refusal; this is transport — that
 * the route exists at all (it 404'd before LAI-222), that the body is strict,
 * and that a refusal reaches the client as the right status.
 */
describe('PATCH /api/v1/users/:id', () => {
  async function patch(id: string, body: unknown): Promise<Response> {
    return req(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  it('is registered — it answered 404 before LAI-222', async () => {
    const target = seedPerson('Grace Hopper');
    const res = await patch(target, { org_role: 'admin' });

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as UserBody).org_role).toBe('admin');
  });

  it('deactivates and reactivates', async () => {
    const target = seedPerson('Grace Hopper');

    expect(((await (await patch(target, { is_active: false })).json()) as UserBody).is_active).toBe(
      false,
    );
    expect(((await (await patch(target, { is_active: true })).json()) as UserBody).is_active).toBe(
      true,
    );
  });

  it('refuses an unknown key rather than ignoring it', async () => {
    const target = seedPerson('Grace Hopper');

    // §6.3 is strict everywhere. A key that is silently dropped is a caller
    // believing they changed something they did not.
    expect((await patch(target, { org_role: 'admin', is_admin: true })).status).toBe(422);
  });

  it('refuses a role that is not an org role', async () => {
    const target = seedPerson('Grace Hopper');

    expect((await patch(target, { org_role: 'lead' })).status).toBe(422);
  });

  it('refuses a patch that asks for nothing', async () => {
    const target = seedPerson('Grace Hopper');

    // `200` here would report a change that did not happen.
    expect((await patch(target, {})).status).toBe(400);
  });

  it('404s on a user that does not exist', async () => {
    expect((await patch('usr_nobody', { org_role: 'admin' })).status).toBe(404);
  });

  it('409s rather than 403s when the last Owner is the target', async () => {
    // The request is well formed and the caller is permitted; the *state*
    // forbids it. A `403` would say "you may not", and an Owner may.
    const res = await patch(ownerId, { org_role: 'admin' });

    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/last active Owner/i);
  });

  // A Member's refusal is driven at the service, where signing a second person
  // in is not needed to state the rule — `test/services/users.test.ts`,
  // "refuses a Member and a Viewer outright". A route-level duplicate would
  // assert the same `can()` call twice and cost an auth round trip to do it.
});
