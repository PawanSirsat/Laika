import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import {
  orgs,
  orgTimeSettings,
  timeBreaks,
  timeDrafts,
  timeEntries,
  users,
} from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * The organisation's break schedule over HTTP (D-101, LAI-955): owners and
 * admins set it on a web session, everybody reads it with their switches, and
 * setting it is display only — no draft, entry or break of anybody's moves.
 */

const PASSWORD = 'correct-horse-battery-staple';
const NOW = Date.now();

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

function put(breaks: unknown, auth: string = cookie): Promise<Response> {
  return req('/api/v1/org/time/breaks', { method: 'PUT', body: JSON.stringify({ breaks }) }, auth);
}

async function errorOf(
  res: Response,
): Promise<{ code: string; details: { reason?: string; issues?: { path: string }[] } }> {
  return ((await res.json()) as { error: Awaited<ReturnType<typeof errorOf>> }).error;
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
  const org = h.db.select().from(orgs).get();
  if (org === undefined) throw new Error('no org');
  const token = seedInvite(h.db, { orgId: org.id, createdBy: org.ownerUserId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

async function mint(): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Agent', scope: 'full' }) },
    cookie,
  );
  expect(res.status).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

const LUNCH = { label: 'Lunch', start: '13:00', end: '13:45', days: [1, 2, 3, 4, 5] };
const TEA = { label: 'Tea', start: '15:30', end: '15:45', days: [1, 2, 3, 4, 5] };

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
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
});

afterEach(() => {
  h.close();
});

describe('PUT /org/time/breaks — who may', () => {
  it('lets an owner and an admin set it, and answers the full settings', async () => {
    const owner = await put([LUNCH]);
    expect(owner.status, await owner.clone().text()).toBe(200);
    expect(await owner.json()).toEqual({
      org_mode: 'off',
      draft_my_time: false,
      drafting: false,
      min_sync_interval_s: 600,
      signal_times: true,
      folder_names: true,
      breaks: [LUNCH],
    });

    const admin = await put([LUNCH, TEA], await join('bo@example.test', 'admin'));
    expect(admin.status, await admin.clone().text()).toBe(200);
    expect(((await admin.json()) as { breaks: unknown[] }).breaks).toEqual([LUNCH, TEA]);
  });

  it('refuses a member and a viewer, and changes nothing', async () => {
    expect((await put([LUNCH])).status).toBe(200);
    for (const role of ['member', 'viewer'] as const) {
      const res = await put([TEA], await join(`${role}@example.test`, role));
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe('forbidden');
    }
    const read = await req('/api/v1/me/time-settings', {}, cookie);
    expect(((await read.json()) as { breaks: unknown[] }).breaks).toEqual([LUNCH]);
  });

  it('refuses any token, the owner’s included: session only', async () => {
    const res = await put([LUNCH], await mint());
    expect(res.status).toBe(403);
    const error = await errorOf(res);
    expect(error.code).toBe('forbidden');
    expect(error.details.reason).toBe('session_required');
    expect(h.db.select().from(orgTimeSettings).all()).toEqual([]);
  });

  it('asks before it judges the body', async () => {
    const res = await put('not a list', await join('mo@example.test', 'member'));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('forbidden');
  });
});

describe('PUT /org/time/breaks — the windows (D-101 item 1)', () => {
  async function refused(breaks: unknown, path: string): Promise<void> {
    const res = await put(breaks);
    expect(res.status, JSON.stringify(breaks)).toBe(422);
    const error = await errorOf(res);
    expect(error.code).toBe('unprocessable');
    expect(
      error.details.issues?.map((issue) => issue.path),
      JSON.stringify(breaks),
    ).toContain(path);
  }

  it('names the window that breaks a rule', async () => {
    await refused([LUNCH, { ...TEA, label: '' }], 'breaks.1.label');
    await refused([LUNCH, { ...TEA, label: '   ' }], 'breaks.1.label');
    await refused([{ ...LUNCH, label: 'x'.repeat(41) }], 'breaks.0.label');
    await refused([{ ...LUNCH, start: '1:00' }], 'breaks.0.start');
    await refused([{ ...LUNCH, end: '24:00' }], 'breaks.0.end');
    await refused([{ ...LUNCH, start: '12:60' }], 'breaks.0.start');
    await refused([{ ...LUNCH, start: '13:45', end: '13:00' }], 'breaks.0.end');
    await refused([{ ...LUNCH, start: '13:00', end: '13:00' }], 'breaks.0.end');
    await refused([{ ...LUNCH, start: '23:30', end: '00:30' }], 'breaks.0.end');
    await refused([{ ...LUNCH, days: [] }], 'breaks.0.days');
    await refused([{ ...LUNCH, days: [0] }], 'breaks.0.days.0');
    await refused([{ ...LUNCH, days: [8] }], 'breaks.0.days.0');
    await refused([{ ...LUNCH, days: [1.5] }], 'breaks.0.days.0');
    await refused([{ ...LUNCH, days: [1, 2, 1] }], 'breaks.0.days');
    await refused([LUNCH, { ...TEA, start: '13:30', end: '14:00', days: [5] }], 'breaks.1');
    await refused([LUNCH, { ...LUNCH, label: 'Second lunch' }], 'breaks.1');
    await refused(
      Array.from({ length: 9 }, (_, i) => ({
        label: `B${String(i)}`,
        start: `0${String(i)}:00`,
        end: `0${String(i)}:30`,
        days: [1],
      })),
      'breaks',
    );
    await refused([{ ...LUNCH, colour: 'red' }], 'breaks.0');
    expect(h.db.select().from(orgTimeSettings).all()).toEqual([]);
  });

  it('takes windows that only touch, or share no day', async () => {
    const res = await put([
      LUNCH,
      { label: 'Walk', start: '13:45', end: '14:00', days: [1] },
      { label: 'Weekend lunch', start: '13:00', end: '14:00', days: [6, 7] },
    ]);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('takes eight', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      label: `B${String(i)}`,
      start: `0${String(i)}:00`,
      end: `0${String(i)}:30`,
      days: [7],
    }));
    const res = await put(eight);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { breaks: unknown[] }).breaks).toHaveLength(8);
  });

  it('keeps the days in order, and the label trimmed', async () => {
    const res = await put([{ ...LUNCH, label: '  Lunch ', days: [5, 1, 3] }]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { breaks: unknown[] }).breaks).toEqual([
      { ...LUNCH, days: [1, 3, 5] },
    ]);
  });
});

describe('PUT /org/time/breaks — what it writes', () => {
  it('creates the settings row off when there is none, and keeps the mode when there is', async () => {
    expect((await put([LUNCH])).status).toBe(200);
    expect(h.db.select({ mode: orgTimeSettings.mode }).from(orgTimeSettings).all()).toEqual([
      { mode: 'off' },
    ]);
    const on = await req(
      '/api/v1/org/time',
      { method: 'PUT', body: JSON.stringify({ mode: 'drafts' }) },
      cookie,
    );
    expect(on.status).toBe(200);
    const again = await put([TEA]);
    expect(((await again.json()) as { org_mode: string }).org_mode).toBe('drafts');
  });

  it('an empty list clears the schedule', async () => {
    expect((await put([LUNCH])).status).toBe(200);
    const res = await put([]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { breaks: unknown[] }).breaks).toEqual([]);
    expect(h.db.select({ breaks: orgTimeSettings.breaks }).from(orgTimeSettings).get()).toEqual({
      breaks: null,
    });
  });

  it('touches no draft, entry or break of anybody’s', async () => {
    const userId = h.db.select({ id: users.id }).from(users).get()?.id ?? '';
    h.db
      .insert(timeDrafts)
      .values({
        id: newId(),
        userId,
        source: 'collector',
        collectorId: 'c',
        day: '2026-10-20',
        tz: 'UTC',
        startedAt: Date.UTC(2026, 9, 20, 13),
        endedAt: Date.UTC(2026, 9, 20, 14),
        minutes: 60,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    h.db
      .insert(timeEntries)
      .values({
        id: newId(),
        userId,
        day: '2026-10-20',
        tz: 'UTC',
        minutes: 30,
        source: 'manual',
        startedAt: Date.UTC(2026, 9, 20, 13),
        endedAt: Date.UTC(2026, 9, 20, 13, 30),
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    h.db
      .insert(timeBreaks)
      .values({
        id: newId(),
        userId,
        day: '2026-10-20',
        tz: 'UTC',
        startedAt: Date.UTC(2026, 9, 20, 13),
        endedAt: Date.UTC(2026, 9, 20, 13, 45),
        createdAt: NOW,
      })
      .run();
    const before = {
      drafts: h.db.select().from(timeDrafts).all(),
      entries: h.db.select().from(timeEntries).all(),
      breaks: h.db.select().from(timeBreaks).all(),
    };
    expect((await put([LUNCH])).status).toBe(200);
    expect((await put([])).status).toBe(200);
    expect({
      drafts: h.db.select().from(timeDrafts).all(),
      entries: h.db.select().from(timeEntries).all(),
      breaks: h.db.select().from(timeBreaks).all(),
    }).toEqual(before);
    expect(h.db.select().from(timeBreaks).where(eq(timeBreaks.userId, userId)).all()).toHaveLength(
      1,
    );
  });
});

describe('everybody reads the schedule', () => {
  it('in /me/time-settings, with a token too, and in My day’s settings', async () => {
    const member = await join('mia@example.test', 'member');
    const none = await req('/api/v1/me/time-settings', {}, member);
    expect(((await none.json()) as { breaks: unknown[] }).breaks).toEqual([]);

    expect((await put([LUNCH])).status).toBe(200);
    const mine = await req('/api/v1/me/time-settings', {}, member);
    expect(((await mine.json()) as { breaks: unknown[] }).breaks).toEqual([LUNCH]);
    const token = await req('/api/v1/me/time-settings', {}, await mint());
    expect(((await token.json()) as { breaks: unknown[] }).breaks).toEqual([LUNCH]);

    const day = await req('/api/v1/me/time?day=2026-10-20&tz=UTC', {}, member);
    expect(day.status, await day.clone().text()).toBe(200);
    expect(((await day.json()) as { settings: { breaks: unknown[] } }).settings.breaks).toEqual([
      LUNCH,
    ]);
  });
});
