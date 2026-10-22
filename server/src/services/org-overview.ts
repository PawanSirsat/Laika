import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { assertCan } from '../policy/can.ts';
import { OPEN_STATUSES, summariseAllTasks } from './tasks.ts';
import { activePeopleSeenSince } from './users.ts';

/**
 * `GET /api/v1/org/overview` (D-104 item 5, LAI-986): the organisation's
 * pulse, for the Organisation screen.
 *
 * **Nothing here is a definition of its own.** The task figures are
 * `summariseAllTasks` with no filter (LAI-974): the spaces the caller can read
 * through `can()`, narrowed by a token's project list, with its overdue and
 * blocked rules. A private space the caller cannot open is not in any count.
 * "Seen" is `last_seen_at` as the directory serves it (LAI-981).
 *
 * "This week" is the last seven days, not the calendar week: a Monday morning
 * would otherwise read as an empty organisation. `since` says where it starts.
 */

export const OVERVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface OrgOverviewView {
  people: {
    /** Active people in the organisation. */
    active: number;
    /** Of those, seen signed in at or after `since`. */
    seen_this_week: number;
    since: number;
  };
  tasks: {
    /** Not done and not cancelled — LAI-974's open. */
    open: number;
    in_review: number;
    blocked: number;
    overdue: number;
  };
}

export function getOrgOverview(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): OrgOverviewView {
  assertCan(actor, 'org.read');

  const since = now - OVERVIEW_WINDOW_MS;
  const people = activePeopleSeenSince(db, since);
  const counts = summariseAllTasks(db, actor, {}, now);

  return {
    people: { active: people.active, seen_this_week: people.seen, since },
    tasks: {
      open: OPEN_STATUSES.reduce((sum, status) => sum + counts.by_status[status], 0),
      in_review: counts.by_status.review,
      blocked: counts.blocked,
      overdue: counts.overdue,
    },
  };
}
