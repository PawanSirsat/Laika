import type { OrgRole, ProjectRole } from '../../../api/invites.ts';
import { PROJECT_ROLES } from '../../../api/invites.ts';
import type { OrgUser } from '../../../api/users.ts';
import { timeLabel, type TimeLabel } from '../../../api/time-label.ts';

/**
 * Organisation → People's search and chips (LAI-987), in the Spaces page's
 * shape (D-103 item 12): a search box, chips with counts, and every choice in
 * the address so a reload or a pasted link opens the list as it was left.
 */

export const ROLE_FILTERS = ['all', 'owner', 'admin', 'member', 'viewer'] as const;
export type RoleFilter = (typeof ROLE_FILTERS)[number];

/** `off` is a deactivated person; the address says `status=off`. */
export const STATUS_FILTERS = ['all', 'active', 'off'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface PeopleQuery {
  readonly q: string;
  readonly role: RoleFilter;
  readonly status: StatusFilter;
  /** A space's slug, or `''` for every space. */
  readonly space: string;
}

const DEFAULT: PeopleQuery = { q: '', role: 'all', status: 'all', space: '' };

function oneOf<T extends string>(list: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The query in the address; an unknown chip value is the default, never a filter that matches nobody. */
export function peopleQuery(params: URLSearchParams): PeopleQuery {
  return {
    q: params.get('q') ?? '',
    role: oneOf(ROLE_FILTERS, params.get('role'), 'all'),
    status: oneOf(STATUS_FILTERS, params.get('status'), 'all'),
    space: params.get('space') ?? '',
  };
}

/** `params` with `patch` applied, keeping everything else (the tab) and dropping defaults. */
export function withPeopleQuery(
  params: URLSearchParams,
  patch: Partial<PeopleQuery>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch) as [keyof PeopleQuery, string][]) {
    if (value === DEFAULT[key]) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

function matchesText(person: OrgUser, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle);
}

function matchesRole(person: OrgUser, role: RoleFilter): boolean {
  return role === 'all' || person.org_role === role;
}

function matchesStatus(person: OrgUser, status: StatusFilter): boolean {
  if (status === 'all') return true;
  return status === 'active' ? person.is_active : !person.is_active;
}

/**
 * Whether `person` is in the chosen space. `members` is that space's member
 * ids, or `undefined` while it has not answered — and **unknown is nobody**,
 * not everybody: the whole list under a space chip would say they all belong.
 */
function matchesSpace(person: OrgUser, space: string, members: ReadonlySet<string> | undefined) {
  if (space === '') return true;
  return members?.has(person.id) ?? false;
}

export function filterPeople(
  people: readonly OrgUser[],
  query: PeopleQuery,
  spaceMembers: ReadonlySet<string> | undefined,
): readonly OrgUser[] {
  return people.filter(
    (p) =>
      matchesText(p, query.q) &&
      matchesRole(p, query.role) &&
      matchesStatus(p, query.status) &&
      matchesSpace(p, query.space, spaceMembers),
  );
}

export interface PeopleCounts {
  readonly role: Readonly<Record<RoleFilter, number>>;
  readonly status: Readonly<Record<StatusFilter, number>>;
}

/**
 * What each chip would show, **with the other filters applied** — a role chip
 * honours the search and the status chip, and the reverse, so a count is the
 * number of rows clicking it gives. The space filter is left out: its members
 * arrive later, and a count that jumps when they do reads as a bug.
 */
export function peopleCounts(people: readonly OrgUser[], query: PeopleQuery): PeopleCounts {
  const searched = people.filter((p) => matchesText(p, query.q));
  const forRole = searched.filter((p) => matchesStatus(p, query.status));
  const forStatus = searched.filter((p) => matchesRole(p, query.role));

  const role = Object.fromEntries(
    ROLE_FILTERS.map((r) => [r, forRole.filter((p) => matchesRole(p, r)).length]),
  ) as Record<RoleFilter, number>;
  const status = Object.fromEntries(
    STATUS_FILTERS.map((s) => [s, forStatus.filter((p) => matchesStatus(p, s)).length]),
  ) as Record<StatusFilter, number>;

  return { role, status };
}

/** The *Last sign-in* cell: `Never signed in`, `3 h ago`, `14 Oct, 9:12 AM`. */
export function lastSeenLabel(at: number | null | undefined, now: number): TimeLabel {
  // Absent as well as null: a server from before LAI-981 does not send it.
  if (at === null || at === undefined)
    return { text: 'Never signed in', full: 'Never signed in', iso: '', fresh: false };
  return timeLabel(at, now);
}

export interface ParsedEmails {
  /** In the order pasted, first spelling kept, duplicates (any case) dropped. */
  readonly valid: readonly string[];
  /** What is not an address, so the reader is told rather than it vanishing. */
  readonly invalid: readonly string[];
}

/** Loose on purpose: the server's check is the real one, and refuses with its own sentence. */
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * A pasted list of addresses for a bulk invite (LAI-987). Commas, semicolons,
 * spaces and line breaks separate; `Name <a@b.c>` yields the address.
 */
export function parseEmails(text: string): ParsedEmails {
  const angled = text.replace(/[^<>\n,;]*<([^>]*)>/g, ' $1 ');
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const piece of angled.split(/[\s,;]+/)) {
    if (piece === '') continue;
    if (!EMAIL.test(piece)) {
      invalid.push(piece);
      continue;
    }
    const key = piece.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(piece);
  }
  return { valid, invalid };
}

/**
 * Who the owner may hand the organisation to (D-104 item 2): an active admin
 * or member other than themselves. **Never a viewer** — the server refuses one
 * (`reason: 'role'`), since an org viewer holds only viewer roles in spaces.
 * Admins first, then by name.
 */
export function newOwnerCandidates(people: readonly OrgUser[], meId: string): readonly OrgUser[] {
  const rank = (role: string): number => (role === 'admin' ? 0 : 1);
  return people
    .filter(
      (p) => p.id !== meId && p.is_active && (p.org_role === 'admin' || p.org_role === 'member'),
    )
    .slice()
    .sort((a, b) => rank(a.org_role) - rank(b.org_role) || a.name.localeCompare(b.name));
}

/** The space roles an invite may carry for `orgRole` (§3: an org viewer holds only `viewer`). */
export function spaceRolesFor(orgRole: OrgRole): readonly ProjectRole[] {
  return orgRole === 'viewer' ? ['viewer'] : PROJECT_ROLES;
}
