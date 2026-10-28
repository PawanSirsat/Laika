import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadActor, type ResolvedActor, resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import {
  hashRequest,
  IDEMPOTENCY_TTL_MS,
  idempotencyOwner,
  lookup,
  pruneExpired,
  remember,
} from '../../src/http/idempotency.ts';
import { CACHEABLE_ROUTES, cacheableRoute } from '../../src/http/middleware/idempotency.ts';
import { pruneIdempotencyKeys } from '../../src/jobs/jobs.ts';
import { idempotencyKeys, orgs, projects, tasks, users } from '../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

const PASSWORD = 'correct-horse-battery-staple';

describe('idempotency store (SPEC §6.3)', () => {
  let h: AuthHarness;

  beforeEach(() => {
    h = authHarness();
  });
  afterEach(() => {
    h.close();
  });

  const fingerprint = hashRequest('POST', '/api/v1/tasks', '{"title":"a"}');

  it('reports an unseen key as fresh', () => {
    expect(lookup(h.db, 'user-1', 'key-1', fingerprint, 1_000).kind).toBe('fresh');
  });

  it('replays the stored response for the same actor, key and body', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{"id":"t1"}' }, 1_000);

    const found = lookup(h.db, 'user-1', 'key-1', fingerprint, 2_000);

    expect(found.kind).toBe('replay');
    expect(found.response).toEqual({ status: 201, body: '{"id":"t1"}' });
  });

  it('reports conflict when the same key carries a different body', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{}' }, 1_000);

    const other = hashRequest('POST', '/api/v1/tasks', '{"title":"something else"}');
    expect(lookup(h.db, 'user-1', 'key-1', other, 2_000).kind).toBe('conflict');
  });

  it('scopes keys per actor, so one caller cannot replay another response', () => {
    remember(
      h.db,
      'user-1',
      'shared-key',
      fingerprint,
      { status: 201, body: '{"secret":1}' },
      1_000,
    );

    expect(lookup(h.db, 'user-2', 'shared-key', fingerprint, 2_000).kind).toBe('fresh');
  });

  it('treats an entry past its 24h TTL as unseen', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{}' }, 1_000);

    expect(lookup(h.db, 'user-1', 'key-1', fingerprint, 1_000 + IDEMPOTENCY_TTL_MS).kind).toBe(
      'fresh',
    );
  });

  it('prunes expired rows without touching live ones', () => {
    remember(h.db, 'u', 'old', fingerprint, { status: 200, body: '{}' }, 1_000);
    remember(h.db, 'u', 'new', fingerprint, { status: 200, body: '{}' }, 1_000_000);

    pruneExpired(h.db, 1_000 + IDEMPOTENCY_TTL_MS + 1);

    expect(lookup(h.db, 'u', 'old', fingerprint, 1_000_001).kind).toBe('fresh');
    expect(lookup(h.db, 'u', 'new', fingerprint, 1_000_001).kind).toBe('replay');
  });

  it('fingerprints method, path and body together', () => {
    const a = hashRequest('POST', '/a', '{}');
    expect(hashRequest('POST', '/b', '{}')).not.toBe(a);
    expect(hashRequest('PATCH', '/a', '{}')).not.toBe(a);
    expect(hashRequest('POST', '/a', '{"x":1}')).not.toBe(a);
    expect(hashRequest('POST', '/a', '{}')).toBe(a);
  });
});

describe('Idempotency-Key over HTTP', () => {
  let h: AuthHarness;
  let owner: { cookie: string; id: string };
  let bob: { cookie: string; id: string };
  let carol: { cookie: string; id: string };

  async function req(path: string, init: RequestInit, auth: { cookie?: string; bearer?: string }) {
    return h.app.request(path, {
      ...init,
      headers: jsonHeaders({
        ...(auth.cookie === undefined ? {} : { Cookie: auth.cookie }),
        ...(auth.bearer === undefined ? {} : { Authorization: `Bearer ${auth.bearer}` }),
        ...((init.headers as Record<string, string>) ?? {}),
      }),
    });
  }

  /** Setup writes go through here, so one that fails cannot pass silently. */
  async function must(res: Response, status = 201): Promise<Record<string, unknown>> {
    expect(res.status, await res.clone().text()).toBe(status);
    return (await res.json()) as Record<string, unknown>;
  }

  async function join(email: string, orgRole: 'member' | 'viewer') {
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const token = seedInvite(h.db, { orgId, createdBy: owner.id, email, orgRole });
    const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(res.status, await res.clone().text()).toBe(200);
    return {
      cookie: cookieFrom(res),
      id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
    };
  }

  function createTask(
    key: string | undefined,
    title: string,
    auth: { cookie?: string; bearer?: string },
  ) {
    return req(
      '/api/v1/projects/core/tasks',
      {
        method: 'POST',
        body: JSON.stringify({ title }),
        headers: key === undefined ? {} : { 'Idempotency-Key': key },
      },
      auth,
    );
  }

  const taskCount = () => h.db.select().from(tasks).all().length;
  const rows = () => h.db.select().from(idempotencyKeys).all();

  beforeEach(async () => {
    h = authHarness();
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
    expect(setup.status).toBe(201);
    owner = {
      cookie: cookieFrom(setup),
      id: h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '',
    };
    await must(
      await req(
        '/api/v1/projects',
        { method: 'POST', body: JSON.stringify({ name: 'Core', slug: 'core', prefix: 'COR' }) },
        { cookie: owner.cookie },
      ),
    );
    bob = await join('bob@example.test', 'member');
    carol = await join('carol@example.test', 'member');
    for (const [who, role] of [
      [bob, 'member'],
      [carol, 'viewer'],
    ] as const) {
      await must(
        await req(
          '/api/v1/projects/core/members',
          { method: 'POST', body: JSON.stringify({ user_id: who.id, role }) },
          { cookie: owner.cookie },
        ),
      );
    }
  });
  afterEach(() => {
    h.close();
  });

  it('runs the route once and replays the stored response', async () => {
    const first = await must(await createTask('k1', 'Ship it', { cookie: bob.cookie }));
    const second = await createTask('k1', 'Ship it', { cookie: bob.cookie });

    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replay')).toBe('true');
    expect(((await second.json()) as { id: string }).id).toBe(first.id);
    // The whole point: the second request did not create a second thing.
    expect(taskCount()).toBe(1);
  });

  it('returns conflict when the key is reused with a different body', async () => {
    await must(await createTask('k1', 'Ship it', { cookie: bob.cookie }));
    const clash = await createTask('k1', 'Something else', { cookie: bob.cookie });

    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe('conflict');
    expect(taskCount()).toBe(1);
  });

  it('does nothing when no key is supplied, and treats different keys as different', async () => {
    await must(await createTask(undefined, 'a', { cookie: bob.cookie }));
    await must(await createTask(undefined, 'a', { cookie: bob.cookie }));
    await must(await createTask('k1', 'a', { cookie: bob.cookie }));
    await must(await createTask('k2', 'a', { cookie: bob.cookie }));
    expect(taskCount()).toBe(4);
  });

  it('keeps nothing for a route not on the allow-list (LAI-534 round 2)', async () => {
    const task = await must(await createTask(undefined, 'a', { cookie: bob.cookie }));
    const before = rows().length;
    for (let i = 0; i < 2; i += 1) {
      const moved = await req(
        `/api/v1/tasks/${String(task.id)}/claim`,
        { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'claim-1' } },
        { cookie: bob.cookie },
      );
      expect(moved.headers.get('Idempotent-Replay')).toBeNull();
    }
    expect(cacheableRoute(`/api/v1/tasks/${String(task.id)}/claim`)).toBeNull();
    expect(rows().length).toBe(before);
  });

  it('never stores a better-auth answer, which carries a session token (LAI-534)', async () => {
    // The positive control: the store is on for this person.
    await must(await createTask('control', 'a', { cookie: owner.cookie }));
    expect(rows()).toHaveLength(1);

    const signedIn = await h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: owner.cookie, 'Idempotency-Key': 'sign-in' }),
      body: JSON.stringify({ email: 'ada@example.test', password: PASSWORD }),
    });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const sessionToken = ((await signedIn.json()) as { token?: string }).token;
    expect(sessionToken?.length ?? 0).toBeGreaterThan(10);

    expect(rows()).toHaveLength(1);
    expect(JSON.stringify(rows())).not.toContain(sessionToken);
  });

  describe('a replay is authorised again, against the actor as it is now (round 2)', () => {
    it('the same agent token after its grant was removed: the fresh 403, not the stored 201', async () => {
      const agent = await must(
        await req(
          '/api/v1/agents',
          {
            method: 'POST',
            body: JSON.stringify({
              display_name: 'a',
              harness: 'other',
              grants: [{ project_id: coreId(), scope: 'full' }],
            }),
          },
          { cookie: bob.cookie },
        ),
      );
      const secret = agent.secret as string;
      const agentId = (agent.agent as { id: string }).id;
      await must(await createTask('agent-1', 'by the agent', { bearer: secret }));

      // While the grant holds, the replay is a replay.
      const kept = await createTask('agent-1', 'by the agent', { bearer: secret });
      expect(kept.headers.get('Idempotent-Replay')).toBe('true');

      await must(
        await req(
          `/api/v1/agents/${agentId}/grants`,
          { method: 'PUT', body: JSON.stringify({ grants: [] }) },
          { cookie: bob.cookie },
        ),
        200,
      );
      const replay = await createTask('agent-1', 'by the agent', { bearer: secret });
      expect(replay.headers.get('Idempotent-Replay')).toBeNull();
      expect(replay.status).toBe(403);
      expect(
        ((await replay.json()) as { error: { code: string; details: { reason: string } } }).error,
      ).toMatchObject({ code: 'forbidden', details: { reason: 'agent_not_granted' } });
      expect(taskCount()).toBe(1);
    });

    it('a web session after its membership was removed: the fresh 403, not the stored 201', async () => {
      await must(await createTask('bob-1', 'by Bob', { cookie: bob.cookie }));
      await must(
        await req(
          `/api/v1/projects/core/members/${bob.id}`,
          { method: 'DELETE' },
          { cookie: owner.cookie },
        ),
        200,
      );

      const replay = await createTask('bob-1', 'by Bob', { cookie: bob.cookie });
      expect(replay.headers.get('Idempotent-Replay')).toBeNull();
      expect(replay.status).toBe(403);
      expect(((await replay.json()) as { error: { code: string } }).error.code).toBe('forbidden');
      expect(taskCount()).toBe(1);
      // The earned row is kept, not overwritten by the refusal.
      expect(rows()).toHaveLength(1);
    });
  });

  /**
   * Each entry's question gives its route's answer, across the narrowings that
   * tell neighbouring actions apart (Codex round 3): a refused role, a space
   * whose task creation is lead-only (where `task.create` and `task.write`
   * differ), a `read_only` token, and a token pinned to another project. So a
   * stored answer is replayed exactly when a fresh request would be allowed,
   * for these cases; an entry whose action drifts to one of its neighbours
   * goes red here.
   */
  describe('every allow-listed route asks again what its route asks', () => {
    interface Cred {
      label: string;
      auth: { cookie?: string; bearer?: string };
      actor: () => ResolvedActor;
    }

    it('agrees with the route for each allowed and refused credential, every entry', async () => {
      // A second space whose task creation is lead-only, with Bob a member.
      const lead = await must(
        await req(
          '/api/v1/projects',
          { method: 'POST', body: JSON.stringify({ name: 'Lead', slug: 'lead', prefix: 'LED' }) },
          { cookie: owner.cookie },
        ),
      );
      await must(
        await req(
          '/api/v1/projects/lead',
          { method: 'PATCH', body: JSON.stringify({ task_create_min_role: 'lead' }) },
          { cookie: owner.cookie },
        ),
        200,
      );
      await must(
        await req(
          '/api/v1/projects/lead/members',
          { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
          { cookie: owner.cookie },
        ),
      );

      const mint = async (label: string, body: unknown): Promise<Cred> => {
        const minted = await must(
          await req(
            '/api/v1/tokens',
            { method: 'POST', body: JSON.stringify(body) },
            {
              cookie: owner.cookie,
            },
          ),
        );
        const secret = minted.secret as string;
        return {
          label,
          auth: { bearer: secret },
          actor: () => resolveTokenActor(h.db, secret, Date.now()),
        };
      };
      const session = (label: string, who: { cookie: string; id: string }): Cred => ({
        label,
        auth: { cookie: who.cookie },
        actor: () => loadActor(h.db, who.id)!,
      });

      const ownerSession = session('owner session', owner);
      const ownerToken = await mint('owner full token', { name: 'full', scope: 'full' });
      const readOnly = await mint('owner read_only token', { name: 'ro', scope: 'read_only' });
      const pinnedElsewhere = await mint('owner token pinned to another space', {
        name: 'pinned',
        scope: 'full',
        project_ids: [lead.id],
      });
      const viewer = session('project viewer', carol);
      const member = session('org member', bob);
      const leadOnlyMember = session('member where creating is lead-only', bob);

      const task = await must(await createTask(undefined, 'target', { cookie: owner.cookie }));
      const blocker = await must(await createTask(undefined, 'blocker', { cookie: owner.cookie }));
      let n = 0;
      const cases: { path: string; body: () => unknown; refused: Cred[]; allowed: Cred[] }[] = [
        {
          path: '/api/v1/projects',
          body: () => ({
            name: `X${String(++n)}`,
            slug: `xx${String(n)}`,
            prefix: `XQ${String(n)}`,
          }),
          refused: [member, readOnly, pinnedElsewhere],
          allowed: [ownerSession],
        },
        {
          path: '/api/v1/projects/core/tasks',
          body: () => ({ title: 't' }),
          refused: [viewer, readOnly, pinnedElsewhere],
          allowed: [ownerSession, ownerToken],
        },
        {
          // `task.create`, not `task.write`: a member may write here, not create.
          path: '/api/v1/projects/lead/tasks',
          body: () => ({ title: 't' }),
          refused: [leadOnlyMember],
          allowed: [ownerSession],
        },
        {
          path: '/api/v1/projects/core/sprints',
          body: () => ({ name: 's', starts_on: 1, ends_on: 86_400_000 }),
          refused: [viewer, member, readOnly, pinnedElsewhere],
          allowed: [ownerSession],
        },
        {
          path: `/api/v1/tasks/${String(task.id)}/comments`,
          body: () => ({ body_md: 'hi' }),
          refused: [viewer, readOnly, pinnedElsewhere],
          allowed: [ownerSession, ownerToken],
        },
        {
          path: `/api/v1/tasks/${String(task.id)}/dependencies`,
          body: () => ({ blocked_by_task_id: blocker.id }),
          refused: [viewer, readOnly, pinnedElsewhere],
          allowed: [ownerSession],
        },
      ];
      // Every entry is exercised: a new one without a case fails here.
      for (const route of CACHEABLE_ROUTES) {
        expect(
          cases.some((c) => route.pattern.test(c.path)),
          String(route.pattern),
        ).toBe(true);
      }

      for (const { path, body, refused, allowed } of cases) {
        const listed = cacheableRoute(path);
        expect(listed, path).not.toBeNull();

        for (const cred of refused) {
          const no = await req(path, { method: 'POST', body: JSON.stringify(body()) }, cred.auth);
          expect(no.status, `${path} · ${cred.label} · fresh`).toBe(403);
          expect(
            listed?.route.mayStill(h.db, cred.actor(), listed.param),
            `${path} · ${cred.label} · replay`,
          ).toBe(false);
        }
        for (const cred of allowed) {
          const yes = await req(path, { method: 'POST', body: JSON.stringify(body()) }, cred.auth);
          expect(yes.status, `${path} · ${cred.label} · fresh: ${await yes.clone().text()}`).toBe(
            201,
          );
          expect(
            listed?.route.mayStill(h.db, cred.actor(), listed.param),
            `${path} · ${cred.label} · replay`,
          ).toBe(true);
        }
      }
    });
  });

  describe('rows from before LAI-534 round 2 (they may hold secrets)', () => {
    it('are never replayed, and the retention job deletes them, and expired rows, and keeps live ones', async () => {
      const now = Date.now();
      const body = JSON.stringify({ title: 'old' });
      const fingerprint = hashRequest('POST', '/api/v1/projects/core/tasks', body);
      // The old owner format: the bare user id, holding a secret-shaped body.
      remember(
        h.db,
        bob.id,
        'old-key',
        fingerprint,
        { status: 201, body: '{"secret":"lai_plaintext_from_before"}' },
        now,
      );
      remember(
        h.db,
        'v2:user:someone',
        'expired',
        fingerprint,
        { status: 201, body: '{}' },
        now - IDEMPOTENCY_TTL_MS - 1,
      );

      // Not replayed: the lookup asks for the new owner, so the route runs.
      const fresh = await req(
        '/api/v1/projects/core/tasks',
        { method: 'POST', body, headers: { 'Idempotency-Key': 'old-key' } },
        { cookie: bob.cookie },
      );
      expect(fresh.status).toBe(201);
      expect(fresh.headers.get('Idempotent-Replay')).toBeNull();
      expect(await fresh.text()).not.toContain('lai_plaintext_from_before');
      const live = idempotencyOwner(loadActor(h.db, bob.id)!);

      expect(pruneIdempotencyKeys(h.db, now)).toEqual({ changed: 2 });
      const left = rows();
      expect(left.map((r) => r.actorId)).toEqual([live]);
      expect(JSON.stringify(left)).not.toContain('lai_plaintext_from_before');
      // And again, nothing more: it is safe to run hourly and at every boot.
      expect(pruneIdempotencyKeys(h.db, now)).toEqual({ changed: 0 });
      expect(
        h.db
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.actorId, live), eq(idempotencyKeys.key, 'old-key')))
          .all(),
      ).toHaveLength(1);
    });
  });

  function coreId(): string {
    const id = h.db.select().from(projects).where(eq(projects.slug, 'core')).get()?.id;
    expect(id, 'the core project exists').toBeDefined();
    return id ?? '';
  }
});
