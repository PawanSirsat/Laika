import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, projectRepoSetups, projects, users } from '../../../src/db/schema.ts';
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
  repo_key: string;
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

/** No query at all: every project the reader can read (LAI-1077). */
function all(auth: Auth): Promise<Response> {
  return req('/api/v1/project-setups', {}, auth);
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
      repo_key: REPO_KEY,
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

  it('keeps a label in any script, with spaces and ordinary punctuation', async () => {
    const tool = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    for (const [i, label] of [
      'onroute-app',
      'Projekt Müller (2)',
      'web_v2.1',
      'Kvell & Co',
    ].entries()) {
      const made = await ok<Setup>(
        await post(localCheck({ repo_key: String(i).repeat(64), repo_label: label }), {
          bearer: tool.secret,
        }),
        201,
      );
      expect(made.repo_label).toBe(label);
    }
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
    // A label is a name, never a path (LAI-1073).
    for (const label of [
      'C:\\Users\\bob\\repo',
      '\\Users\\bob\\repo',
      '~/src/laika',
      'src/laika',
      'host:repo',
      'tab\there',
      '.hidden',
    ]) {
      const refused = await refusal(
        await post(localCheck({ repo_label: label }), { bearer: tool.secret }),
        422,
      );
      expect(refused.code, label).toBe('unprocessable');
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
      repo_key: '',
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

  it('refuses a personal token a local-check body with 403, not a validation 422 (LAI-1073)', async () => {
    const personal = await ok<{ secret: string }>(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'mine', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    for (const body of [localCheck(), {}, { anything: true }]) {
      const refused = await refusal(await post(body, { bearer: personal.secret }), 403);
      expect([refused.code, refused.reason]).toEqual(['forbidden', 'not_an_agent']);
    }
    expect(h.db.select().from(projectRepoSetups).all()).toEqual([]);
  });

  it('refuses a record naming a tool with no grant on the project (LAI-1073)', async () => {
    const tool = await register(bob.cookie, []);
    const refused = await refusal(
      await post(
        { agent_id: tool.agent.id, project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      403,
    );
    expect([refused.code, refused.reason]).toEqual(['forbidden', 'agent_not_granted']);
    expect(h.db.select().from(projectRepoSetups).all()).toEqual([]);
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

  it('serves each record’s repo_key, so one repository groups across devices (LAI-321)', async () => {
    const laptop = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }], 'Laptop');
    const desktop = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }], 'Desktop');
    const other = createHash('sha256').update('github.com/example/laika-web').digest('hex');
    await ok(await post(localCheck(), { bearer: laptop.secret }), 201);
    await ok(await post(localCheck(), { bearer: desktop.secret }), 201);
    await ok(await post(localCheck({ repo_key: other }), { bearer: desktop.secret }), 201);
    await ok(
      await post(
        { agent_id: laptop.agent.id, project_slug: 'alpha', template_revision: 2 },
        { cookie: bob.cookie },
      ),
      201,
    );

    const read = await ok<{ data: Setup[] }>(await list('project=alpha', { cookie: bob.cookie }));
    const keyOf = (row: Setup): string => `${row.device_label ?? ''}:${row.source}:${row.repo_key}`;
    expect(read.data.map(keyOf).sort()).toEqual(
      [
        `Desktop:local_check:${other}`,
        `Desktop:local_check:${REPO_KEY}`,
        `Laptop:local_check:${REPO_KEY}`,
        'Laptop:self_reported_browser:',
      ].sort(),
    );
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

describe('reading records with no project, across every project the reader can read (LAI-1077)', () => {
  /** What the newest-first order is for these ids: ULIDs sort by creation. */
  const newestFirst = (ids: string[]) => [...ids].sort().reverse();

  /** A browser record about no tool in particular, in one project. */
  async function selfReport(slug: string, auth: Auth): Promise<Setup> {
    return ok<Setup>(
      await post({ agent_id: null, project_slug: slug, template_revision: 2 }, auth),
      201,
    );
  }

  beforeEach(async () => {
    await addMember('beta', bob.id);
  });

  it('answers the reader’s own records from both projects, newest first, each naming its project', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const inAlpha = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    const inBeta = await ok<Setup>(
      await post(localCheck({ project_slug: 'beta', block_project: 'beta', block_prefix: 'BET' }), {
        bearer: tool.secret,
      }),
      201,
    );
    const browserAlpha = await selfReport('alpha', { cookie: bob.cookie });

    const res = await all({ cookie: bob.cookie });
    const body = await ok<{ data: Setup[] }>(res);
    expect(body.data.map((row) => row.id)).toEqual(
      newestFirst([inAlpha.id, inBeta.id, browserAlpha.id]),
    );
    expect(
      Object.fromEntries(body.data.map((row) => [row.id, [row.project_id, row.project_slug]])),
    ).toEqual({
      [inAlpha.id]: [alpha, 'alpha'],
      [inBeta.id]: [betaId(), 'beta'],
      [browserAlpha.id]: [alpha, 'alpha'],
    });
    // The same row shape the per-project read answers, field for field.
    const perProject = await ok<{ data: Setup[] }>(
      await list('project=beta', { cookie: bob.cookie }),
    );
    expect(body.data.find((row) => row.id === inBeta.id)).toEqual(perProject.data[0]);
  });

  it('leaves out a project the reader can no longer read, and names it nowhere', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const inAlpha = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    await ok(await post(localCheck({ project_slug: 'beta' }), { bearer: tool.secret }), 201);
    await selfReport('beta', { cookie: bob.cookie });

    await ok(
      await req(
        `/api/v1/projects/beta/members/${bob.id}`,
        { method: 'DELETE' },
        {
          cookie: ownerCookie,
        },
      ),
    );
    // Bob's two records in beta are still stored — the read is what leaves them out.
    expect(
      h.db
        .select()
        .from(projectRepoSetups)
        .where(eq(projectRepoSetups.projectId, betaId()))
        .all()
        .map((row) => row.ownerUserId),
    ).toEqual([bob.id, bob.id]);

    for (const auth of [{ cookie: bob.cookie }, { bearer: tool.secret }]) {
      const res = await all(auth);
      const text = await res.clone().text();
      const body = await ok<{ data: Setup[] }>(res);
      expect(body.data.map((row) => row.id)).toEqual([inAlpha.id]);
      expect(text).not.toContain(betaId());
      expect(text).not.toContain('beta');
    }
    // And the per-project read still answers it as a project that does not exist.
    expect((await refusal(await list('project=beta', { cookie: bob.cookie }), 404)).code).toBe(
      'not_found',
    );
  });

  it('never answers another user’s records, even to the owner who reads every project', async () => {
    const bobs = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }]);
    const adas = await register(ownerCookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const bobAlpha = await ok<Setup>(await post(localCheck(), { bearer: bobs.secret }), 201);
    const adaAlpha = await ok<Setup>(await post(localCheck(), { bearer: adas.secret }), 201);
    const adaBeta = await selfReport('beta', { cookie: ownerCookie });

    const bobRead = await ok<{ data: Setup[] }>(await all({ cookie: bob.cookie }));
    expect(bobRead.data.map((row) => row.id)).toEqual([bobAlpha.id]);

    const adaRead = await ok<{ data: Setup[] }>(await all({ cookie: ownerCookie }));
    expect(adaRead.data.map((row) => row.id)).toEqual(newestFirst([adaAlpha.id, adaBeta.id]));
  });

  it('is not paginated, as the per-project read is not: every row in one answer, no cursor', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    // More than §6.3's default page of 50, split across both projects.
    const made: string[] = [];
    for (let i = 0; i < 56; i += 1) {
      const row = await ok<Setup>(
        await post(
          localCheck({
            project_slug: i % 2 === 0 ? 'alpha' : 'beta',
            repo_key: i.toString(16).padStart(64, '0'),
          }),
          { bearer: tool.secret },
        ),
        201,
      );
      made.push(row.id);
    }

    const body = await ok<Record<string, unknown>>(await all({ cookie: bob.cookie }));
    expect(Object.keys(body)).toEqual(['data']);
    expect((body.data as Setup[]).map((row) => row.id)).toEqual(newestFirst(made));
  });

  it('narrows to one of the reader’s tools with agent_id, still only the reader’s own', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const sibling = await register(
      bob.cookie,
      [
        { project_id: alpha, scope: 'full' },
        { project_id: betaId(), scope: 'full' },
      ],
      'Strelka',
    );
    const adas = await register(ownerCookie, [{ project_id: alpha, scope: 'full' }]);
    const toolAlpha = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    const toolBeta = await ok<Setup>(
      await post(localCheck({ project_slug: 'beta' }), { bearer: tool.secret }),
      201,
    );
    await ok(await post(localCheck({ project_slug: 'beta' }), { bearer: sibling.secret }), 201);
    await selfReport('alpha', { cookie: bob.cookie });
    await ok(await post(localCheck(), { bearer: adas.secret }), 201);

    const filtered = await ok<{ data: Setup[] }>(
      await list(`agent_id=${tool.agent.id}`, { cookie: bob.cookie }),
    );
    expect(filtered.data.map((row) => row.id)).toEqual(newestFirst([toolAlpha.id, toolBeta.id]));

    // Another owner's tool, and an id that names nothing: the same 404.
    const foreign = await refusal(
      await list(`agent_id=${adas.agent.id}`, { cookie: bob.cookie }),
      404,
    );
    const unknown = await refusal(
      await list('agent_id=01ARZ3NDEKTSV4RRFFQ69G5FAV', { cookie: bob.cookie }),
      404,
    );
    expect(foreign.code).toBe('not_found');
    expect(foreign.body).toEqual(unknown.body);
  });

  it('lets an agent’s token read only its own, and only inside its grants as they are now', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const sibling = await register(bob.cookie, [{ project_id: alpha, scope: 'full' }], 'Strelka');
    const toolAlpha = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    const toolBeta = await ok<Setup>(
      await post(localCheck({ project_slug: 'beta' }), { bearer: tool.secret }),
      201,
    );
    await ok(await post(localCheck(), { bearer: sibling.secret }), 201);
    await selfReport('beta', { cookie: bob.cookie });

    const own = await ok<{ data: Setup[] }>(await all({ bearer: tool.secret }));
    expect(own.data.map((row) => row.id)).toEqual(newestFirst([toolAlpha.id, toolBeta.id]));

    const asked = await refusal(
      await list(`agent_id=${sibling.agent.id}`, { bearer: tool.secret }),
      404,
    );
    expect(asked.code).toBe('not_found');

    // Take beta out of the tool's grants: its own token no longer reads beta's
    // record, and the owner — who still reads beta — still does.
    await ok(
      await req(
        `/api/v1/agents/${tool.agent.id}/grants`,
        { method: 'PUT', body: JSON.stringify({ grants: [{ project_id: alpha, scope: 'full' }] }) },
        { cookie: bob.cookie },
      ),
    );
    const narrowed = await ok<{ data: Setup[] }>(await all({ bearer: tool.secret }));
    expect(narrowed.data.map((row) => row.id)).toEqual([toolAlpha.id]);
    const owners = await ok<{ data: Setup[] }>(
      await list(`agent_id=${tool.agent.id}`, { cookie: bob.cookie }),
    );
    expect(owners.data.map((row) => row.id)).toEqual(newestFirst([toolAlpha.id, toolBeta.id]));
  });

  it('answers an empty list to a reader with no project to read', async () => {
    const carol = await join('carol@example.test');
    await selfReport('alpha', { cookie: bob.cookie });
    const body = await ok<Record<string, unknown>>(await all({ cookie: carol.cookie }));
    expect(body).toEqual({ data: [] });
  });

  it('leaves the per-project form as it was: one project, oldest first, an empty slug refused', async () => {
    const tool = await register(bob.cookie, [
      { project_id: alpha, scope: 'full' },
      { project_id: betaId(), scope: 'full' },
    ]);
    const first = await ok<Setup>(await post(localCheck(), { bearer: tool.secret }), 201);
    await ok(await post(localCheck({ project_slug: 'beta' }), { bearer: tool.secret }), 201);
    const second = await selfReport('alpha', { cookie: bob.cookie });

    const alphaOnly = await ok<{ data: Setup[] }>(
      await list('project=alpha', { cookie: bob.cookie }),
    );
    expect(alphaOnly.data.map((row) => row.id)).toEqual([first.id, second.id].sort());

    const empty = await refusal(await list('project=', { cookie: bob.cookie }), 422);
    expect(empty.code).toBe('unprocessable');
  });
});

/** Beta's id, read from the database the projects route wrote. */
function betaId(): string {
  return h.db.select().from(projects).where(eq(projects.slug, 'beta')).get()?.id ?? '';
}
