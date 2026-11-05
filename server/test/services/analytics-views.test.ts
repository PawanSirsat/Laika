import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { analyticsViews, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneLocalActivity } from '../../src/jobs/jobs.ts';
import {
  listAnalyticsViews,
  LOOK_DEDUPE_MS,
  readLogged,
  readLoggedMany,
} from '../../src/services/analytics-views.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Who looked at a person's analytics (SPEC §4.59, D-102 rule 3, LAI-957):
 * `readLogged`'s one write, in the read's own transaction; the person's list,
 * newest first and paged; and 400 days' retention.
 */

const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 9, 21, 15);

let t: TestDb;
let owner: string;
let admin: string;
let bea: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW - 30 * DAY),
      updatedAt: new Date(NOW - 30 * DAY),
    })
    .run();
  return id;
}

function actor(userId: string, extra: Partial<ResolvedActor> = {}): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return { ...loaded, ...extra };
}

function views() {
  return t.db.select().from(analyticsViews).all();
}

beforeEach(() => {
  t = freshDb();
  owner = seed(t.db, NOW - 30 * DAY).userId;
  admin = makeUser('Ari', 'admin');
  bea = makeUser('Bea', 'member');
});

afterEach(() => {
  t.close();
});

describe('readLogged', () => {
  it('answers the read and writes one row: who, whom, what, which day, when', () => {
    const answer = readLogged(
      t.db,
      actor(admin),
      bea,
      'time',
      () => ({ day: '2026-10-20' }),
      (v) => v.day,
      NOW,
    );
    expect(answer).toEqual({ day: '2026-10-20' });
    expect(views().map((v) => [v.viewerId, v.subjectId, v.kind, v.day, v.viewedAt])).toEqual([
      [admin, bea, 'time', '2026-10-20', NOW],
    ]);
  });

  it('writes nothing when the person reads their own', () => {
    expect(readLogged(t.db, actor(bea), bea, 'usage', () => 7, undefined, NOW)).toBe(7);
    expect(views()).toEqual([]);
  });

  it('writes nothing when the read fails, and lets its error through', () => {
    expect(() =>
      readLogged(t.db, actor(owner), bea, 'time', () => {
        throw ApiError.badRequest('no');
      }),
    ).toThrow(ApiError);
    expect(views()).toEqual([]);
  });

  it('is one transaction with the read: a log that cannot be written undoes the read', () => {
    // A read that wrote would be rolled back with the failed log — the proof
    // the insert and the read share one BEGIN … COMMIT.
    t.sqlite.exec('DROP TABLE analytics_views');
    expect(() =>
      readLogged(t.db, actor(owner), bea, 'activity', () =>
        t.db.update(users).set({ name: 'Changed' }).where(eq(users.id, bea)).run(),
      ),
    ).toThrow(/analytics_views/);
    expect(t.db.select().from(users).where(eq(users.id, bea)).get()?.name).toBe('Bea');
  });
});

describe('one row per look (D-135, LAI-1135)', () => {
  const look = (viewer: string, kind: 'time' | 'usage', day: string | null, at: number) =>
    readLogged(
      t.db,
      actor(viewer),
      bea,
      kind,
      () => null,
      () => day,
      at,
    );

  it('writes a repeat inside ten minutes once, and again at ten minutes', () => {
    look(admin, 'time', null, NOW);
    look(admin, 'time', null, NOW + 60_000);
    look(admin, 'time', null, NOW + LOOK_DEDUPE_MS - 1);
    expect(views().map((v) => v.viewedAt)).toEqual([NOW]);
    // Ten minutes on is a new look.
    look(admin, 'time', null, NOW + LOOK_DEDUPE_MS);
    expect(views().map((v) => v.viewedAt)).toEqual([NOW, NOW + LOOK_DEDUPE_MS]);
  });

  it('keeps a different viewer, kind or day its own look', () => {
    look(admin, 'time', null, NOW);
    look(owner, 'time', null, NOW + 1);
    look(admin, 'usage', null, NOW + 2);
    look(admin, 'time', '2026-10-20', NOW + 3);
    look(admin, 'time', '2026-10-21', NOW + 4);
    // The same day again is the same look; null and a day are not the same.
    look(admin, 'time', '2026-10-21', NOW + 5);
    look(admin, 'time', null, NOW + 6);
    expect(views().map((v) => [v.viewerId, v.kind, v.day, v.viewedAt])).toEqual([
      [admin, 'time', null, NOW],
      [owner, 'time', null, NOW + 1],
      [admin, 'usage', null, NOW + 2],
      [admin, 'time', '2026-10-20', NOW + 3],
      [admin, 'time', '2026-10-21', NOW + 4],
    ]);
  });
});

describe('readLoggedMany (LAI-1135)', () => {
  it('logs every person the answer shows, once each, and never the reader', () => {
    const answer = readLoggedMany(
      t.db,
      actor(admin),
      'time',
      () => ({ shown: [bea, owner, bea, admin] }),
      (v) => v.shown,
      undefined,
      NOW,
    );
    expect(answer.shown).toHaveLength(4);
    expect(
      views()
        .map((v) => [v.viewerId, v.subjectId, v.kind, v.day])
        .sort(),
    ).toEqual(
      [
        [admin, bea, 'time', null],
        [admin, owner, 'time', null],
      ].sort(),
    );
  });

  it('dedupes each person on their own: a second read logs only who is new', () => {
    readLoggedMany(
      t.db,
      actor(admin),
      'time',
      () => [bea],
      (v) => v,
      undefined,
      NOW,
    );
    readLoggedMany(
      t.db,
      actor(admin),
      'time',
      () => [bea, owner],
      (v) => v,
      undefined,
      NOW + 1,
    );
    expect(views().map((v) => [v.subjectId, v.viewedAt])).toEqual([
      [bea, NOW],
      [owner, NOW + 1],
    ]);
  });

  it('writes nothing when the read fails', () => {
    expect(() =>
      readLoggedMany(
        t.db,
        actor(admin),
        'time',
        (): string[] => {
          throw ApiError.badRequest('no');
        },
        (v) => v,
      ),
    ).toThrow(ApiError);
    expect(views()).toEqual([]);
  });
});

describe('listAnalyticsViews (GET /me/analytics-views)', () => {
  beforeEach(() => {
    readLogged(
      t.db,
      actor(admin),
      bea,
      'time',
      () => null,
      () => '2026-10-21',
      NOW,
    );
    readLogged(t.db, actor(owner), bea, 'local_activity', () => null, undefined, NOW + 1);
    readLogged(t.db, actor(owner), bea, 'activity', () => null, undefined, NOW + 2);
    // Somebody else's view is not Bea's to see.
    readLogged(
      t.db,
      actor(owner),
      admin,
      'time',
      () => null,
      () => '2026-10-21',
      NOW + 3,
    );
  });

  it('lists the views of the caller, newest first, with who looked', () => {
    const rows = listAnalyticsViews(t.db, actor(bea), { limit: 50, cursor: null });
    expect(rows.map((r) => [r.viewer.name, r.kind, r.day, r.viewed_at])).toEqual([
      ['Owner', 'activity', null, NOW + 2],
      ['Owner', 'local_activity', null, NOW + 1],
      ['Ari', 'time', '2026-10-21', NOW],
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['day', 'id', 'kind', 'viewed_at', 'viewer']);
    expect(rows[2]!.viewer).toEqual({ id: admin, name: 'Ari' });
  });

  it('pages on (viewed_at, id) without skipping or repeating', () => {
    const first = listAnalyticsViews(t.db, actor(bea), { limit: 1, cursor: null });
    // One over the limit: the route's buildPage cuts it and sets the cursor.
    expect(first.map((r) => r.viewed_at)).toEqual([NOW + 2, NOW + 1]);
    const next = listAnalyticsViews(t.db, actor(bea), {
      limit: 1,
      cursor: { sortKey: first[0]!.viewed_at, id: first[0]!.id },
    });
    expect(next.map((r) => r.viewed_at)).toEqual([NOW + 1, NOW]);
  });

  it('is every role’s own, on a session only', () => {
    expect(listAnalyticsViews(t.db, actor(owner), { limit: 50, cursor: null })).toEqual([]);
    const token = actor(bea, { token: { id: 'tok_x', scope: 'full', projectIds: null } });
    let refused: unknown = null;
    try {
      listAnalyticsViews(t.db, token, { limit: 50, cursor: null });
    } catch (err) {
      refused = err instanceof ApiError ? { code: err.code, details: err.details } : err;
    }
    expect(refused).toEqual({
      code: 'forbidden',
      details: { action: 'local_activity.read_own', reason: 'session_required' },
    });
  });
});

describe('retention (§11.6)', () => {
  it('keeps a view 400 days and no longer', () => {
    readLogged(t.db, actor(owner), bea, 'time', () => null, undefined, NOW - 401 * DAY);
    readLogged(t.db, actor(owner), bea, 'time', () => null, undefined, NOW - 399 * DAY);
    pruneLocalActivity(t.db, NOW);
    expect(views().map((v) => v.viewedAt)).toEqual([NOW - 399 * DAY]);
  });
});
