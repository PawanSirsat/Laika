import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { orgs, projectMemberships, projects, users } from '../../../src/db/schema.ts';
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
 * Token budgets over HTTP (LAI-773): read by anyone in the project, set by a
 * lead on a web session — a member and any token are refused with the
 * contract's status and reason. The service test owns the arithmetic.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let bea: string;

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

async function json(res: Promise<Response>, status: number): Promise<Record<string, unknown>> {
  const done = await res;
  expect(done.status, await done.clone().text()).toBe(status);
  return (await done.json()) as Record<string, unknown>;
}

async function mint(cookie: string): Promise<string> {
  const created = await json(
    req(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'Agent', scope: 'full' }) },
      cookie,
    ),
    201,
  );
  return String(created.secret);
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
  ownerCookie = cookieFrom(setup);
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const owner = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get();
  const project = h.db.select().from(projects).get();
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
  bea = cookieFrom(joined);
  const beaId =
    h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id ?? '';
  h.db
    .insert(projectMemberships)
    .values({
      id: newId(),
      projectId: project?.id ?? '',
      userId: beaId,
      role: 'member',
      createdAt: Date.now(),
    })
    .run();
});

afterEach(() => {
  h.close();
});

describe('a project’s budgets', () => {
  it('are read by a member, who may not set them', async () => {
    const read = await json(req('/api/v1/projects/laika/budgets', {}, bea), 200);
    expect(read).toMatchObject({ project_budget: null, sprints: [], tasks: [], can_set: false });
    const refused = await req(
      '/api/v1/projects/laika/budget',
      { method: 'PUT', body: JSON.stringify({ tokens: 1000 }) },
      bea,
    );
    expect(refused.status).toBe(403);
  });

  it('are set by a lead on a session, and cleared with null', async () => {
    const set = await json(
      req(
        '/api/v1/projects/laika/budget',
        { method: 'PUT', body: JSON.stringify({ tokens: 5_000_000 }) },
        ownerCookie,
      ),
      200,
    );
    expect(set).toMatchObject({ budget: { scope: 'project', tokens: 5_000_000, state: 'under' } });
    expect(await json(req('/api/v1/projects/laika/budgets', {}, bea), 200)).toMatchObject({
      project_budget: { tokens: 5_000_000 },
    });
    expect(
      await json(
        req(
          '/api/v1/projects/laika/budget',
          { method: 'PUT', body: JSON.stringify({ tokens: null }) },
          ownerCookie,
        ),
        200,
      ),
    ).toEqual({ budget: null });
  });

  it('refuse a token whatever it holds — an agent never moves its own budget', async () => {
    const token = await mint(ownerCookie);
    const res = await req(
      '/api/v1/projects/laika/budget',
      { method: 'PUT', body: JSON.stringify({ tokens: 9 }) },
      token,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe('session_required');
  });

  it('refuse a budget that is not a whole number above zero, or an unknown field', async () => {
    for (const body of [
      { tokens: 0 },
      { tokens: 1.5 },
      { tokens: 'lots' },
      { tokens: 5, period: 'week' },
    ]) {
      const res = await req(
        '/api/v1/projects/laika/budget',
        { method: 'PUT', body: JSON.stringify(body) },
        ownerCookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('answers 404 for a task or sprint that is not there', async () => {
    for (const path of ['/api/v1/tasks/nope/budget', '/api/v1/sprints/nope/budget']) {
      const res = await req(
        path,
        { method: 'PUT', body: JSON.stringify({ tokens: 5 }) },
        ownerCookie,
      );
      expect(res.status, path).toBe(404);
    }
  });
});
