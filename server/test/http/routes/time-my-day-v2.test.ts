import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * My day v2 over HTTP (LAI-831, the owner's "Laika App v2" design and CHIEF's
 * additions): a gap waved away as a **Break** (D), a block's edge **dragged**
 * (C), **Undo** that puts the server back exactly as it was (B), and the
 * drafts a person holds across every day, for the off switch's question (F).
 *
 * All of it is the person's own, on a web session: each route asks `can()`
 * for `time_drafts.*_own` or `time_entries.*_own`, which refuse every token,
 * and none of it reads or touches anybody else's rows.
 */

const PASSWORD = 'correct-horse-battery-staple';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** A write that must succeed — its status asserted, so a broken setup cannot pass. */
async function ok(path: string, init: RequestInit, status: number, auth = cookie) {
  const res = await req(path, init, auth);
  expect(res.status, `${init.method ?? 'GET'} ${path}: ${await res.clone().text()}`).toBe(status);
  return res;
}

async function mint(auth = cookie): Promise<string> {
  const res = await ok(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Collector', scope: 'full' }) },
    201,
    auth,
  );
  return String(((await res.json()) as { secret: string }).secret);
}

async function errorOf(res: Response): Promise<{ code: string; reason: string }> {
  const { error } = (await res.json()) as {
    error: { code: string; details?: { reason?: string } };
  };
  return { code: error.code, reason: error.details?.reason ?? '' };
}

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number, minute = 0): number =>
  Date.parse(`${today()}T00:00:00Z`) + (hour * 60 + minute) * 60_000;

const block = (hour: number, minutes: number, task: string | null) => ({
  start: at(hour),
  end: at(hour) + minutes * 60_000,
  minutes,
  task,
  signals: { prompts: 3, replies: 6, sessions: 1, commits: 1 },
});

function upload(blocks: unknown[]): string {
  return JSON.stringify({
    v: 1,
    collector_id: COLLECTOR,
    tz: 'UTC',
    days: [{ day: today(), blocks }],
  });
}

interface Draft {
  id: string;
  minutes: number;
  started_at: number | null;
  ended_at: number | null;
  task: { key: string } | null;
  task_key: string | null;
  general: boolean;
}
interface Entry {
  id: string;
  minutes: number;
  started_at: number | null;
  ended_at: number | null;
  revision: number;
}
interface Day {
  drafts: Draft[];
  entries: Entry[];
  breaks: { id: string; day: string; started_at: number; ended_at: number }[];
  drafts_held: { count: number; minutes: number };
}

async function myDay(auth = cookie): Promise<Day> {
  const res = await ok(`/api/v1/me/time?tz=UTC&day=${today()}`, {}, 200, auth);
  return (await res.json()) as Day;
}

const undo = (subject: Record<string, string>, auth = cookie) =>
  req('/api/v1/me/time/undo', { method: 'POST', body: JSON.stringify(subject) }, auth);

let orgId: string;
let ownerId: string;

/** A second person in the organisation, signed in, with drafting on. */
async function someoneElse(): Promise<string> {
  const email = 'grace@example.test';
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole: 'member' });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  const theirs = cookieFrom(res);
  await ok(
    '/api/v1/me/time-settings',
    { method: 'PUT', body: JSON.stringify({ draft_my_time: true }) },
    200,
    theirs,
  );
  return theirs;
}

beforeEach(async () => {
  h = authHarness({ rateLimiter: new RateLimiter() });
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
  orgId = h.db.select({ id: orgs.id }).from(orgs).get()?.id ?? '';
  ownerId =
    h.db.select({ id: users.id }).from(users).where(eq(users.email, 'ada@example.test')).get()
      ?.id ?? '';
  for (const title of ['Time', 'Review']) {
    await ok('/api/v1/projects/laika/tasks', { method: 'POST', body: JSON.stringify({ title }) }, 201);
  }
  await ok('/api/v1/org/time', { method: 'PUT', body: JSON.stringify({ mode: 'drafts' }) }, 200);
  await ok(
    '/api/v1/me/time-settings',
    { method: 'PUT', body: JSON.stringify({ draft_my_time: true }) },
    200,
  );
});

afterEach(() => {
  h.close();
});

/** The collector's upload: a block on LAI-1 at 09:00 and one on nothing at 11:00. */
async function drafted(): Promise<{ onCard: Draft; untied: Draft }> {
  await ok(
    '/api/v1/me/time-drafts',
    { method: 'PUT', body: upload([block(9, 60, 'LAI-1'), block(11, 40, null)]) },
    200,
    await mint(),
  );
  const { drafts } = await myDay();
  const onCard = drafts.find((d) => d.task?.key === 'LAI-1');
  const untied = drafts.find((d) => d.task === null);
  expect(onCard).toBeDefined();
  expect(untied).toBeDefined();
  return { onCard: onCard as Draft, untied: untied as Draft };
}

describe('Break — a gap waved away (D)', () => {
  it('is kept per person and day, served with the day, and removed again', async () => {
    const made = await ok(
      '/api/v1/me/time-breaks',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', started_at: at(12), ended_at: at(12, 45) }),
      },
      201,
    );
    const created = (await made.json()) as { id: string };
    expect(created).toMatchObject({ day: today(), started_at: at(12), ended_at: at(12, 45) });

    expect((await myDay()).breaks).toEqual([
      { id: created.id, day: today(), tz: 'UTC', started_at: at(12), ended_at: at(12, 45) },
    ]);

    await ok(`/api/v1/me/time-breaks/${created.id}`, { method: 'DELETE' }, 204);
    expect((await myDay()).breaks).toEqual([]);
  });

  it('never counts as time: the day’s entries and totals do not change', async () => {
    await ok(
      '/api/v1/me/time-breaks',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', started_at: at(12), ended_at: at(13) }),
      },
      201,
    );
    const day = await myDay();
    expect(day.entries).toEqual([]);
    expect(day.drafts).toEqual([]);
  });

  it('refuses a span that ends before it starts, or leaves its day', async () => {
    for (const [from, to] of [
      [at(13), at(12)],
      [at(23, 30), at(23, 30) + 60 * 60_000],
    ] as const) {
      const res = await req(
        '/api/v1/me/time-breaks',
        {
          method: 'POST',
          body: JSON.stringify({ day: today(), tz: 'UTC', started_at: from, ended_at: to }),
        },
        cookie,
      );
      expect(res.status).toBe(422);
      expect(['invalid_span', 'outside_day']).toContain((await errorOf(res)).reason);
    }
  });

  it('is refused to a token, and is nobody else’s to see or remove', async () => {
    const token = await mint();
    const refused = await req(
      '/api/v1/me/time-breaks',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', started_at: at(12), ended_at: at(13) }),
      },
      token,
    );
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).reason).toBe('session_required');

    const made = await ok(
      '/api/v1/me/time-breaks',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', started_at: at(12), ended_at: at(13) }),
      },
      201,
    );
    const { id } = (await made.json()) as { id: string };
    const theirs = await someoneElse();
    expect((await myDay(theirs)).breaks).toEqual([]);
    expect((await req(`/api/v1/me/time-breaks/${id}`, { method: 'DELETE' }, theirs)).status).toBe(
      404,
    );
    expect((await req(`/api/v1/me/time-breaks/${id}`, { method: 'DELETE' }, token)).status).toBe(
      403,
    );
    expect((await myDay()).breaks).toHaveLength(1);
  });
});

describe('a block’s edges (C)', () => {
  it('a drafted block takes a new start, end and minutes in one write', async () => {
    const { onCard } = await drafted();
    const res = await ok(
      `/api/v1/me/time-drafts/${onCard.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ started_at: at(8, 50), ended_at: at(10, 5), minutes: 75 }),
      },
      200,
    );
    expect(await res.json()).toMatchObject({
      started_at: at(8, 50),
      ended_at: at(10, 5),
      minutes: 75,
    });
  });

  it('refuses a drafted block more minutes than its span, or a span off its day', async () => {
    const { onCard } = await drafted();
    for (const [body, reason] of [
      [{ started_at: at(9), ended_at: at(9, 30), minutes: 45 }, 'minutes_over_span'],
      [{ started_at: at(23, 30), ended_at: at(23, 30) + 60 * 60_000 }, 'outside_day'],
      [{ started_at: at(10), ended_at: at(9) }, 'invalid_span'],
    ] as const) {
      const res = await req(
        `/api/v1/me/time-drafts/${onCard.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        cookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).reason, JSON.stringify(body)).toBe(reason);
    }
  });

  it('a confirmed entry’s new span and minutes are one revision', async () => {
    const made = await ok(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({
          day: today(),
          tz: 'UTC',
          minutes: 30,
          started_at: at(14),
          ended_at: at(14, 30),
        }),
      },
      201,
    );
    const { id } = (await made.json()) as { id: string };
    const res = await ok(
      `/api/v1/me/time-entries/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ started_at: at(13, 45), ended_at: at(14, 30), minutes: 45 }),
      },
      200,
    );
    expect(await res.json()).toMatchObject({
      started_at: at(13, 45),
      ended_at: at(14, 30),
      minutes: 45,
      revision: 2,
    });
    const history = await ok(`/api/v1/me/time-entries/${id}/revisions`, {}, 200);
    const { revisions } = (await history.json()) as {
      revisions: { change: string; started_at: number }[];
    };
    expect(revisions.map((r) => r.change)).toEqual(['created', 'edited']);
    expect(revisions[1]?.started_at).toBe(at(13, 45));
  });
});

describe('Undo puts the server back as it was (B)', () => {
  it('confirm, undone: the draft is pending again as it was, and nothing counts', async () => {
    const { onCard } = await drafted();
    const before = await myDay();
    const confirmed = await ok(`/api/v1/me/time-drafts/${onCard.id}/confirm`, { method: 'POST' }, 201);
    const entry = (await confirmed.json()) as { id: string };

    expect((await undo({ draft: onCard.id })).status).toBe(204);
    const after = await myDay();
    expect(after.drafts).toEqual(before.drafts);
    expect(after.entries).toEqual(before.entries);
    // History is append-only: the entry's record says it was taken back.
    const history = await ok(`/api/v1/me/time-entries/${entry.id}/revisions`, {}, 200);
    expect(
      ((await history.json()) as { revisions: { change: string }[] }).revisions.map(
        (r) => r.change,
      ),
    ).toEqual(['created', 'deleted']);

    // And the block can be confirmed again — the one entry a draft has comes back.
    const again = await ok(`/api/v1/me/time-drafts/${onCard.id}/confirm`, { method: 'POST' }, 201);
    expect(((await again.json()) as { id: string }).id).toBe(entry.id);
    expect((await myDay()).entries.map((e) => e.minutes)).toEqual([60]);
  });

  it('General, undone: the block is back on nothing and its collector’s again', async () => {
    await ok(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([block(11, 40, 'LAI-404')]) },
      200,
      await mint(),
    );
    const before = await myDay();
    const named = before.drafts[0] as Draft;
    expect(named.task_key).toBe('LAI-404');

    await ok(
      `/api/v1/me/time-drafts/${named.id}`,
      { method: 'PATCH', body: JSON.stringify({ general: true }) },
      200,
    );
    expect((await undo({ draft: named.id })).status).toBe(204);
    expect((await myDay()).drafts).toEqual(before.drafts);

    // Its collector's again, not held: the next upload replaces it.
    await ok(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([block(11, 30, 'LAI-404')]) },
      200,
      await mint(),
    );
    expect((await myDay()).drafts.map((d) => d.minutes)).toEqual([30]);
  });

  it('Not work, undone: pending again', async () => {
    const { untied } = await drafted();
    const before = await myDay();
    await ok(`/api/v1/me/time-drafts/${untied.id}/dismiss`, { method: 'POST' }, 204);
    expect((await myDay()).drafts).toHaveLength(1);
    expect((await undo({ draft: untied.id })).status).toBe(204);
    expect((await myDay()).drafts).toEqual(before.drafts);
  });

  it('split, undone: the one block, under its own id', async () => {
    const { onCard } = await drafted();
    const before = await myDay();
    await ok(
      `/api/v1/me/time-drafts/${onCard.id}/split`,
      { method: 'POST', body: JSON.stringify({ at: at(9, 30) }) },
      200,
    );
    expect((await myDay()).drafts).toHaveLength(3);
    expect((await undo({ draft: onCard.id })).status).toBe(204);
    expect((await myDay()).drafts).toEqual(before.drafts);
  });

  it('Confirm day, undone: every block pending again', async () => {
    await drafted();
    const before = await myDay();
    await ok(`/api/v1/me/time/days/${today()}/confirm`, { method: 'POST' }, 200);
    expect((await myDay()).entries).toHaveLength(2);
    expect((await undo({ day: today() })).status).toBe(204);
    const after = await myDay();
    expect(after.drafts).toEqual(before.drafts);
    expect(after.entries).toEqual([]);
  });

  it('delete, undone: the entry is live again; add, undone: it is gone', async () => {
    const made = await ok(
      '/api/v1/me/time-entries',
      { method: 'POST', body: JSON.stringify({ day: today(), tz: 'UTC', minutes: 30 }) },
      201,
    );
    const { id } = (await made.json()) as { id: string };
    const withIt = await myDay();
    await ok(`/api/v1/me/time-entries/${id}`, { method: 'DELETE' }, 204);
    expect((await undo({ entry: id })).status).toBe(204);
    const back = await myDay();
    expect(back.entries.map((e) => [e.id, e.minutes])).toEqual(
      withIt.entries.map((e) => [e.id, e.minutes]),
    );

    const added = await ok(
      '/api/v1/me/time-entries',
      { method: 'POST', body: JSON.stringify({ day: today(), tz: 'UTC', minutes: 15 }) },
      201,
    );
    const second = (await added.json()) as { id: string };
    expect((await undo({ entry: second.id })).status).toBe(204);
    expect((await myDay()).entries.map((e) => e.id)).toEqual([id]);
  });

  it('refuses once the block has changed since, and when there is nothing to undo', async () => {
    const { untied } = await drafted();
    await ok(
      `/api/v1/me/time-drafts/${untied.id}`,
      { method: 'PATCH', body: JSON.stringify({ general: true }) },
      200,
    );
    // An undo of the first change, after a second one, would undo the second too.
    const confirmed = await ok(`/api/v1/me/time-drafts/${untied.id}/confirm`, { method: 'POST' }, 201);
    const entry = (await confirmed.json()) as { id: string };
    await ok(
      `/api/v1/me/time-entries/${entry.id}`,
      { method: 'PATCH', body: JSON.stringify({ minutes: 20 }) },
      200,
    );
    const stale = await undo({ draft: untied.id });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).reason).toBe('changed_since');

    const none = await undo({ entry: 'nothing-here' });
    expect(none.status).toBe(404);
  });

  it('is the person’s own: refused to a token, and nobody else’s change is theirs', async () => {
    const { untied } = await drafted();
    await ok(`/api/v1/me/time-drafts/${untied.id}/dismiss`, { method: 'POST' }, 204);
    const token = await mint();
    const refused = await undo({ draft: untied.id }, token);
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).reason).toBe('session_required');

    const theirs = await someoneElse();
    expect((await undo({ draft: untied.id }, theirs)).status).toBe(404);
    // Still dismissed: theirs refused, mine still to take back.
    expect((await myDay()).drafts).toHaveLength(1);
    expect((await undo({ draft: untied.id })).status).toBe(204);
  });

  it('names exactly one thing', async () => {
    for (const body of [{}, { draft: 'a', entry: 'b' }]) {
      const res = await req(
        '/api/v1/me/time/undo',
        { method: 'POST', body: JSON.stringify(body) },
        cookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe('the drafts a person holds, for the off switch (F)', () => {
  it('counts every pending draft on every day, and nothing confirmed', async () => {
    const { onCard } = await drafted();
    expect((await myDay()).drafts_held).toEqual({ count: 2, minutes: 100 });
    await ok(`/api/v1/me/time-drafts/${onCard.id}/confirm`, { method: 'POST' }, 201);
    expect((await myDay()).drafts_held).toEqual({ count: 1, minutes: 40 });
    const theirs = await someoneElse();
    expect((await myDay(theirs)).drafts_held).toEqual({ count: 0, minutes: 0 });
  });

  it('turning the switch off takes every draft, and the changes that could bring one back', async () => {
    const { untied } = await drafted();
    await ok(`/api/v1/me/time-drafts/${untied.id}/dismiss`, { method: 'POST' }, 204);
    await ok(
      '/api/v1/me/time-settings',
      { method: 'PUT', body: JSON.stringify({ draft_my_time: false }) },
      200,
    );
    expect((await myDay()).drafts_held).toEqual({ count: 0, minutes: 0 });
    expect((await undo({ draft: untied.id })).status).toBe(404);
  });
});
