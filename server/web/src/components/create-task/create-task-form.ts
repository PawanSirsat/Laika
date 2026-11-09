import { dateInputToMs } from '../../api/date-only.ts';
import { ApiError } from '../../api/errors.ts';
import type { SizeLevel } from '../../api/estimates.ts';
import { fieldErrors } from '../../api/setup.ts';
import type { ProjectStatus } from '../../api/statuses.ts';
import { normaliseTagInput } from '../../api/tags.ts';
import type { CreateTaskInput, TaskPriority } from '../../api/tasks.ts';
import { linesOf } from '../../routes/screens/task/delivers-derive.ts';

/**
 * The Create task dialog's state and its mapping to `POST /projects/:slug/tasks`
 * (LAI-1167, D-145) — pure, so the unit test can pin every rule without a
 * browser: what is omitted when empty, that only `status_id` is ever sent,
 * how the dates and the lists are shaped, and which field a `422` lands on.
 */

/** One Ships item as the form holds it; `key` is the row's React key only. */
export interface DeliverableDraft {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

export interface CreateTaskDraft {
  readonly title: string;
  /** Markdown, as the editors write it. */
  readonly description: string;
  readonly acceptance: string;
  /** A status of the project; `undefined` lets the server choose its default. */
  readonly statusId: string | undefined;
  readonly priority: TaskPriority;
  readonly assigneeId: string | null;
  readonly agentId: string | null;
  /** Set after the create, not in the body. */
  readonly sprintId: string | null;
  /** `YYYY-MM-DD`, or `''`. */
  readonly dueOn: string;
  readonly plannedStart: string;
  readonly tags: readonly string[];
  readonly deliverables: readonly DeliverableDraft[];
  /** One per line. */
  readonly solves: string;
  readonly unlocks: string;
  readonly size: SizeLevel | undefined;
  readonly parentId: string | null;
  /** Set after the create, one dependency call each. */
  readonly blockedBy: readonly string[];
  readonly externalRef: string;
}

/** The form's fields, as the errors name them. */
export type FieldKey =
  | 'title'
  | 'description'
  | 'acceptance'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'agent'
  | 'sprint'
  | 'dueOn'
  | 'plannedStart'
  | 'tags'
  | 'deliverables'
  | 'solves'
  | 'unlocks'
  | 'size'
  | 'parent'
  | 'blockedBy'
  | 'externalRef';

export function emptyDraft(): CreateTaskDraft {
  return {
    title: '',
    description: '',
    acceptance: '',
    statusId: undefined,
    priority: 'p2',
    assigneeId: null,
    agentId: null,
    sprintId: null,
    dueOn: '',
    plannedStart: '',
    tags: [],
    deliverables: [],
    solves: '',
    unlocks: '',
    size: undefined,
    parentId: null,
    blockedBy: [],
    externalRef: '',
  };
}

/**
 * The draft after *Create another* (the owner, D-145): status, priority,
 * sprint and assignee stay — the four that describe *where* a run of tasks
 * goes — and everything that describes *one* task is cleared.
 */
export function keepForAnother(draft: CreateTaskDraft): CreateTaskDraft {
  return {
    ...emptyDraft(),
    statusId: draft.statusId,
    priority: draft.priority,
    sprintId: draft.sprintId,
    assigneeId: draft.assigneeId,
  };
}

/**
 * The create body. Empties are omitted rather than sent blank: the server
 * body is strict about shapes (`title` trimmed and non-empty, a date a number)
 * and a `''` would be refused where an absence is the default.
 *
 * **`status_id` only, never `status`** — the server takes both and refuses the
 * pair when they disagree (LAI-738); sending one makes that `422` impossible.
 * The sprint and the blockers are not here: each is its own call after the
 * task exists.
 */
export function toCreateBody(draft: CreateTaskDraft): CreateTaskInput {
  const dueOn = dateInputToMs(draft.dueOn);
  const plannedStart = dateInputToMs(draft.plannedStart);
  const tags = [...new Set(draft.tags.map(normaliseTagInput).filter((t) => t !== ''))];
  const deliverables = draft.deliverables
    .filter((d) => d.title.trim() !== '')
    .map((d) => ({
      title: d.title.trim(),
      ...(d.detail.trim() === '' ? {} : { detail: d.detail.trim() }),
    }));
  const solves = linesOf(draft.solves);
  const unlocks = linesOf(draft.unlocks);
  const externalRef = draft.externalRef.trim();
  const description = draft.description.trim();
  const acceptance = draft.acceptance.trim();

  return {
    title: draft.title.trim(),
    priority: draft.priority,
    ...(draft.statusId === undefined ? {} : { status_id: draft.statusId }),
    ...(description === '' ? {} : { description_md: draft.description }),
    ...(acceptance === '' ? {} : { acceptance_md: draft.acceptance }),
    ...(draft.assigneeId === null ? {} : { assignee_id: draft.assigneeId }),
    ...(draft.agentId === null ? {} : { selected_agent_id: draft.agentId }),
    ...(dueOn === null ? {} : { due_on: dueOn }),
    ...(plannedStart === null ? {} : { planned_start: plannedStart }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(deliverables.length === 0 ? {} : { deliverables }),
    ...(solves.length === 0 ? {} : { solves }),
    ...(unlocks.length === 0 ? {} : { unlocks }),
    ...(draft.size === undefined ? {} : { size: draft.size }),
    ...(draft.parentId === null ? {} : { parent_task_id: draft.parentId }),
    ...(externalRef === '' ? {} : { external_ref: externalRef }),
  };
}

/**
 * Which field a server path names. A zod issue's path is the body key, with
 * an index for a list item (`tags.0`); a service refusal's `details.field` is
 * the body key alone. Both `status` and `status_id` land on the one Status
 * control, which is the only one the person can act on.
 */
export const FIELD_OF_PATH: Readonly<Record<string, FieldKey>> = {
  title: 'title',
  description_md: 'description',
  acceptance_md: 'acceptance',
  status: 'status',
  status_id: 'status',
  priority: 'priority',
  assignee_id: 'assignee',
  selected_agent_id: 'agent',
  due_on: 'dueOn',
  planned_start: 'plannedStart',
  tags: 'tags',
  deliverables: 'deliverables',
  solves: 'solves',
  unlocks: 'unlocks',
  size: 'size',
  parent_task_id: 'parent',
  external_ref: 'externalRef',
};

export interface CreateErrors {
  readonly fields: Partial<Record<FieldKey, string>>;
  /** What no field can carry: shown once, at the form's foot. */
  readonly form?: string | undefined;
}

/**
 * A refused create, laid onto the form. A zod `422` carries `issues`, each
 * with a path (`api/setup.ts`'s `fieldErrors` keeps the first per path); a
 * service `422` carries `details.field` and says why in its message. Anything
 * else — a `403`, a network failure — is the form's, in the error's words.
 */
export function errorsByField(error: unknown): CreateErrors {
  const fields: Partial<Record<FieldKey, string>> = {};
  const issues = fieldErrors(error);
  for (const [path, message] of Object.entries(issues)) {
    const key = FIELD_OF_PATH[path.split('.')[0] ?? ''];
    if (key === undefined) continue;
    fields[key] ??= message;
  }
  if (Object.keys(fields).length > 0) return { fields };

  if (error instanceof ApiError) {
    const details = error.details as { field?: unknown } | null;
    const field = typeof details?.field === 'string' ? FIELD_OF_PATH[details.field] : undefined;
    if (field !== undefined) return { fields: { [field]: error.message } };
    return { fields, form: error.message };
  }
  return {
    fields,
    form: error instanceof Error ? error.message : 'Could not create the task. Try again.',
  };
}

/**
 * Where a new task goes when nothing is chosen: the project's first visible
 * Backlog column by position, else its first visible column at all — the
 * same answer the server's default gives, decided here so the control can
 * show it before the create. `undefined` while the statuses are unknown,
 * and then the body carries no `status_id` and the server decides.
 */
export function defaultStatusId(statuses: readonly ProjectStatus[]): string | undefined {
  const visible = [...statuses].filter((s) => !s.hidden).sort((a, b) => a.position - b.position);
  return (visible.find((s) => s.category === 'backlog') ?? visible[0])?.id;
}
