import { and, count, desc, eq, gt, gte, isNull, lt, or, type SQL } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AnalyticsViewKind, type OrgRole } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { analyticsViews, users } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Who looked at a person's analytics (SPEC §4.59, D-102 rule 3, D-088 item 7,
 * LAI-957): the one write every mirrored read makes, and the person's list.
 *
 * One `analytics_views` row per read of somebody else — one per look, since
 * D-135: a repeat inside ten minutes is the same look — written in the same
 * SQLite transaction as the read: a read that fails writes nothing, and a
 * log that cannot be written fails the read. Its own module, importing no
 * other service, so every reader may log through it — `people-analytics.ts`,
 * `people-activity.ts` and `token-usage.ts` — without an import cycle.
 */

/** One row of `GET /me/analytics-views`. */
export interface WhoLookedView {
  id: string;
  /** Their org role now (D-139 item 3, LAI-1150), so *Who looked* can say it. */
  viewer: { id: string; name: string; org_role: OrgRole };
  kind: AnalyticsViewKind;
  /** The day read, for My day; `null` for a range. */
  day: string | null;
  viewed_at: number;
}

export interface ListAnalyticsViewsOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  /** `?since=`, unix ms: only looks at or after it (LAI-1150). */
  since?: number | null;
}

/**
 * How long one look covers (D-135): the same viewer reading the same person's
 * data of the same kind — and the same day, for My day — again inside this
 * writes no second row. A report filter clicked across forty people writes
 * forty rows once, not forty a click; every viewer and subject pair is still
 * recorded, which is what D-102 rule 3 asks.
 */
export const LOOK_DEDUPE_MS = 10 * 60_000;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * One look, written unless the same one was written inside
 * {@link LOOK_DEDUPE_MS} — on `analytics_views_subject_idx`, which leads with
 * the subject and the time.
 */
function logLook(
  tx: Db | Tx,
  viewerId: string,
  subjectId: string,
  kind: AnalyticsViewKind,
  day: string | null,
  now: number,
): void {
  const recent = tx
    .select({ id: analyticsViews.id })
    .from(analyticsViews)
    .where(
      and(
        eq(analyticsViews.subjectId, subjectId),
        gt(analyticsViews.viewedAt, now - LOOK_DEDUPE_MS),
        eq(analyticsViews.viewerId, viewerId),
        eq(analyticsViews.kind, kind),
        day === null ? isNull(analyticsViews.day) : eq(analyticsViews.day, day),
      ),
    )
    .limit(1)
    .get();
  if (recent !== undefined) return;
  tx.insert(analyticsViews)
    .values({ id: newId(), viewerId, subjectId, kind, day, viewedAt: now })
    .run();
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
  return readLoggedMany(db, viewer, kind, read, () => [subjectId], dayOfRead, now);
}

/**
 * `readLogged` for a read that is a look at several of one person's kinds at
 * once (D-139 items 3 and 4, LAI-1150): somebody else's profile is a
 * `profile` look, and the week's hours it carries a `time` one. Each kind is
 * deduped on its own; the person reading their own writes none.
 */
export function readLoggedKinds<T>(
  db: Db,
  viewer: ResolvedActor,
  subjectId: string,
  kinds: readonly AnalyticsViewKind[],
  read: () => T,
  now: number = Date.now(),
): T {
  return db.transaction((tx) => {
    const view = read();
    if (subjectId !== viewer.userId) {
      for (const kind of new Set(kinds)) logLook(tx, viewer.userId, subjectId, kind, null, now);
    }
    return view;
  });
}

/**
 * `readLogged` for a read that shows several people at once (D-130, LAI-1135):
 * the Time report logs **each person it shows per person** — `subjectsOf`
 * names them from the answer, since who appears is what the read found. The
 * viewer is never one of them, and each is deduped on its own.
 */
export function readLoggedMany<T>(
  db: Db,
  viewer: ResolvedActor,
  kind: AnalyticsViewKind,
  read: () => T,
  subjectsOf: (view: T) => readonly string[],
  dayOfRead: (view: T) => string | null = () => null,
  now: number = Date.now(),
): T {
  return db.transaction((tx) => {
    const view = read();
    const day = dayOfRead(view);
    for (const subjectId of new Set(subjectsOf(view))) {
      if (subjectId === viewer.userId) continue;
      logLook(tx, viewer.userId, subjectId, kind, day, now);
    }
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
  const since = options.since ?? null;
  if (since !== null) conditions.push(gte(analyticsViews.viewedAt, since));
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
      viewerRole: users.orgRole,
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
      viewer: { id: r.viewerId, name: r.viewerName, org_role: r.viewerRole },
      kind: r.kind,
      day: r.day,
      viewed_at: r.viewedAt,
    }));
}

/**
 * How many looks at the caller there are since `since` — or kept at all, when
 * it is null — for `GET /me/analytics-views`'s `total` (LAI-1150): *"7 looks
 * in the last 30 days"* without paging through them. One range of
 * `analytics_views_subject_idx`. The list's own question, asked by its caller.
 */
export function countAnalyticsViews(db: Db, actor: ResolvedActor, since: number | null): number {
  assertCan(actor, 'local_activity.read_own');
  const conditions: SQL[] = [eq(analyticsViews.subjectId, actor.userId)];
  if (since !== null) conditions.push(gte(analyticsViews.viewedAt, since));
  return (
    db
      .select({ n: count() })
      .from(analyticsViews)
      .where(and(...conditions))
      .get()?.n ?? 0
  );
}
