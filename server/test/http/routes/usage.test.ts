import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, tokenUsageDays, users } from '../../../src/db/schema.ts';
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
 * Token usage over HTTP (D-084, SPEC §6.4, LAI-769): the collector's usage
 * report on the same `PUT /me/local-activity` as its snapshot, and the two
 * reads — `GET /usage` for the Usage page and `GET /users/:id/usage` for the
 * profile card — answered to each reader as D-084 item 7 says: owners and
 * admins everyone, a developer their own, a member a project's totals and
 * never a per-person split, and a token never anything per person.
 */

const PASSWORD = 'correct-horse-battery-staple';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const DAY = 24 * 60 * 60 * 1000;

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let bea: { cookie: string; id: string };
let clock: number;

const yesterday = () => new Date(Date.now() - DAY).toISOString().slice(0, 10);

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

async function ok(res: Promise<Response>, status = 200): Promise<Record<string, unknown>> {
  const done = await res;
  expect(done.status, await done.clone().text()).toBe(status);
  return (await done.json()) as Record<string, unknown>;
}

async function mint(cookie: string, scope: 'full' | 'read_only' = 'full'): Promise<string> {
  const created = await ok(
    req(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'Collector', scope }) },
      cookie,
    ),
    201,
  );
  return String(created.secret);
}

async function errorOf(res: Response): Promise<{ code: string; details: Record<string, unknown> }> {
  return ((await res.json()) as { error: { code: string; details: Record<string, unknown> } })
    .error;
}

function usage(extra: Record<string, unknown> = {}, row: Record<string, unknown> = {}) {
  return {
    v: 1,
    collector_id: COLLECTOR,
    tz: 'UTC',
    usage: true,
    days: [
      {
        day: yesterday(),
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: null,
            input: 3_718,
            output: 2_094_668,
            cache_write: 5_615_538,
            cache_read: 648_995_995,
            ...row,
          },
        ],
      },
    ],
    ...extra,
  };
}

const put = (body: unknown, auth: string) =>
  req(
    '/api/v1/me/local-activity',
    { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) },
    auth,
  );

function switchOn(org: boolean, user: boolean): void {
  h.db
    .update(orgs)
    .set({ developerInsights: org ? 1 : 0 })
    .where(eq(orgs.id, orgId))
    .run();
  h.db
    .update(users)
    .set({ shareLocalActivity: user ? 1 : 0 })
    .where(eq(users.id, bea.id))
    .run();
}

beforeEach(async () => {
  clock = Date.now();
  h = authHarness({ rateLimiter: new RateLimiter(() => clock) });
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
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';

  const invite = seedInvite(h.db, {
    orgId,
    createdBy: ownerId,
    email: 'bea@example.test',
    orgRole: 'member',
  });
  const joined = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    name: 'Bea',
    inviteToken: invite,
  });
  expect(joined.status, await joined.clone().text()).toBe(200);
  bea = {
    cookie: cookieFrom(joined),
    id: h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id ?? '',
  };
  expect([orgId, ownerId, bea.id]).not.toContain('');
});

afterEach(() => {
  h.close();
});

describe('PUT /me/local-activity with "usage": true', () => {
  it('stores the day’s totals from a collector’s token and answers only a count', async () => {
    switchOn(true, true);
    const token = await mint(bea.cookie);
    expect(await ok(put(usage(), token))).toEqual({ accepted_days: 1 });
    expect(await ok(put(usage(), token))).toEqual({ accepted_days: 1 });
    const rows = h.db.select().from(tokenUsageDays).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: bea.id, output: 2_094_668, cacheRead: 648_995_995 });
  });

  it('is refused 403 local_activity_off with either switch off, before the body is read', async () => {
    switchOn(true, false);
    const res = await put('{not json', await mint(bea.cookie));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details.reason).toBe('local_activity_off');
  });

  it('refuses anything but counts: unknown fields, text in a model, a key that is not a key', async () => {
    switchOn(true, true);
    const token = await mint(bea.cookie);
    for (const body of [
      usage({ prompt: 'hello' }),
      usage({}, { cwd: '/Users/bea/secret-repo' }),
      usage({}, { session_id: 'b3c1a9e0' }),
      usage({}, { model: 'Fix the login bug in secret-repo' }),
      usage({}, { model: '<synthetic>' }),
      usage({}, { task: 'feature/secret-branch' }),
      usage({}, { output: -1 }),
      usage({}, { output: 1.5 }),
    ]) {
      const res = await put(body, token);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(h.db.select().from(tokenUsageDays).all()).toHaveLength(0);
  });

  it('draws on the collector’s report bucket, as snapshots do', async () => {
    switchOn(true, true);
    const token = await mint(bea.cookie);
    for (let i = 0; i < 30; i += 1) expect((await put(usage(), token)).status).toBe(200);
    const res = await put(usage(), token);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});

describe('backfilled days, over the wire (review 1, the blocker)', () => {
  it('a new collector’s backfilled day replaces the old one’s, and the sharing answer names held days', async () => {
    switchOn(true, true);
    const token = await mint(bea.cookie);
    const marked = (collector: string) => {
      const body = usage({ collector_id: collector });
      body.days = body.days.map((d) => ({ ...d, backfill: true }));
      return body;
    };
    expect(await ok(put(marked(COLLECTOR), token))).toEqual({ accepted_days: 1 });
    const other = '0b4e7d2a-91c3-4f6e-8a1d-5c2b9e7f3a10';
    const sharing = await ok(req(`/api/v1/me/activity-sharing?collector_id=${other}`, {}, token));
    expect(sharing.usage_days_elsewhere).toEqual([yesterday()]);
    expect(await ok(put(marked(other), token))).toEqual({ accepted_days: 1 });
    const rows = h.db.select().from(tokenUsageDays).all();
    expect(rows.map((r) => [r.collectorId, r.output])).toEqual([[other, 2_094_668]]);
    // The marker is `true` or absent; anything else is refused.
    const odd = usage();
    odd.days = odd.days.map((d) => ({ ...d, backfill: 'yes' }));
    expect((await put(odd, token)).status).toBe(422);
  });
});

describe('GET /usage', () => {
  it('answers an owner on a session with the per-person split', async () => {
    switchOn(true, true);
    await ok(put(usage(), await mint(bea.cookie)));
    const view = await ok(req('/api/v1/usage?days=7', {}, ownerCookie));
    expect(view.project).toBeNull();
    expect((view.totals as Record<string, number>).tokens).toBe(3_718 + 2_094_668 + 5_615_538);
    expect((view.by_developer as { name: string }[]).map((p) => p.name)).toEqual(['Bea']);
    // Nothing was sent back: no rework to cost (LAI-772).
    expect(view.rework).toEqual([]);
  });

  it('answers an owner’s token with totals and no per-person split', async () => {
    switchOn(true, true);
    await ok(put(usage(), await mint(bea.cookie)));
    const view = await ok(req('/api/v1/usage?days=7', {}, await mint(ownerCookie, 'read_only')));
    expect(view.by_developer).toBeNull();
    expect(JSON.stringify(view)).not.toContain(bea.id);
  });

  it('refuses a member the organisation, and gives them a project they are in, without people', async () => {
    switchOn(true, true);
    await ok(put(usage(), await mint(bea.cookie)));
    expect((await req('/api/v1/usage?days=7', {}, bea.cookie)).status).toBe(403);

    await ok(
      req(
        '/api/v1/projects/laika/members',
        { method: 'POST', body: JSON.stringify({ user_id: bea.id, role: 'member' }) },
        ownerCookie,
      ),
      201,
    );
    const view = await ok(req('/api/v1/usage?days=7&project=laika', {}, bea.cookie));
    expect(view.by_developer).toBeNull();
    expect(view.project).toMatchObject({ slug: 'laika' });
  });

  it('refuses a range it does not serve', async () => {
    expect((await req('/api/v1/usage?days=400', {}, ownerCookie)).status).toBe(422);
    expect((await req('/api/v1/usage?tz=Not/AZone', {}, ownerCookie)).status).toBe(422);
  });
});

describe('GET /users/:id/usage', () => {
  it('answers the person themselves and an owner, on a session', async () => {
    switchOn(true, true);
    await ok(put(usage(), await mint(bea.cookie)));
    const own = await ok(req(`/api/v1/users/${bea.id}/usage`, {}, bea.cookie));
    expect((own.totals as Record<string, number>).cache_read).toBe(648_995_995);
    const asOwner = await ok(req(`/api/v1/users/${bea.id}/usage`, {}, ownerCookie));
    expect(asOwner.user_id).toBe(bea.id);
  });

  it('refuses a member someone else’s, and every token session_required', async () => {
    switchOn(true, true);
    const token = await mint(bea.cookie);
    expect((await req(`/api/v1/users/${ownerId}/usage`, {}, bea.cookie)).status).toBe(403);
    const res = await req(`/api/v1/users/${bea.id}/usage`, {}, token);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details.reason).toBe('session_required');
  });
});

describe('task attribution over the wire (LAI-770)', () => {
  async function joinLaika(): Promise<void> {
    await ok(
      req(
        '/api/v1/projects/laika/members',
        { method: 'POST', body: JSON.stringify({ user_id: bea.id, role: 'member' }) },
        ownerCookie,
      ),
      201,
    );
  }

  it('the sharing answer names the prefixes a branch key may carry', async () => {
    switchOn(true, true);
    await joinLaika();
    const token = await mint(bea.cookie);
    const sharing = await ok(
      req(`/api/v1/me/activity-sharing?collector_id=${COLLECTOR}`, {}, token),
    );
    expect(sharing.task_prefixes).toEqual(['LAI']);
  });

  it('GET /tasks/:id/usage answers the task’s tokens: per person for its owner, the total for a token', async () => {
    switchOn(true, true);
    await joinLaika();
    const task = await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Tied' }) },
        ownerCookie,
      ),
      201,
    );
    await ok(put(usage({}, { task: task.key }), await mint(bea.cookie)));

    const asOwner = await ok(req(`/api/v1/tasks/${String(task.id)}/usage?tz=UTC`, {}, ownerCookie));
    expect(asOwner.key).toBe(task.key);
    expect((asOwner.totals as Record<string, number>).tokens).toBe(3_718 + 2_094_668 + 5_615_538);
    expect((asOwner.by_person as { name: string }[]).map((p) => p.name)).toEqual(['Bea']);
    expect(asOwner.by_round).toEqual([expect.objectContaining({ number: 1, finished_on: null })]);

    const asToken = await ok(
      req(`/api/v1/tasks/${String(task.id)}/usage`, {}, await mint(ownerCookie, 'read_only')),
    );
    expect(asToken.by_person).toBeNull();
    expect(JSON.stringify(asToken)).not.toContain(bea.id);

    expect(
      (await req('/api/v1/tasks/01NOTATASK000000000000000/usage', {}, ownerCookie)).status,
    ).toBe(404);
    expect(
      (await req(`/api/v1/tasks/${String(task.id)}/usage?tz=Not/AZone`, {}, ownerCookie)).status,
    ).toBe(422);
  });

  it('a claim over REST keeps the branch it is given', async () => {
    const task = await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Claim' }) },
        ownerCookie,
      ),
      201,
    );
    const claimed = await ok(
      req(
        `/api/v1/tasks/${String(task.id)}/claim`,
        { method: 'POST', body: JSON.stringify({ branch: `${String(task.key)}-fix-login` }) },
        ownerCookie,
      ),
    );
    expect(claimed.branch).toBe(`${String(task.key)}-fix-login`);
    // No body at all is still a claim, as it always was.
    const other = await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Bare' }) },
        ownerCookie,
      ),
      201,
    );
    const bare = await h.app.request(`/api/v1/tasks/${String(other.id)}/claim`, {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: 'http://localhost' },
    });
    expect(bare.status, await bare.clone().text()).toBe(200);
    expect(((await bare.json()) as { branch: unknown }).branch).toBeNull();
    const garbled = await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Odd' }) },
        ownerCookie,
      ),
      201,
    );
    expect(
      (
        await req(
          `/api/v1/tasks/${String(garbled.id)}/claim`,
          { method: 'POST', body: '{nope' },
          ownerCookie,
        )
      ).status,
    ).toBe(422);
  });
});
