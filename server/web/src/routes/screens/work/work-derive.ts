import type { AllTasksFilter, TaskStatus, TasksSummary, TaskSummary } from '../../../api/tasks.ts';

/**
 * The Work page (LAI-952): everyone's work across every space, read from
 * `GET /tasks` (LAI-887).
 *
 * **Which tasks a reader sees is the server's answer, never this file's.** An
 * owner is sent every space's tasks and a member only the spaces they may
 * read; the rows here are the page as served, in its order, with ids turned
 * into names and nothing added or dropped.
 */

/** One page at a time (LAI-975): the reader picks how many, and the URL keeps it. */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export function readPageSize(params: URLSearchParams): PageSize {
  const value = Number(params.get('size'));
  return PAGE_SIZES.find((size) => size === value) ?? DEFAULT_PAGE_SIZE;
}

/** `params` with the page size set — the default is no param at all. */
export function withPageSize(params: URLSearchParams, size: PageSize): URLSearchParams {
  const next = new URLSearchParams(params);
  if (size === DEFAULT_PAGE_SIZE) next.delete('size');
  else next.set('size', String(size));
  return next;
}

/** The filters, as they live in the URL. Absent is "any". */
export interface WorkFilter {
  /** A user id, or `none` for unassigned work. */
  readonly person?: string;
  readonly status?: TaskStatus;
  /** A space's slug. `space`, not `project`: the shell owns `?project=`. */
  readonly space?: string;
  /** A sprint id, or `none` for work in no sprint. */
  readonly sprint?: string;
}

/** The categories `GET /tasks?status=` takes, in board order, as the page names them. */
export const STATUS_FILTERS: readonly { readonly value: TaskStatus; readonly label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const KEYS = ['person', 'status', 'space', 'sprint'] as const;
type WorkKey = (typeof KEYS)[number];

function isStatus(value: string): value is TaskStatus {
  return STATUS_FILTERS.some((s) => s.value === value);
}

export function readWorkFilter(params: URLSearchParams): WorkFilter {
  const filter: { -readonly [K in keyof WorkFilter]: WorkFilter[K] } = {};
  for (const key of KEYS) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    if (key === 'status') {
      // An unknown category would be refused `400`; a hand-edited URL reads
      // as no status filter instead.
      if (isStatus(value)) filter.status = value;
    } else {
      filter[key] = value;
    }
  }
  return filter;
}

/**
 * `params` with `change` applied: a value sets its filter, `''` removes it,
 * every other param is kept. **A sprint belongs to one space**, so choosing a
 * different space drops a sprint filter — except `none`, which means the same
 * thing in every space.
 */
export function withWorkFilter(
  params: URLSearchParams,
  change: Partial<Record<WorkKey, string>>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of KEYS) {
    const value = change[key];
    if (value === undefined) continue;
    if (value === '') next.delete(key);
    else next.set(key, value);
  }
  const spaceChanged = change.space !== undefined && change.space !== (params.get('space') ?? '');
  if (spaceChanged && change.sprint === undefined && next.get('sprint') !== 'none') {
    next.delete('sprint');
  }
  return next;
}

/** What the server is asked for: the person is the assignee, the space the project. */
export function allTasksFilter(
  filter: WorkFilter,
  size: PageSize = DEFAULT_PAGE_SIZE,
): AllTasksFilter {
  return {
    ...(filter.person === undefined ? {} : { assignee: filter.person }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.space === undefined ? {} : { project: filter.space }),
    ...(filter.sprint === undefined ? {} : { sprint: filter.sprint }),
    limit: size,
  };
}

/**
 * What the summary is asked for (LAI-975): every filter **but the status**.
 * The tiles are the status breakdown, so filtering them by one status would
 * zero the rest and leave nothing to switch to; the chosen tile is pressed
 * instead, and the pager reads its count from `by_status`.
 */
export function summaryFilter(filter: WorkFilter): Omit<AllTasksFilter, 'limit' | 'cursor'> {
  const { status: _status, limit: _limit, ...rest } = allTasksFilter(filter);
  return rest;
}

/** The status tiles, in the order the strip shows them. Cancelled has none. */
export const STATUS_TILES: readonly { readonly value: TaskStatus; readonly label: string }[] = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
  { value: 'todo', label: 'To do' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'done', label: 'Done' },
];

/** How many tasks the list pages through: the server's figure, never a sum of rows. */
export function pageTotal(
  summary: TasksSummary | undefined,
  status: TaskStatus | undefined,
): number | undefined {
  if (summary === undefined) return undefined;
  return status === undefined ? summary.total : summary.by_status[status];
}

/** The `by_assignee` entry that folds everyone past the server's top ten. */
export const OTHERS = 'others';

/**
 * The person filter a `by_assignee` entry stands for: their id, `none` for
 * unassigned work — and nothing for `others`, which is many people.
 */
export function personFilterOf(userId: string | null): string | undefined {
  if (userId === OTHERS) return undefined;
  return userId ?? 'none';
}

/** `1–25 of 142`, or `51–100` while the total is not known. */
export function pageRange(
  index: number,
  size: number,
  shown: number,
  total: number | undefined,
): string {
  const of = total === undefined ? '' : ` of ${String(total)}`;
  if (shown === 0) return `0${of}`;
  const first = index * size + 1;
  return `${String(first)}–${String(first + shown - 1)}${of}`;
}

/** Which side of the Me / Everyone toggle is on — or neither, for another person. */
export function personMode(
  filter: WorkFilter,
  meId: string | undefined,
): 'me' | 'everyone' | 'other' {
  if (filter.person === undefined) return 'everyone';
  return meId !== undefined && filter.person === meId ? 'me' : 'other';
}

export interface WorkRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  /** Undefined while the space list has not named it. */
  readonly space: { readonly slug: string; readonly name: string } | undefined;
  readonly status: TaskStatus;
  /** The project's own name for the status — `QA`, not `review`. */
  readonly statusName: string;
  readonly assignee: string;
  /** Whose name it is, for the link to their profile (LAI-959); null for nobody. */
  readonly assigneeId: string | null;
  /** Null for work in no sprint. */
  readonly sprint: string | null;
  readonly updatedAt: number;
}

export interface WorkLookups {
  readonly spaces: ReadonlyMap<string, { readonly slug: string; readonly name: string }>;
  readonly people: ReadonlyMap<string, string>;
  readonly sprints: ReadonlyMap<string, string>;
}

/** The served tasks as rows, one each, in the order they were served. */
export function workRows(tasks: readonly TaskSummary[], lookups: WorkLookups): WorkRow[] {
  return tasks.map((task) => ({
    id: task.id,
    key: task.key,
    title: task.title,
    space: lookups.spaces.get(task.project_id),
    status: task.status,
    statusName: task.status_name,
    assignee:
      task.assignee_id === null
        ? 'Unassigned'
        : (lookups.people.get(task.assignee_id) ?? 'Someone'),
    assigneeId: task.assignee_id,
    sprint: task.sprint_id === null ? null : (lookups.sprints.get(task.sprint_id) ?? 'A sprint'),
    updatedAt: task.updated_at,
  }));
}
