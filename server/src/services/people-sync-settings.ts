import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type PeopleSyncErrorCode } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgCalendarSource, orgPeopleSync } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import {
  type LeaverReviewView,
  PEOPLE_SYNC_EVERY_MINUTES,
  type PeopleSyncDeps,
  peopleSyncInFlight,
  type PeopleSyncResultView,
  runPeopleSync,
} from './people-sync.ts';

/**
 * The people sync's two switches on the Microsoft 365 card (§4.109, D-161,
 * LAI-1330): *Photos and profile* and *Leavers*, beside the calendar's own
 * switch, all reading Microsoft through the one connection (§4.101).
 *
 * **Every call is `org.calendar.configure`** — the connection's action:
 * owners and admins holding *Change organisation settings, Time and breaks*,
 * signed in. **Turning *Leavers* on also asks `user.deactivate`**: it lets
 * the sync do what only someone holding that grant may do by hand.
 *
 * Both switches ship off. *Leavers* is on only with *Photos and profile*,
 * which is the read that finds them; while it is off, each run's leaver
 * review is a dry run the card shows. No `activity` row for a switch, as for
 * the calendar's.
 */

export interface PeopleSyncErrorView {
  code: PeopleSyncErrorCode;
  message: string;
}

/** `GET /api/v1/org/people-sync`, and the answer of every write here (§6.4). */
export interface PeopleSyncView {
  /** The Microsoft 365 connection is saved (§4.101): without it nothing runs. */
  connected: boolean;
  /** *Photos and profile*: job title, department, manager and photo, every hour. */
  profile_enabled: boolean;
  /** *Leavers*: deactivate who Microsoft says has left, behind the guards. */
  leavers_enabled: boolean;
  /** The operator's store is set up: without it no photo is kept, and profiles still are. */
  photos_stored: boolean;
  sync_every_minutes: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: PeopleSyncErrorView | null;
  last_result: PeopleSyncResultView | null;
  /** The last complete run's leaver review, a dry run while *Leavers* is off. */
  leavers: LeaverReviewView | null;
}

/** `PUT /api/v1/org/people-sync`. */
export interface PeopleSyncInput {
  profile_enabled: boolean;
  leavers_enabled: boolean;
}

function jsonOf<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function viewOf(db: Db, deps: PeopleSyncDeps): PeopleSyncView {
  const row = db.select().from(orgPeopleSync).get();
  const connected = db.select({ id: orgCalendarSource.orgId }).from(orgCalendarSource).get();
  return {
    connected: connected !== undefined,
    profile_enabled: row?.profileEnabled === 1,
    leavers_enabled: row?.leaversEnabled === 1,
    photos_stored: (deps.attachments?.config ?? null) !== null,
    sync_every_minutes: PEOPLE_SYNC_EVERY_MINUTES,
    last_attempt_at: row?.lastAttemptAt ?? null,
    last_success_at: row?.lastSuccessAt ?? null,
    last_error:
      row?.lastErrorCode == null ? null : { code: row.lastErrorCode, message: row.lastError ?? '' },
    last_result: jsonOf<PeopleSyncResultView>(row?.lastResultJson ?? null),
    leavers: jsonOf<LeaverReviewView>(row?.leaversJson ?? null),
  };
}

/** `GET /api/v1/org/people-sync`. */
export function getPeopleSync(
  db: Db,
  actor: ResolvedActor,
  deps: PeopleSyncDeps = {},
): PeopleSyncView {
  assertCan(actor, 'org.calendar.configure');
  return viewOf(db, deps);
}

/** Start a run once whatever is running has finished, as the calendar's save does. */
function syncSoon(db: Db, serverSecret: string, deps: PeopleSyncDeps): void {
  const running = peopleSyncInFlight(db) ?? Promise.resolve();
  void running
    .catch(() => undefined)
    .then(() => runPeopleSync(db, serverSecret, deps))
    .catch((err: unknown) => {
      // A bug, not Microsoft: its failures are recorded on the row and resolve.
      deps.log?.error('people.sync_failed', {
        error: err instanceof Error ? err.name : 'unknown',
      });
    });
}

/**
 * `PUT /api/v1/org/people-sync`: both switches at once.
 *
 * *Leavers* on with *Photos and profile* off is `422 leavers_need_profile`;
 * turning *Leavers* on without `user.deactivate` is `403`; turning either on
 * with no Microsoft 365 connection saved is `409 microsoft_not_connected`.
 * Turning *Photos and profile* on starts a run in the background.
 */
export function savePeopleSync(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  input: PeopleSyncInput,
  deps: PeopleSyncDeps = {},
): PeopleSyncView {
  assertCan(actor, 'org.calendar.configure');
  if (input.leavers_enabled && !input.profile_enabled) {
    throw new ApiError('unprocessable', 'Leavers are found by the profile sync: turn that on too', {
      field: 'leavers_enabled',
      reason: 'leavers_need_profile',
    });
  }
  const was = db.select().from(orgPeopleSync).get();
  if (input.leavers_enabled && was?.leaversEnabled !== 1) assertCan(actor, 'user.deactivate');
  const turningOn =
    (input.profile_enabled && was?.profileEnabled !== 1) ||
    (input.leavers_enabled && was?.leaversEnabled !== 1);
  if (turningOn && db.select().from(orgCalendarSource).get() === undefined) {
    throw new ApiError('conflict', 'Connect Microsoft 365 first', {
      reason: 'microsoft_not_connected',
    });
  }

  const now = (deps.now ?? Date.now)();
  const values = {
    profileEnabled: input.profile_enabled ? 1 : 0,
    leaversEnabled: input.leavers_enabled ? 1 : 0,
    configuredBy: actor.userId,
    updatedAt: now,
  };
  if (was === undefined) {
    db.insert(orgPeopleSync)
      .values({ orgId: requireOrgId(db), ...values })
      .run();
  } else {
    db.update(orgPeopleSync).set(values).where(eq(orgPeopleSync.orgId, was.orgId)).run();
  }
  if (input.profile_enabled && was?.profileEnabled !== 1) syncSoon(db, serverSecret, deps);
  return viewOf(db, deps);
}

/**
 * `POST /api/v1/org/people-sync/sync`: sync now, or wait for the run already
 * going, and answer how it went. `409 people_sync_off` unless *Photos and
 * profile* is on.
 */
export async function syncPeopleNow(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  deps: PeopleSyncDeps = {},
): Promise<PeopleSyncView> {
  assertCan(actor, 'org.calendar.configure');
  if (db.select().from(orgPeopleSync).get()?.profileEnabled !== 1) {
    throw new ApiError('conflict', 'The people sync is off', { reason: 'people_sync_off' });
  }
  await runPeopleSync(db, serverSecret, deps);
  return viewOf(db, deps);
}
