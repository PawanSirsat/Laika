import { and, eq, ne } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { TIME_MODES, type TimeMode } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgTimeSettings, timeDrafts, userTimeSettings } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { MIN_SYNC_INTERVAL_S } from './local-activity.ts';

export { TIME_MODES };

/**
 * Time's two switches (D-088 item 5, SPEC §4.45–§4.46, LAI-787): the
 * organisation's *Time* — `off`, `manual` or `drafts` — and each person's own
 * *Draft my time*. **No row is off** on both sides: time is something an owner
 * or admin turns on, and drafting is something each person turns on for
 * themselves, from a signed-in web session (§3.1).
 *
 * ## Either off stops drafting and deletes what is held
 *
 * A draft exists only while both are on. The organisation leaving `drafts`
 * deletes every person's unconfirmed drafts; a person turning *Draft my time*
 * off deletes theirs — in the same transaction as the switch, so there is no
 * moment when the switch says off and a draft is still readable. **A confirmed
 * draft stays**, its evidence blanked: it is what keeps the block it came from
 * from being drafted again when drafting is turned back on (LAI-787 review
 * B1), and retention deletes it after 30 days. Confirmed entries are records
 * the person made and no switch touches them; `manual` still lets people type
 * their own.
 *
 * Changing either writes no `activity` row: §4.8 has no verb for it, and a
 * verb is an `activity` rebuild — the reason D-079's switches give.
 */

/** `GET /me/time-settings` — what a collector asks before it drafts, and My day's header. */
export interface TimeSettingsView {
  /** The organisation's *Time*. */
  org_mode: TimeMode;
  /** The person's own *Draft my time*. */
  draft_my_time: boolean;
  /** Both on: the collector may send blocks and an agent may propose. */
  drafting: boolean;
  /** How often a collector may send, as `/me/activity-sharing` says it. */
  min_sync_interval_s: number;
}

/** The organisation's *Time*; `off` when nobody has set it. */
export function timeMode(db: Db): TimeMode {
  const row = db
    .select({ mode: orgTimeSettings.mode })
    .from(orgTimeSettings)
    .where(eq(orgTimeSettings.orgId, requireOrgId(db)))
    .get();
  return row?.mode ?? 'off';
}

/** A person's own *Draft my time*; off when they never turned it on. */
export function draftMyTime(db: Db, userId: string): boolean {
  const row = db
    .select({ on: userTimeSettings.draftMyTime })
    .from(userTimeSettings)
    .where(eq(userTimeSettings.userId, userId))
    .get();
  return row?.on === 1;
}

function viewFor(db: Db, userId: string): TimeSettingsView {
  const mode = timeMode(db);
  const mine = draftMyTime(db, userId);
  return {
    org_mode: mode,
    draft_my_time: mine,
    drafting: mode === 'drafts' && mine,
    min_sync_interval_s: MIN_SYNC_INTERVAL_S,
  };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A switch turned off: every draft not confirmed goes — one person's, or
 * everybody's — and a confirmed one keeps only what ties it to its entry and
 * to the block it came from, its evidence blanked.
 */
function forgetDrafts(tx: Tx, userId?: string): void {
  const whose = userId === undefined ? undefined : eq(timeDrafts.userId, userId);
  tx.delete(timeDrafts)
    .where(and(whose, ne(timeDrafts.state, 'confirmed')))
    .run();
  tx.update(timeDrafts)
    .set({ signals: '{}' })
    .where(and(whose, eq(timeDrafts.state, 'confirmed')))
    .run();
}

/** `GET /me/time-settings`: a session or any token of theirs (§3.1). */
export function getTimeSettings(db: Db, actor: ResolvedActor): TimeSettingsView {
  assertCan(actor, 'time_settings.read_own');
  return viewFor(db, actor.userId);
}

/**
 * `PUT /me/time-settings`: the person's own *Draft my time*, from a web
 * session only. Off deletes every draft they have not confirmed, now.
 */
export function setTimeSettings(
  db: Db,
  actor: ResolvedActor,
  input: { draft_my_time: boolean },
  now: number = Date.now(),
): TimeSettingsView {
  assertCan(actor, 'time_settings.set_own');
  const value = input.draft_my_time ? 1 : 0;
  db.transaction((tx) => {
    tx.insert(userTimeSettings)
      .values({ userId: actor.userId, draftMyTime: value, updatedAt: now })
      .onConflictDoUpdate({
        target: userTimeSettings.userId,
        set: { draftMyTime: value, updatedAt: now },
      })
      .run();
    if (value === 0) forgetDrafts(tx, actor.userId);
  });
  return viewFor(db, actor.userId);
}

/**
 * `PUT /org/time`: owners and admins, from a web session only. Leaving
 * `drafts` deletes every draft anybody has not confirmed, now.
 */
export function setOrgTimeMode(
  db: Db,
  actor: ResolvedActor,
  mode: TimeMode,
  now: number = Date.now(),
): { mode: TimeMode } {
  assertCan(actor, 'org.time.set');
  const orgId = requireOrgId(db);
  db.transaction((tx) => {
    tx.insert(orgTimeSettings)
      .values({ orgId, mode, updatedAt: now })
      .onConflictDoUpdate({ target: orgTimeSettings.orgId, set: { mode, updatedAt: now } })
      .run();
    if (mode !== 'drafts') forgetDrafts(tx);
  });
  return { mode };
}

/**
 * Both switches on, or `403` with `details.reason: "time_drafts_off"` — what a
 * collector stops on and an agent is told (§6.3's envelope, as
 * `local_activity_off`). Asked before anything is read or written.
 */
export function assertDrafting(db: Db, actor: ResolvedActor): void {
  const view = viewFor(db, actor.userId);
  if (view.drafting) return;
  throw new ApiError(
    'forbidden',
    view.org_mode === 'drafts'
      ? 'Draft my time is off for this account'
      : 'Drafting time is off for this organisation',
    { reason: 'time_drafts_off', org_mode: view.org_mode, draft_my_time: view.draft_my_time },
  );
}

/**
 * The organisation keeps time at all, or `403` with `details.reason:
 * "time_off"`. A manual entry needs only this; a draft needs both switches.
 */
export function assertTimeOn(db: Db): void {
  const mode = timeMode(db);
  if (mode !== 'off') return;
  throw new ApiError('forbidden', 'Time is off for this organisation', {
    reason: 'time_off',
    org_mode: mode,
  });
}
