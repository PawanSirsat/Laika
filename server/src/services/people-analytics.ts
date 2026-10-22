import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { readLogged } from './analytics-views.ts';
import { localActivityOf, type OwnLocalActivityView } from './local-activity.ts';
import { dayOf, type MyDayView } from './my-day.ts';

/**
 * A person's analytics, read by an owner or admin in the shape the person
 * reads them, and the log of every such read (SPEC §3.1, §4.59, §6.4, D-102
 * rules 1–4, LAI-957).
 *
 * ## The same shape, from the same code
 *
 * `GET /people/:id/time` is `dayOf` — the assembly `GET /me/time` answers —
 * with the person's id, drafts included; `GET /people/:id/local-activity` is
 * `localActivityOf`, `GET /me/local-activity`'s. There is no second copy to
 * drift. The heatmap and the per-person tokens already had their readers
 * (`people-activity.ts`, `token-usage.ts`); all four log through
 * `analytics-views.ts`.
 *
 * ## Who may ask
 *
 * `people.analytics.read`: *See everyone's analytics*, the owner always and
 * an admin by default (§3's grants), on a web session, **never about
 * themselves** — their own day is `/me`'s. Asked before the person is looked
 * up, so a caller who may not ask cannot tell a real id from a made-up one.
 *
 * ## Every read is logged, in the read's transaction
 *
 * `readLogged` (`analytics-views.ts`). Consent governs collection, not
 * reading (D-102, amended), so nothing here reads a sharing switch.
 *
 * ## Read-only
 *
 * Nothing here writes a person's time, drafts, breaks or switches. Every
 * write stays on `/me`, on the caller's own rows (D-102 rule 4).
 */

function requirePerson(db: Db, actor: ResolvedActor, userId: string): void {
  assertCan(actor, 'people.analytics.read', { targetUserId: userId });
  const person = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (person === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
}

/** `GET /people/:id/time?day=&tz=` — `GET /me/time`, for that person. */
export function getPersonDay(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  query: { day?: string | undefined; tz?: string | undefined },
  now: number = Date.now(),
): MyDayView {
  requirePerson(db, actor, userId);
  return readLogged(
    db,
    actor,
    userId,
    'time',
    () => dayOf(db, userId, query, now),
    (view) => view.day,
    now,
  );
}

/** `GET /people/:id/local-activity?days=` — `GET /me/local-activity`, for that person. */
export function getPersonLocalActivity(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  days?: number,
  now: number = Date.now(),
): OwnLocalActivityView {
  requirePerson(db, actor, userId);
  return readLogged(
    db,
    actor,
    userId,
    'local_activity',
    () => localActivityOf(db, userId, days, now),
    () => null,
    now,
  );
}
