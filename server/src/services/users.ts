import { and, asc, eq, gt, gte, inArray, isNull, max, or, type SQL } from 'drizzle-orm';
import { activityActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole, type ProjectRole } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgs, projectMemberships, projects, sessions, tokens, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import {
  applyOffboardingChoice,
  assertOffboardingChoice,
  openTasksHeldBy,
  type OpenTasksChoice,
} from './offboarding.ts';
import { canSeeProject } from './projects.ts';

/**
 * Re-exported so `http/routes/users.ts` can validate a role without importing
 * `db/` — routes are transport and reach data through `services/`
 * (CONVENTIONS §2). `services/tasks.ts` re-exports the task vocabularies for the
 * same reason.
 */
export { ORG_ROLES } from '../db/enums.ts';

/**
 * The organisation's people (SPEC §6.4 `GET /api/v1/users`, §4.1, §3.1).
 *
 * Exists because `POST /projects/:slug/members` takes a `user_id` and nothing in
 * the API returned one: membership could be changed but a person could not be
 * found, so any UI adding a member could only offer a raw id field.
 *
 * ## Which §3.1 cell governs it
 *
 * **"View member list" — ✓ for Owner, Admin, Member and Viewer** — implemented as
 * `member_list.read`. Not a stand-in: §3.1 has a row for exactly this, a
 * directory of the org's people, and it grants it to every role. Nothing here had
 * to be invented, unlike the org-scoped activity rows of LAI-048 (LAI-111).
 *
 * The gate still does real work: `can()` refuses a deactivated user before a row
 * is read, so deactivation takes effect on this endpoint immediately rather than
 * at next sign-out.
 *
 * ## Emails are included, and that is a decision
 *
 * §4.1 has `email` and §3.1 does not say what a "member list" contains. Including
 * it is consistent rather than novel: `GET /projects/:slug/members` has returned
 * every member's email since LAI-010, gated on `project.read`, so a colleague's
 * address is already visible to anyone sharing a project with them. Withholding it
 * *here* would not protect anything — it would only make this endpoint the
 * inconsistent one, and leave a member picker unable to tell two people with the
 * same name apart.
 *
 * If that is judged wrong, the change belongs in **both** places at once, and it
 * is a product decision rather than an implementation detail.
 *
 * ## There are no non-human users
 *
 * An agent authenticates with a personal access token, and a token belongs to a
 * real person (§4.9 `tokens.user_id`). `actor_kind` on `activity` distinguishes
 * `user` from `agent` **per event**, not per account, and nothing creates a
 * service account. So there is no bot row for a member picker to offer by
 * mistake — the concern is real and the object of it does not exist. A test
 * asserts the `users` table has no column that would introduce one, so this
 * paragraph cannot quietly stop being true.
 */

export interface UserView {
  id: string;
  name: string;
  email: string;
  org_role: OrgRole;
  /** False for a deactivated person. The row is kept so history keeps its author. */
  is_active: boolean;
  /**
   * When they were last seen signed in: the latest activity of any of their
   * sessions, live or ended (D-104 item 3, LAI-981). `null` for somebody who
   * has never signed in. better-auth refreshes a session at most once per
   * `updateAge`, so this is as fine-grained as that and no finer.
   */
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

type UserRow = typeof users.$inferSelect;

function toView(row: UserRow, liveSeenAt: number | null): UserView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    org_role: row.orgRole,
    is_active: row.isActive === 1,
    last_seen_at: latest(row.lastSeenAt, liveSeenAt),
    // Date-typed columns since LAI-005 (better-auth hands the adapter `Date`s);
    // the API speaks unix-ms like every other timestamp in §6.3.
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
  };
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Each person's latest live-session activity, for the rows about to be served. */
function liveSeenAt(db: Db, userIds: readonly string[]): Map<string, number> {
  if (userIds.length === 0) return new Map();

  const rows = db
    .select({ userId: sessions.userId, at: max(sessions.updatedAt) })
    .from(sessions)
    .where(inArray(sessions.userId, [...userIds]))
    .groupBy(sessions.userId)
    .all();

  return new Map(
    rows.flatMap((row) => (row.at === null ? [] : [[row.userId, row.at.getTime()] as const])),
  );
}

/**
 * Active people, and how many of them were seen at or after `since` — by
 * `last_seen_at` exactly as `UserView` serves it (LAI-981), so the overview
 * and the directory cannot disagree about one person (LAI-986). No `can()`:
 * a count, for `services/org-overview.ts`, which asks `org.read`.
 */
export function activePeopleSeenSince(db: Db, since: number): { active: number; seen: number } {
  const views = viewsOf(db, db.select().from(users).where(eq(users.isActive, 1)).all());
  return {
    active: views.length,
    seen: views.filter((v) => v.last_seen_at !== null && v.last_seen_at >= since).length,
  };
}

function viewsOf(db: Db, rows: readonly UserRow[]): UserView[] {
  const seen = liveSeenAt(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toView(row, seen.get(row.id) ?? null));
}

function viewOf(db: Db, row: UserRow): UserView {
  return viewsOf(db, [row])[0]!;
}

export interface ListUsersOptions {
  limit: number;
  /** Keyset cursor over `(name, id)` — see the ordering note below. */
  cursor: { sortKey: string | number; id: string } | null;
  updatedSince: number | null;
  /**
   * Include deactivated people. Off by default: the first caller is a member
   * picker, and offering someone who can no longer sign in is a defect.
   */
  includeInactive?: boolean | undefined;
}

/**
 * The directory, **alphabetically by name**.
 *
 * Ordered by `(name, id)` rather than the `(updated_at, id)` that `projects` and
 * `tasks` use, for the same reason sprints are ordered by date: this list is read
 * as a directory, and re-sorting client-side would make the cursor meaningless.
 * `updated_since` remains a filter on `updated_at` — a filter and a sort key are
 * different things.
 *
 * `(name, id)` is a total order even though names collide, because ids are
 * unique. That is *not* the trap `activity` hit (LAI-055): there the problem was
 * a ULID tiebreaker within one millisecond disagreeing with insert order, which
 * only matters when the rows are meant to be chronological. Here nothing claims
 * the tiebreak means anything — it only has to be stable, and it is.
 *
 * ## Deactivation is not a soft delete
 *
 * §6.3 wants soft-deleted rows to come back from `updated_since` as tombstones,
 * so a client's local copy does not keep a record the server dropped. A
 * deactivated person is not dropped — §4.1 keeps the row so history keeps its
 * author — so a tombstone would be a lie. `updated_since` returns the row with
 * `is_active: false`, which is the change the client needs to see, and it is
 * returned **regardless of `includeInactive`**: a catch-up that hid the
 * deactivation would leave the client showing them as active for ever.
 */
export function listUsers(db: Db, actor: ResolvedActor, options: ListUsersOptions): UserView[] {
  assertCan(actor, 'member_list.read');

  const conditions: SQL[] = [];

  // A catch-up read always sees deactivations; a plain read does not have to.
  if (options.includeInactive !== true && options.updatedSince === null) {
    conditions.push(eq(users.isActive, 1));
  }

  if (options.updatedSince !== null) {
    conditions.push(gte(users.updatedAt, new Date(options.updatedSince)));
  }

  if (options.cursor !== null) {
    const key = String(options.cursor.sortKey);
    conditions.push(
      or(gt(users.name, key), and(eq(users.name, key), gt(users.id, options.cursor.id)))!,
    );
  }

  const rows = db
    .select()
    .from(users)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(users.name), asc(users.id))
    .limit(options.limit + 1)
    .all();

  return viewsOf(db, rows);
}

/**
 * Org role changes and deactivation (SPEC §3.1, §4.1, LAI-222).
 *
 * §3.1 grants the Owner *"Change org roles"* (theirs alone since D-102,
 * LAI-958) and Owner and Admin *"Deactivate user"* (a grant, LAI-958), and
 * `users` has carried `org_role` and `is_active` since
 * LAI-003 — but until LAI-222 **no route wrote either**, so the permissions were
 * real and unreachable.
 *
 * ## One invariant, not four rules
 *
 * An organisation with no active Owner is unrecoverable: there is no route back,
 * no console, and no second org to escalate from. Four of this task's criteria
 * describe that trap from different angles — demoting the last Owner,
 * deactivating them, and doing either to yourself — and they are all the same
 * sentence: **at least one active Owner must remain.**
 *
 * Both write paths check exactly that, so self-versus-other never enters into
 * it. Two rules that must agree eventually disagree; one rule cannot.
 *
 * **An Admin demoting themselves is allowed**, and that is not an oversight.
 * It is recoverable — any Owner can promote them back — where losing the last
 * Owner is not. Only unrecoverable states are guarded.
 */

/** How many people can still administer the org at Owner level. */
function activeOwnerCount(db: Db, excluding?: string): number {
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgRole, 'owner'), eq(users.isActive, 1)))
    .all()
    .filter((row) => row.id !== excluding).length;
}

/**
 * Refuse anything that would leave the org with no active Owner.
 *
 * `409`, matching how a project refuses to lose its last lead: the request is
 * well-formed and the state forbids it, which is a conflict rather than a
 * permission problem. A `403` would say "you may not", and an Owner may.
 */
function assertAnOwnerRemains(db: Db, target: UserRow, stillOwner: boolean): void {
  if (target.orgRole !== 'owner' || stillOwner) return;
  if (activeOwnerCount(db, target.id) > 0) return;

  throw new ApiError(
    'conflict',
    'This is the last active Owner. Promote somebody else to Owner first — an organisation with no Owner cannot be recovered.',
    { user_id: target.id },
  );
}

/** `422 use_transfer`: the one owner changes only through a transfer (LAI-982). */
function useTransfer(userId: string): ApiError {
  return new ApiError(
    'unprocessable',
    'An organisation has exactly one Owner. Use Transfer ownership to hand it over.',
    { reason: 'use_transfer', user_id: userId },
  );
}

/** Who `orgs.owner_user_id` names — the one owner (§4.2). */
function recordedOwnerId(db: Db): string {
  const row = db
    .select({ ownerUserId: orgs.ownerUserId })
    .from(orgs)
    .where(eq(orgs.id, requireOrgId(db)))
    .get();
  return row!.ownerUserId;
}

/**
 * The owner `orgs.owner_user_id` names is not demoted or deactivated by an
 * ordinary write (LAI-982): either would leave the organisation recording an
 * owner who is not one. While a second owner exists from before D-104, the
 * last-Owner rule alone does not catch that, so this does.
 */
function assertNotTheRecordedOwner(db: Db, target: UserRow): void {
  if (target.id === recordedOwnerId(db)) throw useTransfer(target.id);
}

function requireUser(db: Db, userId: string): UserRow {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (row === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return row;
}

export function setOrgRole(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  role: OrgRole,
  now: number = Date.now(),
): UserView {
  const target = requireUser(db, userId);

  // Owner only, whatever the role (D-102 rule 5, LAI-958): an admin who could
  // set roles could make a member an admin with every grant the owner gave.
  assertCan(actor, 'user.set_role');

  // **Exactly one owner** (§3, D-104 item 2, LAI-982). Making somebody owner
  // is a transfer, and a transfer also demotes the one who held it; a role
  // change that only promoted would make a second owner, which is what the
  // picker used to do.
  if (role === 'owner') throw useTransfer(userId);

  assertAnOwnerRemains(db, target, false);
  assertNotTheRecordedOwner(db, target);

  if (target.orgRole === role) return viewOf(db, target);

  db.update(users)
    .set({ orgRole: role, updatedAt: new Date(now) })
    .where(eq(users.id, userId))
    .run();

  appendActivity(db, {
    orgId: requireOrgId(db),
    // Org-scoped: an org role belongs to no project (§4.8, D-022).
    projectId: null,
    ...activityActor(actor),
    type: 'member.role_changed',
    payload: {
      scope: 'org',
      user_id: userId,
      user_name: target.name,
      from: target.orgRole,
      to: role,
    },
    now,
  });

  return viewOf(db, requireUser(db, userId));
}

/**
 * Deactivate or reactivate a person (§3.1, §4.1, LAI-222).
 *
 * The row is **kept** — §4.1 keeps it so history keeps its author, and `can()`
 * already refuses every action to an inactive user, so deactivation is a lock
 * rather than a delete. That is why neither `member.removed` nor a hard delete
 * describes it, and why §4.8 gained `user.deactivated` / `user.reactivated`.
 *
 * ## Deactivating ends access, and reactivating does not restore it
 *
 * D-104 item 3 (LAI-981): every token of theirs is revoked and every session
 * ended, **in the same transaction** as the flag. The lock alone was not
 * enough: the flag stopped each request, but the credentials stayed valid, so
 * reactivating someone months later silently brought back every token they
 * had ever handed to an agent and every browser they had left signed in.
 *
 * Reactivation therefore restores neither. A person let back in signs in again
 * and mints new tokens, which is the only way anyone can say what holds access.
 */
export function setUserActive(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  active: boolean,
  now: number = Date.now(),
  openTasks?: OpenTasksChoice,
): UserView {
  const target = requireUser(db, userId);

  assertCan(actor, 'user.deactivate');

  // Reactivating can never empty the org of Owners, so the invariant only bites
  // one way — but it is the same call, because "still an active Owner after
  // this" is exactly what it asks.
  assertAnOwnerRemains(db, target, active);
  if (!active) assertNotTheRecordedOwner(db, target);

  if (active && openTasks !== undefined) {
    throw new ApiError('unprocessable', 'open_tasks applies only to deactivating someone', {
      field: 'open_tasks',
    });
  }

  if ((target.isActive === 1) === active) return viewOf(db, target);

  db.transaction(() => {
    db.update(users)
      .set({ isActive: active ? 1 : 0, updatedAt: new Date(now) })
      .where(eq(users.id, userId))
      .run();

    if (active) {
      appendActivity(db, {
        orgId: requireOrgId(db),
        projectId: null,
        ...activityActor(actor),
        type: 'user.reactivated',
        payload: { user_id: userId, org_role: target.orgRole },
        now,
      });
      return;
    }

    // Offboarding asks (D-104 item 5, LAI-986): their open tasks anywhere are
    // unassigned or reassigned, or the whole deactivation is refused — checked
    // here, inside the transaction, so nothing above it survives a refusal.
    const open = openTasksHeldBy(db, userId);
    assertOffboardingChoice(db, actor, userId, open, openTasks);
    applyOffboardingChoice(db, actor, userId, open, openTasks, now);
    removeEveryMembership(db, actor, userId, now);

    const revoked = revokeEveryToken(db, userId, now);
    const ended = endEverySession(db, userId);

    appendActivity(db, {
      orgId: requireOrgId(db),
      projectId: null,
      ...activityActor(actor),
      type: 'user.deactivated',
      payload: {
        user_id: userId,
        org_role: target.orgRole,
        token_ids: revoked,
        sessions_ended: ended,
      },
      now,
    });
  });

  return viewOf(db, requireUser(db, userId));
}

/** What `POST /users/:id/sign-out` answers. */
export interface SignOutView {
  user_id: string;
  sessions_ended: number;
}

/**
 * Force sign-out: end every session of a person, and nothing else (D-104
 * item 3, LAI-981). Tokens are left alone — an agent working on their behalf
 * is not a browser left open, and *List / revoke anyone's token* is the row
 * for those.
 *
 * Anyone may sign themselves out everywhere; somebody else needs
 * `user.sign_out`'s grant. The call ends the caller's own session too when
 * they are the target, which is what "everywhere" means.
 *
 * **Logged only when it ended something** — the rule `revoke` in
 * `services/tokens.ts` follows: an event claiming a change that did not happen
 * is worse than a missing one.
 */
export function signOutEverywhere(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): SignOutView {
  requireUser(db, userId);
  assertCan(actor, 'user.sign_out', { targetUserId: userId });

  const ended = db.transaction(() => {
    const count = endEverySession(db, userId);
    if (count === 0) return 0;

    appendActivity(db, {
      orgId: requireOrgId(db),
      projectId: null,
      ...activityActor(actor),
      type: 'user.signed_out',
      payload: { user_id: userId, sessions_ended: count },
      now,
    });
    return count;
  });

  return { user_id: userId, sessions_ended: ended };
}

/**
 * Take a deactivated person off every space (D-104 item 5, LAI-986), one
 * `member.removed` per space as a removal from the members screen writes, with
 * `via: 'deactivation'`. Reactivating brings none back. The last lead may go:
 * the owner holds lead on every space, so none is left without one who can
 * manage it.
 */
function removeEveryMembership(db: Db, actor: ResolvedActor, userId: string, now: number): void {
  const held = db
    .select({
      id: projectMemberships.id,
      projectId: projectMemberships.projectId,
      role: projectMemberships.role,
      orgId: projects.orgId,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(eq(projectMemberships.userId, userId))
    .all();
  // `member.*` rows name their subject (§6.4's history export, LAI-984).
  const name = db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name;

  for (const membership of held) {
    db.delete(projectMemberships).where(eq(projectMemberships.id, membership.id)).run();
    appendActivity(db, {
      orgId: membership.orgId,
      projectId: membership.projectId,
      ...activityActor(actor),
      type: 'member.removed',
      payload: {
        user_id: userId,
        user_name: name ?? null,
        role: membership.role,
        via: 'deactivation',
      },
      now,
    });
  }
}

/** Revoke every live token of a person; the ids it revoked. */
function revokeEveryToken(db: Db, userId: string, now: number): string[] {
  return db
    .update(tokens)
    .set({ revokedAt: now })
    .where(and(eq(tokens.userId, userId), isNull(tokens.revokedAt)))
    .returning({ id: tokens.id })
    .all()
    .map((row) => row.id);
}

/**
 * Delete every session of a person; how many there were.
 *
 * Deleted rather than expired, because better-auth reads the row on every
 * request (no cookie cache is configured) and a missing row is the one answer
 * it cannot misread. What the rows knew about when the person was last seen is
 * kept on `users.last_seen_at` first, so the deletion does not erase it.
 */
export function endEverySession(db: Db, userId: string): number {
  const seen = liveSeenAt(db, [userId]).get(userId);
  if (seen !== undefined) {
    const row = requireUser(db, userId);
    db.update(users)
      .set({ lastSeenAt: latest(row.lastSeenAt, seen) })
      .where(eq(users.id, userId))
      .run();
  }

  return db.delete(sessions).where(eq(sessions.userId, userId)).run().changes;
}

/** One space a person belongs to, as `GET /users/:id/memberships` serves it. */
export interface MembershipView {
  project_id: string;
  slug: string;
  name: string;
  prefix: string;
  role: ProjectRole;
  archived: boolean;
  /** When the membership row was written. */
  joined_at: number;
}

/**
 * The spaces a person is a member of, with their role in each (D-104, LAI-981)
 * — what the person admin panel lists.
 *
 * Gated on *View member list*, the row every other read about who belongs
 * where uses, and **narrowed to the spaces the caller can read**: a member
 * asking about a colleague learns of the shared spaces only, never the name of
 * a private one they are not in. `GET /projects/:slug/members` already shows
 * the same rows to anyone with `project.read`, so this answers nothing new;
 * it answers it from the other side.
 *
 * Membership rows only. An org owner or admin's implicit access everywhere is
 * not a membership and is not listed (D-103 item 5's distinction).
 */
export function listMemberships(db: Db, actor: ResolvedActor, userId: string): MembershipView[] {
  requireUser(db, userId);
  assertCan(actor, 'member_list.read');

  return db
    .select({
      projectId: projects.id,
      slug: projects.slug,
      name: projects.name,
      prefix: projects.prefix,
      role: projectMemberships.role,
      archivedAt: projects.archivedAt,
      joinedAt: projectMemberships.createdAt,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(eq(projectMemberships.userId, userId))
    .orderBy(asc(projects.name), asc(projects.id))
    .all()
    .filter((row) => canSeeProject(actor, row.projectId))
    .map((row) => ({
      project_id: row.projectId,
      slug: row.slug,
      name: row.name,
      prefix: row.prefix,
      role: row.role,
      archived: row.archivedAt !== null,
      joined_at: row.joinedAt,
    }));
}

/** What `POST /org/transfer-ownership` answers: the two people it changed. */
export interface OwnershipTransferView {
  owner: UserView;
  previous_owner: UserView;
}

export interface TransferOwnershipInput {
  userId: string;
  /** The new owner's email, typed (D-104 item 2): a slip of the mouse is not a transfer. */
  confirm: string;
}

/**
 * Transfer ownership (§3.1, §6.4, D-104 item 2, LAI-982).
 *
 * The owner, signed in, names an **active admin or member**; that person
 * becomes the owner, the caller becomes an admin, and `orgs.owner_user_id`
 * moves — **three writes in one transaction**, so there is never a moment with
 * two owners or with `owner_user_id` naming somebody who is not one.
 *
 * A viewer is refused rather than promoted two steps at once: an org viewer
 * may hold only the project role `viewer` (§3), and making one owner would
 * lift that silently. Make them a member first, then transfer.
 *
 * `confirm` must be the target's email. It is the typed confirmation the
 * screen asks for, checked where it cannot be skipped.
 */
export function transferOwnership(
  db: Db,
  actor: ResolvedActor,
  input: TransferOwnershipInput,
  now: number = Date.now(),
): OwnershipTransferView {
  assertCan(actor, 'org.transfer_ownership');
  // The policy grants this to the role `owner`, and an organisation from before
  // D-104 may still have a second one. Only the owner `orgs.owner_user_id`
  // names may hand it over: anyone else would leave two owners behind, or
  // move `owner_user_id` away from the one it names.
  if (actor.userId !== recordedOwnerId(db)) {
    throw new ApiError('forbidden', 'Only the recorded Owner can transfer ownership.', {
      reason: 'not_recorded_owner',
    });
  }
  const target = requireUser(db, input.userId);

  const refuse = (reason: string, message: string): never => {
    throw new ApiError('unprocessable', message, { reason, user_id: target.id });
  };

  if (target.id === actor.userId) refuse('self', 'You already own this organisation.');
  if (target.isActive !== 1)
    refuse('inactive', 'Reactivate them before handing them the organisation.');
  if (target.orgRole !== 'admin' && target.orgRole !== 'member') {
    refuse('role', 'Ownership goes to an admin or a member. Make a viewer a member first.');
  }
  if (input.confirm.trim().toLowerCase() !== target.email.toLowerCase()) {
    refuse('confirm_mismatch', "Type the new owner's email to confirm.");
  }

  db.transaction(() => {
    db.update(users)
      .set({ orgRole: 'owner', updatedAt: new Date(now) })
      .where(eq(users.id, target.id))
      .run();
    db.update(users)
      .set({ orgRole: 'admin', updatedAt: new Date(now) })
      .where(eq(users.id, actor.userId))
      .run();
    db.update(orgs)
      .set({ ownerUserId: target.id, updatedAt: now })
      .where(eq(orgs.id, requireOrgId(db)))
      .run();

    appendActivity(db, {
      orgId: requireOrgId(db),
      projectId: null,
      ...activityActor(actor),
      type: 'org.ownership_transferred',
      payload: {
        from_user_id: actor.userId,
        to_user_id: target.id,
        to_previous_role: target.orgRole,
      },
      now,
    });
  });

  return {
    owner: viewOf(db, requireUser(db, target.id)),
    previous_owner: viewOf(db, requireUser(db, actor.userId)),
  };
}

/**
 * Active owners other than the one `orgs.owner_user_id` names (LAI-982).
 *
 * D-104 item 2: before it, the role picker could make a second owner, and
 * some organisations have one. They are **reported, never demoted
 * silently** — `GET /org` serves this list to the owner, who decides.
 */
export function extraOwners(db: Db): { id: string; name: string; email: string }[] {
  const recorded = recordedOwnerId(db);
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.orgRole, 'owner'), eq(users.isActive, 1)))
    .orderBy(asc(users.name), asc(users.id))
    .all()
    .filter((row) => row.id !== recorded);
}
