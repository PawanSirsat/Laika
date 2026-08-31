import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCP_SERVER_NAME } from '../../src/mcp/server.ts';
import { tokens, users } from '../../src/db/schema.ts';
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

async function mint(scope: 'full' | 'read_only' = 'full'): Promise<string> {
  const res = await h.app.request('/api/v1/tokens', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: ownerCookie }),
    body: JSON.stringify({ name: 'agent', scope }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

/** A real client, connected over a real socket. Caller closes it. */
async function connect(secret: string | undefined): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
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
