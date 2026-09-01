import { and, asc, eq, gt, gte, or, type SQL } from 'drizzle-orm';
import { activityActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole } from '../db/enums.ts';
import { requireOrgId } from '../db/orgs.ts';
import { users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

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
  /** Derived from the id — no uploads in v1 (§4.1). */
  avatar_color: string;
  org_role: OrgRole;
  /** False for a deactivated person. The row is kept so history keeps its author. */
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

type UserRow = typeof users.$inferSelect;

function toView(row: UserRow): UserView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar_color: row.avatarColor,
    org_role: row.orgRole,
    is_active: row.isActive === 1,
    // Date-typed columns since LAI-005 (better-auth hands the adapter `Date`s);
    // the API speaks unix-ms like every other timestamp in §6.3.
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
  };
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

  return db
    .select()
    .from(users)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(users.name), asc(users.id))
    .limit(options.limit + 1)
    .all()
    .map(toView);
}

/**
 * Org role changes and deactivation (SPEC §3.1, §4.1, LAI-222).
 *
 * §3.1 grants Owner and Admin *"Invite users / change org roles"* and
 * *"Deactivate user"*, and `users` has carried `org_role` and `is_active` since
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

  // `targetOrgRole` is what `can()` compares for §3.1's "(not to Owner)" caveat:
  // an Admin may set any role except Owner. Passing it is not optional — without
  // it the caveat cannot be evaluated and an Admin promotes themselves.
  assertCan(actor, 'user.set_role', { targetOrgRole: role });

  assertAnOwnerRemains(db, target, role === 'owner');

  if (target.orgRole === role) return toView(target);

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
    payload: { scope: 'org', user_id: userId, from: target.orgRole, to: role },
    now,
  });

  return toView(requireUser(db, userId));
}

/**
 * Deactivate or reactivate a person (§3.1, §4.1, LAI-222).
 *
 * The row is **kept** — §4.1 keeps it so history keeps its author, and `can()`
 * already refuses every action to an inactive user, so deactivation is a lock
 * rather than a delete. That is why neither `member.removed` nor a hard delete
 * describes it, and why §4.8 gained `user.deactivated` / `user.reactivated`.
 */
export function setUserActive(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  active: boolean,
  now: number = Date.now(),
): UserView {
  const target = requireUser(db, userId);

  assertCan(actor, 'user.deactivate');

  // Reactivating can never empty the org of Owners, so the invariant only bites
  // one way — but it is the same call, because "still an active Owner after
  // this" is exactly what it asks.
  assertAnOwnerRemains(db, target, active);

  if ((target.isActive === 1) === active) return toView(target);

  db.update(users)
    .set({ isActive: active ? 1 : 0, updatedAt: new Date(now) })
    .where(eq(users.id, userId))
    .run();

  appendActivity(db, {
    orgId: requireOrgId(db),
    projectId: null,
    ...activityActor(actor),
    type: active ? 'user.reactivated' : 'user.deactivated',
    payload: { user_id: userId, org_role: target.orgRole },
    now,
  });

  return toView(requireUser(db, userId));
}
