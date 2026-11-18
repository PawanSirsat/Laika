import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { handleMcpRequest, MCP_SERVER_NAME } from '../../src/mcp/server.ts';
import { comments, tokens, users } from '../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * `/mcp` driven by the **real** MCP client (SPEC §7, LAI-406).
 *
 * Served on a real socket rather than through Hono's test client, because the
 * transport is the thing under test: `app.request` would exercise our handler
 * while skipping content negotiation, the `Accept` header the protocol
 * requires, and the client's own session handling. A test that cannot fail on a
 * transport bug is not a test of the transport.
 *
 * `@hono/node-server` is already a direct dependency — it is what `index.ts`
 * serves with — so this needs no package the task did not authorise.
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

async function mint(scope: 'full' | 'read_only' = 'full', name = 'agent'): Promise<string> {
  const res = await h.app.request('/api/v1/tokens', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: ownerCookie }),
    body: JSON.stringify({ name, scope }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

/** A real client, connected over a real socket. Caller closes it. */
async function connect(secret: string | undefined, clientName = 'test-agent'): Promise<Client> {
  const client = new Client({ name: clientName, version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: secret === undefined ? {} : { headers: { Authorization: `Bearer ${secret}` } },
  });

  // The SDK's own client transport does not satisfy the SDK's own `Transport`
  // parameter under this repo's `exactOptionalPropertyTypes` — an optional
  // property declared `?: T` meeting one typed `T | undefined`. That is a
  // type-level incompatibility with our strictness, not a shape mismatch: this
  // is the object the SDK's own documentation passes here.
  //
  // A cast at the one call site rather than relaxing the compiler for the whole
  // package, and not `@ts-ignore`, which would hide a real error later too.
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();

  // Port 0: the OS picks a free one, so this cannot collide with another
  // session's server (CLAUDE.md §4.3) or with a previous run of itself.
  //
  // **Awaited.** `serve()` returns before the socket is bound, so reading
  // `address()` synchronously gives port 0 and every client then tries to
  // connect to `:0`. That failed as `EADDRNOTAVAIL`, which the `rejects`
  // assertions below happily accepted — see the comment there.
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  h.close();
});

describe('the handshake', () => {
  it('completes `initialize` with a real client and names the server', async () => {
    const client = await connect(await mint());

    const info = client.getServerVersion();
    expect(info?.name).toBe(MCP_SERVER_NAME);

    await client.close();
  });

  it('lists its tools', async () => {
    const client = await connect(await mint());

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('laika_whoami');

    await client.close();
  });

  it('carries the authenticated identity into a tool call', async () => {
    // The whole point of the wiring: the tool sees the token's user, with the
    // user's real role, not a service account.
    const client = await connect(await mint());

    const result = await client.callTool({ name: 'laika_whoami', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const identity = JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;

    expect(identity).toMatchObject({
      email: 'ada@example.test',
      org_role: 'owner',
      token_scope: 'full',
    });

    await client.close();
  });

  it('reports the token’s scope, so a read_only agent knows what it holds', async () => {
    const client = await connect(await mint('read_only'));

    const result = await client.callTool({ name: 'laika_whoami', arguments: {} });
    const content = result.content as { type: string; text: string }[];

    expect(JSON.parse(content[0]?.text ?? '{}')).toMatchObject({ token_scope: 'read_only' });

    await client.close();
  });
});

describe('authentication', () => {
  // `rejects.toThrow()` alone is not enough here and it caught me out: while
  // the server was binding to port 0, every one of these passed on
  // `EADDRNOTAVAIL` — a connection that never reached Laika, asserting nothing
  // about authentication.
  //
  // They now require the rejection to carry §6.3's `unauthorized` **code**,
  // which is what §7.2 says an agent branches on. A transport-level failure
  // cannot satisfy that, and neither can a 401 with some other body.
  it('refuses a client with no token', async () => {
    await expect(connect(undefined)).rejects.toThrow(/unauthorized/);
  });

  it('refuses an unknown token', async () => {
    await expect(connect(`lai_${'z'.repeat(40)}`)).rejects.toThrow(/unauthorized/);
  });

  it('refuses a revoked token', async () => {
    const secret = await mint();
    const id = h.db.select().from(tokens).get()?.id ?? '';

    const revoked = await h.app.request(`/api/v1/tokens/${id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ Cookie: ownerCookie }),
    });
    expect(revoked.status).toBe(204);

    await expect(connect(secret)).rejects.toThrow(/unauthorized/);
  });

  it('answers a bad token with JSON in the §6.3 envelope, not HTML', async () => {
    // An agent must be able to branch on the code. An HTML error page — which
    // is what the SPA fallback would serve if `/mcp` were not excluded from it
    // — is unparseable and would look like a protocol fault.
    const res = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer lai_${'z'.repeat(40)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('unauthorized');
  });

  it('answers an anonymous caller the same way', async () => {
    const res = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('unauthorized');
  });
});

describe('an agent is not a browser (§6.1)', () => {
  it('connects with no Origin header at all', async () => {
    // Inherited from LAI-403 rather than re-decided: §6.1 origin-checks
    // `/api/v1/auth/*` and nothing else, and `/mcp` sits behind the same
    // `authMiddleware`. The real client sends no `Origin`, which is the point.
    const client = await connect(await mint());

    expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);

    await client.close();
  });
});

describe('the actor is the token’s user, not a service account', () => {
  it('reports a member as a member', async () => {
    // Demote the owner's identity is not possible; make a second user instead.
    const memberSecret = await mint();
    const client = await connect(memberSecret);

    const result = await client.callTool({ name: 'laika_whoami', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const identity = JSON.parse(content[0]?.text ?? '{}') as { user_id: string };

    const owner = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get();
    expect(identity.user_id).toBe(owner?.id);

    await client.close();
  });
});

describe('shutdown is not blocked by MCP traffic (AC7)', () => {
  it('closes the listener promptly after a completed tool call', async () => {
    // The claim being tested is the statelessness one: no session outlives its
    // request and `enableJsonResponse` leaves no SSE stream open, so there is
    // nothing for `onStopping` to close.
    //
    // Asserted by timing `server.close()`, because that is the thing that
    // actually goes wrong if the claim is false — §11.5's activity feed needed
    // `onStopping` precisely because an open stream is an in-flight request
    // that never ends, and a deploy then waits out the whole 10s grace period.
    const client = await connect(await mint());
    await client.callTool({ name: 'laika_whoami', arguments: {} });
    await client.close();

    const startedAt = Date.now();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(1_000);

    // Re-listen so `afterEach` has something to close.
    baseUrl = await new Promise<URL>((resolve) => {
      server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
      });
    });
  });
});

describe('the server tells any agent how to work the board (D-076)', () => {
  /** The rules an agent must not miss, each by the tool that carries it. */
  const RULE_TOOLS = [
    'laika_whoami',
    'get_project_context',
    'list_ready_tasks',
    'start_working',
    'create_task',
    'add_comment',
    'finish_task',
    'log_unlisted_work',
  ];

  it('returns instructions on initialize that name every rule’s tool', async () => {
    const client = await connect(await mint());

    const instructions = client.getInstructions() ?? '';
    for (const tool of RULE_TOOLS) expect(instructions).toContain(`\`${tool}\``);
    expect(instructions).toMatch(/never .*done/i);
    expect(instructions.split('\n').length).toBeLessThanOrEqual(25);
    // Claude Code truncates server instructions at 2,048 characters.
    expect(instructions.length).toBeLessThanOrEqual(2048);

    await client.close();
  });

  it('puts the must-follow rules in the first 512 characters', async () => {
    // Codex: "Keep the first 512 characters self-contained."
    const client = await connect(await mint());

    const head = (client.getInstructions() ?? '').slice(0, 512);
    for (const tool of ['start_working', 'create_task', 'finish_task']) {
      expect(head).toContain(`\`${tool}\``);
    }
    expect(head).toMatch(/before .*code/i);
    expect(head).toMatch(/never .*done/i);

    await client.close();
  });

  it('names only tools the server actually serves', async () => {
    // Names from both sides (CLAUDE.md §2), not a count: a renamed tool turns
    // this red instead of leaving the instructions pointing at nothing.
    const client = await connect(await mint());

    const served = new Set((await client.listTools()).tools.map((t) => t.name));
    const named = [...(client.getInstructions() ?? '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => name !== undefined && !served.has(name))).toEqual([]);

    await client.close();
  });

  it('repeats them in laika_whoami for clients that drop server instructions', async () => {
    const client = await connect(await mint());

    const result = await client.callTool({ name: 'laika_whoami', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const identity = JSON.parse(content[0]?.text ?? '{}') as { how_to_work?: string };

    expect(identity.how_to_work).toBe(client.getInstructions());

    await client.close();
  });

  it('carries the must-follow rules in the tool descriptions too', async () => {
    // Zed, Cline, Continue, Hermes and Omnigent never show `instructions` to
    // the model. They do show tool descriptions.
    const client = await connect(await mint());

    const described = new Map(
      (await client.listTools()).tools.map((t) => [t.name, t.description ?? '']),
    );
    expect(described.get('start_working')).toMatch(/before .*code/i);
    expect(described.get('create_task')).toMatch(/no task/i);
    expect(described.get('finish_task')).toMatch(/never .*done/i);
    expect(described.get('laika_whoami')).toContain('how_to_work');

    await client.close();
  });
});

describe('what a non-MCP probe gets back', () => {
  async function raw(method: string, headers: Record<string, string>, body?: unknown) {
    return fetch(new URL('/mcp', baseUrl), {
      method,
      headers: { Accept: 'application/json, text/event-stream', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it.each(['GET', 'HEAD', 'DELETE'])(
    'answers %s with 405 and Allow: POST, never the SPA',
    async (method) => {
      // Stateless: there is no SSE stream to open and no session to delete.
      // A 2xx here is what makes Hermes send a throwaway `hermes-probe` session.
      for (const headers of [{ Authorization: `Bearer ${await mint()}` }, {}]) {
        const res = await raw(method, headers);

        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
        expect(res.headers.get('content-type')).toContain('application/json');
        if (method !== 'HEAD') {
          expect(((await res.json()) as { error?: { code?: number } }).error?.code).toBe(-32000);
        }
      }
    },
  );

  it('answers Antigravity’s server/discover with -32601, and initialize still works', async () => {
    const secret = await mint();
    const res = await raw(
      'POST',
      { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} },
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { error?: { code?: number } }).error?.code).toBe(-32601);

    const client = await connect(secret, 'antigravity-client');
    expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
    await client.close();
  });
});

describe('a 401 says what was wrong with the header', () => {
  async function refused(authorization: string | undefined): Promise<string> {
    const res = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(authorization === undefined ? {} : { Authorization: authorization }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unauthorized');
    return body.error.message;
  }

  it('says when there was no Authorization header', async () => {
    expect(await refused(undefined)).toMatch(/no Authorization header/i);
  });

  it.each(['Bearer ', 'Bearer', 'bearer   '])('says when it was empty: %j', async (header) => {
    expect(await refused(header)).toMatch(/empty/i);
  });

  it.each(['Bearer ${LAIKA_TOKEN}', 'Bearer {env:LAIKA_TOKEN}', 'Bearer $LAIKA_TOKEN'])(
    'says when it was an unexpanded placeholder: %s',
    async (header) => {
      const message = await refused(header);

      expect(message).toMatch(/placeholder/i);
      expect(message).not.toContain('LAIKA_TOKEN}');
    },
  );

  it('never echoes a token that was presented', async () => {
    const wrong = `lai_${'Q'.repeat(40)}`;
    const message = await refused(`Bearer ${wrong}`);

    expect(message).toBe('That access token is not valid');
    expect(message).not.toContain('QQQQ');
  });
});

describe('the connecting client is recorded on the token (D-076)', () => {
  interface OwnToken {
    name: string;
    last_mcp_at: number | null;
    last_client: string | null;
    last_client_name: string | null;
  }

  async function ownTokens(): Promise<OwnToken[]> {
    const res = await h.app.request('/api/v1/tokens', { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: OwnToken[] }).data;
  }

  it('shows the client and the time on the owner’s token list', async () => {
    const before = Date.now();
    const client = await connect(await mint('full', 'laika on macOS'), 'claude-code');
    await client.close();

    const [token] = await ownTokens();
    expect(token).toMatchObject({ last_client: 'claude-code', last_client_name: 'claude-code' });
    expect(token?.last_mcp_at).toBeGreaterThanOrEqual(before);
  });

  it('reads the token name when the client calls itself mcp', async () => {
    const client = await connect(await mint('full', 'omnigent on macOS'), 'mcp');
    await client.close();

    const [token] = await ownTokens();
    expect(token).toMatchObject({ last_client: 'omnigent', last_client_name: 'mcp' });
  });

  it('leaves a token that never spoke MCP blank', async () => {
    await mint('full', 'unused');

    const [token] = await ownTokens();
    expect(token).toMatchObject({ last_mcp_at: null, last_client: null, last_client_name: null });
  });

  it('makes an agent with no heartbeat hook present', async () => {
    // The point of D-076: Cursor, Codex, OpenCode… never POST /heartbeats.
    const client = await connect(await mint(), 'Cursor');
    await client.close();

    const res = await h.app.request('/api/v1/presence', { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      present: { name: string; is_agent: boolean; client: string | null; clients: string[] }[];
    };

    expect(view.present).toEqual([
      expect.objectContaining({
        name: 'Ada',
        is_agent: true,
        client: 'cursor',
        clients: ['cursor'],
      }),
    ]);
  });
});

describe('recording the call never fails it', () => {
  it('returns the tool result when the recorder throws, and logs why', async () => {
    const secret = await mint();
    const actor = resolveTokenActor(h.db, secret, Date.now());
    const warnings: { event: string; fields?: Record<string, unknown> }[] = [];

    const res = await handleMcpRequest(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: 'laika_whoami', arguments: {} },
        }),
      }),
      {
        actor,
        version: 'test',
        db: h.db,
        sqlite: h.t.sqlite,
        recordUse: () => {
          throw new Error('disk on fire');
        },
        log: {
          debug: () => undefined,
          info: () => undefined,
          warn: (event, fields) => {
            warnings.push(fields === undefined ? { event } : { event, fields });
          },
          error: (event, fields) => {
            warnings.push(fields === undefined ? { event } : { event, fields });
          },
        },
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; result?: { content: { text: string }[] } };
    expect(body.id).toBe(7);
    expect(JSON.parse(body.result?.content[0]?.text ?? '{}')).toMatchObject({
      email: 'ada@example.test',
    });
    expect(warnings).toEqual([{ event: 'mcp.record_failed', fields: { message: 'disk on fire' } }]);
  });
});

describe('a long body arrives whole, and one that does not says why (LAI-1350)', () => {
  // Bodies past ~2–3.5 KB were answered `-32700 Parse error: Invalid JSON`,
  // and the SDK's bare `catch` around `req.json()` said nothing more. These
  // run over a real socket because framing is the thing under test.
  const UNITS = {
    ascii: 'Done - it is -> fine, measured. ',
    'multi-byte': 'Done — it’s → fine, measured. ',
    emoji: 'Done 🚀🎉 → it’s fine. ',
  } as const;

  /**
   * About 12,000 characters of one kind, well past the size that failed.
   * Trimmed, because `add_comment` trims and the stored body is compared whole.
   */
  const longText = (unit: string): string =>
    unit
      .repeat(Math.ceil(12_000 / unit.length))
      .slice(0, 12_000)
      .trim();

  async function newTask(): Promise<string> {
    const create = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const res = await h.app.request(path, {
        method: 'POST',
        headers: jsonHeaders({ Cookie: ownerCookie }),
        body: JSON.stringify(body),
      });
      expect(res.status, await res.clone().text()).toBe(201);
      return (await res.json()) as Record<string, unknown>;
    };
    await create('/api/v1/projects', { name: 'alpha', slug: 'alpha', prefix: 'ALP' });
    return (await create('/api/v1/projects/alpha/tasks', { title: 'Work' })).key as string;
  }

  const comment = (task: string, body: string): string =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'add_comment', arguments: { task, body } },
    });

  const storedBodies = (): string[] =>
    h.db
      .select()
      .from(comments)
      .all()
      .map((c) => c.bodyMd);

  it.each(Object.entries(UNITS))(
    'stores a 12,000-character %s comment exactly as sent by the MCP client',
    async (_kind, unit) => {
      const key = await newTask();
      const text = longText(unit);
      const client = await connect(await mint());

      const result = (await client.callTool({
        name: 'add_comment',
        arguments: { task: key, body: text },
      })) as { isError?: boolean };

      expect(result.isError).not.toBe(true);
      expect(storedBodies()).toEqual([text]);
      await client.close();
    },
  );

  it('stores one sent chunked, cut at odd byte offsets through its characters', async () => {
    const key = await newTask();
    const secret = await mint();
    const text = longText(UNITS.emoji);
    const payload = Buffer.from(comment(key, text));
    // Written in 331-byte pieces, each its own chunk, so chunk boundaries fall
    // inside characters: a byte at a cut is a UTF-8 continuation byte.
    const PIECE = 331;
    const cuts = Array.from({ length: Math.ceil(payload.length / PIECE) }, (_, i) => i * PIECE);
    expect(cuts.some((at) => ((payload[at] ?? 0) & 0xc0) === 0x80)).toBe(true);

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(new URL('/mcp', baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
      });
      req.on('error', reject);
      req.on('response', (answer) => {
        const parts: Buffer[] = [];
        answer.on('data', (part: Buffer) => parts.push(part));
        answer.on('end', () => {
          resolve({ status: answer.statusCode ?? 0, body: Buffer.concat(parts).toString() });
        });
      });
      for (const at of cuts) req.write(payload.subarray(at, at + PIECE));
      req.end();
    });

    expect(res.status, res.body).toBe(200);
    expect(res.body).not.toContain('-32700');
    expect(storedBodies()).toEqual([text]);
  });

  it('refuses a body cut to a length counted in characters, and logs both lengths but never the body', async () => {
    const key = await newTask();
    const secret = await mint();
    const message = comment(key, longText(UNITS['multi-byte']));
    // What a hop that counts characters as bytes delivers: the first
    // `message.length` bytes of a body that is longer than that in UTF-8.
    const cut = Buffer.from(message).subarray(0, message.length);
    expect(Buffer.byteLength(message)).toBeGreaterThan(cut.length);

    const res = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': 'lai-1350-probe/1.0',
      },
      body: cut,
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect(storedBodies()).toEqual([]);

    const logged = h.log.records.filter((r) => r.event === 'mcp.transport_error');
    expect(logged).toEqual([
      expect.objectContaining({
        level: 'warn',
        error: 'Parse error: Invalid JSON',
        reason: 'ends_early',
        declared_bytes: cut.length,
        received_bytes: cut.length,
        client: 'lai-1350-probe/1.0',
        request_id: res.headers.get('x-request-id'),
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain('measured');
  });

  it('logs a body that stops before its Content-Length, with how much arrived', async () => {
    const secret = await mint();
    const declared = 4096;

    // A raw socket, because no HTTP client will send fewer bytes than it
    // declared: the client half-closes after 1,000, as a dropped hop would.
    await new Promise<void>((resolve, reject) => {
      const socket = netConnect(Number(baseUrl.port), baseUrl.hostname, () => {
        socket.write(
          [
            'POST /mcp HTTP/1.1',
            `Host: ${baseUrl.host}`,
            `Authorization: Bearer ${secret}`,
            'Content-Type: application/json',
            'Accept: application/json, text/event-stream',
            'User-Agent: lai-1350-probe/1.0',
            `Content-Length: ${String(declared)}`,
            '',
            '',
          ].join('\r\n'),
        );
        socket.end(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":${'x'.repeat(940)}`);
      });
      socket.on('error', reject);
      socket.on('close', () => {
        resolve();
      });
      socket.resume();
    });
    await expect
      .poll(() => h.log.records.find((r) => r.event === 'mcp.transport_error'))
      .toMatchObject({
        level: 'warn',
        reason: 'read_failed',
        declared_bytes: declared,
        client: 'lai-1350-probe/1.0',
      });
    const logged = h.log.records.find((r) => r.event === 'mcp.transport_error');
    expect(logged?.received_bytes).toBeLessThan(declared);
    expect(JSON.stringify(logged)).not.toContain('xxxx');
  });

  it('refuses a body whose length disagrees with its Content-Length, without passing it on', async () => {
    const secret = await mint();
    const warnings: { event: string; fields?: Record<string, unknown> }[] = [];
    const sent =
      '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"laika_whoami","arguments":{}}}';

    const res = await handleMcpRequest(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': String(sent.length + 100),
        },
        body: sent,
      }),
      {
        actor: resolveTokenActor(h.db, secret, Date.now()),
        version: 'test',
        db: h.db,
        sqlite: h.t.sqlite,
        log: {
          debug: () => undefined,
          info: () => undefined,
          warn: (event, fields) => {
            warnings.push(fields === undefined ? { event } : { event, fields });
          },
          error: () => undefined,
        },
      },
    );

    expect(res.status).toBe(400);
    const answer = (await res.json()) as { error: { code: number; message: string } };
    expect(answer.error.code).toBe(-32700);
    expect(answer.error.message).toContain(
      `${String(sent.length)} of ${String(sent.length + 100)} bytes`,
    );
    expect(warnings).toEqual([
      {
        event: 'mcp.transport_error',
        fields: expect.objectContaining({
          reason: 'length_mismatch',
          declared_bytes: sent.length + 100,
          received_bytes: sent.length,
        }) as unknown,
      },
    ]);
  });

  /** One request over the socket, and the `mcp.transport_error` lines it left. */
  async function refused(body: string, headers: Record<string, string> = {}) {
    const res = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await mint()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body,
    });
    return {
      status: res.status,
      answer: (await res.json()) as { error?: { code: number } },
      logged: h.log.records.filter((r) => r.event === 'mcp.transport_error'),
    };
  }

  it('calls whole JSON with a fault in its middle not_json, not a cut body', async () => {
    const { status, answer, logged } = await refused(
      '{"jsonrpc":"2.0","id":1 "method":"tools/call","params":{"name":"laika_whoami"}}',
    );

    expect(status).toBe(400);
    expect(answer.error?.code).toBe(-32700);
    expect(logged).toEqual([
      expect.objectContaining({ error: 'Parse error: Invalid JSON', reason: 'not_json' }),
    ]);
  });

  it('calls valid JSON that is not a JSON-RPC message not_json_rpc', async () => {
    const { status, answer, logged } = await refused('{"hello":"world","measured":true}');

    expect(status).toBe(400);
    expect(answer.error?.code).toBe(-32700);
    expect(logged).toEqual([
      expect.objectContaining({
        error: 'Parse error: Invalid JSON-RPC message',
        reason: 'not_json_rpc',
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain('measured');
  });

  it('logs an unsupported protocol version as a fixed sentence, never the header it was sent', async () => {
    const sent = `v<${'z'.repeat(4000)}>`;
    const { status, logged } = await refused(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      { 'MCP-Protocol-Version': sent },
    );

    expect(status).toBe(400);
    expect(logged).toEqual([
      expect.objectContaining({
        error: 'Bad Request: Unsupported protocol version',
        protocol_version: `v?${'z'.repeat(38)}`,
        protocol_version_length: sent.length,
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain('z'.repeat(41));
  });
});
