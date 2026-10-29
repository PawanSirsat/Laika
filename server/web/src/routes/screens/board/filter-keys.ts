import { ALL_STATUSES } from '../../../api/board-derive.ts';
import { isPriority, isTagName } from '../../../api/task-filter.ts';
import type { TaskFilter, TaskStatus } from '../../../api/tasks.ts';

/**
 * Every URL key that narrows which tasks the board and the List show.
 *
 * **One list, read wherever "the filters" are meant** (LAI-485, LAI-487): the
 * List's page reset, the Filter badge, *Clear all*, the View-settings chips,
 * and (LAI-488) what travels between the Board and List tabs. Two hand-written
 * lists of "the filter keys" is how *Clear all* came to miss `sprint`.
 *
 * Not here on purpose: `project`, `task`, `group`, `view`, and the List's own
 * `sort`, `dir` and `page` — none of them changes *which* tasks match.
 */
export const FILTER_KEYS = [
  'q',
  'status',
  'priority',
  'assignee',
  'tag',
  'sprint',
  'updated',
  'ready',
  'blocked',
  'agent',
  // The selected agent (LAI-538): an agent id, `any` or `none`. Not `agent`,
  // which is *agent-created* and keeps that meaning.
  'selected_agent',
  'top',
  'overdue',
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** The filters in a URL as one comparable string, in a fixed order. */
export function filterSignature(params: URLSearchParams): string {
  return FILTER_KEYS.map((key) => `${key}=${params.get(key) ?? ''}`).join('&');
}

/* ----------------------------------------------------- reading, untrusted */

/**
 * `?status=` — one of the project's statuses by id, a whole category, or
 * nothing (LAI-739).
 *
 * The Filter picks a status — a column — by id. A link that names a
 * **category** (`?status=review`, as the Dashboard's overview writes and as
 * every link from before LAI-739 did) still works and means every status of
 * that kind.
 *
 * **Validated before it is applied** (LAI-487): an id this project does not
 * hold is not applied and not counted, exactly like a junk value, so a stale
 * link never turns the board into one that matches nothing. Until the
 * statuses load, `statusIds` is empty and an id waits.
 */
export function readStatus(
  params: URLSearchParams,
  statusIds: ReadonlySet<string> = NO_IDS,
): string | undefined {
  const raw = params.get('status') ?? '';
  return isCategory(raw) || statusIds.has(raw) ? raw : undefined;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function isCategory(value: string): value is TaskStatus {
  return (ALL_STATUSES as readonly string[]).includes(value);
}

/** What a `?status=` value asks of the task set. */
export function statusFilter(value: string): Pick<TaskFilter, 'status' | 'status_id'> {
  return isCategory(value) ? { status: value } : { status_id: value };
}

/**
 * `?sprint=all` — every sprint, **chosen** (LAI-713).
 *
 * The board opens on the active sprint when the URL names none, so "no
 * `?sprint=`" can no longer mean "all sprints": the default would take it
 * straight back. A reader who picks *All sprints* gets this value instead,
 * which a reload keeps and the default leaves alone.
 */
export const ALL_SPRINTS = 'all';

/**
 * The sprint the tasks are scoped to, or `undefined` for every sprint.
 *
 * Missing, empty and {@link ALL_SPRINTS} all mean every sprint; anything else
 * — a sprint id, or `none` for work in no sprint — is sent to the server as is.
 */
export function readSprintScope(params: URLSearchParams): string | undefined {
  const raw = params.get('sprint');
  return raw === null || raw === '' || raw === ALL_SPRINTS ? undefined : raw;
}

/** The sprint a board opens on: the project's active one, if it has one. */
export function activeSprintId(
  sprints: readonly { readonly id: string; readonly status: string }[],
): string | undefined {
  return sprints.find((sprint) => sprint.status === 'active')?.id;
}

export const UPDATED_WINDOWS = ['today', '7d', '30d'] as const;
export type UpdatedWindow = (typeof UPDATED_WINDOWS)[number];

export const UPDATED_LABELS: Readonly<Record<UpdatedWindow, string>> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/**
 * `?updated=` — a **window**, not a timestamp (LAI-487). A link shared on
 * Monday that says "last 7 days" must still mean the last seven days when it
 * is opened on Friday; a stored `updated_since` would freeze Monday's week.
 */
export function readUpdated(params: URLSearchParams): UpdatedWindow | undefined {
  const raw = params.get('updated');
  return (UPDATED_WINDOWS as readonly string[]).includes(raw ?? '')
    ? (raw as UpdatedWindow)
    : undefined;
}

/**
 * The `updated_since` a window means, as of `now`. **Today is since local
 * midnight**, not "the last 24 hours" — a person saying "today" means the
 * calendar day they are in.
 */
export function updatedSince(window: UpdatedWindow, now: number): number {
  if (window === 'today') {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  const days = window === '7d' ? 7 : 30;
  return now - days * 86_400_000;
}

/** `?blocked=true` only; anything else is no filter. */
export function readBlocked(params: URLSearchParams): boolean {
  return params.get('blocked') === 'true';
}

/** Hide subtasks, keep their parents (D-066). */
export function readTop(params: URLSearchParams): boolean {
  return params.get('top') === 'true';
}

/** Only tasks past their due date and still open (D-066). */
export function readOverdue(params: URLSearchParams): boolean {
  return params.get('overdue') === 'true';
}

/* ---------------------------------------------------- what is applied now */

export interface ActiveFilter {
  readonly key: FilterKey;
  readonly label: string;
}

export interface FilterNames {
  /** A `?status=` value as the board says it: the status's name, or the kind's. */
  readonly status: (value: string) => string;
  /** The project's status ids, so a link naming one is applied (LAI-739). */
  readonly statusIds?: ReadonlySet<string> | undefined;
}

/**
 * Every filter the URL actually applies, **as the board applies it** — so a
 * value the board would ignore (`?status=bogus`) is not counted, and one the
 * board does send (`?ready=false`) is.
 *
 * The badge counts these minus search, which has its own box; the chips show
 * them all; *Clear all* deletes every `FILTER_KEYS` entry.
 */
export function activeFilters(
  params: URLSearchParams,
  names: FilterNames,
): readonly ActiveFilter[] {
  const found: ActiveFilter[] = [];
  const query = (params.get('q') ?? '').trim();
  if (query !== '') found.push({ key: 'q', label: `“${query}”` });

  const status = readStatus(params, names.statusIds);
  if (status !== undefined) found.push({ key: 'status', label: `Status ${names.status(status)}` });

  // Priority and tag by the server's rules (LAI-724): a refused value is
  // named by the board and not applied, so it is not counted either.
  const priority = params.get('priority');
  if (priority !== null && isPriority(priority)) {
    found.push({ key: 'priority', label: `Priority ${priority}` });
  }

  const assignee = params.get('assignee');
  if (assignee !== null && assignee !== '') found.push({ key: 'assignee', label: 'Assignee' });

  const tag = params.get('tag');
  if (tag !== null && isTagName(tag)) found.push({ key: 'tag', label: `Tag ${tag}` });

  // `all` is every sprint, chosen — not a filter (LAI-713).
  const sprint = readSprintScope(params);
  if (sprint !== undefined) {
    found.push({ key: 'sprint', label: sprint === 'none' ? 'No sprint' : 'Sprint' });
  }

  const updated = readUpdated(params);
  if (updated !== undefined) {
    found.push({ key: 'updated', label: `Updated ${UPDATED_LABELS[updated].toLowerCase()}` });
  }

  // `ready=false` is sent to the server (BoardScreen), so it is a filter the
  // badge must admit to — it used to filter the board while the button said
  // nothing was filtered.
  const ready = params.get('ready');
  if (ready === 'true') found.push({ key: 'ready', label: 'Ready only' });
  if (ready === 'false') found.push({ key: 'ready', label: 'Not ready' });

  if (readBlocked(params)) found.push({ key: 'blocked', label: 'Blocked only' });
  if (params.get('agent') === 'true') found.push({ key: 'agent', label: 'Agent-created' });
  const selectedAgent = params.get('selected_agent');
  if (selectedAgent !== null && selectedAgent !== '') {
    found.push({ key: 'selected_agent', label: 'Agent' });
  }
  if (readTop(params)) found.push({ key: 'top', label: 'Top-level only' });
  if (readOverdue(params)) found.push({ key: 'overdue', label: 'Overdue' });

  return found;
}

/** The Filter button's number: everything applied except search. */
export function filterCount(params: URLSearchParams, names: FilterNames): number {
  return activeFilters(params, names).filter((f) => f.key !== 'q').length;
}

/** The URL with every filter removed and everything else — project, task, group, sort — kept. */
export function withoutFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FILTER_KEYS) next.delete(key);
  return next;
}
