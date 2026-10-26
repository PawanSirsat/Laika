import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * The day's note over HTTP (§4.62, §6.4, LAI-501): with the confirm, alone,
 * read with the day, session only, and no note on a day the clock refused.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}, auth = cookie): Promise<Response> {
  const credential = auth.startsWith('lai_')
    ? { Authorization: `Bearer ${auth}` }
    : { Cookie: auth };
  return h.app.request(`/api/v1${path}`, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function ok(
  path: string,
  init: RequestInit,
  status: number,
  auth = cookie,
): Promise<Response> {
  const res = await req(path, init, auth);
  expect(res.status, `${init.method ?? 'GET'} ${path}: ${await res.clone().text()}`).toBe(status);
  return res;
}

async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { details: { reason?: string } } };
  return body.error.details.reason ?? '';
}

const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number, minute = 0): number =>
  Date.parse(`${today()}T00:00:00Z`) + (hour * 60 + minute) * 60_000;

interface DayNote {
  day: string;
  note: string;
  updated_at: number;
}

async function noteInDay(): Promise<DayNote | null> {
  const day = (await (await ok(`/me/time?day=${today()}&tz=UTC`, {}, 200)).json()) as {
    day_note: DayNote | null;
  };
  return day.day_note;
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
  await ok('/org/time', json('PUT', { mode: 'drafts' }), 200);
  await ok('/me/time-settings', json('PUT', { draft_my_time: true }), 200);
});

afterEach(() => {
  h.close();
});

describe("the day's note over HTTP", () => {
  it('goes with Confirm day, trimmed, and is kept by a confirm that says nothing', async () => {
    const confirmed = (await (
      await ok(
        `/me/time/days/${today()}/confirm`,
        json('POST', { note: '  Two meetings ran long  ' }),
        200,
      )
    ).json()) as { entries: unknown[]; day_note: DayNote | null };
    expect(confirmed.entries).toEqual([]);
    expect(confirmed.day_note).toMatchObject({ day: today(), note: 'Two meetings ran long' });
    expect(await noteInDay()).toEqual(confirmed.day_note);

    const again = (await (
      await ok(`/me/time/days/${today()}/confirm`, json('POST'), 200)
    ).json()) as {
      day_note: DayNote | null;
    };
    expect(again.day_note?.note).toBe('Two meetings ran long');

    expect(
      (await req(`/me/time/days/${today()}/confirm`, json('POST', { note: 'x'.repeat(501) })))
        .status,
    ).toBe(422);
    expect(
      (await req(`/me/time/days/${today()}/confirm`, json('POST', { mood: 'fine' }))).status,
    ).toBe(422);
  });

  it('is set alone, replaced in place, removed by null or blank, and wants a day', async () => {
    const set = (await (
      await ok(`/me/time/days/${today()}/note`, json('PUT', { note: 'First' }), 200)
    ).json()) as {
      day_note: DayNote | null;
    };
    expect(set.day_note?.note).toBe('First');
    const replaced = (await (
      await ok(`/me/time/days/${today()}/note`, json('PUT', { note: 'Second' }), 200)
    ).json()) as { day_note: DayNote | null };
    expect(replaced.day_note?.note).toBe('Second');
    expect((await noteInDay())?.note).toBe('Second');

    const blank = (await (
      await ok(`/me/time/days/${today()}/note`, json('PUT', { note: '   ' }), 200)
    ).json()) as {
      day_note: DayNote | null;
    };
    expect(blank.day_note).toBeNull();
    expect(await noteInDay()).toBeNull();
    await ok(`/me/time/days/${today()}/note`, json('PUT', { note: null }), 200);

    expect((await req('/me/time/days/2026-13-40/note', json('PUT', { note: 'x' }))).status).toBe(
      422,
    );
    expect((await req(`/me/time/days/${today()}/note`, json('PUT', {}))).status).toBe(422);
  });

  it('is session only and needs Time on', async () => {
    const minted = await ok('/tokens', json('POST', { name: 'Collector', scope: 'full' }), 201);
    const token = String(((await minted.json()) as { secret: string }).secret);
    for (const [path, init] of [
      [`/me/time/days/${today()}/note`, json('PUT', { note: 'x' })],
      [`/me/time/days/${today()}/confirm`, json('POST', { note: 'x' })],
    ] as const) {
      const res = await req(path, init, token);
      expect(res.status, path).toBe(403);
      expect(await reasonOf(res)).toBe('session_required');
    }
    await ok('/org/time', json('PUT', { mode: 'off' }), 200);
    const off = await req(`/me/time/days/${today()}/note`, json('PUT', { note: 'x' }));
    expect(off.status).toBe(403);
    expect(await reasonOf(off)).toBe('time_off');
  });

  it('a refused day keeps no note', async () => {
    // A day that would hold more than a day (LAI-528 retired the clock rule
    // that used to refuse here): 1400 minutes with no set time, then an hour.
    await ok('/me/time-entries', json('POST', { day: today(), tz: 'UTC', minutes: 1400 }), 201);
    const minted = await ok('/tokens', json('POST', { name: 'Collector', scope: 'full' }), 201);
    const token = String(((await minted.json()) as { secret: string }).secret);
    await ok(
      '/me/time-drafts',
      json('PUT', {
        v: 1,
        collector_id: '6f1c2b1e-4d2a-4c5e-9a3b-7e8f9a0b1c2d',
        tz: 'UTC',
        days: [
          {
            day: today(),
            blocks: [
              {
                start: at(10, 30),
                end: at(11, 30),
                minutes: 60,
                task: null,
                signals: { prompts: 3, replies: 9, sessions: 1, commits: 1, marks: 0 },
              },
            ],
          },
        ],
      }),
      200,
      token,
    );
    const refused = await req(
      `/me/time/days/${today()}/confirm`,
      json('POST', { note: 'Never kept' }),
    );
    expect(refused.status).toBe(422);
    expect(await reasonOf(refused)).toBe('day_full');
    expect(await noteInDay()).toBeNull();
  });
});
