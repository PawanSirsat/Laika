import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../../src/db/activity.ts';
import { type ActivityType } from '../../../src/db/enums.ts';
import { newId } from '../../../src/db/ids.ts';
import { orgs, users } from '../../../src/db/schema.ts';
import { type AppEnv } from '../../../src/http/context.ts';
import { createErrorHandler } from '../../../src/http/error-handler.ts';
import { eventRoutes, RECONNECT_MS } from '../../../src/http/routes/events.ts';
import { ActivityFeed, type RepeatingTimer } from '../../../src/services/activity-feed.ts';
import { MAX_REPLAY } from '../../../src/services/events.ts';
import { addMember, createProject } from '../../../src/services/projects.ts';
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
      avatarColor: '#123456',
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
  options: { shippedKeepalive?: boolean } = {},
): Hono<AppEnv> {
  const log = captureLog();
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('log', log.logger);
    c.set('requestId', 'test');
    c.set('actor', userId === null ? null : actor(userId));
    await next();
  });

  app.onError(createErrorHandler(log.logger));

  app.route(
    '/api/v1/events',
    eventRoutes({
      db: t.db,
      feed,
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
   * interval the server actually uses. PM changed the constant to 250_000 and all
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
