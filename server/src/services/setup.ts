import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { orgs, projectMemberships, projects, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';

/**
 * First-run setup (SPEC §6.4, LAI-009) — the M1 exit criterion.
 *
 * A fresh container with an empty database has no org, no users and no way in.
 * This is the one endpoint that creates something from nothing, so it is also the
 * one that must never run twice.
 */

/** Is this instance still waiting to be set up? */
export function setupRequired(db: Db): boolean {
  return countOrgs(db) === 0;
}

function countOrgs(db: Db): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(orgs)
    .get();
  return row?.n ?? 0;
}

export interface SetupInput {
  orgName: string;
  ownerId: string;
  /** Optional first project. Both parts arrive together or not at all. */
  projectName?: string | undefined;
  projectPrefix?: string | undefined;
  /**
   * The first-boot presence toggle (§4.2, LAI-207). Absent means **on**, which
   * is §4.2's default and the design's.
   *
   * LAI-106 had to delete this control because there was nowhere to put the
   * answer: the body is strict (§6.3), so sending `trackPresence` failed the
   * whole submission with a `422`. Keeping the checkbox and not sending it was
   * the other option and is worse — a control that silently discards the user's
   * answer is exactly what strict validation exists to prevent.
   */
  presenceEnabled?: boolean | undefined;
  now?: number;
}

export interface SetupResult {
  orgId: string;
  ownerId: string;
  projectId: string | null;
}

/**
 * Turn a slug out of a display name: lowercase, hyphenated, no leading or
 * trailing separators. `"Laika Core!"` → `"laika-core"`.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A short uppercase display key (§4.3) — `LAI` for "Laika".
 *
 * Derived from initials when the name has several words, otherwise the first
 * letters. Callers may override it; this is only the default so the wizard can
 * ask for one field instead of two.
 */
export function defaultPrefix(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w !== '');

  if (words.length === 0) return 'PRJ';
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).padEnd(3, 'X');

  return words
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 4);
}

/**
 * Create the org, promote the Owner, and optionally create the first project —
 * in **one** transaction (AC2).
 *
 * The user already exists: better-auth created it, so the password is hashed its
 * way (Argon2id, §13.1) and the caller holds a session. Everything that follows
 * is ours, and either all of it lands or none does.
 *
 * `BEGIN IMMEDIATE` takes the write lock before the org count is read, which is
 * what makes the single-use guarantee hold under concurrency: a second caller
 * either waits and then sees the org, or fails — it cannot read zero and write
 * anyway. The same reasoning as task numbering (LAI-003).
 */
export function createFirstOrg(sqlite: Database.Database, db: Db, input: SetupInput): SetupResult {
  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    // Re-checked inside the lock. The caller checks first for a cheap early
    // rejection; this one is the authoritative answer.
    if (countOrgs(db) > 0) {
      throw new ApiError('conflict', 'This Laika has already been set up');
    }

    const orgId = newId();

    db.insert(orgs)
      .values({
        id: orgId,
        name: input.orgName,
        ownerUserId: input.ownerId,
        // D-004: invite-only is the default posture, and it is a flag rather
        // than the `signup_mode` enum earlier task text described.
        inviteOnly: 1,
        // Default on (§4.2), matching the design's default for the toggle.
        presenceEnabled: input.presenceEnabled === false ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // The account that ran setup is the Owner. Signup created it as `member`.
    db.update(users)
      .set({ orgRole: 'owner', updatedAt: new Date(now) })
      .where(sql`${users.id} = ${input.ownerId}`)
      .run();

    appendActivity(db, {
      orgId,
      actorId: input.ownerId,
      actorKind: 'user',
      type: 'org.created',
      payload: { name: input.orgName },
      now,
    });

    const projectId = input.projectName === undefined ? null : newId();

    if (projectId !== null && input.projectName !== undefined) {
      const prefix = (input.projectPrefix ?? defaultPrefix(input.projectName)).toUpperCase();

      db.insert(projects)
        .values({
          id: projectId,
          orgId,
          name: input.projectName,
          slug: slugify(input.projectName),
          prefix,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // The Owner leads the project they created; without this they hold only
      // the implicit lead that org role grants, and removing their org role
      // later would silently strip project access.
      db.insert(projectMemberships)
        .values({
          id: newId(),
          projectId,
          userId: input.ownerId,
          role: 'lead',
          createdAt: now,
        })
        .run();

      appendActivity(db, {
        orgId,
        projectId,
        actorId: input.ownerId,
        actorKind: 'user',
        type: 'project.created',
        payload: { name: input.projectName, prefix },
        now,
      });
    }

    return { orgId, ownerId: input.ownerId, projectId };
  });
}

/**
 * Remove an account created for a setup attempt that then lost the race.
 *
 * Two callers can both pass the early check and both create an account before
 * either takes the write lock. The loser's user would otherwise be an orphan
 * holding an email address, so setup could never be retried with it. better-auth's
 * session and account rows cascade with the user.
 */
export function removeOrphanedOwner(db: Db, userId: string): void {
  db.delete(users)
    .where(sql`${users.id} = ${userId}`)
    .run();
}
