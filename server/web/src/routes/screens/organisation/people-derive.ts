import {
  PROJECT_ROLES,
  type OrgRole,
  type PendingInvite,
  type ProjectRole,
} from '../../../api/invites.ts';
import type { CapacityEntry } from '../../../api/presence.ts';
import type { OrgUser } from '../../../api/users.ts';

/**
 * What the People tab works out before it draws (LAI-893, the owner's
 * "Laika App v3" design): the seat line, the filters and their counts, the
 * sort, each person's *last active* from `GET /capacity`, and the words of
 * an invite. Pure: the clock is passed in.
 */

/** `off` is Deactivated (LAI-999, from LAI-987). */
export type PeopleFilter = 'all' | 'owner' | 'admin' | 'member' | 'viewer' | 'off' | 'pending';
export type PeopleSort = 'active' | 'name' | 'role';

export const SORTS: readonly PeopleSort[] = ['active', 'name', 'role'];
export const SORT_LABELS: Readonly<Record<PeopleSort, string>> = {
  active: 'Last active',
  name: 'Name',
  role: 'Role',
};

/** The next sort round the ring: Last active → Name → Role → Last active. */
export function nextSort(sort: PeopleSort): PeopleSort {
  return SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length] ?? 'active';
}

const ROLE_ORDER: Readonly<Record<string, number>> = { owner: 0, admin: 1, member: 2, viewer: 3 };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface LastActive {
  readonly text: string;
  /** `now` is green, `recent` the ink, `muted` the quiet grey. */
  readonly tone: 'now' | 'recent' | 'muted';
  /** Why there is no figure, for a title. */
  readonly note?: string;
}

/**
 * When a person was last seen, in the design's words: *Active now* while
 * online, else *18m ago*, *2h ago*, *Yesterday*, *6d ago*, *3w ago*; *Never*
 * with no signal. A dash when capacity could not be read, and *Presence is
 * off* when the organisation turned it off — never *Never*, which would be a
 * claim about the person.
 */
export function lastActive(
  entry: Pick<CapacityEntry, 'status' | 'last_seen'> | undefined,
  enabled: boolean | undefined,
  isActive: boolean,
  now: number,
): LastActive {
  if (!isActive) return { text: 'Deactivated', tone: 'muted' };
  if (entry === undefined || enabled === undefined) {
    return { text: '—', tone: 'muted', note: 'Not known: capacity could not be read' };
  }
  if (!enabled || entry.status === null)
    return { text: '—', tone: 'muted', note: 'Presence is off' };
  if (entry.status === 'online') return { text: 'Active now', tone: 'now' };
  if (entry.last_seen === null) return { text: 'Never', tone: 'muted' };
  return ago(entry.last_seen, now);
}

/** *just now*, *18m ago*, *2h ago*, *Yesterday*, *6d ago*, *3w ago*. */
function ago(at: number, now: number): LastActive {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return { text: 'just now', tone: 'recent' };
  if (ago < HOUR) return { text: `${String(Math.floor(ago / MINUTE))}m ago`, tone: 'recent' };
  if (ago < DAY) return { text: `${String(Math.floor(ago / HOUR))}h ago`, tone: 'recent' };
  if (ago < 2 * DAY) return { text: 'Yesterday', tone: 'muted' };
  if (ago < 7 * DAY) return { text: `${String(Math.floor(ago / DAY))}d ago`, tone: 'muted' };
  return { text: `${String(Math.floor(ago / (7 * DAY)))}w ago`, tone: 'muted' };
}

/**
 * When they last signed in — `last_seen_at`, the latest activity of any of
 * their sessions (LAI-981) — in the tab's own words (LAI-999). Unlike *Last
 * active* it needs no presence: it is the account's, not the machine's.
 * Absent reads as never, for a server from before LAI-981.
 */
export function lastSignIn(at: number | null | undefined, now: number): LastActive {
  if (at === null || at === undefined) return { text: 'Never', tone: 'muted' };
  return ago(at, now);
}

/** A space to narrow to: its slug, and the slugs each person is in (`GET /capacity`). */
export interface SpaceFilter {
  readonly slug: string;
  /** `undefined` when not known — and unknown is nobody, never everybody. */
  readonly of: (id: string) => readonly string[] | undefined;
}

/** The people a filter, a search and a space leave: name or email, case aside. */
export function filterPeople(
  people: readonly OrgUser[],
  filter: PeopleFilter,
  query: string,
  space?: SpaceFilter,
): OrgUser[] {
  const q = query.trim().toLowerCase();
  return people.filter(
    (p) =>
      (filter === 'all' ||
        filter === 'pending' ||
        (filter === 'off' ? !p.is_active : p.org_role === filter)) &&
      (q === '' || `${p.name} ${p.email}`.toLowerCase().includes(q)) &&
      (space === undefined || (space.of(p.id)?.includes(space.slug) ?? false)),
  );
}

/**
 * The order of the table: the reader first, deactivated people last, and
 * between them by the sort — most recently seen first (never seen last), by
 * name, or by role then name.
 */
export function sortPeople(
  people: readonly OrgUser[],
  sort: PeopleSort,
  meId: string,
  seenAt: (id: string) => number | null | undefined,
): OrgUser[] {
  const byName = (a: OrgUser, b: OrgUser): number => a.name.localeCompare(b.name);
  const by: Record<PeopleSort, (a: OrgUser, b: OrgUser) => number> = {
    name: byName,
    role: (a, b) => (ROLE_ORDER[a.org_role] ?? 9) - (ROLE_ORDER[b.org_role] ?? 9) || byName(a, b),
    active: (a, b) => (seenAt(b.id) ?? -1) - (seenAt(a.id) ?? -1) || byName(a, b),
  };
  return [...people].sort(
    (a, b) =>
      Number(b.id === meId) - Number(a.id === meId) ||
      Number(!a.is_active) - Number(!b.is_active) ||
      by[sort](a, b),
  );
}

/** How many of each role, deactivated people aside, and the pending invites. */
export function roleCounts(
  people: readonly OrgUser[],
  invites: readonly PendingInvite[],
): Readonly<Record<PeopleFilter, number>> {
  const active = people.filter((p) => p.is_active);
  const of = (role: string): number => active.filter((p) => p.org_role === role).length;
  return {
    all: people.length,
    owner: of('owner'),
    admin: of('admin'),
    member: of('member'),
    viewer: of('viewer'),
    off: people.length - active.length,
    pending: invites.length,
  };
}

/** *50 members · 6 admins · 3 pending invites* — the active people, from the responses. */
export function seatLine(
  people: readonly OrgUser[],
  invites: readonly PendingInvite[],
  truncated: boolean,
  canSeeInvites: boolean,
): string {
  const counts = roleCounts(people, invites);
  const active = people.filter((p) => p.is_active).length;
  const parts = [
    `${String(active)}${truncated ? '+' : ''} ${active === 1 && !truncated ? 'member' : 'members'}`,
    `${String(counts.admin)} ${counts.admin === 1 ? 'admin' : 'admins'}`,
  ];
  if (canSeeInvites) {
    parts.push(`${String(invites.length)} pending ${invites.length === 1 ? 'invite' : 'invites'}`);
  }
  return parts.join(' · ');
}

/** The addresses typed: split on commas, semicolons and whitespace, each once, in order. */
export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const email = part.trim();
    if (email === '' || !email.includes('@')) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** What the dialog's button says: *Create link*, *Send invite*, *Send 3 invites*. */
export function inviteButtonLabel(count: number): string {
  if (count === 0) return 'Create link';
  return count === 1 ? 'Send invite' : `Send ${String(count)} invites`;
}

/** `in 6 days`, `tomorrow`, `today`, or `expired` — the invite's own clock. */
export function expiryLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / DAY);
  if (days >= 2) return `in ${String(days)} days`;
  if (days === 1) return 'tomorrow';
  return 'today';
}

/** `just now`, `3h ago`, `1d ago` — when the invite was made. */
export function invitedLabel(createdAt: number, now: number): string {
  const ago = Math.max(0, now - createdAt);
  if (ago < HOUR) return 'just now';
  if (ago < DAY) return `${String(Math.floor(ago / HOUR))}h ago`;
  return `${String(Math.floor(ago / DAY))}d ago`;
}

/** What was typed that is not an address — named to the reader, not dropped (LAI-999). */
export function rejectedEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part));
}

/**
 * Who the owner may hand the organisation to (D-104 item 2): an active admin
 * or member other than themselves — never a viewer, whom the server refuses
 * (`reason: 'role'`). Admins first, then by name.
 */
export function newOwnerCandidates(people: readonly OrgUser[], meId: string): OrgUser[] {
  const rank = (role: string): number => (role === 'admin' ? 0 : 1);
  return people
    .filter(
      (p) => p.id !== meId && p.is_active && (p.org_role === 'admin' || p.org_role === 'member'),
    )
    .sort((a, b) => rank(a.org_role) - rank(b.org_role) || a.name.localeCompare(b.name));
}

/** The space roles an invite may carry for `orgRole` (§3: an org viewer holds only `viewer`). */
export function spaceRolesFor(orgRole: OrgRole): readonly ProjectRole[] {
  return orgRole === 'viewer' ? ['viewer'] : PROJECT_ROLES;
}
