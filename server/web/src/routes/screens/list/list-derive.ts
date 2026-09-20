import { blockedState, statusLabel, updatedAge } from '../../../api/board-derive.ts';
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
  readonly updated: string;
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
 * How the age reads.
 *
 * The design gives *just now* the accent and anything over five days the amber
 * it uses for stale everywhere else — the same five-day threshold the rail's
 * Stale panel uses, so the two cannot disagree about what quiet means.
 */
const STALE_MS = 5 * 24 * 60 * 60 * 1000;

function updatedTone(updatedAt: number, now: number): Tone {
  if (now - updatedAt > STALE_MS) return 'warn';
  return updatedAge(updatedAt, now) === 'just now' ? 'accent' : 'flat';
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
}

export function listRows({
  tasks,
  byId,
  members,
  sprintLabels,
  now,
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
      status: statusLabel(task.status),
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
      updated: updatedAge(task.updated_at, now),
      updatedTone: updatedTone(task.updated_at, now),
    };
  });
}

export type SortKey = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'sprint' | 'updated';

/** The design's column order, and the order the header renders in. */
export const LIST_COLUMNS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'key', label: 'Key' },
  { key: 'title', label: 'Summary' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Pri' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'sprint', label: 'Spr' },
  { key: 'updated', label: 'Updated' },
];

function sortValue(task: Task, row: ListRow, key: SortKey): string | number {
  switch (key) {
    case 'key':
      return task.number;
    case 'title':
      return task.title.toLowerCase();
    case 'status':
      return task.status;
    case 'priority':
      return task.priority;
    case 'assignee':
      return row.who.toLowerCase();
    case 'sprint':
      return row.sprintTag;
    case 'updated':
      // Newest first when ascending would be backwards; the raw stamp sorts
      // oldest-first and the caller flips it, so the arrow means what it says.
      return task.updated_at;
  }
}

export function sortRows(
  rows: readonly ListRow[],
  byId: ReadonlyMap<string, Task>,
  key: SortKey,
  ascending: boolean,
): readonly ListRow[] {
  const decorated = rows.map((row) => {
    const task = byId.get(row.id);
    return { row, value: task === undefined ? '' : sortValue(task, row, key) };
  });
  decorated.sort((a, b) => {
    const order = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    return ascending ? order : -order;
  });
  return decorated.map((d) => d.row);
}
