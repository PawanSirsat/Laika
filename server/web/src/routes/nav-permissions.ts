/**
 * Whether a reader holds a permission a nav entry requires (LAI-248).
 *
 * **Lifted out of `Sidebar`, not copied.** Its own comment said *"one mirror,
 * not two"* — and then the space tab bar needed the same answer, because a tab
 * that 403s is exactly the control §5.1 says not to render (`/dashboard`
 * required `audit_log.export` when this was written; today the gated entries
 * are those `route-table.ts` marks `requires`). Two copies of a permission
 * predicate is how one of them quietly stops matching the server.
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

/** The action the Meetings entry requires (`route-table.ts`), and the one this narrows. */
export const MEETINGS_ACTION = 'meeting.read_own';

/**
 * `holds`, with Meetings offered only where it can work (LAI-1312).
 *
 * Every signed-in person holds `meeting.read_own`, so the permission alone
 * would put Meetings in every rail — on an instance without Microsoft SSO, or
 * with meetings sync off, where the page could only say it is not turned on.
 * `enabled` is the list's own `enabled` (Microsoft SSO and
 * `LAIKA_MICROSOFT_MEETINGS_SYNC`), read once per page load; until it is
 * known the entry stays hidden, as every gated entry does before
 * `/permissions` answers. **Composed, not a second permission source** —
 * the same shape as Insights' `insightsHolder`, so the rail, the shortcut
 * sheet and the palette keep asking one predicate.
 */
export function meetingsHolder(
  holds: (permission: string) => boolean,
  enabled: boolean,
): (permission: string) => boolean {
  return (permission) =>
    permission === MEETINGS_ACTION ? enabled && holds(permission) : holds(permission);
}
