/**
 * `GET /org/sso` and its two *Sync now* routes over HTTP (LAI-1239,
 * LAI-1311): signed in or 401, the owner's or 403, and the body the services
 * build — never the client secret.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../../src/auth/resolve-actor.ts';
import { type AppEnv } from '../../../src/http/context.ts';
import { createErrorHandler } from '../../../src/http/error-handler.ts';
import { ssoRoutes } from '../../../src/http/routes/sso.ts';
import { resetDirectoryRun } from '../../../src/services/microsoft-directory.ts';
import { resetMeetingsRun } from '../../../src/services/meetings-sync.ts';
import { captureLog } from '../../helpers/app.ts';
import { freshDb, seed, type Seed, type TestDb } from '../../helpers/db.ts';
import { fakeGraph, MEETINGS_SSO as SSO } from '../../helpers/fake-graph.ts';
import { addPeople, ALL, NOW, USER_IDS } from '../../helpers/meetings-fixture.ts';

let t: TestDb;
let s: Seed;
let bo: string;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  bo = addPeople(t.db).bo;
  resetDirectoryRun();
  resetMeetingsRun();
});
afterEach(() => {
  t.close();
});

function app(userId: string | null): Hono<AppEnv> {
  const log = captureLog();
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('log', log.logger);
    c.set('requestId', 'test');
    c.set('actor', userId === null ? null : loadActor(t.db, userId));
    await next();
  });
  a.onError(createErrorHandler(log.logger));
  a.route(
    '/api/v1/org',
    ssoRoutes({
      db: t.db,
      sso: SSO,
      publicUrl: 'https://laika.example',
      meetings: { fetch: fakeGraph(ALL, { userIds: USER_IDS }).fetchImpl, now: () => NOW },
    }),
  );
  return a;
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('the SSO settings routes', () => {
  it('reads the settings for the owner, with the meetings block and no secret', async () => {
    const res = await app(s.userId).request('/api/v1/org/sso');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SSO.clientSecret);
    const body = JSON.parse(text) as {
      sign_in: string;
      microsoft: { redirect_uri: string; meetings_sync: { enabled: boolean } };
    };
    expect(body.sign_in).toBe('microsoft');
    expect(body.microsoft.redirect_uri).toBe(
      'https://laika.example/api/v1/auth/callback/microsoft',
    );
    expect(body.microsoft.meetings_sync.enabled).toBe(true);
  });

  it('is 401 signed out and 403 for a member', async () => {
    const out = await app(null).request('/api/v1/org/sso');
    expect(out.status).toBe(401);
    expect(await codeOf(out)).toBe('unauthorized');
    const member = await app(bo).request('/api/v1/org/sso');
    expect(member.status).toBe(403);
    expect(await codeOf(member)).toBe('forbidden');
  });

  it('directory Sync now is 409 while directory sync is off', async () => {
    const res = await app(s.userId).request('/api/v1/org/sso/directory-sync', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
  });

  it('meetings Sync now runs and answers the settings with the run', async () => {
    const res = await app(s.userId).request('/api/v1/org/sso/meetings-sync', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      microsoft: { meetings_sync: { last_run: { at: number; ok: boolean } } };
    };
    expect(body.microsoft.meetings_sync.last_run).toMatchObject({ at: NOW, ok: true });
  });
});
