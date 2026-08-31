import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAST_USED_THROTTLE_MS } from '../../../src/auth/tokens.ts';
import { activity, tokens, users } from '../../../src/db/schema.ts';
import { LIMITS, RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Authenticating a request with a personal access token (SPEC §6.1, LAI-403).
 *
 * Driven through the real middleware chain rather than by calling
 * `resolveTokenActor` directly: the properties that matter — a refused token is
 * a `401` and not an anonymous request, a `read_only` token cannot write, an
 * out-of-scope project is `403` — are all produced by the chain, and testing the
 * function alone would prove none of them.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
/** Frozen clock, so a bucket drained in a test stays drained. */
let limiter: RateLimiter;

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

/** A request carrying a bearer token and nothing else. */
async function withToken(path: string, secret: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      Authorization: `Bearer ${secret}`,
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

async function withCookie(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** Mint through the real endpoint, so the secret is the one a caller would hold. */
async function mint(body: Record<string, unknown>, cookie = ownerCookie): Promise<string> {
  const res = await withCookie('/api/v1/tokens', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'ci', scope: 'full', ...body }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

async function makeProject(slug: string): Promise<string> {
  const res = await withCookie('/api/v1/projects', ownerCookie, {
    method: 'POST',
    body: JSON.stringify({ name: slug, slug, prefix: slug.slice(0, 3).toUpperCase() }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  limiter = new RateLimiter(() => 0);
  h = authHarness({ rateLimiter: limiter });
  ownerCookie = await setUp();
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
});

afterEach(() => {
  h.close();
});

describe('a valid token authenticates as its user', () => {
  it('resolves the same actor a cookie does', async () => {
    const secret = await mint({});

    const viaToken = await withToken('/api/v1/me', secret);
    const viaCookie = await withCookie('/api/v1/me', ownerCookie);

    expect(viaToken.status).toBe(200);
    expect(await viaToken.json()).toEqual(await viaCookie.json());
  });

  it('carries the user’s real roles — no service account, no elevated mode', async () => {
    const secret = await mint({});
    const res = await withToken('/api/v1/me', secret);

    expect((await res.json()) as { org_role: string }).toMatchObject({
      org_role: 'owner',
      email: 'ada@example.test',
    });
  });
});

describe('a refused token is a 401, never an anonymous request', () => {
  it('rejects unknown, malformed and wrong-prefix secrets alike', async () => {
    for (const secret of [
      `lai_${'a'.repeat(40)}`,
      'not-a-token',
      `ghp_${'a'.repeat(40)}`,
      'lai_short',
      '',
    ]) {
      const res = await withToken('/api/v1/tokens', secret);
      expect(res.status, secret).toBe(401);
    }
  });

  it('rejects a revoked token', async () => {
    const secret = await mint({});
    const id = h.db.select().from(tokens).get()?.id ?? '';
    expect(
      (await withCookie(`/api/v1/tokens/${id}`, ownerCookie, { method: 'DELETE' })).status,
    ).toBe(204);

    expect((await withToken('/api/v1/me', secret)).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const secret = await mint({});
    h.db
      .update(tokens)
      .set({ expiresAt: Date.now() - 1 })
      .run();

    expect((await withToken('/api/v1/me', secret)).status).toBe(401);
  });

  it('never says which of those it was', async () => {
    // Telling a caller "revoked" rather than "unknown" distinguishes a token
    // that existed from one that never did — free information about somebody
    // else's token, on an unauthenticated endpoint.
    const secret = await mint({});
    const id = h.db.select().from(tokens).get()?.id ?? '';
    await withCookie(`/api/v1/tokens/${id}`, ownerCookie, { method: 'DELETE' });

    const revoked = await withToken('/api/v1/me', secret);
    const unknown = await withToken('/api/v1/me', `lai_${'z'.repeat(40)}`);

    const revokedBody: unknown = await revoked.json();
    const unknownBody: unknown = await unknown.json();

    expect(revokedBody).toEqual(unknownBody);
    expect(JSON.stringify(revokedBody)).not.toMatch(/revoked|expired|unknown|malformed/i);
  });
});

describe('an agent sends no Origin, and that is fine (§6.1)', () => {
  it('accepts a bearer request carrying no Origin header at all', async () => {
    // The question LAI-406 rests on. §6.1 settles it already: "`/api/v1/auth/*`
    // is origin-checked; nothing else is." An agent never touches `/auth/*` —
    // it presents a token on `/api/v1/*` and later `/mcp`, neither of which is
    // origin-checked, and it has no browser to send an `Origin` from.
    //
    // Pinned as a test because the *reason* it works is a sentence in the spec
    // that a future CORS change could quietly invalidate, and the failure would
    // land on every agent at once.
    const secret = await mint({});

    const res = await h.app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${secret}` },
    });

    expect(res.status).toBe(200);
  });

  it('accepts a bearer write with no Origin either', async () => {
    const secret = await mint({});

    const res = await h.app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Headless', slug: 'headless', prefix: 'HDL' }),
    });

    expect(res.status).toBe(201);
  });
});

describe('a token and a cookie never both apply', () => {
  it('the token wins when both are present', async () => {
    const viewerSecret = await mint({ scope: 'read_only' });

    // Both credentials, and the *narrower* one must decide. If the cookie won,
    // an agent holding a session could escape the limits of the token it
    // presented — the one direction this must never go.
    const res = await h.app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders({
        Cookie: ownerCookie,
        Authorization: `Bearer ${viewerSecret}`,
      }),
      body: JSON.stringify({ name: 'X', slug: 'x', prefix: 'XXX' }),
    });

    // The cookie alone would have created it: the Owner may.
    expect(res.status).toBe(403);
  });

  it('a bad token does not fall through to a good cookie', async () => {
    // Falling back would mean a revoked token silently acting with the full
    // authority of whatever session happened to be attached.
    const res = await h.app.request('/api/v1/me', {
      headers: jsonHeaders({
        Cookie: ownerCookie,
        Authorization: `Bearer lai_${'q'.repeat(40)}`,
      }),
    });

    expect(res.status).toBe(401);
  });
});

describe('scope narrows what the token can do', () => {
  it('read_only may read', async () => {
    const secret = await mint({ scope: 'read_only' });
    expect((await withToken('/api/v1/projects', secret)).status).toBe(200);
  });

  it('read_only may not write, even for an Owner', async () => {
    const secret = await mint({ scope: 'read_only' });

    const res = await withToken('/api/v1/projects', secret, {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope', slug: 'nope', prefix: 'NOP' }),
    });

    expect(res.status).toBe(403);
  });

  it('full may write', async () => {
    const secret = await mint({ scope: 'full' });

    const res = await withToken('/api/v1/projects', secret, {
      method: 'POST',
      body: JSON.stringify({ name: 'Yes', slug: 'yes', prefix: 'YES' }),
    });

    expect(res.status).toBe(201);
  });
});

describe('a project whitelist narrows which projects', () => {
  it('403s a project outside the list, even though the user may read it', async () => {
    const inside = await makeProject('inside');
    await makeProject('outside');

    const secret = await mint({ project_ids: [inside] });

    expect((await withToken('/api/v1/projects/inside', secret)).status).toBe(200);
    // The Owner can read `outside` perfectly well; this token cannot.
    expect((await withToken('/api/v1/projects/outside', secret)).status).toBe(403);
    expect((await withCookie('/api/v1/projects/outside', ownerCookie)).status).toBe(200);
  });
});

describe('last_used_at (§7.2)', () => {
  it('is stamped on first use and not rewritten on the next call', async () => {
    const secret = await mint({});
    expect(h.db.select().from(tokens).get()?.lastUsedAt).toBeNull();

    await withToken('/api/v1/me', secret);
    const first = h.db.select().from(tokens).get()?.lastUsedAt;
    expect(first).not.toBeNull();

    await withToken('/api/v1/me', secret);
    await withToken('/api/v1/me', secret);
    expect(h.db.select().from(tokens).get()?.lastUsedAt).toBe(first);
  });

  it('is rewritten once the window has passed', async () => {
    const secret = await mint({});
    await withToken('/api/v1/me', secret);

    // Age the stamp rather than waiting a minute.
    const aged = Date.now() - LAST_USED_THROTTLE_MS - 1;
    h.db.update(tokens).set({ lastUsedAt: aged }).run();

    await withToken('/api/v1/me', secret);
    expect(h.db.select().from(tokens).get()?.lastUsedAt).toBeGreaterThan(aged);
  });
});

describe('the audit trail says an agent did it (§4.8)', () => {
  it('differs from the same call on a cookie only in actor_kind and token_id', async () => {
    const secret = await mint({});
    const tokenId = h.db.select().from(tokens).get()?.id ?? '';

    await withCookie('/api/v1/projects', ownerCookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ByCookie', slug: 'by-cookie', prefix: 'BYC' }),
    });
    await withToken('/api/v1/projects', secret, {
      method: 'POST',
      body: JSON.stringify({ name: 'ByToken', slug: 'by-token', prefix: 'BYT' }),
    });

    const rows = h.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.type === 'project.created');

    const cookieRow = rows.find((r) => r.payloadJson.includes('by-cookie'));
    const tokenRow = rows.find((r) => r.payloadJson.includes('by-token'));
    expect(cookieRow).toBeDefined();
    expect(tokenRow).toBeDefined();

    expect(cookieRow?.actorKind).toBe('user');
    expect(cookieRow?.actorTokenId).toBeNull();

    expect(tokenRow?.actorKind).toBe('agent');
    expect(tokenRow?.actorTokenId).toBe(tokenId);

    // The actor is the person either way — a token is somebody acting as
    // themselves from somewhere else, not a second identity.
    expect(tokenRow?.actorId).toBe(ownerId);
    expect(cookieRow?.actorId).toBe(ownerId);

    // And nothing else about the two rows differs.
    const shape = (row: typeof cookieRow) => ({
      type: row?.type,
      orgId: row?.orgId,
      actorId: row?.actorId,
      taskId: row?.taskId,
    });
    expect(shape(tokenRow)).toEqual(shape(cookieRow));
  });
});

describe('a token spends its own budget, not its owner’s (§6.3, LAI-138)', () => {
  /**
   * Both directions, deliberately.
   *
   * One direction passing is consistent with the buckets being **merged**: if
   * token and session shared a key, draining either would refuse both, and a
   * test that only checked "the drained one is refused" would go green on the
   * defect. The pair only passes when the two are genuinely separate.
   */
  it('exhausting the token leaves the cookie answering', async () => {
    const secret = await mint({});
    const tokenId = h.db.select().from(tokens).get()?.id ?? '';

    for (let i = 0; i < LIMITS.token.perMinute; i += 1) {
      limiter.take(`token:${tokenId}`, LIMITS.token);
    }

    expect((await withToken('/api/v1/me', secret)).status).toBe(429);
    expect((await withCookie('/api/v1/me', ownerCookie)).status).toBe(200);
  });

  it('exhausting the cookie leaves the token answering', async () => {
    const secret = await mint({});

    for (let i = 0; i < LIMITS.session.perMinute; i += 1) {
      limiter.take(`session:${ownerId}`, LIMITS.session);
    }

    expect((await withCookie('/api/v1/me', ownerCookie)).status).toBe(429);
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);
  });

  it('gives two tokens of one person separate budgets', async () => {
    const first = await mint({ name: 'first' });
    const second = await mint({ name: 'second' });

    const ids = h.db
      .select()
      .from(tokens)
      .all()
      .map((row) => row.id);
    expect(ids).toHaveLength(2);

    // Drain whichever bucket the first token uses.
    await withToken('/api/v1/me', first);
    const firstId =
      h.db
        .select()
        .from(tokens)
        .all()
        .find((r) => r.lastUsedAt !== null)?.id ?? '';
    for (let i = 0; i < LIMITS.token.perMinute; i += 1) {
      limiter.take(`token:${firstId}`, LIMITS.token);
    }

    expect((await withToken('/api/v1/me', first)).status).toBe(429);
    expect((await withToken('/api/v1/me', second)).status).toBe(200);
  });

  it('reports the token’s limit in the header, not the session’s', async () => {
    const secret = await mint({});
    const res = await withToken('/api/v1/me', secret);

    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(LIMITS.token.perMinute));
    expect(res.headers.get('X-RateLimit-Limit')).not.toBe(String(LIMITS.session.perMinute));
  });
});
