import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, tasks } from '../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders, signUp } from '../helpers/auth.ts';

/**
 * The project-management tools (LAI-611), through a real MCP client.
 *
 * §7.1's work loop — claim, comment, move, finish — left an agent unable to do
 * anything a lead does: open a sprint, edit a task after filing it, hand work to
 * somebody, write the project brief. These are those, and the properties worth
 * proving are the ones a direct handler call would skip: that `can()` runs as
 * the **token's** user, that a `read_only` token is refused every one of them,
 * that the §6.3 `code` survives to where an agent can branch on it, and that
 * none of this opened a second way to reach `done`.
 */

const PASSWORD = 'correct-horse-battery-staple';

/** January 2026, so a date in a test reads as a date. */
const DAY = 86_400_000;
const jan = (n: number): number => Date.UTC(2026, 0, 1) + (n - 1) * DAY;

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

/**
 * A setup call that must succeed (CLAUDE.md §5).
 *
 * Every REST write below goes through this. A fixture that posts the wrong field
 * name gets a `422` the route is right to send, and a bare `await api(...)`
 * would let the tests that follow assert against state that was never built.
 */
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

/** A tool call that must succeed, returning its structured payload. */
async function ok(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

/**
 * A tool call that must be refused, returning the §6.3 envelope.
 *
 * The envelope, not the prose: §7.2 wants an agent branching on `conflict`
 * versus `forbidden`, and every assertion below names the code. A bare
 * "it errored" would be satisfied by a broken fixture.
 */
async function refused(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ErrorBody['error']> {
  const result: ToolResult = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} was expected to fail`).toBe(true);

  const body = result.structuredContent as ErrorBody;
  expect(
    body.error,
    `${name}: no §6.3 envelope in ${JSON.stringify(result.content)}`,
  ).toBeDefined();
  return body.error;
}

async function project(slug = 'core', prefix = 'COR'): Promise<void> {
  await must('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: slug, slug, prefix }),
  });
}

/** A second person on the project, so assignment has somewhere to go. */
async function member(email = 'brin@example.test'): Promise<string> {
  const invited = await must('/api/v1/invites', {
    method: 'POST',
    body: JSON.stringify({ email, org_role: 'member' }),
  });
  const { token } = (await invited.json()) as { token: string };

  // `inviteToken`, not `invite_token`: better-auth reads the sign-up body, and
  // this Laika is invite-only, so the snake_case spelling is a `403` rather
  // than a silently unprivileged user.
  const signed = await signUp(h.app, {
    email,
    password: PASSWORD,
    name: 'Brin',
    inviteToken: token,
  });
  expect(signed.status, await signed.clone().text()).toBe(200);

  const people = (await (await api('/api/v1/users')).json()) as {
    data: { id: string; email: string }[];
  };
  const found = people.data.find((u) => u.email === email);
  expect(found, `no user with email ${email} after sign-up`).toBeDefined();

  await must('/api/v1/projects/core/members', {
    method: 'POST',
    body: JSON.stringify({ user_id: found!.id, role: 'member' }),
  });

  return found!.id;
}

/** One task over REST, so the tools under test are the only thing being measured. */
async function seedTask(title = 'A task'): Promise<string> {
  const res = await must('/api/v1/projects/core/tasks', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
  });
  await project();
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
  it('serves all seven', async () => {
    const client = await connect(await mint());
    const names = (await client.listTools()).tools.map((t) => t.name);

    for (const name of [
      'create_sprint',
      'update_sprint',
      'list_sprints',
      'set_task_sprint',
      'update_task',
      'list_members',
      'update_project_context',
    ]) {
      expect(names, name).toContain(name);
    }

    await client.close();
  });
});

describe('create_sprint', () => {
  it('takes dates a person would write, and the REST API sees the sprint', async () => {
    const client = await connect(await mint());

    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        goal: 'Ship the board',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string; name: string; starts_on: number; status: string };

    expect(sprint.name).toBe('Sprint 1');
    expect(sprint.starts_on).toBe(jan(1));
    // §4.15's default, not one this tool invented.
    expect(sprint.status).toBe('planned');

    const rest = (await (await api('/api/v1/projects/core/sprints')).json()) as {
      data: { id: string; goal: string }[];
    };
    expect(rest.data.map((s) => s.id)).toContain(sprint.id);
    expect(rest.data[0]?.goal).toBe('Ship the board');

    await client.close();
  });

  it('accepts unix-ms as well, and stores the same instant', async () => {
    const client = await connect(await mint());

    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'By number',
        start_date: jan(1),
        end_date: jan(14),
      })
    ).sprint as { starts_on: number; ends_on: number };

    expect(sprint.starts_on).toBe(jan(1));
    expect(sprint.ends_on).toBe(jan(14));

    await client.close();
  });

  it('refuses a date that is not a real date, naming the field', async () => {
    // The case the regex cannot catch and `Date.parse` does not either:
    // `2026-02-31` parses happily to the 3rd of March. Measured, not assumed —
    // it is the reason `toTimestamp` compares the date back out.
    const client = await connect(await mint());

    const error = await refused(client, 'create_sprint', {
      project: 'core',
      name: 'Nope',
      start_date: '2026-02-31',
      end_date: '2026-03-14',
    });

    expect(error.code).toBe('unprocessable');
    expect(error.details?.field).toBe('start_date');
    expect(error.details?.value).toBe('2026-02-31');

    // And nothing was created — a refusal that half-applied would be worse than
    // the typo.
    const rest = (await (await api('/api/v1/projects/core/sprints')).json()) as { data: unknown[] };
    expect(rest.data).toHaveLength(0);

    await client.close();
  });

  it('refuses a malformed date at the schema, before a handler sees it', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'create_sprint',
      arguments: {
        project: 'core',
        name: 'Nope',
        start_date: 'next tuesday',
        end_date: '2026-03-14',
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('YYYY-MM-DD');

    await client.close();
  });

  it('passes §4.15’s overlap rule through as conflict, naming the sprint it hit', async () => {
    const client = await connect(await mint());
    await ok(client, 'create_sprint', {
      project: 'core',
      name: 'Sprint 1',
      start_date: '2026-01-01',
      end_date: '2026-01-14',
    });

    const error = await refused(client, 'create_sprint', {
      project: 'core',
      name: 'Sprint 2',
      start_date: '2026-01-10',
      end_date: '2026-01-24',
    });

    // The service's rule, surfaced as-is: an agent branches on the code and
    // reads which sprint it collided with out of the details.
    expect(error.code).toBe('conflict');
    expect(error.details?.name).toBe('Sprint 1');

    await client.close();
  });
});

describe('update_sprint', () => {
  it('renames, re-goals and activates', async () => {
    const client = await connect(await mint());
    const created = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };

    const updated = (
      await ok(client, 'update_sprint', {
        sprint: created.id,
        name: 'Sprint one',
        goal: 'A goal',
        status: 'active',
      })
    ).sprint as { name: string; goal: string; status: string };

    expect(updated.name).toBe('Sprint one');
    expect(updated.goal).toBe('A goal');
    expect(updated.status).toBe('active');

    await client.close();
  });

  it('completing a sprint leaves its tasks exactly where they are (§4.15, D-013)', async () => {
    const client = await connect(await mint());
    const id = await seedTask();
    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };

    await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: sprint.id });
    await ok(client, 'update_sprint', { sprint: sprint.id, status: 'completed' });

    const after = (await ok(client, 'get_task_context', { task: 'COR-1' })).task as {
      sprint_id: string | null;
      status: string;
    };
    // Unfinished work stays unfinished and stays in the sprint. This is the
    // absence of a branch in the service, which is why it is asserted rather
    // than assumed.
    expect(after.sprint_id).toBe(sprint.id);
    expect(after.status).toBe('backlog');
    expect(
      h.db
        .select()
        .from(tasks)
        .all()
        .find((t) => t.id === id)?.sprintId,
    ).toBe(sprint.id);

    await client.close();
  });

  it('404s an unknown sprint rather than inventing one', async () => {
    const client = await connect(await mint());

    const error = await refused(client, 'update_sprint', {
      sprint: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      name: 'Ghost',
    });
    expect(error.code).toBe('not_found');

    await client.close();
  });
});

describe('list_sprints', () => {
  it('returns dates, status and counts that are per-sprint, not per-project', async () => {
    const client = await connect(await mint());
    await seedTask('One');
    await seedTask('Two');
    await seedTask('Three');

    const first = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };
    const second = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 2',
        start_date: '2026-01-15',
        end_date: '2026-01-28',
      })
    ).sprint as { id: string };

    await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: first.id });
    await ok(client, 'set_task_sprint', { task: 'COR-2', sprint: first.id });
    await ok(client, 'set_task_sprint', { task: 'COR-3', sprint: second.id });

    const listed = (await ok(client, 'list_sprints', { project: 'core' })).sprints as {
      id: string;
      name: string;
      starts_on: number;
      status: string;
      task_counts: { total: number; by_status: Record<string, number> };
    }[];

    // Chronological, because a sprint list is a calendar.
    expect(listed.map((s) => s.name)).toEqual(['Sprint 1', 'Sprint 2']);
    expect(listed[0]?.starts_on).toBe(jan(1));
    expect(listed[0]?.status).toBe('planned');
    expect(listed[0]?.task_counts.total).toBe(2);
    expect(listed[0]?.task_counts.by_status.backlog).toBe(2);
    expect(listed[1]?.task_counts.total).toBe(1);

    await client.close();
  });

  it('says so plainly when a project has none', async () => {
    const client = await connect(await mint());
    const result = await client.callTool({ name: 'list_sprints', arguments: { project: 'core' } });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain('no sprints');

    await client.close();
  });
});

describe('set_task_sprint', () => {
  it('puts a task in, moves it across, and takes it out', async () => {
    const client = await connect(await mint());
    await seedTask();

    const one = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };
    const two = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 2',
        start_date: '2026-01-15',
        end_date: '2026-01-28',
      })
    ).sprint as { id: string };

    const inFirst = (await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: one.id }))
      .task as { sprint_id: string | null };
    expect(inFirst.sprint_id).toBe(one.id);

    // Across in one call — an agent does not have to remove it first.
    const inSecond = (await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: two.id }))
      .task as { sprint_id: string | null };
    expect(inSecond.sprint_id).toBe(two.id);

    const out = (await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: null })).task as {
      sprint_id: string | null;
    };
    expect(out.sprint_id).toBeNull();

    await client.close();
  });

  it('taking out a task that is in no sprint writes nothing at all', async () => {
    const client = await connect(await mint());
    await seedTask();
    const before = h.db.select().from(activity).all().length;

    const out = (await ok(client, 'set_task_sprint', { task: 'COR-1', sprint: null })).task as {
      sprint_id: string | null;
    };

    expect(out.sprint_id).toBeNull();
    // `sprint: null` says where the task should end up and it is already there.
    // Recording a move that did not happen would put a lie on the timeline.
    expect(h.db.select().from(activity).all().length).toBe(before);

    await client.close();
  });

  it('refuses a task from another project, naming both', async () => {
    const client = await connect(await mint());
    await seedTask();
    await project('other', 'OTH');
    await must('/api/v1/projects/other/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Elsewhere' }),
    });

    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };

    const error = await refused(client, 'set_task_sprint', {
      task: 'OTH-1',
      sprint: sprint.id,
    });
    expect(error.code).toBe('unprocessable');

    await client.close();
  });
});

describe('update_task', () => {
  it('edits the fields a lead edits, leaving the omitted ones alone', async () => {
    const client = await connect(await mint());
    await must('/api/v1/projects/core/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Original', description_md: 'Keep me' }),
    });

    const updated = (
      await ok(client, 'update_task', {
        task: 'COR-1',
        title: 'Renamed',
        acceptance: 'The gate is green',
        priority: 'p1',
        tags: ['infra', 'urgent'],
      })
    ).task as {
      title: string;
      description_md: string | null;
      acceptance_md: string | null;
      priority: string;
      tags: string[];
    };

    expect(updated.title).toBe('Renamed');
    expect(updated.acceptance_md).toBe('The gate is green');
    expect(updated.priority).toBe('p1');
    expect(updated.tags).toEqual(['infra', 'urgent']);
    // Untouched, because it was not named.
    expect(updated.description_md).toBe('Keep me');

    await client.close();
  });

  it('clears acceptance with null, which is a different request from omitting it', async () => {
    const client = await connect(await mint());
    await seedTask();
    await ok(client, 'update_task', { task: 'COR-1', acceptance: 'Something' });

    const cleared = (await ok(client, 'update_task', { task: 'COR-1', acceptance: null })).task as {
      acceptance_md: string | null;
    };
    expect(cleared.acceptance_md).toBeNull();

    await client.close();
  });

  it('assigns by email, by id, and unassigns with null', async () => {
    const brin = await member();
    const client = await connect(await mint());
    await seedTask();

    const byEmail = (
      await ok(client, 'update_task', { task: 'COR-1', assignee: 'brin@example.test' })
    ).task as { assignee_id: string | null };
    expect(byEmail.assignee_id).toBe(brin);

    const cleared = (await ok(client, 'update_task', { task: 'COR-1', assignee: null })).task as {
      assignee_id: string | null;
    };
    expect(cleared.assignee_id).toBeNull();

    const byId = (await ok(client, 'update_task', { task: 'COR-1', assignee: brin })).task as {
      assignee_id: string | null;
    };
    expect(byId.assignee_id).toBe(brin);

    await client.close();
  });

  it('refuses an email nobody on the project has', async () => {
    const client = await connect(await mint());
    await seedTask();

    const error = await refused(client, 'update_task', {
      task: 'COR-1',
      assignee: 'nobody@example.test',
    });

    expect(error.code).toBe('not_found');
    expect(error.details?.field).toBe('assignee');

    await client.close();
  });

  it('records a reassignment as task.assigned, exactly as the REST PATCH does', async () => {
    const brin = await member();
    const client = await connect(await mint());
    await seedTask();

    await ok(client, 'update_task', { task: 'COR-1', assignee: 'brin@example.test' });

    const assigned = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'task.assigned');

    // §5: "A task may be reassigned while in_progress — that is `task.assigned`,
    // not a status change." The tool inherits that by calling the same service.
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.payloadJson).toContain(brin);
    expect(assigned[0]?.actorKind).toBe('agent');

    await client.close();
  });

  it('moves a task between sprints through the same path set_task_sprint uses', async () => {
    const client = await connect(await mint());
    await seedTask();
    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };

    const moved = (await ok(client, 'update_task', { task: 'COR-1', sprint: sprint.id })).task as {
      sprint_id: string | null;
    };
    expect(moved.sprint_id).toBe(sprint.id);

    // One verb for the move, whichever tool asked for it — `sprint.tasks_changed`
    // and not a second shape only `update_task` writes.
    const moves = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'sprint.tasks_changed');
    expect(moves).toHaveLength(1);

    await client.close();
  });

  it('has no way to change status at all', async () => {
    // Not "refuses a status" — the tool takes none, so §5's table cannot be
    // routed around through it. The same shape as `finish_task` having no way
    // to reach `done`.
    const client = await connect(await mint());
    const tool = (await client.listTools()).tools.find((t) => t.name === 'update_task');

    expect(JSON.stringify(tool?.inputSchema)).not.toContain('status');

    // And an unknown field is refused rather than ignored (§7.2).
    await seedTask();
    const result = await client.callTool({
      name: 'update_task',
      arguments: { task: 'COR-1', status: 'done' },
    });
    expect(result.isError).toBe(true);

    const after = (await ok(client, 'get_task_context', { task: 'COR-1' })).task as {
      status: string;
    };
    expect(after.status).toBe('backlog');

    await client.close();
  });
});

describe('create_task gains an assignee and a sprint', () => {
  it('files a task already assigned and already in the sprint', async () => {
    const brin = await member();
    const client = await connect(await mint());

    const sprint = (
      await ok(client, 'create_sprint', {
        project: 'core',
        name: 'Sprint 1',
        start_date: '2026-01-01',
        end_date: '2026-01-14',
      })
    ).sprint as { id: string };

    const task = (
      await ok(client, 'create_task', {
        project: 'core',
        title: 'Imported',
        acceptance: 'Done means done',
        tags: ['import'],
        assignee: 'brin@example.test',
        sprint: sprint.id,
      })
    ).task as {
      assignee_id: string | null;
      sprint_id: string | null;
      acceptance_md: string | null;
      tags: string[];
      created_via: string;
    };

    expect(task.assignee_id).toBe(brin);
    expect(task.sprint_id).toBe(sprint.id);
    expect(task.acceptance_md).toBe('Done means done');
    expect(task.tags).toEqual(['import']);
    expect(task.created_via).toBe('mcp');

    await client.close();
  });
});

describe('list_members', () => {
  it('returns everyone on the project with the ids and emails assignment takes', async () => {
    const brin = await member();
    const client = await connect(await mint());

    const members = (await ok(client, 'list_members', { project: 'core' })).members as {
      user_id: string;
      email: string;
      role: string;
    }[];

    expect(members.map((m) => m.user_id)).toContain(brin);
    expect(members.map((m) => m.email)).toContain('ada@example.test');
    expect(members.find((m) => m.user_id === brin)?.role).toBe('member');

    await client.close();
  });
});

describe('update_project_context', () => {
  it('replaces the document', async () => {
    const client = await connect(await mint());

    const written = (
      await ok(client, 'update_project_context', {
        project: 'core',
        context_md: '# The brief\n\nWhat we are doing.',
        mode: 'replace',
      })
    ).context as { context_md: string; length: number };

    expect(written.context_md).toBe('# The brief\n\nWhat we are doing.');
    expect(written.length).toBe('# The brief\n\nWhat we are doing.'.length);

    // The humans' endpoint reads what the agent wrote.
    const rest = (await (await api('/api/v1/projects/core/context')).json()) as {
      context_md: string;
    };
    expect(rest.context_md).toBe('# The brief\n\nWhat we are doing.');

    await client.close();
  });

  it('appends to what is already there rather than over it', async () => {
    const client = await connect(await mint());
    await ok(client, 'update_project_context', {
      project: 'core',
      context_md: 'First paragraph.',
      mode: 'replace',
    });

    const appended = (
      await ok(client, 'update_project_context', {
        project: 'core',
        context_md: 'Second paragraph.',
        mode: 'append',
      })
    ).context as { context_md: string };

    expect(appended.context_md).toBe('First paragraph.\n\nSecond paragraph.');

    await client.close();
  });

  it('appends to an empty document without a leading blank line', async () => {
    const client = await connect(await mint());

    const appended = (
      await ok(client, 'update_project_context', {
        project: 'core',
        context_md: 'The first thing anybody wrote.',
        mode: 'append',
      })
    ).context as { context_md: string };

    expect(appended.context_md).toBe('The first thing anybody wrote.');

    await client.close();
  });

  it('requires a mode, because there is no safe default', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'update_project_context',
      arguments: { project: 'core', context_md: 'No mode given' },
    });

    expect(result.isError).toBe(true);

    // And the document was not touched on the way to the refusal.
    const rest = (await (await api('/api/v1/projects/core/context')).json()) as {
      context_md: string;
    };
    expect(rest.context_md).toBe('');

    await client.close();
  });

  it('writes one project.context_updated row, carrying both lengths', async () => {
    const client = await connect(await mint());
    await ok(client, 'update_project_context', {
      project: 'core',
      context_md: 'Twelve chars',
      mode: 'replace',
    });

    const rows = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'project.context_updated');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payloadJson).toContain('"previous_length":0');
    expect(rows[0]?.actorKind).toBe('agent');

    await client.close();
  });
});

describe('a read_only token is denied every write and allowed every read', () => {
  it('refuses all five writes with forbidden', async () => {
    await seedTask();
    const sprintId = (
      (await (
        await must('/api/v1/projects/core/sprints', {
          method: 'POST',
          body: JSON.stringify({ name: 'Sprint 1', starts_on: jan(1), ends_on: jan(14) }),
        })
      ).json()) as { id: string }
    ).id;

    const client = await connect(await mint({ scope: 'read_only' }));

    const calls: [string, Record<string, unknown>][] = [
      [
        'create_sprint',
        { project: 'core', name: 'Nope', start_date: '2026-02-01', end_date: '2026-02-14' },
      ],
      ['update_sprint', { sprint: sprintId, name: 'Nope' }],
      ['set_task_sprint', { task: 'COR-1', sprint: sprintId }],
      ['update_task', { task: 'COR-1', title: 'Nope' }],
      ['update_project_context', { project: 'core', context_md: 'Nope', mode: 'replace' }],
    ];

    for (const [name, args] of calls) {
      const error = await refused(client, name, args);
      expect(error.code, name).toBe('forbidden');
    }

    // Reads still work, so the refusal is about the scope and not the token.
    await ok(client, 'list_sprints', { project: 'core' });
    await ok(client, 'list_members', { project: 'core' });

    await client.close();
  });

  it('leaves nothing behind when a write is refused', async () => {
    const client = await connect(await mint({ scope: 'read_only' }));
    await client.callTool({
      name: 'create_sprint',
      arguments: {
        project: 'core',
        name: 'Nope',
        start_date: '2026-02-01',
        end_date: '2026-02-14',
      },
    });
    await client.close();

    const rest = (await (await api('/api/v1/projects/core/sprints')).json()) as { data: unknown[] };
    expect(rest.data).toHaveLength(0);
  });
});

describe('a token narrowed to one project cannot manage another', () => {
  it('refuses the sprint tools on a project outside its scope', async () => {
    await project('secret', 'SEC');

    // §4.9 narrows a token by project **id**, so the slug has to be resolved
    // first — `project_slugs` is refused by the route's strict body, which is
    // how this fixture announced itself rather than minting an unnarrowed token
    // and quietly proving nothing.
    const core = (await (await api('/api/v1/projects/core')).json()) as { id: string };
    const scoped = await mint({ scope: 'full', project_ids: [core.id] });
    const client = await connect(scoped);

    const error = await refused(client, 'create_sprint', {
      project: 'secret',
      name: 'Not yours',
      start_date: '2026-01-01',
      end_date: '2026-01-14',
    });
    expect(error.code).toBe('forbidden');

    // And the same call on the project it *is* scoped to succeeds, so the
    // refusal is the narrowing rather than a broken token.
    await ok(client, 'create_sprint', {
      project: 'core',
      name: 'Yours',
      start_date: '2026-01-01',
      end_date: '2026-01-14',
    });

    await client.close();
  });
});
