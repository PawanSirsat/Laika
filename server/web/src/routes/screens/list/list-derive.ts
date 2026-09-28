import { ageDays, blockedState, boardStatusLabel, STALE_DAYS } from '../../../api/board-derive.ts';
import { timeLabel, type TimeLabel } from '../../../api/time-label.ts';
import type { Member, Task } from '../../../api/tasks.ts';

/**
 * One row of the List view, decided (prototype lines 166–203, `listRows` at
 * 2327).
 *
 * **A derive module, not a renderer** (CONVENTIONS §4). Everything the design
 * colours by — status, priority, age — is a decision with edges, and edges are
 * what a test can pin without a browser. The component below reads these and
 * places them; it decides nothing.
 */
export type Tone = 'flat' | 'accent' | 'good' | 'warn' | 'bad';

export interface ListRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  /** Dimmed once the work is finished, as the design draws a done row. */
  readonly muted: boolean;
  readonly status: string;
  readonly statusTone: Tone;
  /** `P1`, upper-case — the design's form, not the API's `p1`. */
  readonly priority: string;
  readonly priorityTone: Tone;
  readonly who: string;
  readonly assigned: boolean;
  /**
   * The assignee's **user** id, for the avatar's colour.
   *
   * Colouring by the row's task id would give one person a different colour on
   * every row, which is precisely what an avatar colour exists to prevent.
   */
  readonly assigneeId: string;
  readonly initials: string;
  /** `S2`, or empty when the task is in no sprint. */
  readonly sprintTag: string;
  /** The task's tags, joined as the design joins them. */
  readonly labels: string;
  readonly blocked: boolean;
  /** `blocked by LC-1`, ready to render. Empty when nothing blocks it. */
  readonly blockedBy: string;
  /** `just now` / `4 min ago` / `27 Sep, 14:05`, with the full moment (LAI-486). */
  readonly created: TimeLabel;
  readonly createdTone: Tone;
  readonly updated: TimeLabel;
  readonly updatedTone: Tone;
}

/** `Mira Kellner` → `MK`; a single word gives one letter. */
function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  if (parts.length === 0) return '—';
  if (parts.length === 1) return (parts[0] ?? '').charAt(0).toUpperCase();
  return `${(parts[0] ?? '').charAt(0)}${(parts[parts.length - 1] ?? '').charAt(0)}`.toUpperCase();
}

function statusTone(status: Task['status']): Tone {
  if (status === 'in_progress') return 'accent';
  if (status === 'done') return 'good';
  return 'flat';
}

function priorityTone(priority: Task['priority']): Tone {
  if (priority === 'p1') return 'bad';
  if (priority === 'p2') return 'warn';
  return 'flat';
}

/**
 * How an age is coloured (LAI-486, D-065).
 *
 * - **Under an hour: the accent** — the owner asked for very recent work to
 *   stand out, and an hour is the edge of "just touched".
 * - **Amber: open work quiet for `STALE_DAYS`** — the rail's own threshold and
 *   comparison. A `done` or `cancelled` task is finished, not neglected; it
 *   used to go amber after five days like everything else, which is why every
 *   Done row in the owner's screenshot looked like a problem.
 * - Otherwise muted.
 */
function ageTone(at: number, now: number, status: Task['status'], staleCounts: boolean): Tone {
  if (timeLabel(at, now).fresh) return 'accent';
  const finished = status === 'done' || status === 'cancelled';
  if (staleCounts && !finished && ageDays(at, now) >= STALE_DAYS) return 'warn';
  return 'flat';
}

export interface ListRowInput {
  readonly tasks: readonly Task[];
  readonly byId: ReadonlyMap<string, Task>;
  readonly members: ReadonlyMap<string, Member>;
  /**
   * Sprint id → the label the board already derived, e.g. `S2`.
   *
   * The board's own map, taken whole rather than remapped: a second projection
   * of the same thing is a second place for `S2` to become `S02`.
   */
  readonly sprintLabels: ReadonlyMap<string, { readonly label: string }>;
  readonly now: number;
  /**
   * The board's columns, hidden ones included, so a status reads as the column
   * that owns it (LAI-490) — the List said *Review* under a board whose column
   * says *Testing*. Absent means "no board to ask", and every status falls back
   * to its own name.
   */
  readonly columns?:
    readonly { readonly name: string; readonly statuses: readonly Task['status'][] }[] | undefined;
}

export function listRows({
  tasks,
  byId,
  members,
  sprintLabels,
  now,
  columns = [],
}: ListRowInput): readonly ListRow[] {
  return tasks.map((task) => {
    const member = task.assignee_id === null ? undefined : members.get(task.assignee_id);
    const blocked = blockedState(task, byId) === true;
    /*
     * **The blocker's key, not its id.** The design writes `blocked by LC-1`;
     * `blocked_by` holds ULIDs, and printing one gives the `p1 · t1` defect
     * LAI-271 fixed on the presence chip. A blocker outside the loaded page is
     * simply not named — the count still says there is one.
     */
    const blockerKeys = task.blocked_by
      .map((id) => byId.get(id)?.key)
      .filter((k): k is string => k !== undefined);

    return {
      id: task.id,
      key: task.key,
      title: task.title,
      muted: task.status === 'done' || task.status === 'cancelled',
      // The label only — sorting reads the value (`compareBy`), so renaming a
      // column can never reorder the List.
      status: boardStatusLabel(task.status, columns),
      statusTone: statusTone(task.status),
      priority: task.priority.toUpperCase(),
      priorityTone: priorityTone(task.priority),
      who: member?.name ?? 'Unassigned',
      assigned: member !== undefined,
      assigneeId: task.assignee_id ?? '',
      initials: member === undefined ? '—' : initialsOf(member.name),
      sprintTag: task.sprint_id === null ? '' : (sprintLabels.get(task.sprint_id)?.label ?? ''),
      labels: task.tags.join(', '),
      blocked,
      blockedBy: blockerKeys.length === 0 ? '' : `blocked by ${blockerKeys.join(', ')}`,
      created: timeLabel(task.created_at, now),
      // Staleness is about going quiet, so only UPDATED can be amber; an old
      // CREATED is just old.
      createdTone: ageTone(task.created_at, now, task.status, false),
      updated: timeLabel(task.updated_at, now),
      updatedTone: ageTone(task.updated_at, now, task.status, true),
    };
  });
}

export type SortKey =
  'key' | 'title' | 'status' | 'priority' | 'assignee' | 'sprint' | 'created' | 'updated';

/** The design's column order, and the order the header renders in. */
export const LIST_COLUMNS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'key', label: 'Key' },
  { key: 'title', label: 'Summary' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Pri' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'sprint', label: 'Spr' },
  /*
   * **Both dates, in the same form** (LAI-621). The List answered "when was
   * this last touched" and never "when was it made", so age and lifespan could
   * not be told apart: a task updated today is either new or a year old, and
   * the screen said the same thing about both.
   */
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
];

/**
 * The workflow order, which is how a person reads status — not the alphabet,
 * which put `cancelled` second and `todo` last (LAI-485).
 */
const STATUS_ORDER: readonly Task['status'][] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
];

/** `S2` → 2, so S2 sorts before S10. No sprint sorts after every sprint. */
function sprintNumber(tag: string): number {
  const n = /\d+/.exec(tag)?.[0];
  return n === undefined ? Number.POSITIVE_INFINITY : Number(n);
}

/**
 * One column's comparison, before direction (LAI-485).
 *
 * **Unassigned sorts after every name** rather than alphabetically among them:
 * "Unassigned" is the absence of a person, not a person called Unassigned.
 */
function compareBy(key: SortKey, a: Task, b: Task, ra: ListRow, rb: ListRow): number {
  switch (key) {
    case 'key':
      return a.number - b.number;
    case 'title':
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    case 'status':
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    case 'priority':
      return a.priority.localeCompare(b.priority);
    case 'assignee':
      if (ra.assigned !== rb.assigned) return ra.assigned ? -1 : 1;
      return ra.who.toLowerCase().localeCompare(rb.who.toLowerCase());
    case 'sprint': {
      const x = sprintNumber(ra.sprintTag);
      const y = sprintNumber(rb.sprintTag);
      return x === y ? 0 : x < y ? -1 : 1;
    }
    case 'created':
      // The raw stamp, so the arrow means what it says.
      return a.created_at - b.created_at;
    case 'updated':
      return a.updated_at - b.updated_at;
  }
}

/**
 * Sort the rows. **Ties break by key number, ascending, whatever the
 * direction** (LAI-485) — sorting by status or priority used to leave each
 * group in whatever order the rows arrived, so the same click could give a
 * different list twice.
 */
export function sortRows(
  rows: readonly ListRow[],
  byId: ReadonlyMap<string, Task>,
  key: SortKey,
  ascending: boolean,
): readonly ListRow[] {
  const decorated = rows.flatMap((row) => {
    const task = byId.get(row.id);
    return task === undefined ? [] : [{ row, task }];
  });
  decorated.sort((x, y) => {
    const primary = compareBy(key, x.task, y.task, x.row, y.row);
    if (primary !== 0) return ascending ? primary : -primary;
    return x.task.number - y.task.number;
  });
  return decorated.map((d) => d.row);
}

/* ------------------------------------------------------ the sort in the URL */

export interface ListSort {
  readonly key: SortKey;
  readonly ascending: boolean;
}

/**
 * **Newest-updated first** (D-065). Not written to the URL: a bare `/list`
 * means this, so writing it would make two addresses for one list.
 */
export const DEFAULT_SORT: ListSort = { key: 'updated', ascending: false };

const SORT_KEYS: ReadonlySet<string> = new Set(LIST_COLUMNS.map((c) => c.key));

/**
 * Which way a column starts when it is first clicked: **dates newest first**,
 * everything else A→Z. A reader clicking CREATED wants the new work, and
 * clicking it twice to get there was the old behaviour.
 */
export function firstDirection(key: SortKey): boolean {
  return key !== 'created' && key !== 'updated';
}

/** A header click: a new column starts its own way, the same column flips. */
export function nextSort(current: ListSort, clicked: SortKey): ListSort {
  return current.key === clicked
    ? { key: clicked, ascending: !current.ascending }
    : { key: clicked, ascending: firstDirection(clicked) };
}

/**
 * The sort a URL asks for. **The URL is untrusted input**: an unknown `sort`,
 * or a `dir` with no `sort`, is the default rather than an error; a known
 * `sort` with a missing or unknown `dir` starts the column's own way.
 */
export function readSort(params: URLSearchParams): ListSort {
  const key = params.get('sort');
  if (key === null || !SORT_KEYS.has(key)) return DEFAULT_SORT;
  const dir = params.get('dir');
  const sortKey = key as SortKey;
  if (dir === 'asc') return { key: sortKey, ascending: true };
  if (dir === 'desc') return { key: sortKey, ascending: false };
  return { key: sortKey, ascending: firstDirection(sortKey) };
}

/** The params for a sort — both absent for the default. */
export function sortParams(sort: ListSort): {
  readonly sort: string | undefined;
  readonly dir: string | undefined;
} {
  if (sort.key === DEFAULT_SORT.key && sort.ascending === DEFAULT_SORT.ascending) {
    return { sort: undefined, dir: undefined };
  }
  return { sort: sort.key, dir: sort.ascending ? 'asc' : 'desc' };
}

/** `?page=` is 1-based for people; this is 0-based. Junk reads as page one. */
export function readPage(params: URLSearchParams): number {
  const raw = params.get('page');
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  return Math.max(0, Number(raw) - 1);
}

/** Page one is not written, for the same reason the default sort is not. */
export function pageParam(page: number): string | undefined {
  return page <= 0 ? undefined : String(page + 1);
}
