import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { activity, timeDrafts, timeEntries, users } from '../../src/db/schema.ts';
import { applyCheckpointDelivery } from '../../src/services/checkpoints.ts';
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

/** `docs/`, resolved from this module rather than from `process.cwd()`. */
const SPEC_DIR = fileURLToPath(new URL('../../../docs', import.meta.url));

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

/**
 * What a case that builds a side may take (LAI-768). A side is a database
 * migrated from nothing, an owner set up through better-auth, a token and a
 * project, and most cases build two: setup, not the property, is what a slow
 * runner pays for. Measured on 2026-10-20 — 90 to 210 ms a case at normal load,
 * 1.0 to 5.2 s under one `yes` per core, where `set_task_sprint` failed on
 * vitest's 5 s default at 5183 ms, as `create_task` had in a loaded gate on
 * 17 Oct. 30 s is nearly 6× the slowest.
 */
const SIDE_BUDGET_MS = 30_000;

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
    // `expires_at` is a clock time like `created_at`: an offer's (LAI-546).
    if (['id', 'seq', 'created_at', 'expires_at', 'actor_kind', 'actor_token_id'].includes(key))
      continue;
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
    'agent_sync',
    {
      note: 'Its twin is `GET /agents/me/inbox` (§6.4, LAI-546). A read on both sides: the setup writes, the read writes nothing.',
      rest: async (s) => {
        const ready = await handoffReady(s);
        await offerOverRest(s, ready);
        const res = await s.h.app.request('/api/v1/agents/me/inbox', {
          headers: jsonHeaders({ Authorization: `Bearer ${ready.receiver}` }),
        });
        expect(res.status, await res.clone().text()).toBe(200);
      },
      mcp: async (s) => {
        const ready = await handoffReady(s);
        await offerOverRest(s, ready);
        const agent = await connectAs(s, ready.receiver);
        await callTool(agent, 'agent_sync', {});
        await agent.close();
      },
    },
  ],
  [
    'offer_handoff',
    {
      note: 'Its twin is `POST /tasks/:id/handoff-offers` (§6.4, LAI-546). Both halves are the registered agent holding the claim, as `checkpoint_task`’s are.',
      rest: async (s) => {
        await offerOverRest(s, await handoffReady(s));
      },
      mcp: async (s) => {
        const ready = await handoffReady(s);
        const agent = await connectAs(s, ready.secret);
        await callTool(agent, 'offer_handoff', {
          task: 'COR-1',
          to_agent: ready.receiverId,
          checkpoint: CHECKPOINT.id,
          reason: 'Out of context',
          idempotency_key: 'parity-offer',
          claim_generation: ready.generation,
        });
        await agent.close();
      },
    },
  ],
  [
    'respond_handoff',
    {
      note: 'Its twins are `POST /handoff-offers/:id/accept`, `/decline` and `/cancel` (§6.4, LAI-546); the pair is the accept, the receiving agent on both sides.',
      rest: async (s) => {
        const ready = await handoffReady(s);
        const offer = await offerOverRest(s, ready);
        const res = await s.h.app.request(`/api/v1/handoff-offers/${offer}/accept`, {
          method: 'POST',
          headers: jsonHeaders({ Authorization: `Bearer ${ready.receiver}` }),
          body: JSON.stringify({ verified_commit_sha: CHECKPOINT.commit_sha }),
        });
        expect(res.status, await res.clone().text()).toBe(200);
      },
      mcp: async (s) => {
        const ready = await handoffReady(s);
        const offer = await offerOverRest(s, ready);
        const agent = await connectAs(s, ready.receiver);
        await callTool(agent, 'respond_handoff', {
          offer,
          action: 'accept',
          verified_commit_sha: CHECKPOINT.commit_sha,
        });
        await agent.close();
      },
    },
  ],
  [
    'checkpoint_task',
    {
      note: 'Its twin is `POST /tasks/:id/checkpoints` (§6.4, LAI-545). **Both halves are the registered agent**, not the person: §3.2 makes saving an agent’s act, so a person’s REST call is `not_an_agent` and there is no human half to mirror. The pair still proves the one thing it exists for — the route and the tool are one write path — and the attribution check below is about the pairs a person can make.',
      rest: async (s) => {
        const held = await agentHolding(s);
        const res = await s.h.app.request(`/api/v1/tasks/${held.task}/checkpoints`, {
          method: 'POST',
          headers: jsonHeaders({
            Authorization: `Bearer ${held.secret}`,
            'X-Laika-Claim-Generation': String(held.generation),
          }),
          body: JSON.stringify(CHECKPOINT),
        });
        expect(res.status, await res.clone().text()).toBe(201);
      },
      mcp: async (s) => {
        const held = await agentHolding(s);
        const agent = await connectAs(s, held.secret);
        await callTool(agent, 'checkpoint_task', {
          task: 'COR-1',
          ...CHECKPOINT,
          claim_generation: held.generation,
        });
        await agent.close();
      },
    },
  ],
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
      note: 'Its twin is `POST /tasks/:id/finish` (LAI-758, D-082), added when a finish began to carry proof: the move to review, the summary comment and the round in one transaction on both surfaces. Before it, the twin was a status call and a comment call in sequence, and this pair is what proves the route did not become a third write path.',
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
          `/api/v1/tasks/${task}/finish`,
          {
            method: 'POST',
            body: JSON.stringify({
              summary: 'Did the thing',
              tests: [{ command: 'pnpm test', exit_code: 0 }],
            }),
          },
          200,
        );
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'update_status', { task: 'COR-1', status: 'in_progress' });
        await callTool(c, 'finish_task', {
          task: 'COR-1',
          summary: 'Did the thing',
          tests: [{ command: 'pnpm test', exit_code: 0 }],
        });
      },
    },
  ],
  [
    'propose_time_entry',
    {
      note: 'Its twin is `POST /me/time-drafts` (LAI-787, D-088 item 13): an agent proposes time into its person’s private drafts, through the one service a person’s own proposal uses. Neither writes an `activity` row — time never reaches the feed — so each half also asserts the draft it made, or the comparison of two empty feeds would prove nothing.',
      rest: async (s) => {
        await seedTask(s);
        await draftingOn(s);
        await must(s, '/api/v1/me/time-drafts', {
          method: 'POST',
          body: JSON.stringify({ minutes: 25, task: 'COR-1', tz: 'UTC', note: 'Review' }),
        });
        expectOneProposal(s);
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await draftingOn(s);
        await callTool(c, 'propose_time_entry', { minutes: 25, task: 'COR-1', note: 'Review' });
        expectOneProposal(s);
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
  [
    'laika_whoami',
    {
      // Its twin is `GET /api/v1/me` specifically, not the generic read triple:
      // both answer "who is this credential acting as", and both must write
      // nothing. Paired rather than exempted (LAI-433) because a pair is
      // **tested** where an exemption is only excused — and the thing worth
      // testing about a read tool is exactly that it stays a read.
      rest: async (s) => {
        // Same seed as the MCP half: the comparison is between the two *reads*,
        // so both databases must start from the same rows or the diff is the
        // setup rather than the tools.
        await seedTask(s);
        await request(s, '/api/v1/me');
      },
      mcp: readsNothingMcp('laika_whoami', {}),
      note: 'both answer "who am I" and neither writes anything',
    },
  ],

  // ------------------------------------------------- the LAI-611 tools
  [
    'create_sprint',
    {
      note: 'The MCP tool takes `2026-01-01` where the route takes unix-ms — §4.15 gives sprint dates date-only semantics, so the tool spells the field `start_date`. Both reach `createSprint` with the same integer, which is what makes this pair a comparison of the write rather than of the parsing.',
      rest: async (s) => {
        await must(s, '/api/v1/projects/core/sprints', {
          method: 'POST',
          body: JSON.stringify({ name: 'Sprint 1', starts_on: JAN1, ends_on: JAN14 }),
        });
      },
      mcp: async (_s, c) => {
        await callTool(c, 'create_sprint', {
          project: 'core',
          name: 'Sprint 1',
          start_date: '2026-01-01',
          end_date: '2026-01-14',
        });
      },
    },
  ],
  [
    'update_sprint',
    {
      // The sprint is created over REST on **both** sides, so the only thing
      // the comparison is left looking at is the edit.
      rest: async (s) => {
        const sprint = await seedSprint(s);
        await must(
          s,
          `/api/v1/sprints/${sprint}`,
          { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) },
          200,
        );
      },
      mcp: async (s, c) => {
        const sprint = await seedSprint(s);
        await callTool(c, 'update_sprint', { sprint, name: 'Renamed' });
      },
    },
  ],
  [
    'set_task_sprint',
    {
      note: 'Its twin is `POST /sprints/:id/tasks` with a single id. The route takes an array because a human dragging a selection moves several at once; §7.2 forbids a tool bulk-mutating, so the tool takes one — the same service call either way.',
      rest: async (s) => {
        const task = await seedTask(s);
        const sprint = await seedSprint(s);
        await must(
          s,
          `/api/v1/sprints/${sprint}/tasks`,
          { method: 'POST', body: JSON.stringify({ task_ids: [task] }) },
          200,
        );
      },
      mcp: async (s, c) => {
        await seedTask(s);
        const sprint = await seedSprint(s);
        await callTool(c, 'set_task_sprint', { task: 'COR-1', sprint });
      },
    },
  ],
  [
    'update_task',
    {
      rest: async (s) => {
        const task = await seedTask(s);
        await must(
          s,
          `/api/v1/tasks/${task}`,
          { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) },
          200,
        );
      },
      mcp: async (s, c) => {
        await seedTask(s);
        await callTool(c, 'update_task', { task: 'COR-1', title: 'Renamed' });
      },
    },
  ],
  [
    'update_project_context',
    {
      note: '`mode: replace` is the twin of `PATCH /projects/:slug/context`, which takes a whole document. `append` has no REST twin because it is a read-then-write the human does in their editor.',
      rest: async (s) => {
        await must(
          s,
          '/api/v1/projects/core/context',
          { method: 'PATCH', body: JSON.stringify({ context_md: 'A brief' }) },
          200,
        );
      },
      mcp: async (_s, c) => {
        await callTool(c, 'update_project_context', {
          project: 'core',
          context_md: 'A brief',
          mode: 'replace',
        });
      },
    },
  ],
  [
    'list_sprints',
    { rest: readsNothingRest, mcp: readsNothingMcp('list_sprints', { project: 'core' }) },
  ],
  [
    'list_members',
    { rest: readsNothingRest, mcp: readsNothingMcp('list_members', { project: 'core' }) },
  ],
]);

/** January 2026, so a date in a fixture reads as a date. */
const JAN1 = Date.UTC(2026, 0, 1);
const JAN14 = Date.UTC(2026, 0, 14);

/** One sprint over REST, so a tool under test is the only thing being measured. */
async function seedSprint(side: Side): Promise<string> {
  const res = await must(side, '/api/v1/projects/core/sprints', {
    method: 'POST',
    body: JSON.stringify({ name: 'Sprint 1', starts_on: JAN1, ends_on: JAN14 }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** One task, so a read tool has something to read. Returns its id. */
async function seedTask(side: Side): Promise<string> {
  const res = await must(side, '/api/v1/projects/core/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'A task', priority: 'p1' }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** One save, the same on both sides (§4.68): names and counts only. */
const CHECKPOINT = {
  id: '01JCPAR1TYSAVE0000000000XX',
  idempotency_key: 'parity-save',
  repo: 'kvelld/laika',
  branch: 'COR-1-work',
  commit_sha: 'c'.repeat(40),
  manifest: [{ path: 'src/a.ts', added: 3, removed: 1 }],
  summary: { work_done: 'Half of it', next_step: 'The rest', failing: 'a.test.ts' },
  summary_commit_sha: 'c'.repeat(40),
};

/**
 * A registered agent of the side's person, holding COR-1's live claim in a
 * project whose configured repo is the save's — what a save needs (§4.68).
 * Every step asserts its status, so a broken setup fails here and not as a
 * parity difference.
 */
async function agentHolding(
  side: Side,
): Promise<{ secret: string; task: string; generation: number }> {
  await must(
    side,
    '/api/v1/projects/core',
    { method: 'PATCH', body: JSON.stringify({ repo: 'kvelld/laika' }) },
    200,
  );
  const project = (await (
    await must(side, '/api/v1/projects/core', { method: 'GET' }, 200)
  ).json()) as {
    id: string;
  };
  const registered = (await (
    await must(side, '/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify({
        display_name: 'Parity agent',
        harness: 'codex',
        grants: [{ project_id: project.id, scope: 'full' }],
      }),
    })
  ).json()) as { secret: string };
  const task = await seedTask(side);
  const claimed = await side.h.app.request(`/api/v1/tasks/${task}/claim`, {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${registered.secret}` }),
  });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  const generation = Number(claimed.headers.get('X-Laika-Claim-Generation'));
  expect(generation).toBe(1);
  return { secret: registered.secret, task, generation };
}

/**
 * The holder of COR-1 with a **verified** checkpoint and a second agent of
 * the same person to receive it (§4.71). The delivery is applied through the
 * service, as the signed webhook would (§10.1) — what is under test here is
 * the offer, not the signature.
 */
async function handoffReady(side: Side): Promise<{
  secret: string;
  task: string;
  generation: number;
  receiver: string;
  receiverId: string;
}> {
  const held = await agentHolding(side);
  const saved = await side.h.app.request(`/api/v1/tasks/${held.task}/checkpoints`, {
    method: 'POST',
    headers: jsonHeaders({
      Authorization: `Bearer ${held.secret}`,
      'X-Laika-Claim-Generation': String(held.generation),
    }),
    body: JSON.stringify(CHECKPOINT),
  });
  expect(saved.status, await saved.clone().text()).toBe(201);
  const { remote_ref } = (await saved.json()) as { remote_ref: string };
  const outcome = applyCheckpointDelivery(
    side.h.t.sqlite,
    side.h.db,
    {
      deliveryId: 'parity-delivery',
      repo: 'kvelld/laika',
      ref: remote_ref,
      before: '0'.repeat(40),
      after: CHECKPOINT.commit_sha,
    },
    Date.now(),
  );
  expect(outcome.state).toBe('verified');
  const project = (await (
    await must(side, '/api/v1/projects/core', { method: 'GET' }, 200)
  ).json()) as { id: string };
  const receiver = (await (
    await must(side, '/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify({
        display_name: 'Parity receiver',
        harness: 'claude-code',
        grants: [{ project_id: project.id, scope: 'full' }],
      }),
    })
  ).json()) as { secret: string; agent: { id: string } };
  return { ...held, receiver: receiver.secret, receiverId: receiver.agent.id };
}

/** The holder offers COR-1 to the receiver over REST; the offer's id. */
async function offerOverRest(
  side: Side,
  ready: Awaited<ReturnType<typeof handoffReady>>,
): Promise<string> {
  const res = await side.h.app.request(`/api/v1/tasks/${ready.task}/handoff-offers`, {
    method: 'POST',
    headers: jsonHeaders({
      Authorization: `Bearer ${ready.secret}`,
      'X-Laika-Claim-Generation': String(ready.generation),
    }),
    body: JSON.stringify({
      idempotency_key: 'parity-offer',
      to_agent_id: ready.receiverId,
      checkpoint_id: CHECKPOINT.id,
      reason: 'Out of context',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** An MCP client on a credential other than the side's own token. */
async function connectAs(side: Side, secret: string): Promise<Client> {
  const client = new Client({ name: 'parity-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', side.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

/** Both of time's switches on for the side's person (LAI-787). */
async function draftingOn(side: Side): Promise<void> {
  await must(side, '/api/v1/org/time', { method: 'PUT', body: '{"mode":"drafts"}' }, 200);
  await must(
    side,
    '/api/v1/me/time-settings',
    { method: 'PUT', body: '{"draft_my_time":true}' },
    200,
  );
}

/** Exactly one agent proposal of 25 minutes on the side's task, and no entry. */
function expectOneProposal(side: Side): void {
  const drafts = side.h.db.select().from(timeDrafts).all();
  expect(drafts.map((d) => [d.source, d.minutes, d.taskId !== null])).toEqual([
    ['agent', 25, true],
  ]);
  expect(side.h.db.select().from(timeEntries).all()).toEqual([]);
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
  it('covers every tool the server actually registers', { timeout: SIDE_BUDGET_MS }, async () => {
    // The load-bearing test. A tool added in six months appears in neither map
    // and is named here — nobody has to remember this file exists.
    const side = await makeSide();
    const client = await connect(side);
    const registered = (await client.listTools()).tools.map((t) => t.name);
    await client.close();

    const uncovered = registered.filter(
      // No inline carve-out. `laika_whoami` used to be excluded by a
      // `name !== '…'` on this line, next to an `EXEMPT` set it did not use —
      // and an inline comparison is audited by nobody, where a named entry can
      // be found, counted and challenged (LAI-433).
      (name) => !PAIRS.has(name) && !EXEMPT.has(name),
    );

    expect(
      uncovered,
      'these MCP tools have neither a REST twin here nor a named exemption',
    ).toEqual([]);
  });

  it(
    'does not list a pair for a tool that no longer exists',
    { timeout: SIDE_BUDGET_MS },
    async () => {
      // The other direction: a stale pair is a test asserting nothing about a
      // tool that is gone, which reads as coverage and is not.
      const side = await makeSide();
      const client = await connect(side);
      const registered = new Set((await client.listTools()).tools.map((t) => t.name));
      await client.close();

      const stale = [...PAIRS.keys(), ...EXEMPT.keys()].filter((name) => !registered.has(name));
      expect(stale, 'these are listed here but the server registers no such tool').toEqual([]);
    },
  );

  it('exempts exactly one tool, with a reason that cites the decision', () => {
    expect([...EXEMPT.keys()]).toEqual(['log_unlisted_work']);

    const reason = EXEMPT.get('log_unlisted_work') ?? '';
    expect(reason).toContain('D-024');
    expect(reason.length).toBeGreaterThan(80);
  });
});

describe('the exemption self-expires', () => {
  it(
    'fails if a REST twin for log_unlisted_work ever appears',
    { timeout: SIDE_BUDGET_MS },
    async () => {
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
    },
  );
});

describe('each tool writes what its REST twin writes', () => {
  for (const [tool, pair] of PAIRS) {
    it(
      `${tool} — identical activity, differing only in attribution`,
      { timeout: SIDE_BUDGET_MS },
      async () => {
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
      },
    );
  }
});

describe('checkpoint_task and its twin read an explicit null alike (LAI-545)', () => {
  it(
    'both accept summary and summary_commit_sha as null, and write the same row',
    { timeout: SIDE_BUDGET_MS },
    async () => {
      const save = { ...CHECKPOINT, summary: null, summary_commit_sha: null };
      const viaRest = await makeSide();
      const viaMcp = await makeSide();

      const restHeld = await agentHolding(viaRest);
      const res = await viaRest.h.app.request(`/api/v1/tasks/${restHeld.task}/checkpoints`, {
        method: 'POST',
        headers: jsonHeaders({
          Authorization: `Bearer ${restHeld.secret}`,
          'X-Laika-Claim-Generation': String(restHeld.generation),
        }),
        body: JSON.stringify(save),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      expect(((await res.json()) as { summary: unknown }).summary).toBeNull();

      const mcpHeld = await agentHolding(viaMcp);
      const agent = await connectAs(viaMcp, mcpHeld.secret);
      const result = await agent.callTool({
        name: 'checkpoint_task',
        arguments: { task: 'COR-1', ...save, claim_generation: mcpHeld.generation },
      });
      await agent.close();
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      expect(
        (result.structuredContent as { checkpoint: { summary: unknown } }).checkpoint.summary,
      ).toBeNull();

      expect(await events(viaMcp)).toEqual(await events(viaRest));
    },
  );
});

describe('attribution is the only thing that differs', () => {
  it('the agent’s rows say agent, the human’s say user', { timeout: SIDE_BUDGET_MS }, async () => {
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
  it('leaves the activity table untouched', { timeout: SIDE_BUDGET_MS }, async () => {
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

/**
 * §7.1's table against the tools the server registers (LAI-433).
 *
 * The count has been wrong in three places at once — the ROADMAP said eight,
 * LAI-419's AC4 said eight, §7.1 lists ten, and the server serves eleven. Three
 * documents disagreeing about a number nobody was comparing.
 *
 * **Names, not just the count.** A count agrees by accident the moment one tool
 * is added and another renamed, and it is the accident this file exists to stop:
 * `PAIRS` and `EXEMPT` are derived from the running server precisely so nothing
 * has to be remembered, and §7.1 was the one list still written down.
 */
describe('§7.1 lists the tools the server actually serves', () => {
  /** §7.1's table, read as the tool column of every row. */
  function specTools(): string[] {
    const spec = readFileSync(join(SPEC_DIR, 'SPEC.md'), 'utf8');
    const section = spec.slice(spec.indexOf('### 7.1 Tools'), spec.indexOf('### 7.2'));
    const rows = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]!);

    expect(rows.length, 'could not parse §7.1’s tool table').toBeGreaterThan(5);
    return rows.sort();
  }

  it(
    'names exactly the registered tools, in neither direction short',
    { timeout: SIDE_BUDGET_MS },
    async () => {
      const side = await makeSide();
      const client = await connect(side);
      const registered = (await client.listTools()).tools.map((t) => t.name).sort();
      await client.close();

      // Both directions in one assertion: a tool §7.1 lists and the server does
      // not serve is as wrong as the reverse, and `toEqual` on sorted names says
      // which without anybody having to count.
      expect(registered).toEqual(specTools());
    },
  );

  it('agrees with §7.2 about which tool has no REST twin', () => {
    // §7.2 names the exempt tool and counts nothing (LAI-546): a count of the
    // twinned tools — "nine", then "eighteen" — went stale every time the
    // surface grew. Every other registered tool is held to a pair above.
    const spec = readFileSync(join(SPEC_DIR, 'SPEC.md'), 'utf8');
    const section = spec.slice(spec.indexOf('### 7.2 Tool contract'), spec.indexOf('### 7.3'));
    const named = [...section.matchAll(/\*\*`([a-z_]+)` is the one tool with no REST twin/g)].map(
      (m) => m[1]!,
    );

    expect(named, '§7.2 no longer names the tool with no REST twin').not.toEqual([]);
    expect(named).toEqual([...EXEMPT.keys()]);
    expect(section, '§7.2 states a count of twinned tools again').not.toMatch(
      /cover the [a-z]+ tools that have twins/,
    );
  });
});

/**
 * The public README says what the server serves, by name (LAI-744).
 *
 * Its badge read `MCP-20 tools` while the registry held 18. **The badge
 * carries no count** — a number typed by hand rots the day the surface
 * changes (CLAUDE.md §2) — and the *MCP tools* table is held to the registry
 * by name, both directions, like §7.1 above.
 */
describe('the README names the tools the server serves (LAI-744)', () => {
  const readme = (): string => readFileSync(join(SPEC_DIR, '..', 'README.md'), 'utf8');

  it(
    'lists exactly the registered tools in its MCP tools table',
    { timeout: SIDE_BUDGET_MS },
    async () => {
      const text = readme();
      const start = text.indexOf('## 🧰 MCP tools');
      expect(start, 'the README has no MCP tools section').toBeGreaterThan(-1);
      const section = text.slice(start, text.indexOf('\n---', start));
      const listed = [...new Set([...section.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!))].sort();

      const side = await makeSide();
      const client = await connect(side);
      const registered = (await client.listTools()).tools.map((t) => t.name).sort();
      await client.close();

      expect(listed).toEqual(registered);
    },
  );

  it('puts no number on the MCP badge', () => {
    const badge = /img\.shields\.io\/badge\/MCP-([^)\s]*)/.exec(readme());
    expect(badge, 'the README has no MCP badge').not.toBeNull();
    expect(badge?.[1]).not.toMatch(/\d/);
  });
});
