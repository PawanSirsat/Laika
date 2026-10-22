import type { AllTasksFilter, TaskStatus, TaskSummary } from '../../../api/tasks.ts';

/**
 * The Work page (LAI-952): everyone's work across every space, read from
 * `GET /tasks` (LAI-887).
 *
 * **Which tasks a reader sees is the server's answer, never this file's.** An
 * owner is sent every space's tasks and a member only the spaces they may
 * read; the rows here are the page as served, in its order, with ids turned
 * into names and nothing added or dropped.
 */

/** One page at a time; "Load more" asks for the next. */
export const ALL_TASKS_PAGE = 50;

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
export function allTasksFilter(filter: WorkFilter): AllTasksFilter {
  return {
    ...(filter.person === undefined ? {} : { assignee: filter.person }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.space === undefined ? {} : { project: filter.space }),
    ...(filter.sprint === undefined ? {} : { sprint: filter.sprint }),
    limit: ALL_TASKS_PAGE,
  };
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
    sprint: task.sprint_id === null ? null : (lookups.sprints.get(task.sprint_id) ?? 'A sprint'),
    updatedAt: task.updated_at,
  }));
}
