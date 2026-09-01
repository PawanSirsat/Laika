import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { and, desc, eq, gt, isNull, lt, or, type SQL } from 'drizzle-orm';
import { hashInviteToken } from '../auth/invites.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { requireOrg } from '../db/orgs.ts';
import { type OrgRole, type ProjectRole } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { invites, orgs, projectMemberships, projects, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Invites (SPEC §4.11, §6.4, D-004).
 *
 * `POST /api/v1/setup` runs once. Before this module there was no second way for
 * anyone to reach a running Laika, so an instance had exactly one account for
 * ever — which makes the M2 exit test (two humans, two machines) unreachable.
 *
 * ## Which §3.1 cells govern it
 *
 * **"Invite users / change org roles | ✓ | ✓ (not to Owner) | — | — |"** — the
 * one row, read whole. Creating, listing and revoking are all `user.invite`:
 * they are one capability seen from three sides, and the row names one thing.
 * That is different from "List / revoke **anyone's** token", which the actions
 * list splits in two, because that row names two operations in its own text.
 *
 * The `(not to Owner)` half is enforced as a **second** check against
 * `user.set_role` with the role being granted. Without it an Admin invites
 * themselves a fresh Owner account and the caveat on `user.set_role` is
 * decorative — the same reasoning already written into `can()` for the direct
 * role change. An invite is a role grant with a delay on it.
 *
 * A project-scoped invite (§4.11 `project_id`) additionally needs
 * `project.members.manage` on that project, which is §3.2's own cell for putting
 * someone into a project. Nothing here invents a permission.
 *
 * ## Two endpoints deliberately have no `can()` call
 *
 * `GET /invites/:token` and `POST /invites/accept` are pre-auth: they are how
 * somebody who has no account gets one, so there is no actor to ask about. That
 * is the same exemption `GET /setup/status` and `POST /setup` already hold, and
 * §6.4 labels the preview "unauthenticated" in the spec itself. The token is the
 * credential in both, and it is checked before either returns anything.
 *
 * ## No email is sent
 *
 * Laika has no SMTP (§11.7 lists no mail configuration and nothing reads one).
 * An invite yields a URL and the inviter passes it on themselves. `email_sent`
 * is on the response as a literal `false` so a UI cannot imply otherwise — a
 * screen that says "invitation sent" when nothing was sent is a support ticket
 * that arrives a week later.
 */

/**
 * Seven days.
 *
 * Long enough to survive a weekend and a holiday Monday, which is the realistic
 * gap between an admin creating an invite and a new colleague opening it. Short
 * enough that a link pasted into a chat channel and forgotten stops working
 * inside the same sprint. It matches the only other expiry Laika already has —
 * unreviewed meeting proposals (§4.12) — and §11.6 sweeps both from one cron.
 */
/**
 * Re-exported so the route can validate a role without importing `db/` — which
 * the layering rule forbids (CONVENTIONS §2), and rightly.
 *
 * The alternative, and what `routes/tasks.ts` and `routes/sprints.ts` do today,
 * is to retype the tuple in the route file. That makes a fourth copy of a closed
 * vocabulary whose entire reason for living in `db/enums.ts` is that one
 * declaration cannot drift from another, and nothing checks the route copies
 * against it. One line here costs nothing and removes the drift instead of
 * adding to it. LAI-119 converges the other two.
 */
export { ORG_ROLES, PROJECT_ROLES } from '../db/enums.ts';

export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * 256 bits of `randomBytes`, base64url — 43 characters.
 *
 * Drawn from the CSPRNG and from nothing else. The email, the id, the org and
 * the clock are all guessable or discoverable, so none of them may contribute:
 * a token derived from the invitee's address would be forgeable by anyone who
 * knows who was invited, which is everyone in the room. 256 bits is the same
 * strength the session cookie carries, and the personal access tokens of M3
 * should mint theirs the same way.
 */
export const INVITE_TOKEN_BYTES = 32;

export function newInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export interface InviteView {
  id: string;
  /** Null for a link invite — anyone holding the token may use it (§4.11). */
  email: string | null;
  org_role: OrgRole;
  project_id: string | null;
  project_role: ProjectRole | null;
  created_by: string;
  created_at: number;
  expires_at: number;
  /** Always `false`. Laika sends no mail; see the module comment. */
  email_sent: false;
}

type InviteRow = typeof invites.$inferSelect;

function toView(row: InviteRow): InviteView {
  return {
    id: row.id,
    email: row.email,
    org_role: row.orgRole,
    project_id: row.projectId,
    project_role: row.projectRole,
    created_by: row.createdBy,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    email_sent: false,
  };
}

export interface CreateInviteInput {
  email?: string | null | undefined;
  orgRole: OrgRole;
  projectId?: string | null | undefined;
  projectRole?: ProjectRole | null | undefined;
  now?: number;
}

export interface CreatedInvite {
  invite: InviteView;
  /**
   * The plaintext token, returned exactly once. Only its SHA-256 is stored, so
   * this value cannot be recovered from the database afterwards — losing it
   * means revoking the invite and issuing another.
   */
  token: string;
}

/**
 * Refuse an address that already has an account.
 *
 * Both answers are `409`, matching how membership already behaves (adding a
 * member who is one is a conflict, not a fresh insert). They carry different
 * messages because the remedies differ: an active user needs no invite, while a
 * deactivated one needs reactivating — and reactivating is `user.deactivate`'s
 * inverse, not something an invite may do quietly. An invite that silently
 * restored a deactivated account would be a way around the deactivate cell.
 */
function assertEmailFree(db: Db, email: string): void {
  const existing = db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existing === undefined) return;

  if (existing.isActive === 1) {
    throw new ApiError('conflict', `${email} already has an account in this Laika`, {
      user_id: existing.id,
    });
  }

  throw new ApiError(
    'conflict',
    `${email} belongs to a deactivated account; reactivate it rather than inviting again`,
    { user_id: existing.id, is_active: false },
  );
}

/**
 * One live invite per address at a time.
 *
 * Two valid tokens for one person makes revocation ambiguous — an admin revokes
 * "the invite" and the other one still works. The existing id travels in
 * `details` so a UI can offer "revoke and re-invite" as one action rather than
 * leaving the admin to find it.
 */
function assertNoLiveInvite(db: Db, email: string, now: number): void {
  const existing = db
    .select({ id: invites.id, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.email, email), isNull(invites.acceptedBy), gt(invites.expiresAt, now)))
    .get();

  if (existing === undefined) return;

  throw new ApiError('conflict', `${email} already has a pending invite`, {
    invite_id: existing.id,
    expires_at: existing.expiresAt,
  });
}

function requireProject(db: Db, projectId: string): { id: string; name: string } {
  const row = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (row === undefined) throw ApiError.notFound('No such project', { project_id: projectId });

  return row;
}

export function createInvite(
  db: Db,
  actor: ResolvedActor,
  input: CreateInviteInput,
): CreatedInvite {
  assertCan(actor, 'user.invite');
  // The row's "(not to Owner)" half. `user.set_role` is the only action that
  // takes `targetOrgRole`, and an invite grants a role just as surely.
  assertCan(actor, 'user.set_role', { targetOrgRole: input.orgRole });

  const now = input.now ?? Date.now();
  const org = requireOrg(db);
  const email =
    input.email === undefined || input.email === null ? null : input.email.toLowerCase();

  if (email !== null) {
    assertEmailFree(db, email);
    assertNoLiveInvite(db, email, now);
  }

  const projectId = input.projectId ?? null;
  const projectRole = input.projectRole ?? null;

  if (projectId === null && projectRole !== null) {
    throw new ApiError('unprocessable', 'project_role needs a project_id beside it', {
      project_role: projectRole,
    });
  }

  if (projectId !== null) {
    requireProject(db, projectId);
    // §3.2's own cell for putting someone into a project. An org admin holds
    // implicit lead everywhere (§3), so this only bites for a role that does not.
    assertCan(
      { ...actor, projectRole: projectRoleOf(actor, projectId) },
      'project.members.manage',
      {
        projectId,
      },
    );
  }

  const token = newInviteToken();
  const row: InviteRow = {
    id: newId(),
    orgId: org.id,
    email,
    orgRole: input.orgRole,
    projectId,
    projectRole: projectId === null ? null : (projectRole ?? 'member'),
    tokenHash: hashInviteToken(token),
    createdBy: actor.userId,
    expiresAt: now + INVITE_TTL_MS,
    acceptedBy: null,
    acceptedAt: null,
    createdAt: now,
  };

  db.insert(invites).values(row).run();

  return { invite: toView(row), token };
}

function projectRoleOf(actor: ResolvedActor, projectId: string): ProjectRole | null {
  return actor.memberships.find((m) => m.projectId === projectId)?.role ?? null;
}

export interface ListInvitesOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  /** Include accepted and expired rows. Off by default — AC2 asks for pending. */
  includeUsed?: boolean | undefined;
  now?: number;
}

/**
 * Pending invites, newest first.
 *
 * `(created_at, id)` descending. The id tiebreak only has to be *stable*, which
 * unique ULIDs are; it is not claiming to be chronological, so this is not the
 * trap `activity` hit in LAI-055 — there the tiebreak was asked to carry meaning
 * it could not.
 */
export function listInvites(
  db: Db,
  actor: ResolvedActor,
  options: ListInvitesOptions,
): InviteView[] {
  assertCan(actor, 'user.invite');

  const now = options.now ?? Date.now();
  const conditions: SQL[] = [];

  if (options.includeUsed !== true) {
    conditions.push(isNull(invites.acceptedBy));
    conditions.push(gt(invites.expiresAt, now));
  }

  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(invites.createdAt, key),
        and(eq(invites.createdAt, key), lt(invites.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select()
    .from(invites)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(invites.createdAt), desc(invites.id))
    .limit(options.limit + 1)
    .all()
    .map(toView);
}

/**
 * Revoke by deleting the row.
 *
 * §4.11 has no `revoked_at` and adding one is a schema change the spec does not
 * describe. It would also be describing a state nothing reads: a pending invite
 * that has been revoked is indistinguishable, to every caller, from one that
 * never existed. Nothing references the row — `accepted_by` is null by
 * definition here — so there is no history to lose.
 *
 * An **accepted** invite is different: it is the record of how somebody got in,
 * and deleting it would erase that. Those answer `409`.
 */
export function revokeInvite(db: Db, actor: ResolvedActor, id: string): void {
  assertCan(actor, 'user.invite');

  const row = db
    .select({ id: invites.id, acceptedBy: invites.acceptedBy })
    .from(invites)
    .where(eq(invites.id, id))
    .get();

  if (row === undefined) throw ApiError.notFound('No such invite', { invite_id: id });

  if (row.acceptedBy !== null) {
    throw new ApiError('conflict', 'That invite has already been accepted and cannot be revoked', {
      invite_id: id,
    });
  }

  db.delete(invites).where(eq(invites.id, id)).run();
}

export interface InvitePreview {
  org_name: string;
  inviter_name: string;
  org_role: OrgRole;
  project_id: string | null;
  project_name: string | null;
  project_role: ProjectRole | null;
  /** Null for a link invite; otherwise the address this token is bound to. */
  email: string | null;
  expires_at: number;
}

/**
 * The unauthenticated preview of §6.4 — org name, inviter, role, expiry.
 *
 * No `can()`: there is nobody to ask about. Holding the token is the whole
 * credential, exactly as it is for accepting, and an invalid or spent one is
 * `404` rather than a shape that distinguishes "wrong" from "expired". The
 * distinction would tell a guesser their token exists.
 */
export function previewInvite(db: Db, token: string, now: number = Date.now()): InvitePreview {
  const row = db
    .select({
      orgRole: invites.orgRole,
      projectId: invites.projectId,
      projectRole: invites.projectRole,
      email: invites.email,
      expiresAt: invites.expiresAt,
      orgName: orgs.name,
      inviterName: users.name,
    })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .innerJoin(users, eq(users.id, invites.createdBy))
    .where(
      and(
        eq(invites.tokenHash, hashInviteToken(token)),
        isNull(invites.acceptedBy),
        gt(invites.expiresAt, now),
      ),
    )
    .get();

  if (row === undefined) {
    throw ApiError.notFound('That invite is invalid, expired, or already used');
  }

  const project =
    row.projectId === null
      ? null
      : (db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, row.projectId))
          .get()?.name ?? null);

  return {
    org_name: row.orgName,
    inviter_name: row.inviterName,
    org_role: row.orgRole,
    project_id: row.projectId,
    project_name: project,
    project_role: row.projectRole,
    email: row.email,
    expires_at: row.expiresAt,
  };
}

/** The one wording every accept path refuses with. See `resolveInviteForAccept`. */
const REFUSED = 'That invite is invalid, expired, or already used';

export interface AcceptableInvite {
  /** Null for a link invite — the caller must supply an address of their own. */
  email: string | null;
  orgRole: OrgRole;
  projectId: string | null;
}

/**
 * Read the invite an accept request is about, before an account exists.
 *
 * Separate from `previewInvite` because the two answer differently on purpose.
 * The preview is a `GET` for a resource, so a missing one is `404`. Accepting is
 * an *action* the token has to authorise, so a token that does not authorise it
 * is `403` — which is also what `POST /api/v1/auth/sign-up/email` already
 * answers for the same token, and the two must not disagree about one input.
 *
 * Unknown, expired and already-spent are one indistinguishable answer in both
 * functions. Splitting them would confirm to somebody posting guesses that a
 * token exists, which is the only thing worth learning here.
 */
export function resolveInviteForAccept(
  db: Db,
  token: string,
  now: number = Date.now(),
): AcceptableInvite {
  const row = db
    .select({
      email: invites.email,
      orgRole: invites.orgRole,
      projectId: invites.projectId,
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

  if (row === undefined) throw new ApiError('forbidden', REFUSED);

  return row;
}

export interface ConsumeInviteInput {
  token: string;
  /** The account better-auth has just created for the invitee. */
  userId: string;
  now?: number;
}

export interface ConsumedInvite {
  inviteId: string;
  orgRole: OrgRole;
  projectId: string | null;
  projectRole: ProjectRole | null;
}

/**
 * Spend the invite and land the new account on the role it was issued for.
 *
 * ## Why this is one transaction and why it is `IMMEDIATE`
 *
 * Marking the invite used, promoting the user, adding the project membership and
 * writing the audit row either all happen or none do. Half of it is worse than
 * none: an invite marked spent whose role never applied leaves somebody
 * permanently a `member` with no way to retry, and a role applied without the
 * invite marked spent is the replay hole this exists to close.
 *
 * `BEGIN IMMEDIATE` takes the write lock before the invite is re-read, so two
 * people racing the same token cannot both read it unspent. The conditional
 * `WHERE accepted_by IS NULL` on the update is the backstop that makes the loser
 * loud rather than silent — `changes === 0` is the race, and it throws.
 *
 * ## Why it lives here and not in the accept route
 *
 * `POST /api/v1/auth/sign-up/email` is a public endpoint that already takes an
 * `inviteToken` (D-004's gate reads it). If only the accept route consumed
 * invites, a caller who posted straight to better-auth would sign up with a
 * valid token, land on the default `member` role, and leave the token **unspent
 * and reusable for ever**. So the consumption is wired into the sign-up hook
 * itself, where both paths meet, and this function is what that hook calls.
 */
export function consumeInvite(
  sqlite: Database.Database,
  db: Db,
  input: ConsumeInviteInput,
): ConsumedInvite {
  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    const row = db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashInviteToken(input.token)))
      .get();

    if (row?.acceptedBy !== null || row.expiresAt <= now) {
      throw new ApiError('forbidden', REFUSED);
    }

    const marked = db
      .update(invites)
      .set({ acceptedBy: input.userId, acceptedAt: now })
      .where(and(eq(invites.id, row.id), isNull(invites.acceptedBy)))
      .run();

    // Unreachable under the write lock above; kept because the guarantee this
    // function exists for should not rest on one lock being taken correctly.
    if (marked.changes !== 1) {
      throw new ApiError('forbidden', 'That invite has already been used');
    }

    db.update(users)
      .set({ orgRole: row.orgRole, updatedAt: new Date(now) })
      .where(eq(users.id, input.userId))
      .run();

    // Org-scoped: `project_id` is null, so §3.1's audit-log cell governs who can
    // read it, which is admin+ (see `visibleTo` in services/events.ts).
    appendActivity(db, {
      orgId: row.orgId,
      actorId: input.userId,
      actorKind: 'user',
      type: 'member.added',
      payload: {
        user_id: input.userId,
        org_role: row.orgRole,
        via: 'invite',
        invite_id: row.id,
        invited_by: row.createdBy,
      },
      now,
    });

    if (row.projectId !== null) {
      const role = row.projectRole ?? 'member';

      db.insert(projectMemberships)
        .values({
          id: newId(),
          projectId: row.projectId,
          userId: input.userId,
          role,
          createdAt: now,
        })
        .run();

      // A second row, project-scoped, in the same shape `projects.ts` writes when
      // a member is added directly — so a project's feed shows the arrival
      // whether it came from an invite or from the members screen.
      appendActivity(db, {
        orgId: row.orgId,
        projectId: row.projectId,
        actorId: input.userId,
        actorKind: 'user',
        type: 'member.added',
        payload: { user_id: input.userId, role, via: 'invite' },
        now,
      });
    }

    return {
      inviteId: row.id,
      orgRole: row.orgRole,
      projectId: row.projectId,
      projectRole: row.projectRole,
    };
  });
}

/**
 * Remove an account whose invite could not be spent.
 *
 * better-auth creates the user before the sign-up hook's `after` stage runs, so
 * a lost race leaves an orphan holding an email address — and because that
 * address is now taken, the invite could never be retried with it. Sessions and
 * accounts cascade with the user (§4.1). Same reasoning as `removeOrphanedOwner`
 * in setup, and the same shape.
 */
export function removeOrphanedInvitee(db: Db, userId: string): void {
  db.delete(users).where(eq(users.id, userId)).run();
}
