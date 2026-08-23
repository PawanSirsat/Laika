import { createHash } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { invites, orgs } from '../db/schema.ts';

/**
 * Invite-only signup (SPEC §4.2 `orgs.invite_only`, D-004).
 *
 * The check lives server-side and runs inside better-auth's sign-up hook, not in
 * the UI. Hiding a button is not access control: the endpoint is public, an agent
 * can POST to it, and the whole point of D-004 is that a self-hosted board does
 * not quietly accept strangers.
 */

/** Invite tokens are stored hashed, never in plaintext (§4.11, §13.1). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `true` when the org requires an invite. Absent org (first boot) ⇒ open. */
export function isInviteOnly(db: Db): boolean {
  const row = db.select({ inviteOnly: orgs.inviteOnly }).from(orgs).limit(1).get();

  // No org yet means first-run setup (LAI-009), which creates the Owner itself.
  return row === undefined ? false : row.inviteOnly === 1;
}

export interface UsableInvite {
  id: string;
  email: string | null;
  orgRole: 'owner' | 'admin' | 'member' | 'viewer';
  projectId: string | null;
  projectRole: 'lead' | 'member' | 'viewer' | null;
}

/**
 * Find an unexpired, unaccepted invite for this token.
 *
 * Expiry and acceptance are part of the lookup rather than checked afterwards,
 * so there is no window where a caller forgets one of them.
 */
export function findUsableInvite(db: Db, token: string, now: number): UsableInvite | null {
  const row = db
    .select({
      id: invites.id,
      email: invites.email,
      orgRole: invites.orgRole,
      projectId: invites.projectId,
      projectRole: invites.projectRole,
    })
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashInviteToken(token)),
        isNull(invites.acceptedBy),
        gt(invites.expiresAt, now),
      ),
    )
    .get();

  return row ?? null;
}

/**
 * An email-targeted invite is only usable by that address. A link invite
 * (`email IS NULL`) is usable by anyone holding the token (§4.11).
 */
export function inviteMatchesEmail(invite: UsableInvite, email: string): boolean {
  return invite.email === null || invite.email.toLowerCase() === email.toLowerCase();
}

/** Mark the invite consumed. Callers run this in the signup transaction. */
export function markInviteAccepted(db: Db, inviteId: string, userId: string, now: number): void {
  db.update(invites)
    .set({ acceptedBy: userId, acceptedAt: now })
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedBy)))
    .run();
}

/** Rows whose expiry has passed, for the cron sweep of §11.6. */
export function countExpiredInvites(db: Db, now: number): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(invites)
    .where(and(isNull(invites.acceptedBy), sql`${invites.expiresAt} <= ${now}`))
    .get();

  return row?.n ?? 0;
}
