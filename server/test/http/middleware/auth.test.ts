import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAST_USED_THROTTLE_MS, resetReadOnlyWarning } from '../../../src/auth/tokens.ts';
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

/**
 * A broken database is not a bad credential (SPEC §6.3, LAI-437).
 *
 * Found by breaking a real instance: a database file restored with the wrong
 * owner made **every** token request answer `401 — "Not signed in"`. The cause
 * was in the log and not in the response:
 *
 * ```
 * {"message":"attempt to write a readonly database","event":"auth.resolve_failed"}
 * {"code":"unauthorized","status":401,"message":"Not signed in"}
 * ```
 *
 * `PRAGMA query_only` rather than `chmod`: it produces the same
 * `SQLITE_READONLY` from the same driver, deterministically, on any machine and
 * whatever user the suite runs as.
 */

describe('a read-only database still serves reads (LAI-156)', () => {
  /**
   * The condition an operator actually hits — a restored file with the wrong
   * owner, a full volume, a read-only mount.
   *
   * The stale stamp is the whole fixture. `touchTokenUsage` is throttled to one
   * write a minute, so a token used seconds ago writes nothing and would serve
   * this request whatever the disk was doing. **That was the old failure mode:**
   * a read-only instance worked for sixty seconds after each token's last use
   * and then stopped, so a total outage looked intermittent.
   */
  async function readOnlyWithStaleStamp(): Promise<string> {
    const secret = await mint({});
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    h.db.update(tokens).set({ lastUsedAt: null }).run();
    resetReadOnlyWarning();
    h.t.sqlite.pragma('query_only = ON');
    return secret;
  }

  afterEach(() => {
    // Before `h.close()`, which needs to write.
    h.t.sqlite.pragma('query_only = OFF');
    resetReadOnlyWarning();
  });

  it('serves a GET with a valid token whose stamp is stale', async () => {
    const secret = await readOnlyWithStaleStamp();

    const res = await withToken('/api/v1/me', secret);

    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('still refuses a write', async () => {
    // The relaxation is the auth layer's own bookkeeping and nothing else. A
    // POST that reported success while storing nothing would be far worse than
    // the outage this replaces.
    const secret = await readOnlyWithStaleStamp();

    const res = await withToken('/api/v1/projects', secret, {
      method: 'POST',
      body: JSON.stringify({ name: 'New', slug: 'new', prefix: 'NEW' }),
    });

    expect(res.status).not.toBe(201);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('says so in the log, once, not once per request', async () => {
    const secret = await readOnlyWithStaleStamp();

    for (let i = 0; i < 4; i++) expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    const lines = h.log.records.filter((r) => r.event === 'token.last_used_unwritable');
    expect(lines, 'the degradation was never reported').toHaveLength(1);
    expect(String((lines[0] as { effect?: unknown }).effect)).toMatch(/reads continue/i);
  });

  it('reports it again if the database goes read-only a second time', async () => {
    // "Once per process" would announce the first outage and stay silent through
    // every later one — the version of this that looks identical and is worse.
    const secret = await readOnlyWithStaleStamp();
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    // Recover: the next successful stamp clears the flag.
    h.t.sqlite.pragma('query_only = OFF');
    h.db.update(tokens).set({ lastUsedAt: null }).run();
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    // And fail again.
    h.db.update(tokens).set({ lastUsedAt: null }).run();
    h.t.sqlite.pragma('query_only = ON');
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    expect(h.log.records.filter((r) => r.event === 'token.last_used_unwritable')).toHaveLength(2);
  });

  it('does not swallow a write failure that is not read-only', async () => {
    // **The narrow catch, asserted against the write itself.**
    //
    // The first version of this dropped a table and got its 500 from
    // `loadActor`'s *read* failing — so it passed whether the catch was narrow
    // or caught everything, which a mutation proved. A trigger that aborts the
    // UPDATE leaves every read working and fails exactly the statement the catch
    // wraps, with `SQLITE_CONSTRAINT_TRIGGER` rather than `SQLITE_READONLY`.
    const secret = await mint({});
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    h.db.update(tokens).set({ lastUsedAt: null }).run();
    h.t.sqlite.exec(
      "CREATE TRIGGER no_stamp BEFORE UPDATE ON tokens BEGIN SELECT RAISE(ABORT, 'nope'); END",
    );

    const res = await withToken('/api/v1/me', secret);

    expect(res.status, await res.clone().text()).toBe(500);
    h.t.sqlite.exec('DROP TRIGGER no_stamp');
  });
});

describe('a resolver failure that is not a credential problem', () => {
  /**
   * **Re-based by LAI-156.** These originally used a read-only database, because
   * `touchTokenUsage`'s stamp was the resolver's only write and it threw. That
   * write is now survivable on purpose — a read-only instance serves reads — so
   * using it here would test the opposite of what LAI-437 established.
   *
   * The property LAI-437 pinned is unchanged and is the one that matters: **a
   * resolver failure that is not a credential problem is `internal`, never
   * `unauthorized`.** It just needs a failure that is still a failure. Dropping
   * a table the resolver reads is one: `SQLITE_ERROR`, not `SQLITE_READONLY`, so
   * LAI-156's narrow catch does not apply and it reaches the error handler.
   */
  async function breakTheResolver(): Promise<string> {
    const secret = await mint({});

    // Working first, so a later 500 cannot be a token that was never valid.
    expect((await withToken('/api/v1/me', secret)).status).toBe(200);

    // `loadActor` joins this to build the actor's memberships.
    h.t.sqlite.exec('DROP TABLE project_memberships');
    return secret;
  }

  it('answers internal, not unauthorized', async () => {
    const secret = await breakTheResolver();

    const res = await withToken('/api/v1/me', secret);

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal');
  });

  it('still says unauthorized for a token that is actually invalid', async () => {
    // **The other direction, and the fix is not done without it.** "Answer 500
    // to everything" satisfies the test above and is a worse bug than the one
    // being fixed — it would tell an operator the disk is broken every time
    // somebody mistypes a token.
    await breakTheResolver();

    const res = await withToken('/api/v1/me', `lai_${'a'.repeat(43)}`);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('does not leak the driver message to the caller', async () => {
    const secret = await breakTheResolver();

    const body = await (await withToken('/api/v1/me', secret)).text();

    // The operator needs the SQLite message; the caller gets a request id to
    // quote (§13.2) and nothing about the schema.
    expect(body).not.toContain('project_memberships');
    expect(body).toContain('request_id');
  });

  it('keeps the log line that made this diagnosable', async () => {
    // AC5. It names the layer — `http.unhandled` names only the request — and it
    // is the reason this took two minutes to find rather than twenty.
    const secret = await breakTheResolver();

    await withToken('/api/v1/me', secret);

    const line = h.log.find('auth.resolve_failed');
    expect(line, 'auth.resolve_failed is no longer logged').toBeDefined();
    expect(String((line as { message?: unknown }).message)).toMatch(/project_memberships/i);
  });

  it('refuses sign-in as internal rather than as wrong credentials', async () => {
    // AC3. It already did, because better-auth surfaces its own 500 and
    // `translateAuthResponse` maps 5xx to `internal` — accidental until
    // something asserts it. The failure this guards against is the LAI-090 one:
    // an infrastructure fault rendered as "Email or password is wrong."
    // Sign-in writes a session row, so a read-only database genuinely stops it —
    // unlike the resolver's stamp, which LAI-156 made survivable.
    h.t.sqlite.pragma('query_only = ON');

    const res = await h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'ada@example.test', password: PASSWORD }),
    });

    expect(res.status).toBe(500);
    const body = await res.text();
    expect((JSON.parse(body) as { error: { code: string } }).error.code).toBe('internal');
    expect(body).not.toMatch(/password is wrong|not valid|Not signed in/i);

    h.t.sqlite.pragma('query_only = OFF');
  });
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

  it('logs which of those it was, even though it does not say (LAI-437)', async () => {
    // The other half of the test below: the caller learns nothing, **and the
    // operator learns everything**, which is the whole design in `tokens.ts`.
    //
    // This was broken and silent. `TokenAuthError extends ApiError`, so LAI-442
    // adding an `instanceof ApiError` branch above the token branch made the
    // token branch unreachable: every rejection logged `auth.session_refused`
    // with `code: 'unauthorized'` and no `reason`, so revoked, expired and
    // never-existed became one line. The status was right throughout, which is
    // why nothing noticed.
    const secret = await mint({});
    // Revoked straight in the table: the subject is the middleware's
    // classification, and routing through the revoke endpoint would make this
    // fail for reasons that have nothing to do with it.
    h.db.update(tokens).set({ revokedAt: 1 }).run();

    expect((await withToken('/api/v1/me', secret)).status).toBe(401);

    const line = h.log.find('auth.token_rejected');
    expect(line, 'auth.token_rejected is unreachable again').toBeDefined();
    // The specific reason, not merely that something was logged: a branch that
    // logs `unknown` for a revoked token satisfies "a line exists" and is the
    // failure this is here to catch.
    expect((line as { reason?: unknown }).reason).toBe('revoked');
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

/**
 * The two refusal logs, and the order they are tested in (LAI-443).
 *
 * **Placed next to the token case above on purpose.** `TokenAuthError extends
 * ApiError`, so which branch runs is decided entirely by which `instanceof` is
 * checked first — and that ordering is invisible from either test alone. LAI-442
 * put the `ApiError` branch above the token branch and made the token branch
 * unreachable for a day; `auth.token_rejected` stopped being written and **every
 * test still passed**, because the status was `401` either way.
 *
 * §6.1 keeps the reason out of the response deliberately, so these lines are the
 * *only* place the distinction survives. An operator asking "why was this
 * refused" has nothing else to read.
 */
describe('the refusal logs say which refusal it was', () => {
  function deactivate(): void {
    // Directly: the API refuses to deactivate the last Owner (LAI-222), and that
    // invariant is not what this is about.
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, ownerId)).run();
  }

  it('logs session_refused, with its code, for a deactivated account', async () => {
    // Working first, so this cannot pass against a cookie that was never valid.
    expect((await withCookie('/api/v1/me', ownerCookie)).status).toBe(200);

    deactivate();

    expect((await withCookie('/api/v1/me', ownerCookie)).status).toBe(403);

    const line = h.log.find('auth.session_refused');
    expect(line, 'auth.session_refused is no longer reachable').toBeDefined();
    // The **specific** code. "A line exists" is satisfied by a branch logging
    // the wrong thing, which is the failure mode this whole pair is about.
    expect((line as { code?: unknown }).code).toBe('forbidden');
  });

  it('logs token_rejected and not session_refused for a refused token', async () => {
    // **The ordering, asserted as an ordering.** This is the assertion that was
    // missing when LAI-442 landed: both branches were individually correct, and
    // the one above swallowed the one below.
    const secret = await mint({});
    h.db.update(tokens).set({ revokedAt: 1 }).run();

    expect((await withToken('/api/v1/me', secret)).status).toBe(401);

    expect(h.log.find('auth.token_rejected'), 'the specific branch was skipped').toBeDefined();
    expect(
      h.log.find('auth.session_refused'),
      'the ApiError branch caught a TokenAuthError — it is a subclass, so it must be checked second',
    ).toBeUndefined();
  });

  it('logs session_refused and not token_rejected for a deactivated account', async () => {
    // And the other direction, so "log both lines every time" does not satisfy
    // the pair. A reader learns nothing from two lines that always appear.
    deactivate();

    expect((await withCookie('/api/v1/me', ownerCookie)).status).toBe(403);

    expect(h.log.find('auth.session_refused')).toBeDefined();
    expect(h.log.find('auth.token_rejected')).toBeUndefined();
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
