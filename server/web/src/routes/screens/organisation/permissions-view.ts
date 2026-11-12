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

/**
 * A table's rows in groups, by the part of the action id before its first
 * dot (LAI-1210) — `user.invite` and `user.deactivate` sit together. Groups
 * come in the order their first row arrived, rows keep the server's order
 * inside them, and an id with no dot is its own group.
 *
 * The heading is a plain word for the prefixes §3 uses today and **the
 * prefix itself for any other**, so a new area the server adds is still
 * grouped, under its own name, rather than dropped or misfiled.
 */
const GROUP_NAMES: Readonly<Record<string, string>> = {
  org: 'Organisation',
  user: 'People',
  project: 'Spaces',
  presence: 'Presence',
  token: 'Tokens',
  agent: 'Agents',
  unlisted: 'Unlisted work',
  audit_log: 'Audit log',
  webhook: 'Integrations',
  profile: 'Profiles',
  usage: 'Usage',
  time: 'Time',
  task: 'Tasks',
  comment: 'Comments',
  sprint: 'Sprints',
};

export interface RowGroup {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly PermissionRow[];
}

export function groupRows(rows: readonly PermissionRow[]): readonly RowGroup[] {
  const groups: { key: string; name: string; rows: PermissionRow[] }[] = [];
  for (const row of rows) {
    const dot = row.action.indexOf('.');
    const key = dot === -1 ? row.action : row.action.slice(0, dot);
    let group = groups.find((g) => g.key === key);
    if (group === undefined) {
      group = { key, name: GROUP_NAMES[key] ?? key, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/** Rows whose name, or action id, holds the find; all of them for an empty one. */
export function findRows(rows: readonly PermissionRow[], query: string): readonly PermissionRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) =>
      actionName(row).toLowerCase().includes(needle) || row.action.toLowerCase().includes(needle),
  );
}

export interface RoleExplanation {
  readonly total: number;
  /** Rows the role may do outright. */
  readonly yes: number;
  /** Rows the role may do under a condition, with the server's condition. */
  readonly conditional: readonly string[];
  /** Rows the role may not do, by name. */
  readonly not: readonly string[];
}

/** What one role may do in one table — every count is a cell the server sent. */
export function explainRole(rows: readonly PermissionRow[], role: string): RoleExplanation {
  let yes = 0;
  const conditional: string[] = [];
  const not: string[] = [];
  for (const row of rows) {
    const cell = cellFor(row, role);
    if (cell.kind === 'yes') yes += 1;
    else if (cell.kind === 'conditional') conditional.push(`${actionName(row)} (${cell.text})`);
    else if (cell.kind === 'no') not.push(actionName(row));
  }
  return { total: rows.length, yes, conditional, not };
}
