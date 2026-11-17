import { inArray } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { userEmailPrefs } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';

/**
 * A person's own email switches (§4.97, D-153, LAI-1313): instant mail when
 * they are assigned or @mentioned, and the daily digest.
 *
 * **Both on unless they say otherwise.** No row is the defaults, so a person
 * who never opens the section is mailed as the organisation intends — and
 * nothing at all is mailed while the organisation's switch is off, whatever
 * these say.
 *
 * `email_prefs.own`, **session only** (§3.1): whether a person hears from
 * Laika is theirs to decide, not an agent's acting for them. Every read and
 * write is the caller's own row; no path names anybody else's.
 */

/** `GET /me/email-prefs` (§6.4). */
export interface EmailPrefsView {
  /** Mail at once when assigned a task or @mentioned in a comment. */
  instant: boolean;
  /** One mail a morning with everything else on the tasks they watch. */
  digest: boolean;
}

/** The defaults: what a person with no row gets. */
export const EMAIL_PREFS_DEFAULT: EmailPrefsView = { instant: true, digest: true };

export function getEmailPrefs(db: Db, actor: ResolvedActor): EmailPrefsView {
  assertCan(actor, 'email_prefs.own');
  return emailPrefsFor(db, [actor.userId]).get(actor.userId) ?? { ...EMAIL_PREFS_DEFAULT };
}

/** `PUT /me/email-prefs`: either or both; absent leaves alone. */
export interface SetEmailPrefsInput {
  instant?: boolean | undefined;
  digest?: boolean | undefined;
}

export function setEmailPrefs(
  db: Db,
  actor: ResolvedActor,
  input: SetEmailPrefsInput,
  now: number = Date.now(),
): EmailPrefsView {
  assertCan(actor, 'email_prefs.own');
  const current = getEmailPrefs(db, actor);
  const next: EmailPrefsView = {
    instant: input.instant ?? current.instant,
    digest: input.digest ?? current.digest,
  };
  db.insert(userEmailPrefs)
    .values({
      userId: actor.userId,
      instant: next.instant ? 1 : 0,
      digest: next.digest ? 1 : 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userEmailPrefs.userId,
      set: { instant: next.instant ? 1 : 0, digest: next.digest ? 1 : 0, updatedAt: now },
    })
    .run();
  return next;
}

/**
 * The switches of many people at once, for the email job — the defaults for
 * anyone with no row. No `can()`: the job acts as the system and only reads
 * what each person chose for themselves.
 */
export function emailPrefsFor(db: Db, userIds: readonly string[]): Map<string, EmailPrefsView> {
  const out = new Map<string, EmailPrefsView>();
  for (const id of userIds) out.set(id, { ...EMAIL_PREFS_DEFAULT });
  if (userIds.length === 0) return out;
  const rows = db
    .select()
    .from(userEmailPrefs)
    .where(inArray(userEmailPrefs.userId, [...userIds]))
    .all();
  for (const row of rows) {
    out.set(row.userId, { instant: row.instant === 1, digest: row.digest === 1 });
  }
  return out;
}
