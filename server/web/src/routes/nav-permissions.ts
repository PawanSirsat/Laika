/**
 * Whether a reader holds a permission a nav entry requires (LAI-248).
 *
 * **Lifted out of `Sidebar`, not copied.** Its own comment said *"one mirror,
 * not two"* — and then the space tab bar needed the same answer, because
 * `/dashboard` requires `audit_log.export` and a tab that 403s is exactly the
 * control §5.1 says not to render. Two copies of a permission predicate is how
 * one of them quietly stops matching the server.
 *
 * **The server's answer, never a role** (LAI-970): `actions` is
 * `GET /permissions`' `me.actions`, which already reflects the owner's grants.
 * `undefined` — before it answers, when it failed, pre-auth — grants nothing:
 * gated entries stay hidden rather than leaking to somebody the owner withdrew
 * them from.
 */
export function permissionHolder(actions?: readonly string[]): (permission: string) => boolean {
  return (permission) => actions?.includes(permission) === true;
}
