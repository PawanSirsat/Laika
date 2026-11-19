import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { attachments, comments } from '../../src/db/schema.ts';
import { type AttachmentsEnv } from '../../src/env.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';
import { browserPut, fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';

/**
 * An agent attaches its outputs over MCP (D-162, LAI-1302), through a real
 * client against a fake store behind an injected `fetch` — no test calls a
 * real one: `request_upload` hands out the presigned `PUT` and a `curl` line,
 * the bytes go to the store, `complete_upload` checks them, and `finish_task`,
 * `add_comment`, `create_task` and `log_unlisted_work` attach them captioned;
 * `get_task_context` lists them with their captions and rounds.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

let h: AuthHarness;
let fake: FakeS3;
let cookie: string;
let server: ReturnType<typeof serve>;
let baseUrl: URL;
const clients: Client[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
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

async function boot(config: AttachmentsEnv | null = fakeAttachments()): Promise<void> {
  fake = fakeS3();
  h = authHarness({
    attachments: { config, fetchImpl: (input, init) => fake.fetchImpl(input, init) },
  });
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
  cookie = cookieFrom(setup);
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
  });
  for (const [slug, prefix] of [
    ['core', 'COR'],
    ['web', 'WEB'],
  ]) {
    await must('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: slug, slug, prefix }),
    });
  }
  await must('/api/v1/projects/core/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Build the board' }),
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  h.close();
});

async function agent(scope: 'full' | 'read_only' = 'full'): Promise<Client> {
  const minted = await must('/api/v1/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: 'agent', scope }),
  });
  const { secret } = (await minted.json()) as { secret: string };
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  clients.push(client);
  return client;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return client.callTool({ name, arguments: args });
}

/** A call that must succeed, and its payload. */
async function ok(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await call(client, name, args);
  expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** A call that must be refused, and its §6.3 error. */
async function refused(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ code: string; details: Record<string, unknown> | null }> {
  const result = await call(client, name, args);
  expect(result.isError, `${name} was not refused`).toBe(true);
  return (result.structuredContent as { error: { code: string; details: Record<string, unknown> } })
    .error;
}

interface Asked {
  attachment: { id: string; task_id: string | null; project_id: string };
  upload: { url: string; headers: Record<string, string> };
  curl: string;
}

/** The words of a `curl` line, as a POSIX shell splits single-quoted ones. */
function shellWords(line: string): string[] {
  return [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) =>
    m[1] === undefined ? m[2]! : m[1].replaceAll(`'\\''`, "'"),
  );
}

/**
 * Upload the way the `curl` line says to: its headers and its URL, and the
 * bytes `-T` would send — through the fake store, so a line that left out a
 * signed header, or quoted one wrongly, is refused here as the store would.
 */
async function curlPut(curl: string, bytes: Uint8Array): Promise<Response> {
  const words = shellWords(curl);
  expect(words.slice(0, 2)).toEqual(['curl', '-fsS']);
  const headers: Record<string, string> = {};
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === '-H') {
      const [name, ...value] = words[i + 1]!.split(': ');
      headers[name!] = value.join(': ');
    }
  }
  return browserPut(fake, { url: words.at(-1)!, headers }, bytes);
}

/** request_upload, the curl line, complete_upload: a ready file's id. */
async function upload(
  client: Client,
  where: Record<string, unknown>,
  bytes: Uint8Array = PNG,
  file: { filename: string; content_type: string } = {
    filename: 'board.png',
    content_type: 'image/png',
  },
): Promise<string> {
  const asked = (await ok(client, 'request_upload', {
    ...where,
    ...file,
    size_bytes: bytes.length,
  })) as unknown as Asked;
  expect((await curlPut(asked.curl, bytes)).status).toBe(200);
  await ok(client, 'complete_upload', { attachment: asked.attachment.id });
  return asked.attachment.id;
}

const row = (id: string) => h.db.select().from(attachments).where(eq(attachments.id, id)).get()!;
const url = (id: string) => `/api/v1/attachments/${id}/content`;

describe('request_upload and complete_upload', () => {
  it('hands out a presigned PUT and a curl line that the store accepts, by task key', async () => {
    await boot();
    const client = await agent();

    const asked = (await ok(client, 'request_upload', {
      task: 'COR-1',
      filename: "it's done.png",
      content_type: 'image/png',
      size_bytes: PNG.length,
    })) as unknown as Asked;
    expect(asked.attachment.task_id).not.toBeNull();
    expect(asked.curl).toContain(`-T 'it'\\''s done.png'`);
    expect(asked.curl).toContain(`'${asked.upload.url}'`);
    // The bytes never pass through MCP: the answer holds a URL, not a body.
    expect(asked.upload.url.startsWith('https://files.example.test/')).toBe(true);

    expect((await curlPut(asked.curl, PNG)).status).toBe(200);
    const done = (await ok(client, 'complete_upload', { attachment: asked.attachment.id }))
      .attachment as { inline: boolean; ready_at: number | null; task_id: string };
    expect(done).toMatchObject({ inline: true, task_id: asked.attachment.task_id });
    expect(done.ready_at).not.toBeNull();
  });

  it('takes a project instead of a task for a file with no task yet, and refuses neither or both', async () => {
    await boot();
    const client = await agent();
    const file = { filename: 'a.png', content_type: 'image/png', size_bytes: 3 };

    const loose = (await ok(client, 'request_upload', {
      project: 'web',
      ...file,
    })) as unknown as Asked;
    expect(loose.attachment.task_id).toBeNull();

    for (const where of [{}, { task: 'COR-1', project: 'core' }]) {
      expect(await refused(client, 'request_upload', { ...where, ...file })).toMatchObject({
        code: 'unprocessable',
        details: { reason: 'task_or_project' },
      });
    }
  });

  it('refuses a file that holds a secret, by rule and line, and keeps nothing of it', async () => {
    await boot();
    const client = await agent();
    const body = new TextEncoder().encode(`NODE_ENV=test\nAPI_TOKEN=${'q'.repeat(24)}\n`);
    const asked = (await ok(client, 'request_upload', {
      task: 'COR-1',
      filename: '.env.test',
      content_type: 'text/plain',
      size_bytes: body.length,
    })) as unknown as Asked;
    expect((await curlPut(asked.curl, body)).status).toBe(200);

    const error = await refused(client, 'complete_upload', { attachment: asked.attachment.id });
    expect(error).toMatchObject({
      code: 'unprocessable',
      details: { reason: 'secret_detected', pattern: 'env_secret', line: 2 },
    });
    expect(JSON.stringify(error)).not.toContain('q'.repeat(24));
    expect(fake.objects.size).toBe(0);
    expect(row(asked.attachment.id).deletedAt).not.toBeNull();
  });

  it('is refused to a read_only token', async () => {
    await boot();
    const client = await agent('read_only');
    expect(
      (
        await refused(client, 'request_upload', {
          task: 'COR-1',
          filename: 'a.png',
          content_type: 'image/png',
          size_bytes: 3,
        })
      ).code,
    ).toBe('forbidden');
  });

  it('answers attachments_off on a board with no store, and get_task_context still answers', async () => {
    await boot(null);
    const client = await agent();
    expect(
      await refused(client, 'request_upload', {
        task: 'COR-1',
        filename: 'a.png',
        content_type: 'image/png',
        size_bytes: 3,
      }),
    ).toMatchObject({ code: 'unavailable', details: { reason: 'attachments_off' } });
    expect((await ok(client, 'get_task_context', { task: 'COR-1' })).attachments).toEqual([]);
  });
});

describe('outputs and attachments on the writes (D-162)', () => {
  it('finish_task outputs: captioned in the summary, listed by get_task_context with their round', async () => {
    await boot();
    const client = await agent();
    const shot = await upload(client, { task: 'COR-1' });
    const sheet = await upload(
      client,
      { task: 'COR-1' },
      new TextEncoder().encode('name,role\nAda,owner\n'),
      { filename: 'roles.csv', content_type: 'text/csv' },
    );
    await ok(client, 'update_status', { task: 'COR-1', status: 'in_progress' });

    const finished = await call(client, 'finish_task', {
      task: 'COR-1',
      summary: 'The board is built',
      outputs: [
        { attachment: shot, caption: 'Board, light, 1440' },
        { attachment: sheet, caption: 'Roles export' },
      ],
    });
    expect(finished.isError, JSON.stringify(finished)).not.toBe(true);
    expect(JSON.stringify(finished.content)).toContain('2 outputs');

    const context = await call(client, 'get_task_context', { task: 'COR-1' });
    const listed = (context.structuredContent as { attachments: unknown[] }).attachments;
    expect(listed).toEqual([
      expect.objectContaining({
        id: shot,
        filename: 'board.png',
        content_type: 'image/png',
        size_bytes: PNG.length,
        caption: 'Board, light, 1440',
        url: url(shot),
        round: 1,
      }),
      expect.objectContaining({ id: sheet, caption: 'Roles export', round: 1, inline: false }),
    ]);
    const text = (context.content as { text: string }[])[0]!.text;
    expect(text).toContain('### Files (2)');
    expect(text).toContain(`[Board, light, 1440](${url(shot)}) — \`board.png\`, image/png`);
  });

  it('add_comment attachments: under the comment, which owns the file', async () => {
    await boot();
    const client = await agent();
    const shot = await upload(client, { project: 'core' });

    const result = await ok(client, 'add_comment', {
      task: 'COR-1',
      body: 'The build fails on the login screen',
      attachments: [{ attachment: shot, caption: 'The error' }],
    });
    const comment = result.comment as { id: string; body_md: string };
    expect(comment.body_md).toBe(
      `The build fails on the login screen\n\n**Attached**\n\n- ![The error](${url(shot)})`,
    );
    expect(row(shot)).toMatchObject({ commentId: comment.id });
  });

  it('create_task attachments: in the description, and the new task has them', async () => {
    await boot();
    const client = await agent();
    const mockup = await upload(client, { project: 'core' });

    const task = (
      await ok(client, 'create_task', {
        project: 'core',
        title: 'Restyle the header',
        attachments: [{ attachment: mockup, caption: 'The mockup' }],
      })
    ).task as { id: string; description_md: string };
    expect(task.description_md).toBe(`**Attached**\n\n- ![The mockup](${url(mockup)})`);
    expect(row(mockup).taskId).toBe(task.id);
  });

  it('refuses a file of another project, and writes nothing', async () => {
    await boot();
    const client = await agent();
    const theirs = await upload(client, { project: 'web' });

    expect(
      await refused(client, 'add_comment', {
        task: 'COR-1',
        body: 'See this',
        attachments: [{ attachment: theirs, caption: 'x' }],
      }),
    ).toMatchObject({ code: 'unprocessable', details: { reason: 'other_project' } });
    expect(h.db.select().from(comments).all()).toEqual([]);
    expect(row(theirs).taskId).toBeNull();
  });

  it('log_unlisted_work attachments: linked to the finding, which a promotion carries to its task', async () => {
    await boot();
    const client = await agent();
    const log = await upload(
      client,
      { project: 'web' },
      new TextEncoder().encode('build failed: exit 2\n'),
      { filename: 'build.log', content_type: 'text/plain' },
    );

    const logged = (
      await ok(client, 'log_unlisted_work', {
        repo: 'kvell/laika',
        note: 'The release script fails',
        attachments: [{ attachment: log, caption: 'The failing build' }],
      })
    ).unlisted as { id: string; note: string };
    expect(row(log).unlistedWorkId).toBe(logged.id);
    expect(logged.note).toContain(`[The failing build](${url(log)})`);

    const promoted = await must(
      `/api/v1/unlisted/${logged.id}/promote`,
      {
        method: 'POST',
        body: JSON.stringify({ project_slug: 'core', title: 'Fix the release script' }),
      },
      201,
    );
    const { task } = (await promoted.json()) as { task: { id: string; project_id: string } };
    expect(row(log)).toMatchObject({ taskId: task.id, projectId: task.project_id });
  });
});
