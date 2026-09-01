import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, heartbeats, orgs, projects, tokens, users } from '../../../src/db/schema.ts';
import { LIMITS, RateLimiter } from '../../../src/http/rate-limit.ts';
import { BRANCH_MAX_LENGTH, REPO_MAX_LENGTH } from '../../../src/services/heartbeats.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * `POST /api/v1/heartbeats` (SPEC §9.1, §4.10, D-005, D-023).
 *
 * Two properties carry the privacy promise and neither is about permissions:
 * the body refuses anything that is not `repo` or `branch`, and the table has
 * nowhere to put it if it did.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let secret: string;
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

/** A heartbeat as the plugin sends it: a bearer token and nothing else. */
async function beat(body: unknown, token = secret): Promise<Response> {
  return h.app.request('/api/v1/heartbeats', {
    method: 'POST',
    headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  limiter = new RateLimiter(() => 0);
  h = authHarness({ rateLimiter: limiter });
  ownerCookie = await setUp();
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';

  const minted = await h.app.request('/api/v1/tokens', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: ownerCookie }),
    body: JSON.stringify({ name: 'agent', scope: 'full' }),
  });
  expect(minted.status, await minted.clone().text()).toBe(201);
  secret = ((await minted.json()) as { secret: string }).secret;
});

afterEach(() => {
  h.close();
});

describe('the happy path', () => {
  it('accepts a heartbeat with 202 and an empty body', async () => {
    const res = await beat({ repo: 'kvell/laika', branch: 'lai-417-heartbeats' });

    // 202, not 201: nothing is created that a client can go and read, and
    // `matched_task_id` is resolved later or not at all (§9.2 is M5).
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('writes exactly one row with the shape §4.10 describes', async () => {
    await beat({ repo: 'kvell/laika', branch: 'main' });

    const rows = h.db.select().from(heartbeats).all();
    expect(rows).toHaveLength(1);

    expect(rows[0]).toMatchObject({
      userId: ownerId,
      repo: 'kvell/laika',
      branch: 'main',
      // §9.2 is M5. Null rather than a guess at which task this is.
      matchedTaskId: null,
    });
    // Which agent session, so M5's presence view can attribute it.
    expect(rows[0]?.tokenId).not.toBeNull();
    expect(rows[0]?.createdAt).toBeGreaterThan(0);
  });

  it('stores the branch as the plain string it arrives as', async () => {
    // Branch → task resolution is §9.2 and M5. Nothing here parses it, and a
    // branch that looks like a task key is still just a string today.
    await beat({ repo: 'kvell/laika', branch: 'feature/LAI-417-something' });

    expect(h.db.select().from(heartbeats).get()?.branch).toBe('feature/LAI-417-something');
    expect(h.db.select().from(heartbeats).get()?.matchedTaskId).toBeNull();
  });

  it('writes no activity row', async () => {
    // Presence is not an audited action. An agent beating every few minutes
    // would drown the feed that exists so a person can see what *changed*.
    const before = h.db.select().from(activity).all().length;
    await beat({ repo: 'kvell/laika', branch: 'main' });
    await beat({ repo: 'kvell/laika', branch: 'main' });

    expect(h.db.select().from(activity).all().length).toBe(before);
  });
});

describe('token auth only (§9.1)', () => {
  it('refuses a valid session cookie', async () => {
    // The whole point: a cookie resolves a perfectly good actor. Accepting it
    // would turn a session's mere existence into a claim about what somebody is
    // working on.
    const res = await h.app.request('/api/v1/heartbeats', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: ownerCookie }),
      body: JSON.stringify({ repo: 'kvell/laika', branch: 'main' }),
    });

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(h.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('refuses an anonymous caller', async () => {
    const res = await h.app.request('/api/v1/heartbeats', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ repo: 'kvell/laika', branch: 'main' }),
    });

    expect(res.status).toBe(401);
  });

  it('refuses a revoked token', async () => {
    const id = h.db.select().from(tokens).get()?.id ?? '';
    const revoked = await h.app.request(`/api/v1/tokens/${id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ Cookie: ownerCookie }),
    });
    expect(revoked.status).toBe(204);

    expect((await beat({ repo: 'kvell/laika', branch: 'main' })).status).toBe(401);
  });
});

describe('the can() gate (§3.1)', () => {
  it('refuses a read_only token', async () => {
    // **The only path on which `can()` actually says no**, and without it the
    // gate is unguarded: `heartbeat.send_own` is ✓ for every role, so the role
    // never refuses. What refuses is the credential — `heartbeat.send_own` is
    // not a read action, so `tokenAllows` denies it to a `read_only` token.
    //
    // Found by mutation: deleting `assertCan` from the service left every test
    // in this file green. A permission test needs an actor for whom the
    // permission actually differs (LAI-405, LAI-081).
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: ownerCookie }),
      body: JSON.stringify({ name: 'watcher', scope: 'read_only' }),
    });
    expect(minted.status).toBe(201);
    const readOnly = ((await minted.json()) as { secret: string }).secret;

    const res = await beat({ repo: 'kvell/laika', branch: 'main' }, readOnly);

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(h.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('a full token of the same person is accepted, so the refusal is the scope’s', async () => {
    // Otherwise the test above would pass on an endpoint nobody can reach.
    expect((await beat({ repo: 'kvell/laika', branch: 'main' })).status).toBe(202);
  });
});

describe('metadata only (D-005, §13.4)', () => {
  it('refuses a body carrying anything else, rather than ignoring it', async () => {
    // The privacy promise is kept by refusing, not by dropping: a client that
    // believes it sent a diff is how a promise like this quietly stops holding.
    const res = await beat({ repo: 'kvell/laika', branch: 'main', diff: '--- a/x\n+++ b/x' });

    expect(res.status).toBe(422);
    expect(h.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('refuses every field a tempting feature would add', async () => {
    for (const extra of ['files', 'prompt', 'transcript', 'paths', 'diff_stat', 'lines_changed']) {
      const res = await beat({ repo: 'kvell/laika', branch: 'main', [extra]: 'x' });
      expect(res.status, extra).toBe(422);
    }

    expect(h.db.select().from(heartbeats).all()).toHaveLength(0);
  });

  it('requires both fields', async () => {
    expect((await beat({ repo: 'kvell/laika' })).status).toBe(422);
    expect((await beat({ branch: 'main' })).status).toBe(422);
    expect((await beat({})).status).toBe(422);
  });

  it('bounds the lengths', async () => {
    expect((await beat({ repo: 'x'.repeat(REPO_MAX_LENGTH), branch: 'main' })).status).toBe(202);
    expect((await beat({ repo: 'x'.repeat(REPO_MAX_LENGTH + 1), branch: 'main' })).status).toBe(
      422,
    );
    expect((await beat({ repo: 'r', branch: 'x'.repeat(BRANCH_MAX_LENGTH + 1) })).status).toBe(422);
  });
});

describe('the heartbeat rate limit applies (§6.3, §9.1)', () => {
  it('uses the heartbeat budget, not the token one', async () => {
    // Confirmed rather than assumed, as the criterion asks: an unbounded
    // presence endpoint is the one most likely to be hammered.
    const res = await beat({ repo: 'kvell/laika', branch: 'main' });

    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(LIMITS.heartbeat.perMinute));
    expect(res.headers.get('X-RateLimit-Limit')).not.toBe(String(LIMITS.token.perMinute));
  });

  it('refuses once the budget is spent, and leaves other traffic alone', async () => {
    const tokenId = h.db.select().from(tokens).get()?.id ?? '';

    for (let i = 0; i < LIMITS.heartbeat.perMinute; i += 1) {
      limiter.take(`heartbeat:${tokenId}`, LIMITS.heartbeat);
    }

    expect((await beat({ repo: 'kvell/laika', branch: 'main' })).status).toBe(429);

    // A drained presence budget must not stop the agent working — that is why
    // §9.1 gives heartbeats their own bucket rather than the token's.
    const still = await h.app.request('/api/v1/me', {
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });
    expect(still.status).toBe(200);
  });
});

/**
 * Repo → project attribution at the transport edge (§4.3, §9.2, LAI-116).
 *
 * The rule itself is tested in `test/services/heartbeats.test.ts`. What is left
 * here is the part only the route decides: the resolution changes **nothing**
 * about the response, and an operator can still find out about it.
 */
describe('attributing a heartbeat to a project (LAI-116)', () => {
  async function projectTracking(slug: string, prefix: string, repo: string): Promise<string> {
    const res = await h.app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: ownerCookie }),
      body: JSON.stringify({ name: slug, slug, prefix }),
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const { id } = (await res.json()) as { id: string };
    h.db.update(projects).set({ repo }).where(eq(projects.id, id)).run();

    return id;
  }

  it('does not widen the response — §9.1 still answers 202 with no body', async () => {
    await projectTracking('laika', 'LAI', 'kvell/laika');

    const res = await beat({ repo: 'kvell/laika', branch: 'lai-42-x' });

    // The resolution is deliberately not serialised. Widening §9.1's response is
    // a contract change and belongs in its own task, not as a ride-along here.
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('accepts a repo no project tracks, and says so in the log', async () => {
    await projectTracking('laika', 'LAI', 'kvell/laika');

    const res = await beat({ repo: 'someone/else', branch: 'main' });
    expect(res.status).toBe(202);

    // §9.2 degrades and never errors, so the row is written — but a heartbeat
    // naming a repo nobody tracks is almost always a misconfigured plugin, and
    // silently accepting it is how presence is empty for weeks with no clue why.
    const warned = h.log.find('heartbeat.repo_unmatched');
    expect(warned).toBeDefined();
    expect(warned?.repo).toBe('someone/else');
    expect(warned?.level).toBe('warn');

    expect(h.db.select().from(heartbeats).all()).toHaveLength(1);
  });

  it('says nothing when the repo resolves', async () => {
    await projectTracking('laika', 'LAI', 'kvell/laika');

    await beat({ repo: 'kvell/laika', branch: 'main' });

    expect(h.log.find('heartbeat.repo_unmatched')).toBeUndefined();
    expect(h.log.find('heartbeat.repo_ambiguous')).toBeUndefined();
  });

  it('records a monorepo as information, not as a warning', async () => {
    await projectTracking('web', 'WEB', 'kvell/mono');
    await projectTracking('api', 'API', 'kvell/mono');

    await beat({ repo: 'kvell/mono', branch: 'main' });

    // LAI-108 permits this deliberately, so it is not a warning — but an
    // operator still needs to tell "present on two projects" from a bug.
    const noted = h.log.find('heartbeat.repo_ambiguous');
    expect(noted).toBeDefined();
    expect(noted?.level).toBe('info');
    expect(noted?.project_count).toBe(2);
  });

  it('says nothing when the branch narrows a monorepo to one project', async () => {
    await projectTracking('web', 'WEB', 'kvell/mono');
    await projectTracking('api', 'API', 'kvell/mono');

    await beat({ repo: 'kvell/mono', branch: 'api-42-add-crud' });

    expect(h.log.find('heartbeat.repo_ambiguous')).toBeUndefined();
  });
});

describe('a disabled org answers 202 and stores nothing (§4.2, LAI-150)', () => {
  it('is 202 in both states, so the client contract does not change', async () => {
    const enabled = await beat({ repo: 'kvell/laika', branch: 'main' });
    expect(enabled.status).toBe(202);
    expect(await enabled.text()).toBe('');

    h.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const disabled = await beat({ repo: 'kvell/laika', branch: 'main' });

    // Not 403 and not 409. A plugin must not start reporting errors because an
    // org turned a feature off — §9.2's "degrades, never errors" is about the
    // whole endpoint, and an operator who disabled presence does not want an
    // alert storm as the receipt.
    expect(disabled.status).toBe(202);
    expect(await disabled.text()).toBe('');
  });

  it('stores the first and not the second', async () => {
    await beat({ repo: 'kvell/laika', branch: 'main' });
    h.db.update(orgs).set({ presenceEnabled: 0 }).run();
    await beat({ repo: 'kvell/laika', branch: 'main' });

    expect(h.db.select().from(heartbeats).all()).toHaveLength(1);
  });

  it('still refuses a cookie, because §9.1 is about the credential', async () => {
    h.db.update(orgs).set({ presenceEnabled: 0 }).run();

    const res = await h.app.request('/api/v1/heartbeats', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: ownerCookie }),
      body: JSON.stringify({ repo: 'kvell/laika', branch: 'main' }),
    });

    // Disabled must not become a path with different auth. The credential rule
    // is §9.1's and has nothing to do with whether rows are kept.
    expect(res.status).toBe(403);
  });
});
