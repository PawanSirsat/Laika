import { and, asc, eq, gt, gte, or, type SQL } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole } from '../db/enums.ts';
import { users } from '../db/schema.ts';
import { assertCan } from '../policy/can.ts';

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
