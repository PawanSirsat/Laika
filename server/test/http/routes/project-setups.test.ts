import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, projectRepoSetups, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `POST` / `GET /api/v1/project-setups` (SPEC §4.82, LAI-1066; plan LAI-1042
 * §D.2, §E.5, §G, §K "404s", "Permissions").
 *
 * A record is evidence about one repository's Laika block, never access. The
 * owner signed in makes the browser's record; the owner's agent, on its own
 * token, makes a local check; nobody else's agent, project or row is ever
 * reachable, and each miss answers exactly as an id that names nothing does.
 * Every refusal asserts the §6.3 `code` and, where there is one, the `reason`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const REPO_KEY = createHash('sha256').update('github.com/example/laika').digest('hex');

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let bob: { cookie: string; id: string };
let alpha: string;

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface Setup {
  id: string;
  agent_id: string | null;
  device_label: string | null;
  project_id: string;
  project_slug: string;
  repo_label: string | null;
  instructions_path: string | null;
  block_found: boolean;
  template_revision: number | null;
  project_match: boolean | null;
  prefix_match: boolean | null;
  source: string;
  checked_at: number | null;
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

function post(body: unknown, auth: Auth): Promise<Response> {
  return req('/api/v1/project-setups', { method: 'POST', body: JSON.stringify(body) }, auth);
}

function list(query: string, auth: Auth): Promise<Response> {
  return req(`/api/v1/project-setups?${query}`, {}, auth);
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok<T = Record<string, unknown>>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function refusal(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  const body = (await res.json()) as {
    error: { code: string; message: string; details: { reason?: string } | null };
  };
  return { code: body.error.code, reason: body.error.details?.reason, body };
}

async function join(email: string) {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole: 'member' });
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

async function addMember(slug: string, userId: string) {
  await ok(
    await req(
      `/api/v1/projects/${slug}/members`,
      { method: 'POST', body: JSON.stringify({ user_id: userId, role: 'member' }) },
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
  device = 'Belka',
): Promise<Registered> {
  return ok<Registered>(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Tool',
          harness: 'claude-code',
          device_label: device,
          grants,
        }),
      },
      { cookie },
    ),
    201,
  );
}

function localCheck(overrides: Record<string, unknown> = {}) {
  return {
    project_slug: 'alpha',
    repo_key: REPO_KEY,
    repo_label: 'laika',
    instructions_path: 'CLAUDE.md',
    block_found: true,
    template_revision: 2,
    block_project: 'alpha',
    block_prefix: 'ALP',
    ...overrides,
  };
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

  bob = await join('bob@example.test');
  alpha = await project('alpha', 'ALP');
  await project('beta', 'BET');
  await addMember('alpha', bob.id);
});

describe('a local check, on the agent’s own token', () => {
  it('records what the CLI read, with the agent from the token and the device it runs on', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const before = Date.now();
    const made = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);

    expect(made).toMatchObject({
      agent_id: tool.agent.id,
      device_label: 'Belka',
      project_id: alpha,
      project_slug: 'alpha',
      repo_label: 'laika',
      instructions_path: 'CLAUDE.md',
      block_found: true,
      template_revision: 2,
      project_match: true,
      prefix_match: true,
      source: 'local_check',
    });
    expect(made.checked_at).toBeGreaterThanOrEqual(before);

    // The row stores the hash and the label, never a path outside the repo.
    const row = h.db.select().from(projectRepoSetups).get();
    expect(row?.repoKey).toBe(REPO_KEY);
    expect(row?.ownerUserId).toBe(bob.id);
  });

  it('works out a project or prefix mismatch from what the block said, and keeps a legacy block unknown', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'read_only' }]);
    const copied = await ok<Setup>(
      await post(localCheck({ block_project: 'beta', block_prefix: 'BET' }), {
        bearer: tool.secret,
      }),
      201,
    );
    expect([copied.project_match, copied.prefix_match]).toEqual([false, false]);

    const legacy = await ok<Setup>(
      await post(
        localCheck({
          repo_key: 'b'.repeat(64),
          template_revision: 1,
          block_project: null,
          block_prefix: 'ALP',
        }),
        { bearer: tool.secret },
      ),
      201,
    );
    expect([legacy.template_revision, legacy.project_match, legacy.prefix_match]).toEqual([
      1,
      null,
      true,
    ]);

    const missing = await ok<Setup>(
      await post(
        localCheck({
          repo_key: 'c'.repeat(64),
          block_found: false,
          template_revision: 3,
          block_project: 'alpha',
          block_prefix: 'ALP',
        }),
        { bearer: tool.secret },
      ),
      201,
    );
    // No block, so nothing about one is kept, whatever the body said.
    expect([missing.template_revision, missing.project_match, missing.prefix_match]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('replaces its own record for the same repository rather than piling them up', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const first = await ok<Setup>(
      await post(localCheck({ template_revision: 1, block_project: null }), {
        bearer: tool.secret,
      }),
      201,
    );
    const second = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    expect(second.id).toBe(first.id);
    expect(second.template_revision).toBe(2);
    expect(h.db.select().from(projectRepoSetups).all()).toHaveLength(1);
  });

  it('records only inside the agent’s grants, refused as every agent read outside them is', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    // An agent outside its grants gets `agent_not_granted` (§4.64), the answer
    // `requireReadableProjectBySlug` gives every agent read.
    const beta = await refusal(
      await post(localCheck({ project_slug: 'beta' }), { bearer: tool.secret }),
      403,
    );
    const nowhere = await refusal(
      await post(localCheck({ project_slug: 'no-such' }), { bearer: tool.secret }),
      403,
    );
    expect([beta.code, beta.reason]).toEqual(['forbidden', 'agent_not_granted']);
    // A project that exists outside the grants and one that does not exist
    // answer the same body.
    expect(beta.body).toEqual(nowhere.body);
    expect(h.db.select().from(projectRepoSetups).all()).toHaveLength(0);
  });

  it('takes the agent from the token: an agent_id in the body is refused', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const other = await register(ownerCookie, [{ project_id: alpha, scope: 'full' }]);
    const refused = await refusal(
      await post({ ...localCheck(), agent_id: other.agent.id }, { bearer: tool.secret }),
      422,
    );
    expect(refused.code).toBe('unprocessable');
  });

  it('refuses an absolute path, a parent path, or a path with a home directory in it', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    for (const path of [
      '/Users/bob/src/laika/CLAUDE.md',
      '~/src/laika/CLAUDE.md',
      '../CLAUDE.md',
      'docs/../../CLAUDE.md',
      'C:\\Users\\bob\\CLAUDE.md',
    ]) {
      const refused = await refusal(
        await post(localCheck({ instructions_path: path }), { bearer: tool.secret }),
        422,
      );
      expect(refused.code, path).toBe('unprocessable');
    }
    const notAHash = await refusal(
      await post(localCheck({ repo_key: '/Users/bob/src/laika' }), { bearer: tool.secret }),
      422,
    );
    expect(notAHash.code).toBe('unprocessable');
    expect(h.db.select().from(projectRepoSetups).all()).toHaveLength(0);
  });

  it('keeps no time while the organisation has presence off', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    await ok(await post(localCheck(), { bearer: tool.secret }), 201);
    h.db.update(orgs).set({ presenceEnabled: 0 }).run();

    // A row written while presence was on says nothing once it is off.
    const read = await ok<{ data: Setup[] }>(await list('project=alpha', { cookie: bob.cookie }));
    expect(read.data[0]?.checked_at).toBeNull();

    const made = await ok<Setup>(
      await post(localCheck({ repo_key: 'd'.repeat(64) }), { bearer: tool.secret }),
      201,
    );
    expect(made.checked_at).toBeNull();
    const stored = h.db
      .select()
      .from(projectRepoSetups)
      .where(eq(projectRepoSetups.id, made.id))
      .get();
    expect(stored?.checkedAt).toBeNull();
  });

  it('writes no activity row', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const before = h.db.select().from(activity).all().length;
    await ok(await post(localCheck(), { bearer: tool.secret }), 201);
    await ok(
      await post(
        { agent_id: tool.agent.id, project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      201,
    );
    expect(h.db.select().from(activity).all()).toHaveLength(before);
  });
});

describe('the browser’s record, the owner signed in', () => {
  it('records the owner’s word, never as checked', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const made = await ok<Setup>(
      await post(
        {
          agent_id: tool.agent.id,
          project_slug: 'alpha',
          template_revision: 2,
          instructions_path: 'CLAUDE.md',
        },
        { cookie: bob.cookie },
      ),
      201,
    );
    expect(made).toMatchObject({
      agent_id: tool.agent.id,
      source: 'self_reported_browser',
      repo_label: null,
      block_found: true,
      template_revision: 2,
      project_match: null,
      prefix_match: null,
    });
  });

  it('allows a record about no tool in particular', async () => {
    const made = await ok<Setup>(
      await post(
        { agent_id: null, project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      201,
    );
    expect(made.agent_id).toBeNull();
    expect(made.device_label).toBeNull();
  });

  it('answers another owner’s agent exactly as an id that names nothing', async () => {
    const adas = await register(ownerCookie, [{ project_id: alpha, scope: 'full' }]);
    const foreign = await refusal(
      await post(
        { agent_id: adas.agent.id, project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      404,
    );
    const unknown = await refusal(
      await post(
        { agent_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      404,
    );
    expect(foreign.code).toBe('not_found');
    expect(foreign.body).toEqual(unknown.body);
  });

  it('answers a project the owner cannot read exactly as one that does not exist', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const beta = await refusal(
      await post(
        { agent_id: tool.agent.id, project_slug: 'beta', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      404,
    );
    const nowhere = await refusal(
      await post(
        { agent_id: tool.agent.id, project_slug: 'no-such', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      404,
    );
    expect(beta.code).toBe('not_found');
    expect(beta.body.error.message.replace('beta', 'X')).toBe(
      nowhere.body.error.message.replace('no-such', 'X'),
    );
  });

  it('refuses a personal token: it is neither the owner signed in nor the agent', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const personal = await ok<{ secret: string }>(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'mine', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    const refused = await refusal(
      await post(
        { agent_id: tool.agent.id, project_slug: 'alpha', template_revision: 2 },
        { bearer: personal.secret },
      ),
      403,
    );
    expect([refused.code, refused.reason]).toEqual(['forbidden', 'not_an_agent']);
  });

  it('refuses a local check from a session: only the agent’s token reads a file', async () => {
    const refused = await refusal(await post(localCheck(), { cookie: bob.cookie }), 422);
    expect(refused.code).toBe('unprocessable');
  });
});

describe('reading records', () => {
  it('reads the owner’s own, and nobody else’s', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const adas = await register(ownerCookie, [{ project_id: alpha, scope: 'full' }]);
    await ok(await post(localCheck(), { bearer: tool.secret }), 201);
    await ok(await post(localCheck(), { bearer: adas.secret }), 201);

    const mine = await ok<{ data: Setup[] }>(await list('project=alpha', { cookie: bob.cookie }));
    expect(mine.data.map((row) => row.agent_id)).toEqual([tool.agent.id]);

    const filtered = await ok<{ data: Setup[] }>(
      await list(`project=alpha&agent_id=${tool.agent.id}`, { cookie: bob.cookie }),
    );
    expect(filtered.data).toHaveLength(1);

    const foreign = await refusal(
      await list(`project=alpha&agent_id=${adas.agent.id}`, { cookie: bob.cookie }),
      404,
    );
    const unknown = await refusal(
      await list('project=alpha&agent_id=01ARZ3NDEKTSV4RRFFQ69G5FAV', { cookie: bob.cookie }),
      404,
    );
    expect(foreign.body).toEqual(unknown.body);
  });

  it('lets an agent’s token read only its own records', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const sibling = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }], 'Strelka');
    await ok(await post(localCheck(), { bearer: tool.secret }), 201);
    await ok(await post(localCheck(), { bearer: sibling.secret }), 201);

    const own = await ok<{ data: Setup[] }>(await list('project=alpha', { bearer: tool.secret }));
    expect(own.data.map((row) => row.agent_id)).toEqual([tool.agent.id]);

    const asked = await refusal(
      await list(`project=alpha&agent_id=${sibling.agent.id}`, { bearer: tool.secret }),
      404,
    );
    expect(asked.code).toBe('not_found');
  });

  it('answers a project the reader cannot read with a 404', async () => {
    const refused = await refusal(await list('project=beta', { cookie: bob.cookie }), 404);
    expect(refused.code).toBe('not_found');
  });
});
