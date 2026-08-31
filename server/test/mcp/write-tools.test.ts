import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, comments, tasks } from '../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * The write tools (SPEC §7.1, LAI-408), through a real MCP client.
 *
 * The properties worth proving here are the ones a direct handler call would
 * skip: that `can()` runs as the **token's** user, that a `read_only` token is
 * refused, that an agent's write reaches an open SSE stream, and that the
 * §6.3 code survives to where an agent can branch on it.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let server: ReturnType<typeof serve>;
let baseUrl: URL;

async function setUp(): Promise<string> {
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

async function api(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** A setup call that must succeed (CLAUDE.md §5). */
async function must(path: string, init: RequestInit, expected = 201): Promise<Response> {
  const res = await api(path, init);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

async function mint(body: Record<string, unknown> = {}): Promise<string> {
  const res = await must('/api/v1/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: 'agent', scope: 'full', ...body }),
  });
  return ((await res.json()) as { secret: string }).secret;
}

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function payload(result: ToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

async function project(slug: string, prefix: string): Promise<void> {
  await must('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: slug, slug, prefix }),
  });
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
  });
  await project('core', 'COR');
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  h.close();
});

describe('the tools are registered', () => {
  it('lists the five that have a §3 permission behind them', async () => {
    const client = await connect(await mint());
    const names = (await client.listTools()).tools.map((t) => t.name);

    for (const name of [
      'create_task',
      'start_working',
      'update_status',
      'add_comment',
      'finish_task',
    ]) {
      expect(names, name).toContain(name);
    }

    await client.close();
  });
});

describe('create_task', () => {
  it('creates a task the REST API can see, marked as an agent’s', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'From an agent', priority: 'p1' },
    });

    const task = payload(result).task as { key: string; created_via: string; priority: string };
    expect(task.key).toBe('COR-1');
    expect(task.created_via).toBe('mcp');
    expect(task.priority).toBe('p1');

    // Visible over REST, because there is one write path.
    const rest = (await (await api('/api/v1/projects/core/tasks')).json()) as {
      data: { key: string }[];
    };
    expect(rest.data.map((t) => t.key)).toContain('COR-1');

    await client.close();
  });

  it('links dependencies by key', async () => {
    const client = await connect(await mint());
    await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'Blocker' },
    });

    const result = await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'Blocked', depends_on: ['COR-1'] },
    });

    const task = payload(result).task as { dependencies: string[]; ready: boolean };
    expect(task.dependencies).toHaveLength(1);
    // Derived, not stored: a task with an unfinished blocker is not ready.
    expect(task.ready).toBe(false);

    await client.close();
  });

  it('refuses an array where one task is expected (§7.2 no bulk mutation)', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'T', discovered_from: ['COR-1', 'COR-2'] },
    });

    expect(result.isError).toBe(true);

    await client.close();
  });
});

describe('start_working', () => {
  it('claims a task', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });

    const result = await client.callTool({
      name: 'start_working',
      arguments: { task: 'COR-1' },
    });

    expect((payload(result).task as { status: string }).status).toBe('in_progress');

    await client.close();
  });

  it('fails with conflict naming the current assignee, not a bare error', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });
    await client.callTool({ name: 'start_working', arguments: { task: 'COR-1' } });

    const second = await client.callTool({ name: 'start_working', arguments: { task: 'COR-1' } });

    expect(second.isError).toBe(true);
    // §7.2: an agent must be able to branch on `conflict` rather than parse
    // prose, and must be able to see *who* holds it.
    const text = JSON.stringify(second);
    expect(text).toContain('conflict');
    expect(text).toContain('assignee_id');

    await client.close();
  });
});

describe('update_status', () => {
  it('moves a task and validates the transition against §5', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });

    const ok = await client.callTool({
      name: 'update_status',
      arguments: { task: 'COR-1', status: 'in_progress' },
    });
    expect((payload(ok).task as { status: string }).status).toBe('in_progress');

    // `in_progress -> done` is not in §5's table; the lifecycle module refuses
    // it, and the tool does not get its own opinion about legality.
    const illegal = await client.callTool({
      name: 'update_status',
      arguments: { task: 'COR-1', status: 'done' },
    });
    expect(illegal.isError).toBe(true);
    expect(JSON.stringify(illegal)).toContain('unprocessable');

    await client.close();
  });

  it('posts the note as a comment rather than dropping it', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });

    await client.callTool({
      name: 'update_status',
      arguments: { task: 'COR-1', status: 'in_progress', note: 'Picking this up now' },
    });

    const rows = h.db.select().from(comments).all();
    expect(rows.map((r) => r.bodyMd)).toContain('Picking this up now');

    await client.close();
  });
});

describe('finish_task', () => {
  it('stops at review and posts the summary as a comment', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });
    await client.callTool({ name: 'start_working', arguments: { task: 'COR-1' } });

    const result = await client.callTool({
      name: 'finish_task',
      arguments: { task: 'COR-1', summary: 'Did the thing', checklist: ['tests green'] },
    });

    // **Review, never done.** Agents do not close their own work (§7.2).
    expect((payload(result).task as { status: string }).status).toBe('review');

    const bodies = h.db
      .select()
      .from(comments)
      .all()
      .map((r) => r.bodyMd);
    expect(bodies.some((b) => b.includes('Did the thing'))).toBe(true);
    expect(bodies.some((b) => b.includes('- [x] tests green'))).toBe(true);

    await client.close();
  });

  it('has no way to reach done at all', async () => {
    // Not "refuses done" — the tool takes no status, so `done` is unreachable
    // through it rather than guarded against.
    const client = await connect(await mint());
    const tool = (await client.listTools()).tools.find((t) => t.name === 'finish_task');

    expect(JSON.stringify(tool?.inputSchema)).not.toContain('status');

    await client.close();
  });

  it('refuses to finish a task that was never started', async () => {
    const client = await connect(await mint());
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Work' } });

    // backlog -> review is not a legal §5 transition.
    const result = await client.callTool({
      name: 'finish_task',
      arguments: { task: 'COR-1', summary: 'Never touched it' },
    });

    expect(result.isError).toBe(true);
    // And nothing was written: the comment must not survive the failed move.
    expect(h.db.select().from(comments).all()).toHaveLength(0);

    await client.close();
  });
});

describe('a read_only token is denied every write', () => {
  it('refuses all five', async () => {
    await must('/api/v1/projects/core/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Existing' }),
    });

    const client = await connect(await mint({ scope: 'read_only' }));

    const calls: [string, Record<string, unknown>][] = [
      ['create_task', { project: 'core', title: 'Nope' }],
      ['start_working', { task: 'COR-1' }],
      ['update_status', { task: 'COR-1', status: 'in_progress' }],
      ['add_comment', { task: 'COR-1', body: 'Nope' }],
      ['finish_task', { task: 'COR-1', summary: 'Nope' }],
    ];

    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(JSON.stringify(result), name).toContain('forbidden');
    }

    // And it can still read, so the refusal is about scope and not the token.
    expect((await client.callTool({ name: 'list_projects', arguments: {} })).isError).toBeFalsy();

    await client.close();
  });
});

describe('an agent’s work reaches an open browser (AC9)', () => {
  it('appears on the live SSE stream, not merely in the activity table', async () => {
    // M3's exit criterion. Asserting the `activity` row would pass even if the
    // stream were broken, so this reads the stream itself.
    //
    // It holds because `services/activity-feed.ts` **polls the table** rather
    // than being published to — so a tool's row becomes an event exactly as a
    // route's does. That is a design fact, which is why it is tested rather
    // than assumed.
    const secret = await mint();

    const stream = await fetch(new URL('/api/v1/events?project=core', baseUrl), {
      headers: { Authorization: `Bearer ${secret}`, Accept: 'text/event-stream' },
    });
    expect(stream.status).toBe(200);

    const reader = stream.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();

    const client = await connect(secret);
    await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'Watch me appear' },
    });
    await client.close();

    // Read until the frame arrives or the budget runs out. The feed polls every
    // 250ms by default, so a second is several ticks.
    interface Chunk {
      value: Uint8Array | undefined;
      done: boolean;
    }

    let seen = '';
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !seen.includes('task.created')) {
      // Raced against a timeout so a stream that never delivers fails the
      // assertion rather than hanging the suite until vitest kills it.
      const chunk: Chunk = await Promise.race<Chunk>([
        stream.body!.getReader === undefined
          ? Promise.resolve({ value: undefined, done: true })
          : (reader!.read() as Promise<Chunk>),
        new Promise<Chunk>((resolve) =>
          setTimeout(() => {
            resolve({ value: undefined, done: false });
          }, 500),
        ),
      ]);

      if (chunk.value !== undefined) seen += decoder.decode(chunk.value, { stream: true });
    }

    await reader!.cancel();

    expect(seen).toContain('task.created');
    expect(seen).toContain('Watch me appear');
    // The row an agent wrote says an agent wrote it.
    expect(seen).toContain('"actor_kind":"agent"');
  });
});

describe('the audit trail says an agent did it', () => {
  it('writes the same row a REST call writes, differing only in attribution', async () => {
    const secret = await mint();
    const client = await connect(secret);

    await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'By tool' },
    });
    await client.close();

    await must('/api/v1/projects/core/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'By route' }),
    });

    const rows = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'task.created');

    expect(rows).toHaveLength(2);

    const byTool = rows.find((r) => r.payloadJson.includes('By tool'));
    const byRoute = rows.find((r) => r.payloadJson.includes('By route'));

    expect(byTool?.actorKind).toBe('agent');
    expect(byTool?.actorTokenId).not.toBeNull();
    expect(byRoute?.actorKind).toBe('user');
    expect(byRoute?.actorTokenId).toBeNull();

    // Same person either way.
    expect(byTool?.actorId).toBe(byRoute?.actorId);
    expect(byTool?.projectId).toBe(byRoute?.projectId);
  });

  it('leaves no task behind when a write is refused', async () => {
    const client = await connect(await mint({ scope: 'read_only' }));
    await client.callTool({ name: 'create_task', arguments: { project: 'core', title: 'Nope' } });
    await client.close();

    expect(h.db.select().from(tasks).where(eq(tasks.title, 'Nope')).all()).toHaveLength(0);
  });
});

describe('log_unlisted_work — the one tool with no REST twin (D-024)', () => {
  it('records a note against the token’s user and the token', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'log_unlisted_work',
      arguments: { repo: 'kvell/laika', note: 'The deploy script assumes bash 5' },
    });

    const logged = payload(result).unlisted as {
      repo: string;
      note: string;
      user_id: string;
      token_id: string | null;
    };

    expect(logged.repo).toBe('kvell/laika');
    expect(logged.note).toBe('The deploy script assumes bash 5');
    // §4.14 has a `token_id` column and nothing was filling it. Triage wants to
    // know *which* agent session noticed something.
    expect(logged.token_id).not.toBeNull();

    await client.close();
  });

  it('is visible to the humans’ triage endpoint', async () => {
    // The point of D-024: the tool has no REST twin for *writing*, but the pile
    // it writes into is read and acted on over REST. If those two disagreed the
    // note would be recorded and unreachable.
    const client = await connect(await mint());
    await client.callTool({
      name: 'log_unlisted_work',
      arguments: { repo: 'kvell/laika', note: 'Noticed in passing' },
    });
    await client.close();

    const pile = (await (await api('/api/v1/unlisted')).json()) as {
      data: { note: string }[];
    };
    expect(pile.data.map((r) => r.note)).toContain('Noticed in passing');
  });

  it('writes one org-scoped activity row', async () => {
    const client = await connect(await mint());
    await client.callTool({
      name: 'log_unlisted_work',
      arguments: { repo: 'kvell/laika', note: 'A note' },
    });
    await client.close();

    const rows = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'unlisted.logged');

    expect(rows).toHaveLength(1);
    // §3.1 names `unlisted.logged` among the `project_id IS NULL` audit rows,
    // which is what routes reading it to the audit-log cell.
    expect(rows[0]?.projectId).toBeNull();
    expect(rows[0]?.actorKind).toBe('agent');
  });

  it('is refused to a read_only token, though the role allows it', async () => {
    // §3.1's new row is ✓ for every role — the restriction is the credential.
    const client = await connect(await mint({ scope: 'read_only' }));

    const result = await client.callTool({
      name: 'log_unlisted_work',
      arguments: { repo: 'kvell/laika', note: 'Nope' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('forbidden');

    await client.close();
  });

  it('has no REST twin, deliberately', async () => {
    // D-024, asserted so that adding one is a decision someone makes on purpose
    // rather than a gap somebody fills to look consistent. §7.2 names this tool
    // as the one exempt from §13.3's parity pairs.
    for (const method of ['POST', 'PUT']) {
      const res = await api('/api/v1/unlisted', {
        method,
        body: JSON.stringify({ repo: 'kvell/laika', note: 'via REST' }),
      });

      expect([404, 405], `${method} /unlisted`).toContain(res.status);
    }
  });
});
