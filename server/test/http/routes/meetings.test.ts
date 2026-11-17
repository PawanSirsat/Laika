/**
 * The meetings routes (LAI-1311) over HTTP: transport, status codes, the
 * `X-Undo-Id` of *Add to My day*, `no-store` on the transcript, session
 * only, and that a transcript never reaches the request log.
 */
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../../src/auth/resolve-actor.ts';
import { type MicrosoftSso } from '../../../src/auth/sso.ts';
import { meetings } from '../../../src/db/schema.ts';
import { type AppEnv } from '../../../src/http/context.ts';
import { createErrorHandler } from '../../../src/http/error-handler.ts';
import { meetingRoutes, meMeetingRoutes } from '../../../src/http/routes/meetings.ts';
import { ssoRoutes } from '../../../src/http/routes/sso.ts';
import { resetMeetingsRun, runMeetingsSync } from '../../../src/services/meetings-sync.ts';
import { setOrgTimeMode } from '../../../src/services/time-settings.ts';
import { captureLog, type CapturedLog } from '../../helpers/app.ts';
import { freshDb, seed, type Seed, type TestDb } from '../../helpers/db.ts';
import { fakeGraph, MEETINGS_SSO as SSO } from '../../helpers/fake-graph.ts';
import { addPeople, ALL, NOW, SECRET_WORDS, USER_IDS } from '../../helpers/meetings-fixture.ts';

let t: TestDb;
let s: Seed;
let people: { bo: string; cy: string; vi: string };
let standupId: string;
let log: CapturedLog;

beforeEach(async () => {
  t = freshDb();
  s = seed(t.db, NOW);
  people = addPeople(t.db);
  resetMeetingsRun();
  await runMeetingsSync(t.db, SSO, {
    fetch: fakeGraph(ALL, { userIds: USER_IDS }).fetchImpl,
    now: () => NOW,
  });
  standupId =
    t.db.select().from(meetings).where(eq(meetings.graphEventId, 'ical-standup')).get()?.id ?? '';
  const owner = loadActor(t.db, s.userId);
  if (owner === null) throw new Error('no owner');
  setOrgTimeMode(t.db, owner, 'manual', NOW);
  resetMeetingsRun();
});
afterEach(() => {
  t.close();
});

type As = string | null | { token: string };

function app(as: As, sso: MicrosoftSso | null = SSO): Hono<AppEnv> {
  log = captureLog();
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('log', log.logger);
    c.set('requestId', 'test');
    let actor: ResolvedActor | null = null;
    if (typeof as === 'string') actor = loadActor(t.db, as);
    if (as !== null && typeof as === 'object') {
      const base = loadActor(t.db, as.token);
      actor =
        base === null ? null : { ...base, token: { id: 'tok', scope: 'full', projectIds: null } };
    }
    c.set('actor', actor);
    await next();
  });
  a.onError(createErrorHandler(log.logger));
  const graph = { fetch: fakeGraph(ALL, { userIds: USER_IDS }).fetchImpl, now: () => NOW };
  const options = {
    db: t.db,
    sso,
    serverSecret: 'x'.repeat(48),
    graph,
    now: () => NOW,
    provider: () => ({
      complete: () =>
        Promise.resolve(
          JSON.stringify({ proposals: [{ kind: 'new', title: 'Follow up', quote: 'Morning' }] }),
        ),
    }),
  };
  a.route('/api/v1/me', meMeetingRoutes(options));
  a.route('/api/v1/meetings', meetingRoutes(options));
  a.route(
    '/api/v1/org',
    ssoRoutes({ db: t.db, sso, publicUrl: 'https://laika.example', meetings: graph }),
  );
  return a;
}

const send = (a: Hono<AppEnv>, path: string, method = 'GET', body?: unknown) =>
  a.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function refused(res: Response, status: number, code: string, reason?: string) {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  const body = JSON.parse(text) as { error: { code: string; details?: { reason?: string } } };
  expect(body.error.code).toBe(code);
  if (reason !== undefined) expect(body.error.details?.reason).toBe(reason);
}

describe('the meetings routes', () => {
  it('lists the reader’s meetings with the switch, and validates the filter', async () => {
    const res = await send(app(s.userId), '/api/v1/me/meetings?filter=attended');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; data: { id: string }[] };
    expect(body.enabled).toBe(true);
    expect(body.data.map((m) => m.id)).toEqual([standupId]);

    await refused(
      await send(app(s.userId), '/api/v1/me/meetings?filter=mine'),
      422,
      'unprocessable',
    );
  });

  it('nobody signed in is 401; a token, even a full one, is refused — session only', async () => {
    await refused(await send(app(null), '/api/v1/me/meetings'), 401, 'unauthorized');
    await refused(
      await send(app({ token: s.userId }), `/api/v1/meetings/${standupId}`),
      403,
      'forbidden',
    );
  });

  it('a meeting the reader was not on is 404', async () => {
    const vendor = t.db
      .select()
      .from(meetings)
      .where(eq(meetings.graphEventId, 'ical-outside'))
      .get();
    await refused(
      await send(app(people.bo), `/api/v1/meetings/${vendor?.id ?? ''}`),
      404,
      'not_found',
    );
  });

  it('serves the transcript uncached, and never logs a word of it', async () => {
    const a = app(people.bo);
    const res = await send(a, `/api/v1/meetings/${standupId}/transcript`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain(SECRET_WORDS);
    expect(JSON.stringify(log.records)).not.toContain(SECRET_WORDS);
  });

  it('links a space by id, and unlinks with null', async () => {
    const a = app(s.userId);
    const linked = await send(a, `/api/v1/meetings/${standupId}`, 'PATCH', {
      project_id: s.projectId,
    });
    expect(linked.status).toBe(200);
    expect(((await linked.json()) as { project: { slug: string } }).project.slug).toBe('laika');
    const unlinked = await send(a, `/api/v1/meetings/${standupId}`, 'PATCH', { project_id: null });
    expect(((await unlinked.json()) as { project: unknown }).project).toBeNull();
    await refused(
      await send(a, `/api/v1/meetings/${standupId}`, 'PATCH', { project: 'laika' }),
      422,
      'unprocessable',
    );
  });

  it('reviews with AI into a linked space → 201 with the review id', async () => {
    const a = app(s.userId);
    await send(a, `/api/v1/meetings/${standupId}`, 'PATCH', { project_id: s.projectId });
    const res = await send(a, `/api/v1/meetings/${standupId}/review`, 'POST', {});
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await res.json()).toMatchObject({ proposals: 1, project_slug: 'laika' });
  });

  it('adds it to My day → 201, the entry, and its X-Undo-Id; again is 409', async () => {
    const a = app(s.userId);
    const res = await send(a, `/api/v1/meetings/${standupId}/log-time`, 'POST', { tz: 'UTC' });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(res.headers.get('x-undo-id')).toMatch(/^[0-9A-Z]{26}$/);
    expect(await res.json()).toMatchObject({ kind: 'meeting', minutes: 34 });
    await refused(
      await send(a, `/api/v1/meetings/${standupId}/log-time`, 'POST', { tz: 'UTC' }),
      409,
      'conflict',
      'already_logged',
    );
  });

  it('Sync now on the Sign-in card answers the settings with the run', async () => {
    const res = await send(app(s.userId), '/api/v1/org/sso/meetings-sync', 'POST', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      microsoft: { meetings_sync: { last_run: { ok: boolean; meetings: number } } };
    };
    expect(body.microsoft.meetings_sync.last_run).toMatchObject({ ok: true, meetings: 3 });
    await refused(
      await send(app(people.bo), '/api/v1/org/sso/meetings-sync', 'POST', {}),
      403,
      'forbidden',
    );
  });
});
