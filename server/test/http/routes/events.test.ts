import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor } from '../../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../../src/db/activity.ts';
import { type ActivityType } from '../../../src/db/enums.ts';
import { newId } from '../../../src/db/ids.ts';
import { agents, orgs, tasks, tokens, users } from '../../../src/db/schema.ts';
import { type AppEnv } from '../../../src/http/context.ts';
import { createErrorHandler } from '../../../src/http/error-handler.ts';
import { eventRoutes, MAX_QUEUED_FRAMES, RECONNECT_MS } from '../../../src/http/routes/events.ts';
import { ActivityFeed, type RepeatingTimer } from '../../../src/services/activity-feed.ts';
import { registerAgent, revokeAgent } from '../../../src/services/agents.ts';
import { expireClaims } from '../../../src/services/claims.ts';
import { MAX_REPLAY } from '../../../src/services/events.ts';
import { addMember, createProject } from '../../../src/services/projects.ts';
import { createTask, startWorking } from '../../../src/services/tasks.ts';
import { createToken, revokeOwnToken } from '../../../src/services/tokens.ts';
import { captureLog } from '../../helpers/app.ts';
import { authHarness, cookieFrom, jsonHeaders, type AuthHarness } from '../../helpers/auth.ts';
import { freshDb, type TestDb } from '../../helpers/db.ts';

// ------------------------------------------------------------- reading frames

interface Frame {
  event: string | null;
  id: string | null;
  data: string;
  retry: number | null;
  comment: string | null;
}

function parseFrame(raw: string): Frame {
  const frame: Frame = { event: null, id: null, data: '', retry: null, comment: null };
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('retry: ')) frame.retry = Number(line.slice(7));
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }

  frame.data = data.join('\n');
  return frame;
}

/**
 * An SSE client over the response body.
 *
 * Frames are read one at a time rather than "collect for N ms": a test that waits
 * a fixed period is a test that is slow when it passes and flaky when it fails.
 */
function sseClient(res: Response) {
  const body: ReadableStream<Uint8Array> | null = res.body;
  if (body === null) throw new Error('no response body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function raw(): Promise<string | null> {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return frame;
      }

      const chunk = await reader.read();
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  return {
    /** The next frame, or a failure if the stream ended instead. */
    async next(): Promise<Frame> {
      const frame = await raw();
      if (frame === null) throw new Error(`stream ended; buffered: ${JSON.stringify(buffer)}`);
      return parseFrame(frame);
    },
    /** The next frame, or `null` if the server closed the stream. */
    async nextOrEnd(): Promise<Frame | null> {
      const frame = await raw();
      return frame === null ? null : parseFrame(frame);
    },
    async disconnect(): Promise<void> {
      await reader.cancel();
    },
  };
}

const noop = (): void => undefined;

/** Let the stream's write chain settle after an event that is not awaited. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

// ------------------------------------------------------------- a bare mounting
//
// The full chain is exercised further down; these tests need the actor, the feed
// and the keepalive timer under the test's control, so they mount the router on
// its own.

let t: TestDb;
let ownerId: string;
let orgId: string;
let laikaId: string;
let otherId: string;
let feed: ActivityFeed;
let timers: { armed: number; cleared: number; intervals: number[]; fire: () => void };

function makeUser(orgRole: 'owner' | 'admin' | 'member' | 'viewer'): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string) {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function member(slug: string, role: 'lead' | 'member' | 'viewer'): string {
  const id = makeUser(role === 'viewer' ? 'viewer' : 'member');
  addMember(t.db, actor(ownerId), slug, id, role);
  return id;
}

function write(projectId: string | null, type: ActivityType = 'task.created'): void {
  appendActivity(t.db, {
    orgId,
    projectId,
    actorId: ownerId,
    actorKind: 'user',
    type,
    payload: { note: 'hello' },
  });
}

/**
 * The router mounted where the app mounts it, with `actor` already resolved.
 *
 * `keepaliveMs` is injected as 1 by default so a test can fire the timer by hand.
 * Pass `{ shippedKeepalive: true }` to leave it out and exercise the real default
 * — which is the only way to prove the number AC5 names is actually wired.
 */
function bareApp(
  userId: string | null,
  options: {
    shippedKeepalive?: boolean;
    token?: string;
    now?: () => number;
    /** Runs after the actor is resolved and before the stream starts. */
    afterAuth?: () => void;
  } = {},
): Hono<AppEnv> {
  const log = captureLog();
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('log', log.logger);
    c.set('requestId', 'test');
    c.set(
      'actor',
      options.token === undefined
        ? userId === null
          ? null
          : actor(userId)
        : resolveTokenActor(t.db, options.token, options.now?.() ?? Date.now()),
    );
    options.afterAuth?.();
    await next();
  });

  app.onError(createErrorHandler(log.logger));

  app.route(
    '/api/v1/events',
    eventRoutes({
      db: t.db,
      feed,
      ...(options.now === undefined ? {} : { now: options.now }),
      // Omitted entirely rather than passed as `undefined`: under
      // `exactOptionalPropertyTypes` those are different things, and only the
      // omission reaches the `?? KEEPALIVE_MS` default.
      ...(options.shippedKeepalive === true ? {} : { keepaliveMs: 1 }),
      setTimer: (fn, ms) => {
        timers.armed += 1;
        timers.intervals.push(ms);
        timers.fire = fn;
        return {} satisfies RepeatingTimer;
      },
      clearTimer: () => {
        timers.cleared += 1;
      },
    }),
  );

  return app;
}

async function connect(userId: string, query = '') {
  const res = await bareApp(userId).request(`/api/v1/events${query}`);
  expect(res.status).toBe(200);
  return { res, client: sseClient(res) };
}

/** For the cases that must *not* produce a stream. */
async function refused(
  userId: string | null,
  query = '',
): Promise<{ status: number; code: string }> {
  const res = await bareApp(userId).request(`/api/v1/events${query}`);
  const body = (await res.json()) as { error: { code: string } };
  return { status: res.status, code: body.error.code };
}

beforeEach(() => {
  t = freshDb();
  timers = { armed: 0, cleared: 0, intervals: [], fire: noop };
  feed = new ActivityFeed({
    db: t.db,
    // Never fires on its own: every test drives `feed.poll()` explicitly.
    setTimer: () => ({}),
    clearTimer: noop,
  });

  const now = Date.now();
  ownerId = makeUser('owner');
  orgId = newId();
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();

  laikaId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;
  otherId = createProject(t.sqlite, t.db, actor(ownerId), {
    name: 'Other',
    slug: 'other',
    prefix: 'OTH',
  }).id;
});
afterEach(() => {
  t.close();
});

describe('the response is a stream (AC1)', () => {
  it('opens with text/event-stream and a ready frame carrying the retry hint', async () => {
    const { res, client } = await connect(ownerId);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    // nginx buffers proxied responses by default, which defeats the whole point.
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');

    const ready = await client.next();
    expect(ready.event).toBe('ready');
    expect(ready.retry).toBe(RECONNECT_MS);
    expect(JSON.parse(ready.data)).toMatchObject({ project_id: null });

    await client.disconnect();
  });

  it('401s an anonymous caller', async () => {
    expect(await refused(null)).toEqual({ status: 401, code: 'unauthorized' });
  });
});

describe('server-side filtering (AC2)', () => {
  it('stays silent about a project the actor cannot see', async () => {
    const { client } = await connect(member('laika', 'viewer'));
    await client.next();

    // Two writes, one of them off-limits. The next frame the client sees proves
    // the other was dropped — a fixed wait would only prove the test is slow.
    write(otherId);
    write(laikaId);
    feed.poll();

    const frame = await client.next();
    expect(frame.event).toBe('task.created');
    expect(JSON.parse(frame.data)).toMatchObject({ project_id: laikaId });

    await client.disconnect();
  });

  it('keeps org-scoped rows to Owner and Admin', async () => {
    const { client } = await connect(member('laika', 'lead'));
    await client.next();

    write(null, 'token.created');
    write(laikaId);
    feed.poll();

    expect((await client.next()).event).toBe('task.created');
    await client.disconnect();
  });

  it('delivers an org-scoped row to the Owner', async () => {
    const { client } = await connect(ownerId);
    await client.next();

    write(null, 'token.created');
    feed.poll();

    expect((await client.next()).event).toBe('token.created');
    await client.disconnect();
  });

  it('narrows further with ?project=', async () => {
    const { client } = await connect(ownerId, '?project=laika');
    expect(JSON.parse((await client.next()).data)).toMatchObject({ project_id: laikaId });

    write(otherId);
    write(laikaId);
    feed.poll();

    expect(JSON.parse((await client.next()).data)).toMatchObject({ project_id: laikaId });
    await client.disconnect();
  });

  it('404s an unknown ?project= and 403s one the actor cannot see', async () => {
    expect(await refused(ownerId, '?project=nope')).toEqual({ status: 404, code: 'not_found' });
    expect(await refused(member('laika', 'member'), '?project=other')).toEqual({
      status: 403,
      code: 'forbidden',
    });
  });
});

describe('event ids and replay (AC3)', () => {
  it('numbers events monotonically', async () => {
    const { client } = await connect(ownerId);
    await client.next();

    write(laikaId);
    write(laikaId);
    feed.poll();

    const first = await client.next();
    const second = await client.next();

    expect(Number(second.id)).toBe(Number(first.id) + 1);
    await client.disconnect();
  });

  it('replays what a reconnecting client missed', async () => {
    const { client: warm } = await connect(ownerId);
    const ready = JSON.parse((await warm.next()).data) as { seq: number };
    await warm.disconnect();

    write(laikaId);
    write(laikaId);

    const { client } = await connect(ownerId, `?last_event_id=${String(ready.seq)}`);
    expect((await client.next()).event).toBe('ready');

    expect(Number((await client.next()).id)).toBe(ready.seq + 1);
    expect(Number((await client.next()).id)).toBe(ready.seq + 2);

    await client.disconnect();
  });

  it('accepts the Last-Event-ID header, which is what a browser sends', async () => {
    write(laikaId);
    const app = bareApp(ownerId);
    const res = await app.request('/api/v1/events', { headers: { 'Last-Event-ID': '1' } });
    const client = sseClient(res);

    await client.next();
    expect(Number((await client.next()).id)).toBe(2);

    await client.disconnect();
  });
});

describe('a gap too large to replay (AC4)', () => {
  it('says so and names the updated_since to fall back to', async () => {
    for (let i = 0; i < MAX_REPLAY + 2; i++) write(laikaId);

    const { client } = await connect(ownerId, '?last_event_id=1');

    expect((await client.next()).event).toBe('ready');

    const gap = await client.next();
    expect(gap.event).toBe('gap');
    // No id: a control frame is not a position in the log.
    expect(gap.id).toBeNull();

    const body = JSON.parse(gap.data) as Record<string, unknown>;
    expect(body).toMatchObject({ reason: 'replay_too_large', limit: MAX_REPLAY });
    expect(typeof body.updated_since).toBe('number');

    // And then nothing historical — it went live instead of dumping the log.
    write(laikaId);
    feed.poll();
    expect((await client.next()).event).toBe('task.created');

    await client.disconnect();
  });

  it('reports an id from a database it does not recognise', async () => {
    const { client } = await connect(ownerId, '?last_event_id=999999');

    await client.next();
    expect(JSON.parse((await client.next()).data)).toMatchObject({
      reason: 'unknown_last_event_id',
    });

    await client.disconnect();
  });
});

describe('the keepalive (AC5)', () => {
  it('sends a comment frame, which no client mistakes for data', async () => {
    const { client } = await connect(ownerId);
    await client.next();

    timers.fire();

    const frame = await client.next();
    expect(frame.comment).toBe('keepalive');
    expect(frame.event).toBeNull();
    expect(frame.data).toBe('');

    await client.disconnect();
  });

  /**
   * AC5 names 25 seconds in bold, and until this test existed nothing referenced
   * `KEEPALIVE_MS` at all: every other test here injects `keepaliveMs`, so what
   * they proved was "a frame is sent on the interval we asked for", not the
   * interval the server actually uses. CHIEF changed the constant to 250_000 and all
   * 560 tests passed.
   *
   * Asserting the literal `25_000` rather than `KEEPALIVE_MS` is the whole point —
   * comparing the constant to itself passes for any value, which is the same
   * mistake in a different place.
   */
  it('asks for a 25-second interval when nothing overrides it (AC5)', async () => {
    const res = await bareApp(ownerId, { shippedKeepalive: true }).request('/api/v1/events');
    expect(res.status).toBe(200);

    const client = sseClient(res);
    await client.next();

    expect(timers.intervals).toEqual([25_000]);

    await client.disconnect();
  });
});

describe('disconnect leaves nothing behind (AC6)', () => {
  it('drops the subscription and clears the keepalive timer', async () => {
    const { client } = await connect(ownerId);
    await client.next();

    expect(feed.subscriberCount()).toBe(1);
    expect(timers.armed).toBe(1);
    expect(timers.cleared).toBe(0);

    await client.disconnect();
    await settle();

    expect(feed.subscriberCount()).toBe(0);
    expect(timers.cleared).toBe(1);
    expect(feed.isPolling()).toBe(false);
  });

  it('holds nothing after a hundred connections come and go', async () => {
    for (let i = 0; i < 100; i++) {
      const { client } = await connect(ownerId);
      await client.next();
      await client.disconnect();
    }
    await settle();

    expect(feed.subscriberCount()).toBe(0);
    expect(timers.armed).toBe(100);
    expect(timers.cleared).toBe(100);
  });

  it('stops delivering to a client that has gone', async () => {
    const { client } = await connect(ownerId);
    await client.next();
    await client.disconnect();
    await settle();

    write(laikaId);
    expect(() => {
      feed.poll();
    }).not.toThrow();
    expect(feed.subscriberCount()).toBe(0);
  });
});

describe('graceful shutdown (AC7)', () => {
  it('says goodbye and closes, rather than dropping the connection', async () => {
    const { client } = await connect(ownerId);
    await client.next();

    feed.closeAll();

    const closing = await client.next();
    expect(closing.event).toBe('closing');
    expect(JSON.parse(closing.data)).toEqual({ reason: 'server_shutdown' });

    // And the stream really ends, so the client is not left waiting.
    expect(await client.nextOrEnd()).toBeNull();
    expect(timers.cleared).toBe(1);
  });
});

describe('a permission change reaches an open stream', () => {
  it('ends the stream when the user is deactivated', async () => {
    const memberId = member('laika', 'member');
    const { client } = await connect(memberId);
    await client.next();

    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, memberId)).run();

    write(laikaId);
    feed.poll();

    expect(await client.nextOrEnd()).toBeNull();
    expect(feed.subscriberCount()).toBe(0);
  });
});

describe('open token streams re-check credentials (LAI-539)', () => {
  async function open(
    options: { projectIds?: string[]; expiresAt?: number; now?: () => number } = {},
  ) {
    const minted = createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'SSE regression',
      scope: 'read_only',
      ...options,
      now: options.now?.() ?? Date.now(),
    });
    const res = await bareApp(ownerId, {
      token: minted.secret,
      ...(options.now === undefined ? {} : { now: options.now }),
    }).request('/api/v1/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const client = sseClient(res);
    expect((await client.next()).event).toBe('ready');
    // A positive delivery proves that authentication and the subscription work.
    write(laikaId);
    feed.poll();
    expect((await client.next()).event).toBe('task.created');
    return { minted, client };
  }

  async function unauthorized(client: ReturnType<typeof sseClient>) {
    const frame = await client.next();
    expect(frame.event).toBe('error');
    expect(frame.id).toBeNull();
    expect(JSON.parse(frame.data)).toEqual({
      error: {
        code: 'unauthorized',
        message: 'That access token is not valid',
        details: null,
      },
    });
    expect(await client.nextOrEnd()).toBeNull();
    expect(feed.subscriberCount()).toBe(0);
    expect(timers.cleared).toBe(1);
  }

  it('closes a revoked token stream with unauthorized before the next event', async () => {
    const { minted, client } = await open();
    try {
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      write(laikaId);
      feed.poll();
      await unauthorized(client);
    } finally {
      await client.disconnect();
    }
  });

  it('closes an expired token stream with unauthorized at the injected expiry boundary', async () => {
    let now = Date.now();
    const expiresAt = now + 60_000;
    const { client } = await open({ expiresAt, now: () => now });
    try {
      now = expiresAt - 1;
      write(laikaId);
      feed.poll();
      expect((await client.next()).event).toBe('task.created');
      now = expiresAt;
      write(laikaId);
      feed.poll();
      await unauthorized(client);
    } finally {
      await client.disconnect();
    }
  });

  it('never delivers another project or org rows to a project-pinned token', async () => {
    const { client } = await open({ projectIds: [laikaId] });
    try {
      write(otherId);
      write(null, 'token.created');
      write(laikaId);
      feed.poll();
      const frame = await client.next();
      expect(frame.event).toBe('task.created');
      expect(JSON.parse(frame.data)).toMatchObject({ project_id: laikaId });
      timers.fire();
      expect((await client.next()).comment).toBe('keepalive');
    } finally {
      await client.disconnect();
    }
  });

  it('closes a deactivated token agent stream with unauthorized', async () => {
    const { client } = await open();
    try {
      t.db.update(users).set({ isActive: 0 }).where(eq(users.id, ownerId)).run();
      write(laikaId);
      feed.poll();
      await unauthorized(client);
    } finally {
      await client.disconnect();
    }
  });

  it('re-checks revocation before writing an already queued batch', async () => {
    const { minted, client } = await open();
    try {
      write(laikaId);
      feed.poll();
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      await unauthorized(client);
    } finally {
      await client.disconnect();
    }
  });

  it('closes an idle revoked token stream on the keepalive check', async () => {
    const { minted, client } = await open();
    try {
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      timers.fire();
      await unauthorized(client);
    } finally {
      await client.disconnect();
    }
  });

  it('honours a narrowed project pin on the next batch', async () => {
    const { minted, client } = await open();
    try {
      t.db
        .update(tokens)
        .set({ projectIdsJson: JSON.stringify([laikaId]) })
        .where(eq(tokens.id, minted.token.id))
        .run();
      write(otherId);
      write(laikaId);
      feed.poll();
      expect(JSON.parse((await client.next()).data)).toMatchObject({ project_id: laikaId });
      timers.fire();
      expect((await client.next()).comment).toBe('keepalive');
    } finally {
      await client.disconnect();
    }
  });

  // **A registered agent's stream re-reads the agent too** (integration of
  // LAI-534 and LAI-539). The per-frame actor is rebuilt through
  // `tokenContextFor`, so an agent token keeps its agent — its project grants
  // and its revocation — for as long as the stream is open, not only at connect.
  describe("an agent token's stream keeps the agent's grants and revocation", () => {
    async function openAgent() {
      const created = registerAgent(t.sqlite, t.db, actor(ownerId), {
        displayName: 'Claude',
        harness: 'claude-code',
        // Granted Laika only. The owner reads Other; the agent may not.
        grants: [{ projectId: laikaId, scope: 'full' }],
      });
      const res = await bareApp(ownerId, { token: created.secret }).request('/api/v1/events');
      expect(res.status).toBe(200);
      const client = sseClient(res);
      expect((await client.next()).event).toBe('ready');
      write(laikaId);
      feed.poll();
      expect((await client.next()).event).toBe('task.created');
      return { created, client };
    }

    it("drops an ungranted project's events and stays open", async () => {
      const { client } = await openAgent();
      try {
        write(otherId);
        write(laikaId);
        feed.poll();
        const frame = await client.next();
        expect(frame.event).toBe('task.created');
        expect(JSON.parse(frame.data)).toMatchObject({ project_id: laikaId });
        // Nothing else was queued: the next frame is the keepalive, not Other's row.
        timers.fire();
        expect((await client.next()).comment).toBe('keepalive');
      } finally {
        await client.disconnect();
      }
    });

    it('closes with the one unauthorized frame once the agent row is revoked, its token untouched', async () => {
      const { created, client } = await openAgent();
      try {
        // The second lock (`tokenContextFor`): the agent is revoked and its
        // token row still is not, so only the agent check can refuse this.
        t.db
          .update(agents)
          .set({ status: 'revoked', revokedAt: Date.now() })
          .where(eq(agents.id, created.agent.id))
          .run();
        expect(
          t.db.select().from(tokens).where(eq(tokens.id, created.token.id)).get()?.revokedAt,
        ).toBeNull();
        write(laikaId);
        feed.poll();
        await unauthorized(client);
      } finally {
        await client.disconnect();
      }
    });

    it('closes with the one unauthorized frame when the owner revokes the agent', async () => {
      const { created, client } = await openAgent();
      try {
        revokeAgent(t.sqlite, t.db, actor(ownerId), created.agent.id);
        write(laikaId);
        feed.poll();
        await unauthorized(client);
      } finally {
        await client.disconnect();
      }
    });
  });
});

describe('every frame on a token stream is checked as it is written (LAI-539)', () => {
  // ## How a write is held
  //
  // `streamSSE` writes through a `TransformStream` whose readable side has a
  // high-water mark of 0: once one frame sits unread, the **next** write does not
  // resolve until the client reads. So a frame the test leaves unread holds the
  // write behind it, and the frames behind that are still queued — which is the
  // window a credential can change in, made deterministic rather than raced.

  function mint(options: { projectIds?: string[]; expiresAt?: number; now?: number } = {}) {
    return createToken(t.sqlite, t.db, actor(ownerId), {
      name: 'SSE per-frame regression',
      scope: 'read_only',
      ...options,
      now: options.now ?? Date.now(),
    });
  }

  async function connectToken(
    secret: string,
    options: { query?: string; now?: () => number; afterAuth?: () => void } = {},
  ) {
    const res = await bareApp(ownerId, {
      token: secret,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.afterAuth === undefined ? {} : { afterAuth: options.afterAuth }),
    }).request(`/api/v1/events${options.query ?? ''}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    return sseClient(res);
  }

  /** The close a refused credential produces, and then nothing. */
  async function expectRefusal(client: ReturnType<typeof sseClient>): Promise<void> {
    const frame = await client.next();
    expect(frame.event).toBe('error');
    expect(frame.id).toBeNull();
    expect(JSON.parse(frame.data)).toEqual({
      error: { code: 'unauthorized', message: 'That access token is not valid', details: null },
    });
    expect(await client.nextOrEnd()).toBeNull();
    expect(feed.subscriberCount()).toBe(0);
  }

  async function activity(client: ReturnType<typeof sseClient>, projectId: string) {
    const frame = await client.next();
    expect(frame.event).toBe('task.created');
    expect(JSON.parse(frame.data)).toMatchObject({ project_id: projectId });
    return Number(frame.id);
  }

  interface Change {
    name: string;
    /** Where the second row of the held batch is written. */
    second: () => string;
    change: (ctx: { tokenId: string; setNow: (n: number) => void; expiresAt: number }) => void;
  }

  const refusing: Change[] = [
    {
      name: 'revoked',
      second: () => laikaId,
      change: ({ tokenId }) => {
        revokeOwnToken(t.sqlite, t.db, actor(ownerId), tokenId);
      },
    },
    {
      name: 'expired (injected clock)',
      second: () => laikaId,
      change: ({ setNow, expiresAt }) => {
        setNow(expiresAt);
      },
    },
    {
      name: 'its holder deactivated',
      second: () => laikaId,
      change: () => {
        t.db.update(users).set({ isActive: 0 }).where(eq(users.id, ownerId)).run();
      },
    },
  ];

  async function heldLive(change: Change) {
    let clock = Date.now();
    const expiresAt = clock + 60_000;
    const minted = mint({ expiresAt, now: clock });
    const client = await connectToken(minted.secret, { now: () => clock });
    expect((await client.next()).event).toBe('ready');

    write(laikaId); // X: written and left unread, so the next write is held
    feed.poll();
    await settle();
    write(laikaId); // A: checked, then held in the write
    write(change.second()); // B: still queued behind A
    feed.poll();
    await settle();

    change.change({
      tokenId: minted.token.id,
      setNow: (n) => {
        clock = n;
      },
      expiresAt,
    });

    const x = await activity(client, laikaId);
    expect(await activity(client, laikaId)).toBe(x + 1);
    // Let B's turn in the queue run before anything else refreshes the actor.
    await settle();
    return client;
  }

  for (const change of refusing) {
    it(`a live batch: a token ${change.name} after the first write closes before row two`, async () => {
      const client = await heldLive(change);
      try {
        await expectRefusal(client);
      } finally {
        await client.disconnect();
      }
    });
  }

  it('a live batch: a pin narrowed after the first write drops row two and stays open', async () => {
    const client = await heldLive({
      name: 'narrowed',
      second: () => otherId,
      change: ({ tokenId }) => {
        t.db
          .update(tokens)
          .set({ projectIdsJson: JSON.stringify([laikaId]) })
          .where(eq(tokens.id, tokenId))
          .run();
      },
    });
    try {
      // B (the other project) never arrives; the next frame is the next row in.
      write(laikaId);
      feed.poll();
      await activity(client, laikaId);
      timers.fire();
      expect((await client.next()).comment).toBe('keepalive');
    } finally {
      await client.disconnect();
    }
  });

  for (const change of refusing) {
    it(`a replay: a token ${change.name} after the first replayed write closes before row two`, async () => {
      let clock = Date.now();
      const expiresAt = clock + 60_000;
      // Minted first: minting writes its own `token.created` row.
      const minted = mint({ expiresAt, now: clock });

      const { client: warm } = await connect(ownerId);
      const ready = JSON.parse((await warm.next()).data) as { seq: number };
      await warm.disconnect();

      write(laikaId); // A
      write(change.second()); // B

      // `ready` is written and left unread, so A's write is held and B queued.
      const client = await connectToken(minted.secret, {
        query: `?last_event_id=${String(ready.seq)}`,
        now: () => clock,
      });
      await settle();
      change.change({
        tokenId: minted.token.id,
        setNow: (n) => {
          clock = n;
        },
        expiresAt,
      });

      try {
        expect((await client.next()).event).toBe('ready');
        expect(await activity(client, laikaId)).toBe(ready.seq + 1);
        await expectRefusal(client);
      } finally {
        await client.disconnect();
      }
    });
  }

  it('a queued keepalive is not written after the token is revoked', async () => {
    const minted = mint();
    const client = await connectToken(minted.secret);
    expect((await client.next()).event).toBe('ready');
    try {
      write(laikaId); // X: unread
      feed.poll();
      await settle();
      write(laikaId); // A: held
      feed.poll();
      await settle();
      timers.fire(); // the keepalive passes its own check and is queued behind A
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);

      const x = await activity(client, laikaId);
      expect(await activity(client, laikaId)).toBe(x + 1);
      await expectRefusal(client);
    } finally {
      await client.disconnect();
    }
  });

  /** Every frame to the end of the stream, so a test can count what arrived. */
  async function rest(client: ReturnType<typeof sseClient>): Promise<Frame[]> {
    const frames: Frame[] = [];
    for (;;) {
      const frame = await client.nextOrEnd();
      if (frame === null) return frames;
      frames.push(frame);
    }
  }

  const UNAUTHORIZED = {
    error: { code: 'unauthorized', message: 'That access token is not valid', details: null },
  };

  it('a refusal found while a shutdown drains the queue is still written, once, last', async () => {
    const minted = mint();
    const client = await connectToken(minted.secret);
    expect((await client.next()).event).toBe('ready');
    try {
      write(laikaId); // X: unread
      feed.poll();
      await settle();
      write(laikaId); // A: checked, then held
      feed.poll();
      await settle();
      write(laikaId); // B: queued, not yet checked
      feed.poll();
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      // The shutdown ends the stream first; B is checked only while it drains.
      feed.closeAll();

      const frames = await rest(client);
      expect(frames.map((f) => f.event)).toEqual(['task.created', 'task.created', 'error']);
      expect(frames[2]?.id).toBeNull();
      expect(JSON.parse(frames[2]?.data ?? 'null')).toEqual(UNAUTHORIZED);
      expect(feed.subscriberCount()).toBe(0);
    } finally {
      await client.disconnect();
    }
  });

  it('a refusal with the queue at its cap is still written, once, last', async () => {
    const minted = mint();
    const client = await connectToken(minted.secret);
    try {
      // Let `ready`'s write complete first: until it does, `ready` itself
      // counts as queued. Then the first keepalive is checked and held in its
      // write (nothing is read), and the rest queue behind it — exactly
      // `MAX_QUEUED_FRAMES` frames, at the cap and not past it.
      await settle();
      for (let i = 0; i < MAX_QUEUED_FRAMES; i++) timers.fire();
      await settle();
      // Precondition: full, and still open.
      expect(feed.subscriberCount()).toBe(1);
      revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      timers.fire(); // finds the revoke, with no room left in the queue

      // The held keepalive passed its check before the revoke; every one
      // queued behind it is checked after and dropped.
      const frames = await rest(client);
      expect(frames.map((f) => f.event ?? f.comment)).toEqual(['ready', 'keepalive', 'error']);
      expect(JSON.parse(frames[2]?.data ?? 'null')).toEqual(UNAUTHORIZED);
      expect(feed.subscriberCount()).toBe(0);
    } finally {
      await client.disconnect();
    }
  });

  it('a gap queued behind a written ready is refused by its own check', async () => {
    for (let i = 0; i < MAX_REPLAY + 2; i++) write(laikaId);
    const minted = mint();
    // Each read of the clock is one credential check. The first is the test
    // app's authentication, the second `ready`'s write-time check, the third
    // `gap`'s: revoking inside the third lands after `ready` was written and
    // before `gap` is. A backpressure hold cannot do this — `ready` is the
    // first write, into an empty stream, so it never blocks the frame behind.
    let reads = 0;
    const client = await connectToken(minted.secret, {
      query: '?last_event_id=1',
      now: () => {
        reads += 1;
        if (reads === 3) revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
        return Date.now();
      },
    });
    try {
      expect((await client.next()).event).toBe('ready');
      // Frame by frame, not `rest()`: a gap that slipped through would leave
      // the stream open, and this must fail on the frame, not on a timeout.
      const second = await client.next();
      expect(second.event).toBe('error');
      expect(JSON.parse(second.data)).toEqual(UNAUTHORIZED);
      expect(await client.nextOrEnd()).toBeNull();
      // The instrument ran as described: exactly the three checks above.
      expect(reads).toBe(3);
    } finally {
      await client.disconnect();
    }
  });

  it('a queued gap is not written after the token is revoked', async () => {
    for (let i = 0; i < MAX_REPLAY + 2; i++) write(laikaId);
    const minted = mint();
    // Revoked after authentication and before the stream's first write: `ready`
    // and `gap` are both queued, and neither may reach the wire.
    const client = await connectToken(minted.secret, {
      query: '?last_event_id=1',
      afterAuth: () => {
        revokeOwnToken(t.sqlite, t.db, actor(ownerId), minted.token.id);
      },
    });
    try {
      await expectRefusal(client);
    } finally {
      await client.disconnect();
    }
  });
});

// ------------------------------------------------------------ the real chain

describe('mounted in the app', () => {
  let h: AuthHarness;
  let cookie: string;

  // No injected feed here on purpose: this block is the one that proves the
  // default wiring works, poll timer included.
  beforeEach(async () => {
    h = authHarness();

    const setup = await h.app.request('/api/v1/setup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        org_name: 'Laika',
        owner_name: 'Ada',
        owner_email: 'ada@example.test',
        owner_password: 'correct-horse-battery-staple',
        project_name: 'Laika',
        project_prefix: 'LAI',
      }),
    });
    expect(setup.status).toBe(201);
    cookie = cookieFrom(setup);
  });
  afterEach(() => {
    h.close();
  });

  it('401s an anonymous caller through the real chain', async () => {
    const res = await h.app.request('/api/v1/events');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('carries a task created over HTTP, badged with its actor kind', async () => {
    const res = await h.app.request('/api/v1/events', { headers: { Cookie: cookie } });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const client = sseClient(res);
    await client.next();

    const created = await h.app.request('/api/v1/projects/laika/tasks', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ title: 'Do the thing' }),
    });
    expect(created.status).toBe(201);

    const frame = await client.next();
    expect(frame.event).toBe('task.created');
    const body = JSON.parse(frame.data) as { actor_kind: string; project_id: string | null };
    expect(body.actor_kind).toBe('user');
    expect(body.project_id).not.toBeNull();

    await client.disconnect();
  });
});

/**
 * Another person's agent is named on the stream only while the task shows it,
 * and that is asked **when the frame is written** (D-121 item 7, LAI-1011).
 * A frame that waited behind a slow client while the agent's claim lapsed must
 * not carry the agent out.
 */
describe("another person's agent on a held write (LAI-1011)", () => {
  it('a claim that lapses while the frame waits is not named when it is written', async () => {
    const bea = member('laika', 'member');
    const created = registerAgent(t.sqlite, t.db, actor(bea), {
      displayName: 'Bea private bot',
      harness: 'codex',
      deviceLabel: 'bea-1',
      grants: [{ projectId: laikaId, scope: 'full' }],
    });
    const agentId = created.agent.id;
    const taskId = createTask(t.sqlite, t.db, actor(ownerId), 'laika', { title: 'Shared' }).id;
    // A real claim and session: Bea's agent is "working" the task, so the task
    // shows it to every reader.
    startWorking(t.sqlite, t.db, resolveTokenActor(t.db, created.secret, Date.now()), taskId);
    t.db.update(tasks).set({ selectedAgentId: null }).where(eq(tasks.id, taskId)).run();

    const { client } = await connect(ownerId);
    try {
      expect((await client.next()).event).toBe('ready');
      // The claim's own rows were written before connecting, so the stream
      // starts after them: what follows is only what this test writes.
      write(laikaId); // X: written and left unread, so the next write is held
      feed.poll();
      await settle();
      write(laikaId); // A: checked, then held in the write
      appendActivity(t.db, {
        orgId,
        projectId: laikaId,
        taskId,
        actorId: bea,
        actorKind: 'agent',
        actorTokenId: created.token.id,
        type: 'task.updated',
        payload: { field: 'description_md', agent_id: agentId },
      }); // B: queued behind A while the claim is live
      feed.poll();
      await settle();

      // While A waits, the claim lapses: the task no longer shows the agent.
      expireClaims(t.db, Date.now() + 365 * 24 * 60 * 60 * 1000);

      expect((await client.next()).event).toBe('task.created'); // X
      expect((await client.next()).event).toBe('task.created'); // A
      const held = await client.next();
      expect(held.event).toBe('task.updated');
      const view = JSON.parse(held.data) as Record<string, unknown>;
      expect(view.task_id).toBe(taskId);
      expect(view.agent_id).toBeNull();
      expect(view.agent_session).toBeNull();
      expect(view.agent_redacted).toBe(true);
      expect(held.data).not.toContain(agentId);
    } finally {
      await client.disconnect();
    }
  });
});
