import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AnalyticsViewKind } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { analyticsViews, users } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Who looked at a person's analytics (SPEC §4.59, D-102 rule 3, D-088 item 7,
 * LAI-957): the one write every mirrored read makes, and the person's list.
 *
 * One `analytics_views` row per read of somebody else, written in the same
 * SQLite transaction as the read: a read that fails writes nothing, and a
 * log that cannot be written fails the read. Its own module, importing no
 * other service, so every reader may log through it — `people-analytics.ts`,
 * `people-activity.ts` and `token-usage.ts` — without an import cycle.
 */

/** One row of `GET /me/analytics-views`. */
export interface WhoLookedView {
  id: string;
  viewer: { id: string; name: string };
  kind: AnalyticsViewKind;
  /** The day read, for My day; `null` for a range. */
  day: string | null;
  viewed_at: number;
}

export interface ListAnalyticsViewsOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
}

/**
 * Run `read` and log it as `viewer` reading `subjectId`'s `kind`, in one
 * transaction. A person reading their own writes no row: nobody looked.
 *
 * The read runs on `db` inside `db.transaction`: one connection, so it is
 * inside the same `BEGIN … COMMIT` as the insert.
 */
export function readLogged<T>(
  db: Db,
  viewer: ResolvedActor,
  subjectId: string,
  kind: AnalyticsViewKind,
  read: () => T,
  dayOfRead: (view: T) => string | null = () => null,
  now: number = Date.now(),
): T {
  if (subjectId === viewer.userId) return read();
  return db.transaction((tx) => {
    const view = read();
    tx.insert(analyticsViews)
      .values({
        id: newId(),
        viewerId: viewer.userId,
        subjectId,
        kind,
        day: dayOfRead(view),
        viewedAt: now,
      })
      .run();
    return view;
  });
}

/**
 * `GET /me/analytics-views` — who looked at the caller's analytics, newest
 * first, one row over the limit so `buildPage` can tell there is more.
 *
 * *Read and delete own local activity*'s action, `local_activity.read_own`
 * (§3.1): the person seeing what is held about them, and who has seen it, on
 * a web session.
 */
export function listAnalyticsViews(
  db: Db,
  actor: ResolvedActor,
  options: ListAnalyticsViewsOptions,
): WhoLookedView[] {
  assertCan(actor, 'local_activity.read_own');
  const conditions: SQL[] = [eq(analyticsViews.subjectId, actor.userId)];
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(analyticsViews.viewedAt, key),
        and(eq(analyticsViews.viewedAt, key), lt(analyticsViews.id, options.cursor.id)),
      )!,
    );
  }
  return db
    .select({
      id: analyticsViews.id,
      viewerId: analyticsViews.viewerId,
      viewerName: users.name,
      kind: analyticsViews.kind,
      day: analyticsViews.day,
      viewedAt: analyticsViews.viewedAt,
    })
    .from(analyticsViews)
    .innerJoin(users, eq(users.id, analyticsViews.viewerId))
    .where(and(...conditions))
    .orderBy(desc(analyticsViews.viewedAt), desc(analyticsViews.id))
    .limit(options.limit + 1)
    .all()
    .map((r) => ({
      id: r.id,
      viewer: { id: r.viewerId, name: r.viewerName },
      kind: r.kind,
      day: r.day,
      viewed_at: r.viewedAt,
    }));
}
