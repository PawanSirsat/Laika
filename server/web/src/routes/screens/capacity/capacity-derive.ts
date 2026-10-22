import type {
  CapacityAgent,
  CapacityEntry,
  CapacityWorkload,
  LoadLevel,
  PersonStatus,
  SeenVia,
} from '../../../api/presence.ts';
import { formatDurationMs } from '../../../api/duration.ts';
import { timeLabel } from '../../../api/time-label.ts';

/**
 * Capacity's client-side derivations (LAI-767) — **all of them about
 * presentation**.
 *
 * Nothing here computes a figure the API did not send. The status, last seen,
 * workload counts and load badge arrive decided by the server's fixed rules
 * (SPEC §9.3); what is left is which people to show, in what order, and how to
 * say it. Every function takes `now` rather than reading a clock, so each edge
 * is testable.
 */

/**
 * The filter chips, in the order they are drawn.
 *
 * **`none` is *No load*, the badge's word and the badge's rule** (LAI-832).
 * It was *No work* — no open work at all — beside a badge that says *No load*
 * for nothing committed, so a person with fifty in backlog read *No load* and
 * was left out of *No work*. Backlog is the pipeline and review waits on the
 * reviewer (D-092); who has room is who has nothing committed. The id stays
 * `none`, so a saved address still opens it.
 */
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online now' },
  { id: 'agents', label: 'Agents running' },
  { id: 'heavy', label: 'Heavy load' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'none', label: 'No load' },
  { id: 'never', label: 'Never seen' },
] as const;
export type CapacityFilter = (typeof FILTERS)[number]['id'];

/** Filters that read presence, and mean nothing while it is off. */
export const PRESENCE_FILTERS: ReadonlySet<CapacityFilter> = new Set(['online', 'agents', 'never']);

export const SORTS = [
  { id: 'online', label: 'Online first' },
  { id: 'load', label: 'Heaviest load' },
  { id: 'name', label: 'Name' },
  { id: 'seen', label: 'Last seen' },
] as const;
export type CapacitySort = (typeof SORTS)[number]['id'];

const ZERO: CapacityWorkload = {
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
};

/** A person's counts in one space, or across every space when `space` is `null`. */
export function workloadIn(person: CapacityEntry, space: string | null): CapacityWorkload {
  if (space === null) return person.workload;
  return person.spaces.find((s) => s.project_id === space) ?? ZERO;
}

/**
 * Their load badge in one space, or across every space when `space` is
 * `null` — **the server's**, either way (D-092, LAI-818). Each space arrives
 * with its own load by the same rule, so the badge, the *Heavy load* chip and
 * the sort agree with the counts beside them. No work there is no load there.
 */
export function loadIn(person: CapacityEntry, space: string | null): LoadLevel {
  if (space === null) return person.load;
  return person.spaces.find((s) => s.project_id === space)?.load ?? 'none';
}

/** Their agents running now. */
export function runningAgents(person: CapacityEntry): readonly CapacityAgent[] {
  return person.agents.filter((agent) => agent.running);
}

/**
 * Does the search match? Every word must appear in the name or the email,
 * ignoring case and accents — `bea nk` finds Bea Nkosi, `kvelld` finds
 * everyone at that domain. An empty search matches everybody.
 */
export function matchesQuery(person: CapacityEntry, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const haystack = `${fold(person.name)} ${fold(person.email)}`;
  return fold(query)
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => haystack.includes(word));
}

/** Does `person` pass a filter chip, in the chosen space? */
export function passesFilter(
  person: CapacityEntry,
  filter: CapacityFilter,
  space: string | null,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'online':
      return person.status === 'online';
    case 'agents':
      return runningAgents(person).length > 0;
    case 'heavy':
      return loadIn(person, space) === 'heavy';
    case 'overdue':
      return workloadIn(person, space).overdue > 0;
    case 'none':
      return loadIn(person, space) === 'none';
    case 'never':
      return person.status === 'never';
  }
}

const STATUS_RANK: Readonly<Record<PersonStatus, number>> = {
  online: 0,
  away: 1,
  offline: 2,
  never: 3,
};

const LOAD_RANK: Readonly<Record<LoadLevel, number>> = { heavy: 3, normal: 2, light: 1, none: 0 };

/**
 * Heaviest first: the load badge in the chosen space, then committed work,
 * then in progress. **Overdue is not load** (D-092), so it orders nobody here;
 * it has its own badge and its own filter.
 */
export function byLoad(a: CapacityEntry, b: CapacityEntry, space: string | null): number {
  const x = workloadIn(a, space);
  const y = workloadIn(b, space);
  return (
    LOAD_RANK[loadIn(b, space)] - LOAD_RANK[loadIn(a, space)] ||
    y.committed - x.committed ||
    y.in_progress - x.in_progress
  );
}

/** People in the chosen order; ties fall back to name so the order is stable. */
export function sortPeople(
  people: readonly CapacityEntry[],
  sort: CapacitySort,
  space: string | null,
): CapacityEntry[] {
  const byName = (a: CapacityEntry, b: CapacityEntry) => a.name.localeCompare(b.name);
  const rank = (p: CapacityEntry) => (p.status === null ? 0 : STATUS_RANK[p.status]);
  return [...people].sort((a, b) => {
    switch (sort) {
      case 'online':
        return rank(a) - rank(b) || byLoad(a, b, space) || byName(a, b);
      case 'load':
        return byLoad(a, b, space) || byName(a, b);
      case 'name':
        return byName(a, b);
      case 'seen':
        return (b.last_seen ?? -1) - (a.last_seen ?? -1) || byName(a, b);
    }
  });
}

/** What `last_seen` was, in words, for the tooltip. */
export const SEEN_VIA: Readonly<Record<SeenVia, string>> = {
  web: 'signed in',
  board: 'a board action',
  agent: 'an agent session',
};

export interface StatusText {
  /** `Online now`, `Away · 23 min`, `Last seen 2 h ago`, `Never seen`. */
  readonly text: string;
  /** The absolute time and the kind of signal, for a tooltip; absent with none. */
  readonly title?: string;
}

/**
 * The status line under a name. **Words, not only a colour**: the ring and dot
 * say the same thing to an eye, this says it to everyone.
 */
export function statusText(person: CapacityEntry, now: number): StatusText {
  if (person.status === null) return { text: 'Presence is off' };
  if (person.status === 'never' || person.last_seen === null) return { text: 'Never seen' };

  const label = timeLabel(person.last_seen, now);
  const via = person.last_seen_via === null ? '' : ` · ${SEEN_VIA[person.last_seen_via]}`;
  const title = `${label.full}${via}`;

  if (person.status === 'online') return { text: 'Online now', title };
  if (person.status === 'away') {
    const away = Math.max(60_000, Math.floor((now - person.last_seen) / 60_000) * 60_000);
    return { text: `Away · ${formatDurationMs(away)}`, title };
  }
  return { text: `Last seen ${label.text}`, title };
}

export const LOAD_LABEL: Readonly<Record<LoadLevel, string>> = {
  // Nothing committed — they may still have backlog or work waiting on a
  // reviewer, so "No work" would say something the counts beside it deny.
  // The filter chip says the same word (`FILTERS`, LAI-832).
  none: 'No load',
  light: 'Light',
  normal: 'Normal',
  heavy: 'Heavy',
};

/**
 * The stacked bar's parts, in drawing order: **committed work only** (D-092).
 * Review waits on the reviewer and backlog is the pipeline; both are counted
 * beside the bar, never in it.
 */
export const BAR_PARTS = [
  { key: 'in_progress', label: 'In progress' },
  { key: 'todo', label: 'To do' },
] as const;

export interface BarSegment {
  readonly key: (typeof BAR_PARTS)[number]['key'];
  readonly label: string;
  readonly n: number;
  /** Width as a percentage of `scale`. */
  readonly pct: number;
}

/**
 * The stacked bar of committed work: in progress and to do, each as a share
 * of `scale` — the person's own committed count on a card, the heaviest
 * person's in *Team load* so the bars compare. Empty parts are left out.
 */
export function barSegments(work: CapacityWorkload, scale: number): BarSegment[] {
  const of = Math.max(scale, 1);
  return BAR_PARTS.filter((part) => work[part.key] > 0).map((part) => ({
    key: part.key,
    label: part.label,
    n: work[part.key],
    pct: (work[part.key] / of) * 100,
  }));
}

export interface CapacitySummary {
  /** People online now. */
  readonly online: number;
  /** Agent sessions running now — distinct tokens, as `active_sessions` counts them. */
  readonly sessions: number;
  readonly inProgress: number;
  readonly overdue: number;
}

/** The tiles' figures, summed from what the server sent, in the chosen space. */
export function summarize(people: readonly CapacityEntry[], space: string | null): CapacitySummary {
  let online = 0;
  let sessions = 0;
  let inProgress = 0;
  let overdue = 0;
  for (const person of people) {
    if (person.status === 'online') online += 1;
    sessions += person.active_sessions;
    const work = workloadIn(person, space);
    inProgress += work.in_progress;
    overdue += work.overdue;
  }
  return { online, sessions, inProgress, overdue };
}

/**
 * *Team load*: everyone with **committed** work in the chosen space, heaviest
 * first, and how many have none — so an imbalance is one glance. Backlog and
 * review are not load (D-092), so a person holding only those is counted with
 * the people who have nothing committed.
 */
export function teamLoad(
  people: readonly CapacityEntry[],
  space: string | null,
): { readonly rows: CapacityEntry[]; readonly idle: number; readonly scale: number } {
  const busy = people.filter((p) => workloadIn(p, space).committed > 0);
  const rows = [...busy].sort((a, b) => byLoad(a, b, space) || a.name.localeCompare(b.name));
  const scale = Math.max(1, ...rows.map((p) => workloadIn(p, space).committed));
  return { rows, idle: people.length - busy.length, scale };
}

/**
 * `4 h 20 min`, `3 d`, `just now` — the age of the oldest in-progress task.
 *
 * Coarse, because the number answers *"has this been sitting?"*. `null` in
 * means `undefined` out: **a person with nothing in progress has no age, and
 * `0` would read as "started this instant"**.
 */
export function oldestAge(ms: number | null): string | undefined {
  if (ms === null) return undefined;
  // Server clock, browser clock; a hair either side of zero is normal.
  const elapsed = Math.max(0, ms);
  if (elapsed < 60_000) return 'just now';
  return formatDurationMs(elapsed);
}
