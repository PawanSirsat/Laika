import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  localActivityDays,
  orgs,
  pushedCommitKeys,
  users,
} from '../../../src/db/schema.ts';
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
 * D-079's developer side over HTTP (SPEC §6.4, LAI-751): `/me/activity-sharing`
 * and `/me/local-activity`, the contract LAI-752's collector is written
 * against. The service tests own the arithmetic; this proves the door and
 * every refusal the contract names, with its status **and** `details.reason`
 * — which only the code that means it writes.
 *
 * Days are anchored to the real clock, as the route reads it: *yesterday*, so
 * a run that crosses midnight still sends a day inside the window.
 */

const PASSWORD = 'correct-horse-battery-staple';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const DAY = 24 * 60 * 60 * 1000;

let h: AuthHarness;
let ownerCookie: string;
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

function report(extra: Record<string, unknown> = {}, day: Record<string, unknown> = {}) {
  return {
    v: 1,
    collector_id: COLLECTOR,
    tz: 'UTC',
    days: [
      {
        day: yesterday(),
        prompts: { 'claude-code': 18, codex: 5 },
        sessions: 3,
        commits_local: 2,
        pushed_keys: ['a1b2c3d4e5f6a7b8'],
        ...day,
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
  const owner = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get();

  const invite = seedInvite(h.db, {
    orgId,
    createdBy: owner?.id ?? '',
    email: 'bea@example.test',
    orgRole: 'member',
  });
  const joined = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(joined.status, await joined.clone().text()).toBe(200);
  bea = {
    cookie: cookieFrom(joined),
    id: h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id ?? '',
  };
  expect([orgId, bea.id]).not.toContain('');
});

afterEach(() => {
  h.close();
});

describe('GET and PUT /me/activity-sharing', () => {
  it('401s nobody, and answers a session and any token with the contract shape', async () => {
    expect((await req('/api/v1/me/activity-sharing')).status).toBe(401);

    const expected = {
      org_enabled: false,
      enabled: false,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    };
    expect(await ok(req('/api/v1/me/activity-sharing', {}, bea.cookie))).toEqual(expected);
    expect(
      await ok(req('/api/v1/me/activity-sharing', {}, await mint(bea.cookie, 'read_only'))),
    ).toEqual(expected);
  });

  it('says collection is on once the organisation turns it on — the person never did (D-102 amended)', async () => {
    switchOn(true, false);
    expect(await ok(req('/api/v1/me/activity-sharing', {}, bea.cookie))).toEqual({
      org_enabled: true,
      enabled: true,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    });
  });

  it('403s organisation_controlled to a session that sends enabled, writing nothing — scope included', async () => {
    for (const org of [true, false]) {
      switchOn(org, true);
      for (const enabled of [true, false]) {
        const res = await req(
          '/api/v1/me/activity-sharing',
          { method: 'PUT', body: JSON.stringify({ enabled, scope: 'laika-repos' }) },
          bea.cookie,
        );
        expect(res.status).toBe(403);
        expect(await errorOf(res)).toEqual({
          code: 'forbidden',
          message: expect.any(String) as string,
          details: { reason: 'organisation_controlled', org_enabled: org },
        });
      }
    }
    const row = h.db.select().from(users).where(eq(users.id, bea.id)).get();
    expect(row?.shareLocalActivity).toBe(1);
    expect(row?.localActivityScope).toBe('agent-repos');
  });

  it('still sets the scope from a session', async () => {
    switchOn(true, false);
    expect(
      await ok(
        req(
          '/api/v1/me/activity-sharing',
          { method: 'PUT', body: JSON.stringify({ scope: 'laika-repos' }) },
          bea.cookie,
        ),
      ),
    ).toEqual({
      org_enabled: true,
      enabled: true,
      person_can_opt_out: false,
      scope: 'laika-repos',
      min_sync_interval_s: 600,
    });
  });

  it('403s every token the PUT with session_required — an agent must not consent', async () => {
    for (const scope of ['full', 'read_only'] as const) {
      const res = await req(
        '/api/v1/me/activity-sharing',
        { method: 'PUT', body: JSON.stringify({ enabled: true }) },
        await mint(bea.cookie, scope),
      );
      expect(res.status, scope).toBe(403);
      expect(await errorOf(res), scope).toEqual({
        code: 'forbidden',
        message: expect.any(String) as string,
        details: { action: 'activity_sharing.set_own', reason: 'session_required' },
      });
    }
    expect(h.db.select().from(users).where(eq(users.id, bea.id)).get()?.shareLocalActivity).toBe(0);
  });

  it('422s an unknown field and a scope that is not one of the two', async () => {
    for (const body of [{ enabled: true, extra: 1 }, { scope: 'every-repo' }, { enabled: 'yes' }]) {
      const res = await req(
        '/api/v1/me/activity-sharing',
        { method: 'PUT', body: JSON.stringify(body) },
        bea.cookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
  });
});

describe('PUT /me/local-activity', () => {
  it('401s nobody', async () => {
    expect((await req('/api/v1/me/local-activity', { method: 'PUT', body: '{}' })).status).toBe(
      401,
    );
  });

  it("403s local_activity_off while the organisation's switch is off, whatever the person's says", async () => {
    const token = await mint(bea.cookie);
    for (const user of [true, false]) {
      switchOn(false, user);
      const res = await put(report(), token);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toMatchObject({
        code: 'forbidden',
        details: { reason: 'local_activity_off', org_enabled: false, enabled: false },
      });
    }
    // Even a malformed report is told collection is off, not that it is malformed.
    const res = await put({ nonsense: true }, token);
    expect((await errorOf(res)).details).toMatchObject({ reason: 'local_activity_off' });
    expect(h.db.select().from(localActivityDays).all()).toEqual([]);
  });

  it("200s a report with the organisation's switch on and the person's off (D-102 amended)", async () => {
    switchOn(true, false);
    expect(await ok(put(report(), await mint(bea.cookie)))).toEqual({ accepted_days: 1 });
    expect(h.db.select().from(localActivityDays).all()).toHaveLength(1);
  });

  describe('both switches on', () => {
    beforeEach(() => {
      switchOn(true, true);
    });

    it('200s with accepted_days and nothing else, and writes no activity row', async () => {
      // Minting writes `token.created`; count after it, so only the report is measured.
      const token = await mint(bea.cookie);
      const before = h.db.select().from(activity).all().length;
      const res = await put(report(), token);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted_days: 1 });
      expect(h.db.select().from(activity).all()).toHaveLength(before);
      expect(h.db.select().from(pushedCommitKeys).all()).toHaveLength(1);
    });

    it('accepts the ids the collector really sends, and an unknown-but-valid one as other', async () => {
      const body = report(
        {},
        {
          prompts: {
            'claude-code': 1,
            codex: 2,
            'gemini-cli': 3,
            goose: 4,
            kiro: 5,
            other: 6,
            'cursor-agent-9': 7, // well-formed, and no agent the board knows
          },
        },
      );
      expect(await ok(put(body, await mint(bea.cookie)))).toEqual({ accepted_days: 1 });

      const row = h.db.select().from(localActivityDays).get();
      expect(JSON.parse(row?.promptsByAgent ?? '')).toEqual({
        'claude-code': 1,
        codex: 2,
        'gemini-cli': 3,
        goose: 4,
        kiro: 5,
        other: 13,
      });
      expect(row?.prompts).toBe(28);
    });

    it('takes a report from a session too', async () => {
      expect(await ok(put(report(), bea.cookie))).toEqual({ accepted_days: 1 });
    });

    it('403s a read-only token: sending is a write', async () => {
      const res = await put(report(), await mint(bea.cookie, 'read_only'));
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toMatchObject({
        code: 'forbidden',
        details: { action: 'local_activity.send_own' },
      });
    });

    it('413s a body over 16 KB, before anything is read', async () => {
      const big = report(
        {},
        { pushed_keys: Array.from({ length: 900 }, (_, i) => i.toString(16).padStart(16, '0')) },
      );
      expect(JSON.stringify(big).length).toBeGreaterThan(16 * 1024);
      const res = await put(big, await mint(bea.cookie));
      expect(res.status).toBe(413);
      expect((await errorOf(res)).code).toBe('payload_too_large');
      expect(h.db.select().from(pushedCommitKeys).all()).toEqual([]);
    });

    it('bounds pushed keys by the body alone: the most that fit are taken, one more is 413', async () => {
      const keys = (n: number) =>
        Array.from({ length: n }, (_, i) => i.toString(16).padStart(16, '0'));
      let n = 0;
      while (JSON.stringify(report({}, { pushed_keys: keys(n + 1) })).length <= 16 * 1024) n += 1;
      const token = await mint(bea.cookie);
      expect((await put(report({}, { pushed_keys: keys(n) }), token)).status).toBe(200);
      expect(h.db.select().from(pushedCommitKeys).all()).toHaveLength(n);
      const over = await put(report({}, { pushed_keys: keys(n + 1) }), token);
      expect(over.status).toBe(413);
      // Fewer than any per-day cap the schema once carried could ever see.
      expect(n).toBeLessThan(900);
    });

    it('422s each malformed shape, unprocessable', async () => {
      const token = await mint(bea.cookie);
      const cases: [string, unknown][] = [
        ['an unknown top-level field', report({ repo: 'kvell/laika' })],
        ['an unknown field in a day', report({}, { branch: 'main' })],
        ['a version other than 1', report({ v: 2 })],
        ['a collector id that is not a UUID v4', report({ collector_id: 'my-laptop' })],
        ['prompts over 5000 for an agent', report({}, { prompts: { codex: 5001 } })],
        ['sessions over 500', report({}, { sessions: 501 })],
        ['commits_local over 2000', report({}, { commits_local: 2001 })],
        ['a negative count', report({}, { sessions: -1 })],
        ['a fraction', report({}, { commits_local: 1.5 })],
        ['an agent id with a capital', report({}, { prompts: { 'Claude-Code': 1 } })],
        ['an agent id over 32 characters', report({}, { prompts: { ['a'.repeat(33)]: 1 } })],
        ['an empty agent id', report({}, { prompts: { '': 1 } })],
        ['an agent id with a space', report({}, { prompts: { 'claude code': 1 } })],
        ['a pushed key that is not 16 hex', report({}, { pushed_keys: ['a1b2c3d4e5f6a7b'] })],
        ['a raw commit id', report({}, { pushed_keys: ['a'.repeat(40)] })],
        ['not JSON at all', 'days please'],
      ];
      for (const [name, body] of cases) {
        const res = await put(body, token);
        expect(res.status, name).toBe(422);
        expect((await errorOf(res)).code, name).toBe('unprocessable');
      }
      expect(h.db.select().from(localActivityDays).all()).toEqual([]);
    });

    it('422s day_out_of_range: outside the window, repeated, none, or too many', async () => {
      const token = await mint(bea.cookie);
      const far = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
      const days = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          day: new Date(Date.now() - (i + 1) * DAY).toISOString().slice(0, 10),
        }));
      for (const [name, body] of [
        ['a month ago', report({}, { day: far })],
        ['a day twice', report({ days: [{ day: yesterday() }, { day: yesterday() }] })],
        ['no days', report({ days: [] })],
        ['fifteen days', report({ days: days(15) })],
      ] as const) {
        const res = await put(body, token);
        expect(res.status, name).toBe(422);
        expect(await errorOf(res), name).toMatchObject({
          code: 'unprocessable',
          details: { reason: 'day_out_of_range' },
        });
      }
    });

    it('422s invalid_tz for a zone the server does not know', async () => {
      const res = await put(report({ tz: 'Mars/Olympus_Mons' }), await mint(bea.cookie));
      expect(res.status).toBe(422);
      expect((await errorOf(res)).details).toMatchObject({ reason: 'invalid_tz' });
    });

    it('429s the 31st report in an hour from one token, with Retry-After; another token is its own', async () => {
      const token = await mint(bea.cookie);
      for (let i = 0; i < 30; i += 1) {
        const res = await put(report(), token);
        expect(res.status, `report ${String(i + 1)}`).toBe(200);
      }
      const limited = await put(report(), token);
      expect(limited.status).toBe(429);
      expect((await errorOf(limited)).code).toBe('rate_limited');
      expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);

      // A second token of hers, and her session, have budgets of their own.
      expect((await put(report(), await mint(bea.cookie))).status).toBe(200);
      expect((await put(report(), bea.cookie)).status).toBe(200);

      // And the limited token gets one back two minutes later: 30 an hour.
      clock += 2 * 60 * 1000;
      expect((await put(report(), token)).status).toBe(200);
    });

    describe('a look-back report (D-080)', () => {
      const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
      const hex = (i: number) => i.toString(16).padStart(16, '0');
      const lookback = (days: unknown[], extra: Record<string, unknown> = {}) => ({
        v: 1,
        collector_id: COLLECTOR,
        tz: 'UTC',
        lookback: true,
        days,
        ...extra,
      });

      it('takes keys on days a year back and writes no snapshot row', async () => {
        const body = lookback([
          { day: daysAgo(399), pushed_keys: [hex(1)] },
          { day: daysAgo(200), pushed_keys: [hex(2), hex(3)] },
          { day: yesterday(), pushed_keys: [hex(4)] },
        ]);
        const token = await mint(bea.cookie);
        const activityBefore = h.db.select().from(activity).all().length;
        expect(await ok(put(body, token))).toEqual({ accepted_days: 3 });
        expect(
          h.db
            .select({ day: pushedCommitKeys.day })
            .from(pushedCommitKeys)
            .all()
            .map((r) => r.day)
            .sort(),
        ).toEqual([daysAgo(399), daysAgo(200), daysAgo(200), yesterday()].sort());
        expect(h.db.select().from(localActivityDays).all()).toEqual([]);
        expect(h.db.select().from(activity).all().length).toBe(activityBefore);
      });

      it('422s day_out_of_range past retention, with the snapshot’s details', async () => {
        const res = await put(
          lookback([{ day: daysAgo(402), pushed_keys: [hex(1)] }]),
          await mint(bea.cookie),
        );
        expect(res.status).toBe(422);
        const error = await errorOf(res);
        expect(error.code).toBe('unprocessable');
        expect(Object.keys(error.details).sort()).toEqual(['day', 'earliest', 'latest', 'reason']);
        expect(error.details).toMatchObject({ reason: 'day_out_of_range', day: daysAgo(402) });
        expect(h.db.select().from(pushedCommitKeys).all()).toEqual([]);
      });

      it('422s a look-back day that carries counts, or no keys, and a snapshot day a month back', async () => {
        const token = await mint(bea.cookie);
        const old = daysAgo(30);
        for (const [name, body] of [
          ['prompts', lookback([{ day: old, pushed_keys: [hex(1)], prompts: { codex: 1 } }])],
          ['sessions', lookback([{ day: old, pushed_keys: [hex(1)], sessions: 1 }])],
          ['commits_local', lookback([{ day: old, pushed_keys: [hex(1)], commits_local: 1 }])],
          ['no keys', lookback([{ day: old, pushed_keys: [] }])],
          ['lookback false', lookback([{ day: old, pushed_keys: [hex(1)] }], { lookback: false })],
          ['a snapshot a month back', report({}, { day: old })],
        ] as const) {
          const res = await put(body, token);
          expect(res.status, name).toBe(422);
          expect((await errorOf(res)).code, name).toBe('unprocessable');
        }
        expect(h.db.select().from(pushedCommitKeys).all()).toEqual([]);
      });

      it('holds a look-back report to the same 16 KB: the most that fit are taken, one more is 413', async () => {
        const token = await mint(bea.cookie);
        const keys: string[] = [];
        const body = (n: number) =>
          lookback([
            { day: daysAgo(100), pushed_keys: Array.from({ length: n }, (_, i) => hex(i)) },
          ]);
        while (JSON.stringify(body(keys.length + 1)).length <= 16 * 1024)
          keys.push(hex(keys.length));
        expect((await put(body(keys.length), token)).status).toBe(200);
        expect(h.db.select().from(pushedCommitKeys).all()).toHaveLength(keys.length);
        const over = await put(body(keys.length + 1), token);
        expect(over.status).toBe(413);
        expect((await errorOf(over)).code).toBe('payload_too_large');
        expect(h.db.select().from(pushedCommitKeys).all()).toHaveLength(keys.length);
      });

      it('spends the same report budget as a snapshot: 29 + 1 pass, the 31st is 429', async () => {
        const token = await mint(bea.cookie);
        for (let i = 0; i < 29; i += 1) expect((await put(report(), token)).status).toBe(200);
        const body = lookback([{ day: daysAgo(100), pushed_keys: [hex(1)] }]);
        expect((await put(body, token)).status).toBe(200);
        expect((await put(body, token)).status).toBe(429);
      });
    });

    it('does not spend the report budget on the preview or the delete', async () => {
      const token = await mint(bea.cookie);
      for (let i = 0; i < 30; i += 1) await put(report(), token);
      expect((await req('/api/v1/me/local-activity', {}, bea.cookie)).status).toBe(200);
      expect(
        (await req('/api/v1/me/local-activity', { method: 'DELETE' }, bea.cookie)).status,
      ).toBe(204);
    });
  });
});

describe('GET and DELETE /me/local-activity', () => {
  beforeEach(async () => {
    switchOn(true, true);
    await ok(put(report(), bea.cookie));
  });

  it('previews the caller’s own days to a session', async () => {
    const body = await ok(req('/api/v1/me/local-activity?days=14', {}, bea.cookie));
    expect(body).toMatchObject({
      tz: 'UTC',
      collectors: 1,
      days: [
        {
          day: yesterday(),
          prompts_by_agent: { 'claude-code': 18, codex: 5 },
          sessions: 3,
          commits_local: 2,
          pushed_commits: 1,
        },
      ],
    });
    // The owner, asking for theirs, sees nothing of Bea's.
    expect(await ok(req('/api/v1/me/local-activity', {}, ownerCookie))).toMatchObject({ days: [] });
  });

  it('422s a window outside 1–14 days', async () => {
    for (const days of ['0', '15', 'many']) {
      const res = await req(`/api/v1/me/local-activity?days=${days}`, {}, bea.cookie);
      expect(res.status, days).toBe(422);
    }
  });

  it('403s a token the preview and the delete with session_required, and deletes nothing', async () => {
    const token = await mint(bea.cookie);
    for (const init of [{}, { method: 'DELETE' }]) {
      const res = await req('/api/v1/me/local-activity', init, token);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).details).toMatchObject({ reason: 'session_required' });
    }
    expect(h.db.select().from(localActivityDays).all()).toHaveLength(1);
  });

  it('204s the delete, after which nothing of theirs is held', async () => {
    const res = await req('/api/v1/me/local-activity', { method: 'DELETE' }, bea.cookie);
    expect(res.status).toBe(204);
    expect(h.db.select().from(localActivityDays).all()).toEqual([]);
    expect(h.db.select().from(pushedCommitKeys).all()).toEqual([]);
  });
});
