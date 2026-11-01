import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /api/v1/agents/:id/project-access` (SPEC §6.4, plan LAI-1042 §E.5,
 * LAI-1052): one of your tools against one project, for Project setup.
 *
 * The owner's membership and the tool's grant are separate fields, and each
 * test asserts both, so an answer that collapsed them into one word fails
 * here. Every refusal asserts the §6.3 `code` and, where there is one, the
 * `reason`, so a broken setup cannot pass for the rule.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let bob: { cookie: string; id: string };
let alpha: string;
let beta: string;

interface Auth {
  cookie?: string;
  bearer?: string;
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...headers, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer') {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function project(slug: string, prefix: string): Promise<string> {
  const body = await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: slug, slug, prefix }) },
      { cookie: ownerCookie },
    ),
    201,
  );
  return body.id as string;
}

async function addMember(slug: string, userId: string, role: 'member' | 'viewer') {
  await ok(
    await req(
      `/api/v1/projects/${slug}/members`,
      { method: 'POST', body: JSON.stringify({ user_id: userId, role }) },
      { cookie: ownerCookie },
    ),
    201,
  );
}

interface Registered {
  agent: { id: string };
  secret: string;
}

async function register(
  cookie: string,
  grants: { project_id: string; scope: 'full' | 'read_only' }[],
  harness = 'claude-code',
): Promise<Registered> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: 'Tool', harness, device_label: 'Belka', grants }),
      },
      { cookie },
    ),
    201,
  )) as unknown as Registered;
}

function access(agentId: string, slug: string, auth: Auth): Promise<Response> {
  return req(
    `/api/v1/agents/${encodeURIComponent(agentId)}/project-access?project=${slug}`,
    {},
    auth,
  );
}

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
    }),
  });
  expect(setup.status).toBe(201);
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';

  bob = await join('bob@example.test', 'member');
  alpha = await project('alpha', 'ALP');
  beta = await project('beta', 'BET');
  await addMember('alpha', bob.id, 'member');
  await addMember('beta', bob.id, 'viewer');
});

afterEach(() => {
  h.close();
});

describe('GET /agents/:id/project-access', () => {
  it('answers membership and grant as two separate facts', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'read_only' }]);

    const body = await ok(await access(tool.agent.id, 'alpha', { cookie: bob.cookie }));
    expect(body).toEqual({
      agent_id: tool.agent.id,
      project: { id: alpha, slug: 'alpha', name: 'alpha', prefix: 'ALP', agents_allowed: true },
      member: { role: 'member', can_read: true, can_write: true },
      grant: { scope: 'read_only' },
      effective: 'read_only',
      can_grant: { max: 'full', reason: null },
    });
  });

  it('a project the tool was not given is no access, while the owner is still a member', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);

    const body = await ok(await access(tool.agent.id, 'beta', { cookie: bob.cookie }));
    expect(body.member).toEqual({ role: 'viewer', can_read: true, can_write: false });
    expect(body.grant).toEqual({ scope: null });
    expect(body.effective).toBe('none');
  });

  it('a viewer may grant at most read only, and a full grant there is read only in effect', async () => {
    const tool = await register(bob.cookie, [{ project_id: beta, scope: 'full' }]);

    const body = await ok(await access(tool.agent.id, 'beta', { cookie: bob.cookie }));
    expect(body.can_grant).toEqual({ max: 'read_only', reason: 'viewer_role' });
    // The grant row says what was stored; `effective` says what it can do.
    expect(body.grant).toEqual({ scope: 'full' });
    expect(body.effective).toBe('read_only');
  });

  it('a space with coding tools off caps a full grant at read only', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    await ok(
      await req(
        '/api/v1/projects/alpha',
        { method: 'PATCH', body: JSON.stringify({ agents_allowed: false }) },
        { cookie: ownerCookie },
      ),
    );

    const body = await ok(await access(tool.agent.id, 'alpha', { cookie: bob.cookie }));
    expect(body.project).toMatchObject({ agents_allowed: false });
    expect(body.grant).toEqual({ scope: 'full' });
    expect(body.effective).toBe('read_only');
    expect(body.can_grant).toEqual({ max: 'full', reason: null });
  });

  it('a revoked tool reaches nothing and may be given nothing', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    await ok(
      await req(
        `/api/v1/agents/${tool.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );

    const body = await ok(await access(tool.agent.id, 'alpha', { cookie: bob.cookie }));
    expect(body.effective).toBe('none');
    expect(body.can_grant).toEqual({ max: null, reason: 'agent_revoked' });
  });

  it('another owner’s agent is the same 404 as an id that names nothing, byte for byte', async () => {
    const adas = await register(ownerCookie, [{ project_id: alpha, scope: 'full' }]);

    const foreign = await access(adas.agent.id, 'alpha', { cookie: bob.cookie });
    const missing = await access('01NOSUCHAGENT0000000000000', 'alpha', { cookie: bob.cookie });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const foreignText = await foreign.text();
    expect(foreignText).toBe(await missing.text());
    expect(JSON.parse(foreignText)).toMatchObject({ error: { code: 'not_found' } });
    // The owner still sees it, so the 404 above is the ownership rule.
    await ok(await access(adas.agent.id, 'alpha', { cookie: ownerCookie }));
  });

  it('a project the owner cannot read is the missing slug’s 404', async () => {
    const tool = await register(bob.cookie, []);
    await project('gamma', 'GAM');

    const hidden = await access(tool.agent.id, 'gamma', { cookie: bob.cookie });
    const missing = await access(tool.agent.id, 'nopes', { cookie: bob.cookie });
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // The message names the slug asked for, so each body is compared with its
    // own slug taken out; everything else must be the same bytes.
    const normalise = async (res: Response, slug: string) =>
      (await res.text())
        .replaceAll(`"${slug}"`, '"<slug>"')
        .replaceAll(`\\"${slug}\\"`, '\\"<slug>\\"');
    const hiddenBody = await normalise(hidden, 'gamma');
    expect(hiddenBody).toBe(await normalise(missing, 'nopes'));
    expect(JSON.parse(hiddenBody)).toMatchObject({ error: { code: 'not_found' } });
  });

  it('needs a signed-in session: the agent’s own token is refused', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);

    const res = await access(tool.agent.id, 'alpha', { bearer: tool.secret });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details: { reason: string } } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.details.reason).toBe('session_required');
  });

  it('refuses no session at all, and a missing project query', async () => {
    const tool = await register(bob.cookie, []);

    expect((await access(tool.agent.id, 'alpha', {})).status).toBe(401);
    const bad = await req(
      `/api/v1/agents/${tool.agent.id}/project-access`,
      {},
      { cookie: bob.cookie },
    );
    expect(bad.status).toBe(422);
  });

  it('a grant changed through PUT /grants, one project at a time, shows here and keeps the rest', async () => {
    const tool = await register(bob.cookie, [{ project_id: beta, scope: 'read_only' }]);

    // What Project setup sends: the current set with only alpha changed.
    await ok(
      await req(
        `/api/v1/agents/${tool.agent.id}/grants`,
        {
          method: 'PUT',
          body: JSON.stringify({
            grants: [
              { project_id: beta, scope: 'read_only' },
              { project_id: alpha, scope: 'full' },
            ],
          }),
        },
        { cookie: bob.cookie },
      ),
    );

    expect((await ok(await access(tool.agent.id, 'alpha', { cookie: bob.cookie }))).grant).toEqual({
      scope: 'full',
    });
    expect((await ok(await access(tool.agent.id, 'beta', { cookie: bob.cookie }))).grant).toEqual({
      scope: 'read_only',
    });
  });
});
