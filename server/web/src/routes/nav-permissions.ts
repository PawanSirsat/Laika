import { canManageOrg } from '../api/invites.ts';
import { mayOpenProfiles } from '../api/profiles.ts';
import { mayTriageUnlisted } from '../api/unlisted.ts';

/**
 * Whether a reader holds a permission a nav entry requires (LAI-248).
 *
 * **Lifted out of `Sidebar`, not copied.** Its own comment said *"one mirror,
 * not two"* — and then the space tab bar needed the same answer, because
 * `/dashboard` requires `audit_log.export` and a tab that 403s is exactly the
 * control §5.1 says not to render. Two copies of a permission predicate is how
 * one of them quietly stops matching the server.
 *
 * `undefined` means "unrestricted" only in the sense that nothing is granted:
 * the pre-auth render and the tests pass no role, and gated entries stay hidden
 * rather than leaking.
 */
export function permissionHolder(
  orgRole: string | undefined,
  actions?: readonly string[],
): (permission: string) => boolean {
  return (permission) => {
    if (actions !== undefined) return actions.includes(permission);
    if (permission === 'audit_log.export') return mayTriageUnlisted(orgRole ?? '');
    // §3.1 `profile.read` (LAI-743), through the predicate the links use.
    if (permission === 'profile.read') return mayOpenProfiles(orgRole);
    // §3.1 `token.list_any` — everyone's tokens, the Organisation page's
    // Security tab (LAI-796) — through the predicate that page's controls use.
    if (permission === 'token.list_any') return canManageOrg(orgRole ?? '');
    return false;
  };
}
