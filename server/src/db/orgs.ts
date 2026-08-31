import { type Db } from './client.ts';
import { orgs } from './schema.ts';

/**
 * The one org (SPEC §4.2, D-022).
 *
 * Laika is single-org by design, so "which org" is a lookup with one answer, and
 * every writer of an org-scoped `activity` row needs it. Two services had begun
 * answering it privately — `invites.ts` and `tokens.ts` — and `unlisted.ts` was
 * about to be the third, which is three chances to disagree about what happens
 * when there is no org yet. Converging the existing two is LAI-140.
 *
 * Here rather than in a service because it reads one table and decides nothing:
 * `db/` is where a query with no policy in it belongs (CONVENTIONS §2).
 *
 * Only the throwing form is exported, because only that form has a caller. A
 * non-throwing variant would be a shape nobody has needed yet.
 */
export function requireOrgId(db: Db): string {
  const row = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (row === undefined) throw new Error('This instance has no organisation yet');
  return row.id;
}
