import { ApiError } from '../errors.ts';
import { type Db } from './client.ts';
import { orgs } from './schema.ts';

/**
 * The one org (SPEC §4.2, D-022).
 *
 * Laika is single-org by design, so "which org" is a lookup with one answer.
 * Three services were answering it privately — `invites.ts`, `tokens.ts` and
 * nearly `unlisted.ts` — and all three disagreed about the one case that
 * differs. **LAI-140 converged them here.**
 *
 * Here rather than in a service because it reads one table and decides nothing:
 * `db/` is where a query with no policy in it belongs (CONVENTIONS §2).
 *
 * ## The no-org answer, and why it is this one
 *
 * Three copies gave three answers: `conflict` (invites), `not_found` — a 404 —
 * (tokens), and a plain `Error`, a 500 (here). They are not stylistic variants:
 * a 404 tells a client the thing is missing, a 500 tells them the server broke,
 * and neither is true.
 *
 * **Reaching any of these without an org means the setup gate was bypassed**,
 * not that a caller asked for something absent. Every API path is gated by
 * `setupGate`, which answers `conflict` with `setup_required` and the path to
 * fix it — so that is the answer here too, **identical to the gate's**. A client
 * that somehow gets past the gate sees exactly what the gate would have told it,
 * and can branch on one shape rather than three.
 *
 * Only the throwing form is exported, because only that form has a caller. A
 * non-throwing variant would be a shape nobody has needed yet.
 */
export function requireOrg(db: Db): { id: string; name: string } {
  const row = db.select({ id: orgs.id, name: orgs.name }).from(orgs).limit(1).get();

  if (row === undefined) {
    // The gate's code, message and `setup_required` — but not its `setup_path`.
    // `db/` does not know about routes and should not learn: a client that has
    // reached here has already seen the gate's answer, which carries the path.
    throw new ApiError('conflict', 'This Laika has not been set up yet', {
      setup_required: true,
    });
  }

  return row;
}

/** The id alone — most callers want only that, and every `activity` writer does. */
export function requireOrgId(db: Db): string {
  return requireOrg(db).id;
}

/**
 * Whether the org records presence at all (§4.2, LAI-152).
 *
 * **Non-throwing, unlike the two above, and that is the difference that matters
 * rather than a stylistic one:** "there is no org" has a *correct answer* here —
 * an instance with nothing set up has nothing to have switched off, so presence
 * is on, which is also §4.2's default. For the id there is no such answer, which
 * is why that one throws.
 *
 * `db/orgs.ts` says a non-throwing form should arrive **with** its caller rather
 * than ahead of it. This one arrives with two: `heartbeats.ts` uses it to decide
 * whether to store a row at all (LAI-150), and `presence.ts` to set `enabled` on
 * the response (LAI-432). They had a byte-identical private copy each, written
 * an hour apart, and neither said why `?? 1` was the right default.
 */
export function presenceEnabled(db: Db): boolean {
  const row = db.select({ on: orgs.presenceEnabled }).from(orgs).limit(1).get();

  return (row?.on ?? 1) === 1;
}
