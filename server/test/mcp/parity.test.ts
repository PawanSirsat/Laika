import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { activity, users } from '../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * An MCP tool and its REST twin write identical activity (SPEC §13.3, LAI-409).
 *
 * ## What this proves, and what already guarantees it
 *
 * The layering rules make divergence hard: `http/routes/` and `mcp/` can each
 * only reach data through `services/`, enforced by `no-restricted-imports`. So
 * this file **confirms a property the structure already provides** rather than
 * being the only thing holding it up — which is the right relationship, because
 * a test that is the sole guarantee fails silently the day someone works around
 * it, and a structural rule cannot be worked around without failing lint.
 *
 * It goes red the day somebody adds a second write path.
 *
 * ## The pair list is derived
 *
 * `PAIRS` and `EXEMPT` are checked **against the tools the server actually
 * registers**, read from a live `listTools()`. A tool added in six months is
 * covered without anyone remembering this file exists: it appears in neither
 * map and the completeness test names it.
 *
 * That is the load-bearing half. An exemption protects the one case somebody
 * thought about; a derived list protects the case nobody did.
 */

const PASSWORD = 'correct-horse-battery-staple';

/**
 * The one tool with no REST twin (D-024, SPEC §7.2).
 *
 * Not silently absent — a missing pair must read as intended rather than as a
 * gap. The self-expiry test below removes the need for anyone to remember this
 * is still true.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    'log_unlisted_work',
    'D-024 and §7.2: unlisted work is by definition something an agent noticed outside any project — a human at the board would file a task instead — so there is no human write path to mirror. Humans read the pile (`GET /api/v1/unlisted`) and act on it (`POST /api/v1/unlisted/:id/promote`); neither is a twin of logging one.',
  ],
]);

/** A harness with its own database and its own listening socket. */
interface Side {
  h: AuthHarness;
  server: ReturnType<typeof serve>;
  baseUrl: URL;
  cookie: string;
  secret: string;
}

const open: Side[] = [];

async function makeSide(): Promise<Side> {
  const h = authHarness();

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
  expect(setup.status, await setup.clone().text()).toBe(201);
  const cookie = cookieFrom(setup);

  const baseUrl = await new Promise<URL>((resolve) => {
    const server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
    open.push({ h, server, baseUrl: new URL('http://placeholder'), cookie, secret: '' });
  });

  const side = open[open.length - 1]!;
  side.baseUrl = baseUrl;

  const minted = await request(side, '/api/v1/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: 'agent', scope: 'full' }),
  });
  expect(minted.status, await minted.clone().text()).toBe(201);
  side.secret = ((await minted.json()) as { secret: string }).secret;

  // The same project on both sides, so ids differ but structure does not.
  const project = await request(side, '/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Core', slug: 'core', prefix: 'COR' }),
  });
  expect(project.status, await project.clone().text()).toBe(201);

  return side;
}

async function request(side: Side, path: string, init: RequestInit = {}): Promise<Response> {
  return side.h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      Cookie: side.cookie,
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

/** A REST call that must succeed — a broken setup must not satisfy a parity test. */
async function must(
  side: Side,
  path: string,
  init: RequestInit,
  expected = 201,
): Promise<Response> {
  const res = await request(side, path, init);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

async function connect(side: Side): Promise<Client> {
  const client = new Client({ name: 'parity', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', side.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${side.secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

/** A tool call that must succeed — an errored tool writes nothing to compare. */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * An event with everything that *must* differ removed.
 *
 * Two runs against two clean databases produce different ULIDs and different
 * clocks; the point of the comparison is what is left. `actor_kind` and
 * `actor_token_id` differ **by design** — that is the one thing an agent's row
 * is supposed to say — and stripping them is what makes the rest meaningful.
 */
function normalise(event: unknown): unknown {
  if (typeof event === 'string') return ULID.test(event) ? '<id>' : event;
  if (Array.isArray(event)) return event.map(normalise);
  if (typeof event !== 'object' || event === null) return event;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (['id', 'seq', 'created_at', 'actor_kind', 'actor_token_id'].includes(key)) continue;
    out[key] = normalise(value);
  }
  return out;
}

/**
 * The project's activity as a client sees it — the **same `eventView`** the SSE
 * stream serialises with (`services/activity.ts` and `routes/events.ts` both
 * call it), so comparing here compares what a browser receives.
 */
async function events(side: Side): Promise<unknown[]> {
  const res = await request(side, '/api/v1/projects/core/activity?limit=200');
  expect(res.status).toBe(200);

  const page = (await res.json()) as { data: unknown[] };
  // Oldest first, so two runs line up in the order the actions happened.
  return [...page.data].reverse().map(normalise);
}

/** Rows written since a marker, for the reads-write-nothing assertions. */
function rowCount(side: Side): number {
  return side.h.db.select().from(activity).all().length;
}

afterEach(async () => {
  for (const side of open.splice(0)) {
    await new Promise<void>((resolve) => {
      side.server.close(() => {
        resolve();
      });
    });
    side.h.close();
  }
});

// ------------------------------------------------------------- the pair list

interface Pair {
  /** What the human does. */
  readonly rest: (side: Side) => Promise<void>;
  /** What the agent does. */
  readonly mcp: (side: Side, client: Client) => Promise<void>;
  /** Why these two are the same logical action, where it is not obvious. */
  readonly note?: string;
}

const PAIRS: ReadonlyMap<string, Pair> = new Map<string, Pair>([
  [
    'create_task',
    {
      rest: async (s) => {
        await must(s, '/api/v1/projects/core/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: 'A task', priority: 'p1' }),
        });
      },
      mcp: async (_s, c) => {
        await callTool(c, 'create_task', { project: 'core', title: 'A task', priority: 'p1' });
      },
    },
  ],
  [
    'start_working',
    {
      rest: async (s) => {
        const task = await seedTask(s);
        await must(s, `/api/v1/tasks/${task}/claim`, { method: 'POST' }, 200);
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'start_working', { task: 'COR-1' });
      },
    },
  ],
  [
    'update_status',
    {
      rest: async (s) => {
        const task = await seedTask(s);
        await must(
          s,
          `/api/v1/tasks/${task}/status`,
          { method: 'POST', body: JSON.stringify({ status: 'in_progress' }) },
          200,
        );
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'update_status', { task: 'COR-1', status: 'in_progress' });
      },
    },
  ],
  [
    'add_comment',
    {
      rest: async (s) => {
        const task = await seedTask(s);
        await must(s, `/api/v1/tasks/${task}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body_md: 'A remark' }),
        });
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'add_comment', { task: 'COR-1', body: 'A remark' });
      },
    },
  ],
  [
    'finish_task',
    {
      note: 'A **composite** twin. There is no `POST /tasks/:id/finish`, because a human finishing work does two things: moves the task to review, and says what they did. `finish_task` is those two in one transaction (LAI-408), so its twin is the two REST calls in sequence — and this pair is what proves it did not become a third write path.',
      rest: async (s) => {
        const task = await seedTask(s);
        await must(
          s,
          `/api/v1/tasks/${task}/status`,
          { method: 'POST', body: JSON.stringify({ status: 'in_progress' }) },
          200,
        );
        await must(
          s,
          `/api/v1/tasks/${task}/status`,
          { method: 'POST', body: JSON.stringify({ status: 'review' }) },
          200,
        );
        await must(s, `/api/v1/tasks/${task}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body_md: 'Did the thing' }),
        });
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'update_status', { task: 'COR-1', status: 'in_progress' });
        await callTool(c, 'finish_task', { task: 'COR-1', summary: 'Did the thing' });
      },
    },
  ],
  ['list_projects', { rest: readsNothingRest, mcp: readsNothingMcp('list_projects', {}) }],
  ['list_ready_tasks', { rest: readsNothingRest, mcp: readsNothingMcp('list_ready_tasks', {}) }],
  [
    'get_task_context',
    { rest: readsNothingRest, mcp: readsNothingMcp('get_task_context', { task: 'COR-1' }) },
  ],
  [
    'get_project_context',
    { rest: readsNothingRest, mcp: readsNothingMcp('get_project_context', { project: 'core' }) },
  ],
]);

/** One task, so a read tool has something to read. Returns its id. */
async function seedTask(side: Side): Promise<string> {
  const res = await must(side, '/api/v1/projects/core/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'A task', priority: 'p1' }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** A read's twin: the REST read, which must also write nothing. */
async function readsNothingRest(side: Side): Promise<void> {
  await seedTask(side);
  await request(side, '/api/v1/projects');
  await request(side, '/api/v1/projects/core/tasks?ready=true');
  await request(side, '/api/v1/projects/core/context');
}

function readsNothingMcp(tool: string, args: Record<string, unknown>) {
  return async (side: Side, client: Client): Promise<void> => {
    await seedTask(side);
    await callTool(client, tool, args);
  };
}

// ----------------------------------------------------------------- the tests

describe('the pair list is derived from the server, not written down', () => {
  it('covers every tool the server actually registers', async () => {
    // The load-bearing test. A tool added in six months appears in neither map
    // and is named here — nobody has to remember this file exists.
    const side = await makeSide();
    const client = await connect(side);
    const registered = (await client.listTools()).tools.map((t) => t.name);
    await client.close();

    const uncovered = registered.filter(
      (name) => !PAIRS.has(name) && !EXEMPT.has(name) && name !== 'laika_whoami',
    );

    expect(
      uncovered,
      'these MCP tools have neither a REST twin here nor a named exemption',
    ).toEqual([]);
  });

  it('does not list a pair for a tool that no longer exists', async () => {
    // The other direction: a stale pair is a test asserting nothing about a
    // tool that is gone, which reads as coverage and is not.
    const side = await makeSide();
    const client = await connect(side);
    const registered = new Set((await client.listTools()).tools.map((t) => t.name));
    await client.close();

    const stale = [...PAIRS.keys(), ...EXEMPT.keys()].filter((name) => !registered.has(name));
    expect(stale, 'these are listed here but the server registers no such tool').toEqual([]);
  });

  it('exempts exactly one tool, with a reason that cites the decision', () => {
    expect([...EXEMPT.keys()]).toEqual(['log_unlisted_work']);

    const reason = EXEMPT.get('log_unlisted_work') ?? '';
    expect(reason).toContain('D-024');
    expect(reason.length).toBeGreaterThan(80);
  });
});

describe('the exemption self-expires', () => {
  it('fails if a REST twin for log_unlisted_work ever appears', async () => {
    // The shape LAI-052, LAI-080, LAI-043 and LAI-213 all needed: an exemption
    // that survives the condition that justified it is worse than none, because
    // it reads as a decision somebody is still standing behind.
    const side = await makeSide();

    for (const method of ['POST', 'PUT']) {
      const res = await request(side, '/api/v1/unlisted', {
        method,
        body: JSON.stringify({ repo: 'kvell/laika', note: 'via REST' }),
      });

      expect(
        [404, 405],
        `${method} /api/v1/unlisted answered ${String(res.status)} — a REST twin for log_unlisted_work now exists, so remove its entry from EXEMPT and add a pair`,
      ).toContain(res.status);
    }
  });
});

describe('each tool writes what its REST twin writes', () => {
  for (const [tool, pair] of PAIRS) {
    it(`${tool} — identical activity, differing only in attribution`, async () => {
      // Two clean databases, so the comparison is structural rather than a
      // matter of one run happening after the other.
      const viaRest = await makeSide();
      const viaMcp = await makeSide();

      await pair.rest(viaRest);

      const client = await connect(viaMcp);
      await pair.mcp(viaMcp, client);
      await client.close();

      const restEvents = await events(viaRest);
      const mcpEvents = await events(viaMcp);

      expect(
        mcpEvents,
        `${tool} does not write what its REST twin writes${pair.note === undefined ? '' : ` — ${pair.note}`}`,
      ).toEqual(restEvents);
    });
  }
});

describe('attribution is the only thing that differs', () => {
  it('the agent’s rows say agent, the human’s say user', async () => {
    // The counterpart to `normalise` stripping those fields: having removed
    // them from the comparison, something has to assert they are not identical,
    // or the parity tests above would pass on a tool that forgot it was an agent.
    const viaRest = await makeSide();
    const viaMcp = await makeSide();

    await must(viaRest, '/api/v1/projects/core/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'A task' }),
    });

    const client = await connect(viaMcp);
    await callTool(client, 'create_task', { project: 'core', title: 'A task' });
    await client.close();

    const restRow = viaRest.h.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'task.created');
    const mcpRow = viaMcp.h.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'task.created');

    expect(restRow?.actorKind).toBe('user');
    expect(restRow?.actorTokenId).toBeNull();
    expect(mcpRow?.actorKind).toBe('agent');
    expect(mcpRow?.actorTokenId).not.toBeNull();

    // Same person, both times.
    const rest = viaRest.h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get();
    const mcp = viaMcp.h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get();
    expect(restRow?.actorId).toBe(rest?.id);
    expect(mcpRow?.actorId).toBe(mcp?.id);
  });
});

describe('the read tools write nothing at all', () => {
  it('leaves the activity table untouched', async () => {
    const side = await makeSide();
    await seedTask(side);
    const before = rowCount(side);

    const client = await connect(side);
    await callTool(client, 'list_projects', {});
    await callTool(client, 'list_ready_tasks', {});
    await callTool(client, 'get_task_context', { task: 'COR-1' });
    await callTool(client, 'get_project_context', { project: 'core' });
    await client.close();

    expect(rowCount(side)).toBe(before);
  });
});
