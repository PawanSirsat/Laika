import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * The timer over HTTP (§4.61, §6.4, LAI-500): the routes, their bodies, their
 * refusals, the undo header on a stop, and the timer riding in My day.
 * The clock's arithmetic is `test/services/time-timer.test.ts`'s.
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
  const body = (await res.json()) as { error: { details: { reason?: string; action?: string } } };
  return body.error.details.reason ?? '';
}

const post = (body?: unknown) => ({
  method: 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

interface Timer {
  started_at: number;
  resumed_at: number;
  paused_at: number | null;
  accumulated_ms: number;
  tz: string;
  task: { key: string } | null;
  kind: string | null;
  title: string | null;
}

async function mint(): Promise<string> {
  const res = await ok('/tokens', post({ name: 'Collector', scope: 'full' }), 201);
  return String(((await res.json()) as { secret: string }).secret);
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
  await ok('/org/time', { method: 'PUT', body: JSON.stringify({ mode: 'manual' }) }, 200);
  await ok('/projects/laika/tasks', post({ title: 'Zoom presets' }), 201);
});

afterEach(() => {
  h.close();
});

describe('the timer over HTTP', () => {
  it('starts, rides in My day, pauses, resumes, and refuses a second start', async () => {
    const before = Date.now();
    const made = (await (
      await ok(
        '/me/time/timer',
        post({ tz: 'UTC', task: 'LAI-1', kind: 'review', title: ' Steps ' }),
        201,
      )
    ).json()) as Timer;
    expect(made).toMatchObject({
      paused_at: null,
      accumulated_ms: 0,
      tz: 'UTC',
      task: { key: 'LAI-1' },
      kind: 'review',
      title: 'Steps',
    });
    expect(made.started_at).toBeGreaterThanOrEqual(before);
    expect(made.resumed_at).toBe(made.started_at);

    const day = (await (await ok('/me/time?tz=UTC', {}, 200)).json()) as { timer: Timer | null };
    expect(day.timer).toEqual(made);

    const again = await req('/me/time/timer', post({ tz: 'UTC' }));
    expect(again.status).toBe(409);
    expect(await reasonOf(again)).toBe('timer_running');

    const paused = (await (await ok('/me/time/timer/pause', post(), 200)).json()) as Timer;
    expect(paused.paused_at).not.toBeNull();
    const pausedTwice = await req('/me/time/timer/pause', post());
    expect(pausedTwice.status).toBe(409);
    expect(await reasonOf(pausedTwice)).toBe('timer_paused');

    const resumed = (await (await ok('/me/time/timer/resume', post(), 200)).json()) as Timer;
    expect(resumed.paused_at).toBeNull();
    expect(resumed.started_at).toBe(made.started_at);
    const resumedTwice = await req('/me/time/timer/resume', post());
    expect(resumedTwice.status).toBe(409);
    expect(await reasonOf(resumedTwice)).toBe('timer_running');
  });

  it('a stop under a minute is refused and the timer stays; discard removes it; then nothing is there', async () => {
    await ok('/me/time/timer', post({ tz: 'UTC' }), 201);
    const stop = await req('/me/time/timer/stop', post());
    expect(stop.status).toBe(422);
    expect(await reasonOf(stop)).toBe('timer_too_short');
    expect(stop.headers.get('X-Undo-Id')).toBeNull();
    const day = (await (await ok('/me/time?tz=UTC', {}, 200)).json()) as { timer: Timer | null };
    expect(day.timer).not.toBeNull();

    await ok('/me/time/timer', { method: 'DELETE' }, 204);
    const gone = (await (await ok('/me/time?tz=UTC', {}, 200)).json()) as { timer: Timer | null };
    expect(gone.timer).toBeNull();
    for (const path of ['/me/time/timer/pause', '/me/time/timer/resume', '/me/time/timer/stop']) {
      const res = await req(path, post());
      expect(res.status, path).toBe(404);
      expect(await reasonOf(res)).toBe('no_timer');
    }
    expect((await req('/me/time/timer', { method: 'DELETE' })).status).toBe(404);
  });

  it('is session only, needs Time on, and takes only what it knows', async () => {
    const token = await mint();
    for (const [path, init] of [
      ['/me/time/timer', post({ tz: 'UTC' })],
      ['/me/time/timer/pause', post()],
      ['/me/time/timer/resume', post()],
      ['/me/time/timer/stop', post()],
      ['/me/time/timer', { method: 'DELETE' }],
    ] as const) {
      const res = await req(path, init, token);
      expect(res.status, `${init.method} ${path}`).toBe(403);
      const body = (await res.json()) as { error: { details: { reason: string; action: string } } };
      expect(body.error.details).toMatchObject({
        reason: 'session_required',
        action: 'time_entries.write_own',
      });
    }

    for (const body of [
      { tz: 'UTC', colour: 'violet' },
      { tz: 'UTC', kind: 'daydreaming' },
      { tz: 'UTC', title: 'x'.repeat(121) },
      {},
    ]) {
      expect((await req('/me/time/timer', post(body))).status, JSON.stringify(body)).toBe(422);
    }
    const zone = await req('/me/time/timer', post({ tz: 'Mars/Olympus' }));
    expect(zone.status).toBe(422);
    expect(await reasonOf(zone)).toBe('invalid_tz');
    expect((await req('/me/time/timer', post({ tz: 'UTC', task: 'LAI-404' }))).status).toBe(404);

    await ok('/org/time', { method: 'PUT', body: JSON.stringify({ mode: 'off' }) }, 200);
    const off = await req('/me/time/timer', post({ tz: 'UTC' }));
    expect(off.status).toBe(403);
    expect(await reasonOf(off)).toBe('time_off');
  });
});
