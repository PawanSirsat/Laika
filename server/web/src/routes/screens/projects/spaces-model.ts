import type { Project } from '../../../api/projects.ts';

/**
 * The Spaces page's rules, pure (D-103 item 12, LAI-978): what the chips
 * count, what search matches, which section a space lands in, and how the
 * choice is written into the URL. Kept out of the component so each rule is a
 * unit test rather than a browser run.
 */

export const SPACES_FILTERS = ['all', 'yours', 'public', 'archived'] as const;
export type SpacesFilter = (typeof SPACES_FILTERS)[number];

export const SPACES_VIEWS = ['grid', 'list'] as const;
export type SpacesView = (typeof SPACES_VIEWS)[number];

export interface SpacesQuery {
  readonly filter: SpacesFilter;
  readonly view: SpacesView;
  readonly q: string;
}

/** Read the page's state from the URL; anything unknown is the default. */
export function readSpacesQuery(params: URLSearchParams): SpacesQuery {
  const filter = params.get('filter');
  return {
    filter: (SPACES_FILTERS as readonly (string | null)[]).includes(filter)
      ? (filter as SpacesFilter)
      : 'all',
    view: params.get('view') === 'list' ? 'list' : 'grid',
    q: params.get('q') ?? '',
  };
}

/**
 * Write a change back, leaving every other parameter alone. Defaults are
 * removed rather than written, so the plain page keeps the plain address.
 */
export function writeSpacesQuery(
  params: URLSearchParams,
  patch: Partial<SpacesQuery>,
): URLSearchParams {
  const merged = { ...readSpacesQuery(params), ...patch };
  const next = new URLSearchParams(params);
  if (merged.filter === 'all') next.delete('filter');
  else next.set('filter', merged.filter);
  if (merged.view === 'grid') next.delete('view');
  else next.set('view', merged.view);
  if (merged.q === '') next.delete('q');
  else next.set('q', merged.q);
  return next;
}

/** Name, slug, key prefix, repository or description, ignoring case. */
export function matchesSearch(space: Project, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return [space.name, space.slug, space.prefix, space.repo ?? '', space.description ?? ''].some(
    (field) => field.toLowerCase().includes(needle),
  );
}

export interface SpacesSplit {
  /** Spaces the reader is in, or leads implicitly as an owner or admin. */
  readonly yours: readonly Project[];
  /** Public spaces they are not in: the ones offered **Join**. */
  readonly joinable: readonly Project[];
  readonly archived: readonly Project[];
}

/**
 * Sort the two lists the server sent into the page's three groups.
 *
 * The archived list is `?archived=only`; the main list is the default, which
 * leaves archived spaces out. Each is held to what it claims — a row's own
 * `archived_at` decides — so a server that sent one in the wrong list cannot
 * show a space twice.
 */
export function splitSpaces(
  active: readonly Project[],
  archived: readonly Project[],
  isMine: (space: Project) => boolean,
): SpacesSplit {
  const live = active.filter((p) => p.archived_at === null);
  return {
    yours: live.filter(isMine),
    joinable: live.filter((p) => !isMine(p) && p.visibility === 'public'),
    archived: archived.filter((p) => p.archived_at !== null),
  };
}

export type SpacesCounts = Readonly<Record<SpacesFilter, number>>;

/** The chips' numbers. Search does not change them; it narrows what is shown. */
export function spaceCounts(split: SpacesSplit): SpacesCounts {
  const visible = [...split.yours, ...split.joinable];
  return {
    all: visible.length,
    yours: split.yours.length,
    public: visible.filter((p) => p.visibility === 'public').length,
    archived: split.archived.length,
  };
}

/** What each section shows for a chip and a search. */
export function sectionsFor(split: SpacesSplit, filter: SpacesFilter, q: string): SpacesSplit {
  const match = (list: readonly Project[]): readonly Project[] =>
    list.filter((p) => matchesSearch(p, q));
  const isPublic = (p: Project): boolean => p.visibility === 'public';
  switch (filter) {
    case 'all':
      return { yours: match(split.yours), joinable: match(split.joinable), archived: [] };
    case 'yours':
      return { yours: match(split.yours), joinable: [], archived: [] };
    case 'public':
      return {
        yours: match(split.yours.filter(isPublic)),
        joinable: match(split.joinable),
        archived: [],
      };
    case 'archived':
      return { yours: [], joinable: [], archived: match(split.archived) };
  }
}

export interface SpaceProgress {
  /** Every task but cancelled ones: a cancelled task is not outstanding work. */
  readonly total: number;
  readonly done: number;
  readonly review: number;
  readonly active: number;
  readonly blocked: number;
}

/** The served counts, gathered for the bar. Nothing is re-derived. */
export function progressOf(space: Project): SpaceProgress {
  const c = space.task_counts;
  return {
    total: c.backlog + c.todo + c.in_progress + c.review + c.done,
    done: c.done,
    review: c.review,
    active: c.in_progress,
    blocked: space.blocked_count,
  };
}

/** `done/total done · n active · n blocked`, each part only when it says something. */
export function progressLine(p: SpaceProgress): {
  readonly main: string;
  readonly active: string | null;
  readonly blocked: string | null;
} {
  return {
    main: `${String(p.done)}/${String(p.total)} done`,
    active: p.active > 0 ? `${String(p.active)} active` : null,
    blocked: p.blocked > 0 ? `${String(p.blocked)} blocked` : null,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `4m ago`, `3d ago` — short, because it sits in a corner. */
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return `${String(Math.floor(d / MINUTE))}m ago`;
  if (d < DAY) return `${String(Math.floor(d / HOUR))}h ago`;
  return `${String(Math.floor(d / DAY))}d ago`;
}

/**
 * When a space last changed: its newest activity, not `updated_at` — a space
 * with a week of task activity and no settings edit is not untouched.
 */
export function updatedAt(space: Project): number {
  return space.last_activity_at ?? space.updated_at;
}

/** `LAI-1 · owner/repo`, or the slug when no repository is set. */
export function spaceSubline(space: Project): string {
  const where = space.repo !== null && space.repo !== '' ? space.repo : space.slug;
  return `${space.prefix}-1 · ${where}`;
}
