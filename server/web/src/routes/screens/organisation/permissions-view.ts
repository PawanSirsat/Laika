import type { Grants, PermissionRow, Permissions } from '../../../api/permissions.ts';

/**
 * What the Roles & permissions tab draws, derived from the response alone
 * (LAI-950).
 *
 * **Nothing here knows a role or an action.** Rows, columns and labels are the
 * server's; the only words this module adds are the three answers a cell can
 * give, and a fourth the server might add later is shown as it was sent rather
 * than mapped to one of those.
 */

/** An action's name on screen: its §3 row, or the action id when no row exists yet. */
export function actionName(row: Pick<PermissionRow, 'action' | 'label'>): string {
  return row.label ?? row.action;
}

/** The rows of one table, in the order the server sent them. */
export function rowsFor(
  view: Permissions,
  scope: PermissionRow['scope'],
): readonly PermissionRow[] {
  return view.permissions.filter((row) => row.scope === scope);
}

export interface Cell {
  /** `yes`, `no`, `conditional`, or whatever else the server sent. */
  readonly kind: string;
  readonly text: string;
}

/**
 * One role's answer for one row.
 *
 * A conditional cell is **the condition**, in the server's words — *"Their own
 * comments only"* says more than *"sometimes"*. A role the row does not mention
 * is `—`, not `No`: absent is not a refusal anybody computed.
 */
export function cellFor(row: PermissionRow, role: string): Cell {
  const holding = row.roles[role];
  if (holding === undefined) return { kind: 'absent', text: '—' };
  if (holding === 'yes') return { kind: 'yes', text: 'Yes' };
  if (holding === 'no') return { kind: 'no', text: 'No' };
  if (holding === 'conditional') return { kind: 'conditional', text: row.condition ?? holding };
  return { kind: holding, text: holding };
}

/**
 * The names of the actions the caller holds, once each.
 *
 * Several actions share a §3 row — *"Generate, read and revoke own tokens"* is
 * three — and listing it three times reads as a mistake. An action the
 * catalogue does not carry is still listed, by its id.
 */
export function heldNames(view: Permissions, actions: readonly string[]): readonly string[] {
  const rows = new Map(view.permissions.map((row) => [row.action, row]));
  const names = actions.map((action) => {
    const row = rows.get(action);
    return row === undefined ? action : actionName(row);
  });
  return [...new Set(names)];
}

/** A project's name when the reader can see it, else the id the server sent. */
export function projectLabel(
  projects: readonly { readonly id: string; readonly name: string }[],
  id: string,
): string {
  return projects.find((project) => project.id === id)?.name ?? id;
}

/**
 * The org roles no grant reaches — the owner today — in the order
 * `GET /permissions` lists them. Their column is always on and cannot be
 * switched; which roles they are is the two responses' difference, not a name
 * this module knows.
 */
export function lockedRoles(
  orgRoles: readonly string[],
  grantable: readonly string[],
): readonly string[] {
  return orgRoles.filter((role) => !grantable.includes(role));
}

/** `grants` with one cell set, the rest copied. The input is not touched. */
export function withGrant(grants: Grants, role: string, capability: string, on: boolean): Grants {
  return { ...grants, [role]: { ...grants[role], [capability]: on } };
}

/** The same cells on, role by role. A cell missing on one side is off. */
export function sameGrants(a: Grants, b: Grants): boolean {
  const roles = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...roles].every((role) => {
    const left = a[role] ?? {};
    const right = b[role] ?? {};
    const capabilities = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...capabilities].every((c) => (left[c] ?? false) === (right[c] ?? false));
  });
}

/**
 * Whether the grid is switches or text: the server's answer, from the actions
 * `GET /permissions` says the caller may take on this credential. An owner on
 * a token is refused `session_required`, and that is already in the answer.
 */
export function mayEditGrants(actions: readonly string[]): boolean {
  return actions.includes('org.permissions.manage');
}
