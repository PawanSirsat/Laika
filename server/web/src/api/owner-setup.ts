/**
 * **An admin may not act on the owner's setup** (D-133; LAI-1137 for tools
 * and devices, LAI-1143 for tokens): only the owner revokes the owner's tools,
 * devices or tokens. The server holds the rule and refuses `403` with
 * `details.reason: 'not_for_owner'`; this is the client's mirror, so a
 * control the server would refuse is not offered — and a refusal that arrives
 * anyway is said in the reader's terms.
 *
 * One helper for every screen that revokes someone else's credential: the
 * profile's Developer setup tab, the Manage member panel's tokens, and
 * Organisation → Security (LAI-1140).
 */

/** Whether a reader of `readerRole` may revoke what a person of `holderRole` holds. */
export function mayActOnSetupOf(readerRole: string, holderRole: string): boolean {
  return holderRole !== 'owner' || readerRole === 'owner';
}

/** Said beside a list whose revoke controls are withheld for that reason. */
export const OWNER_SETUP_NOTE =
  'This is the owner’s setup. Only the owner can revoke its tools, devices or tokens.';

/** Said when the server refuses a revoke for that reason. */
export const NOT_FOR_OWNER_LINE =
  'Only the owner can change the owner’s setup. Nothing was changed.';

/** The server's `403 not_for_owner`. */
export function isNotForOwner(error: unknown): boolean {
  const details = (error as { details?: unknown } | null)?.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === 'not_for_owner'
  );
}

/** A revoke's refusal as a sentence: `not_for_owner` in the reader's terms, else the server's own. */
export function revokeRefusal(error: unknown, fallback: string): string {
  if (isNotForOwner(error)) return NOT_FOR_OWNER_LINE;
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}
