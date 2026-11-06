import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole } from '../db/enums.ts';
import { tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { timeChangedSubject, writeNotice } from './notices.ts';
import {
  currentFields,
  entryById,
  type EntryPatch,
  insertEntry,
  type NewEntryInput,
  newEntryFields,
  patchEntry,
  patchTarget,
  retireEntry,
  revisionsOf,
  type TimeEntryView,
  type TimeRevisionView,
  type Tx,
} from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';
import { closedThrough } from './time-solidtime.ts';

/**
 * A member's confirmed time, changed by an owner or admin (D-143, LAI-1165,
 * amending D-102 rule 4 and D-088 items 2 and 6) — `POST`, `PATCH` and
 * `DELETE /people/:id/time-entries…`, from the person's Day tab on their
 * profile.
 *
 * **Confirmed entries only.** Drafts, the timer and breaks stay the person's
 * own, so nothing here reaches them. **Imports included** (the owner,
 * 2026-11-06): most of a team's time comes from Solidtime, and read-only
 * imports would leave nothing to correct. An import is never pushed back, so
 * the change stays in Laika; a later pull of that entry, changed in
 * Solidtime, may put Solidtime's version back — the history keeps both. The
 * person's own path still leaves imports to Solidtime. **Never a day in the
 * closed period**, which the push to Solidtime has already taken.
 *
 * **The editor is on the record.** Every change is a `time_entry_revisions`
 * row with `changed_by` the editor, so the entry's history names who did it;
 * and the person gets a `time_changed` notice saying so. No Undo: Undo is
 * the person's own, and an editor who got it wrong changes it back, which is
 * one more revision with their name on it.
 *
 * `time_entries.write_member`, session only: the owner anybody else's, an
 * admin anybody else's but the owner's (D-133's shape). Yourself is refused
 * here — your own time keeps its own path, with its Undo.
 */

interface Subject {
  id: string;
  orgRole: OrgRole;
}

/**
 * The person a request names, after the editor is asked about them, in the
 * order that discloses nothing — `requireSubject`'s in `developer-setup.ts`:
 *
 * 1. **yourself** is `422 use_own_time`;
 * 2. **the role**, asked before the person is looked up, so a member gets the
 *    same `403` for an id that exists and one that does not;
 * 3. **an unknown id** is `404`;
 * 4. **the owner's time** is `403 not_for_owner` to an admin.
 */
function requireSubject(db: Db, actor: ResolvedActor, userId: string): Subject {
  if (userId === actor.userId) {
    throw new ApiError('unprocessable', 'Your own time is changed on My day', {
      reason: 'use_own_time',
    });
  }
  const probe = { targetUserId: userId, targetOrgRole: 'member' as const };
  if (!can(actor, 'time_entries.write_member', probe)) {
    assertCan(actor, 'time_entries.write_member', probe);
  }

  const row = db
    .select({ id: users.id, orgRole: users.orgRole })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (row === undefined) throw ApiError.notFound(`No user with id "${userId}"`);

  const resource = { targetUserId: row.id, targetOrgRole: row.orgRole };
  if (!can(actor, 'time_entries.write_member', resource)) {
    if (row.orgRole === 'owner') {
      throw new ApiError('forbidden', "An admin cannot change the owner's time", {
        action: 'time_entries.write_member',
        reason: 'not_for_owner',
      });
    }
    assertCan(actor, 'time_entries.write_member', resource);
  }
  return row;
}

/** A day in the closed period is read-only here: `403 closed_period`. */
function assertOpen(db: Db, ...days: string[]): void {
  const closed = closedThrough(db);
  const day = days.find((d) => closed !== null && d <= closed);
  if (day !== undefined) {
    throw new ApiError('forbidden', `${day} is in the closed period`, {
      reason: 'closed_period',
      day,
    });
  }
}

/** The card's id, for the notice, when the entry is on one that still exists. */
function taskOf(tx: Tx, taskId: string | null): string | null {
  if (taskId === null) return null;
  return tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get()?.id ?? null;
}

function tell(
  db: Db,
  actor: ResolvedActor,
  subject: Subject,
  change: 'created' | 'edited' | 'deleted',
  day: string,
  delta: number,
  taskId: string | null,
  now: number,
): void {
  writeNotice(db, {
    userId: subject.id,
    actorUserId: actor.userId,
    kind: 'time_changed',
    taskId,
    subject: timeChangedSubject(change, day, delta),
    now,
  });
}

/** `POST /people/:id/time-entries`: an entry on the member's day, by the editor. */
export function createMemberEntry(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  input: NewEntryInput,
  now: number = Date.now(),
): TimeEntryView {
  const subject = requireSubject(db, actor, userId);
  assertTimeOn(db);
  const fields = newEntryFields(db, actor, input, now);
  assertOpen(db, fields.day);
  const id = db.transaction((tx) => {
    const made = insertEntry(tx, subject.id, fields, 'manual', null, now, actor.userId);
    const taskId = taskOf(tx, fields.target.taskId);
    tell(db, actor, subject, 'created', fields.day, fields.minutes, taskId, now);
    return made;
  });
  return entryById(db, subject.id, id);
}

/**
 * `PATCH /people/:id/time-entries/:entryId`: the editor corrects one of the
 * member's entries — its length, its edges, its note, its card. Another
 * person's entry under this member's id is `404`, as none is. A patch that
 * changes nothing writes no revision and tells nobody.
 */
export function updateMemberEntry(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  entryId: string,
  patch: EntryPatch,
  now: number = Date.now(),
): TimeEntryView {
  const subject = requireSubject(db, actor, userId);
  assertTimeOn(db);
  const resolved = patchTarget(db, actor, patch);
  db.transaction((tx) => {
    const row = currentFields(tx, subject.id, entryId, true);
    assertOpen(db, row.day, ...(patch.day === undefined ? [] : [patch.day]));
    const done = patchEntry(tx, subject.id, entryId, patch, resolved, actor.userId, now, true);
    if (done === null) return;
    const delta = done.after.minutes - done.beforeMinutes;
    const taskId = taskOf(tx, done.after.target.taskId);
    tell(db, actor, subject, 'edited', done.after.day, delta, taskId, now);
  });
  return entryById(db, subject.id, entryId);
}

/**
 * `DELETE /people/:id/time-entries/:entryId`: the editor takes back one of
 * the member's entries — kept, with `deleted_at` and a `deleted` revision by
 * the editor, as the person's own delete keeps it.
 */
export function deleteMemberEntry(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  entryId: string,
  now: number = Date.now(),
): void {
  const subject = requireSubject(db, actor, userId);
  assertTimeOn(db);
  db.transaction((tx) => {
    const row = currentFields(tx, subject.id, entryId, true);
    assertOpen(db, row.day);
    retireEntry(tx, entryId, actor.userId, now);
    tell(db, actor, subject, 'deleted', row.day, -row.minutes, taskOf(tx, row.taskId), now);
  });
}

/**
 * `GET /people/:id/time-entries/:entryId/revisions`: one of the member's
 * entries' history, for the editor who may change it — who changed what,
 * by name.
 */
export function listMemberRevisions(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  entryId: string,
): TimeRevisionView[] {
  const subject = requireSubject(db, actor, userId);
  return revisionsOf(db, subject.id, entryId);
}
