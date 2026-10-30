import type { SelectedAgent } from './selected-agent.ts';
import type { CheckpointVerification } from './handoffs.ts';
import { type TaskSize } from './estimates.ts';
import { request } from './client.ts';
import { ApiError } from './errors.ts';

/**
 * Tasks (SPEC §6.4, LAI-011).
 *
 * Wire shapes are snake_case and mirror `server/src/services/tasks.ts` exactly.
 * Anything the server does not send is **not invented here** — notably `stale`
 * and the agent-authored badge, which LAI-049 needs and `TaskView` does not
 * carry (→ LAI-208, LAI-209).
 */

export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof STATUSES)[number] | 'cancelled';

export const PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

/** `TaskView.send_back` (§6.4): who sent it back, when, and why. */
export interface TaskSendBack {
  readonly reason_md: string;
  readonly decided_by: string;
  readonly created_at: number;
}

/**
 * A task as every list in the app holds it (LAI-795): `?fields=slim`, which is
 * {@link Task} without its two texts. Board, List, Timeline, Calendar,
 * Capacity and the store draw none of them, and they were 83% of a gzip'd
 * 200-task page (LAI-786). The task panel reads them with `GET /tasks/:id`.
 *
 * **The type is the census.** A screen that reads `description_md` off the
 * store's set does not compile, so a new reader cannot quietly draw an empty
 * description from a list that never carried it.
 */
/** `TaskLiveClaimView` in `server/src/services/claims.ts`. Shown, decides nothing. */
export interface TaskLiveClaim {
  readonly generation: number;
  readonly state: 'active' | 'paused';
  readonly agent_id: string;
  readonly session_id: string;
  readonly lease_expires_at: number;
  /** The holding session's. */
  readonly last_heartbeat_at: number;
  /**
   * Its age by the **server's** clock as of the read (LAI-597 review). Aged on
   * the page's own monotonic clock; never `last_heartbeat_at` against
   * `Date.now()`. Optional: a view served before it has none, read as 0.
   */
  readonly heartbeat_age_ms?: number;
  /** As of the read; `suspect_after_ms` moves it on the client's own clock. */
  readonly connection: 'live' | 'suspect';
  /** Heartbeats write no activity, so no event re-reads the task when this passes. */
  readonly suspect_after_ms: number;
  readonly device_label: string | null;
  /**
   * What the holding session said ran (D-118, LAI-593) — self-reported, null
   * where it reported nothing. Optional because a view served before LAI-593
   * has none, which reads as null.
   */
  readonly harness?: string | null;
  readonly harness_version?: string | null;
  readonly model?: string | null;
}

/**
 * `TaskHandoffView` in `server/src/services/task-handoff.ts` (LAI-1005): the
 * task's newest save and live hand-off in brief, with the two card states the
 * **server** derives. The card draws them; it never derives them again.
 */
export interface TaskHandoff {
  readonly checkpoint: {
    readonly verification: CheckpointVerification;
    readonly saved_at: number;
    readonly pending_since: number | null;
    readonly pending_notice: boolean;
  } | null;
  readonly offer: {
    readonly kind: 'handoff' | 'recovery';
    readonly state: 'pending_approval' | 'open';
    readonly requires_approval: boolean;
  } | null;
  readonly recovery_available: boolean;
  readonly save_needs_attention: boolean;
}

export interface TaskSummary {
  readonly id: string;
  /** The display key humans and agents both use — `LAI-42` (§4.5). */
  readonly key: string;
  readonly project_id: string;
  readonly number: number;
  readonly title: string;
  /**
   * The **kind** of work the task's status is (LAI-738) — one of the six
   * categories the lifecycle rules, `ready` and the MCP tools read. It colours
   * the status; it is not what the status is called.
   */
  readonly status: TaskStatus;
  /** The project status the task is in — one board column (LAI-738, LAI-739). */
  readonly status_id: string;
  /** That status's name, as the project calls it. What the UI prints. */
  readonly status_name: string;
  readonly priority: TaskPriority;
  readonly assignee_id: string | null;
  /**
   * The sprint this task belongs to, or `null`.
   *
   * The server has returned this on every `TaskView` since LAI-011; the client
   * type simply never declared it, so nothing in the UI could group or scope by
   * sprint (LAI-121, found by Builder-A).
   */
  readonly sprint_id: string | null;
  readonly created_by: string;
  readonly created_via: string;
  /**
   * Which client created it — the agent's name where a token was used, `null`
   * otherwise (§4.9, LAI-093).
   *
   * `created_via` is the channel (`web`, `mcp`, `api`); this is the *client*.
   * Together they answer "an agent did this, and which one" — the attribution
   * LAI-411 could only render as the honest "agent", and the name LAI-416 needs
   * so an org Admin stops rendering as "Someone".
   */
  readonly created_by_client: string | null;
  readonly discovered_from: string | null;
  /**
   * The task's place in its project's **manual order** (§4.5, LAI-472, D-070):
   * an opaque key compared **byte-wise** — never with `localeCompare`, which
   * would fold case and disagree with the server. A lane draws its tasks in
   * this order. `null` only for a row the server had not yet placed.
   */
  readonly position: string | null;
  /**
   * **Derived by the server** (§4.5): backlog or todo, unassigned, and every
   * dependency done. Displayed, never recomputed — recomputing it here is the
   * bug LAI-049 warns about, because the two definitions would drift.
   */
  readonly ready: boolean;
  /**
   * When the nightly job last flagged this task as stale — unix ms, `null` when
   * it has not (§11.6, LAI-208, LAI-157).
   *
   * **A timestamp, not a boolean, and that is the whole point.** The marker
   * §11.4.1 asks for says *how* stale, and "stale" and "stale for 9 days" are
   * different messages to somebody scanning a board. A served `stale: true`
   * would have thrown away the only thing the row actually holds.
   *
   * **Nothing here decides whether a task is stale.** The rule is three
   * conditions — `in_progress`, no heartbeat, no commit, for three days (§11.6)
   * — and the job evaluates them. Reading the field is display; recomputing it
   * would be the second definition §4.5 refuses for `ready`, and it would drift
   * the same way.
   *
   * **The job owns it in both directions**, so a rescued task is un-flagged
   * rather than marked forever — but only at the next run. A task rescued at
   * noon keeps its marker until tonight, and **the client must not paper over
   * that** by hiding the marker on, say, non-`in_progress` tasks: that is a
   * third staleness rule, and if the lag is too visible the fix is the job's
   * schedule.
   */
  readonly stale_flagged_at: number | null;
  readonly blocked_by: readonly string[];
  /**
   * Ids this task **blocks** — the reverse edge of `blocked_by`.
   *
   * Declared because it is served (LAI-213). Nothing renders it yet; a card
   * saying what it is holding up, rather than only what holds it, is LAI-223's
   * note.
   */
  readonly blocks: readonly string[];
  /**
   * The send-back this task carries, or null (§4.27, D-082): a person sent it
   * back from review with this reason, and nobody has finished it since. The
   * card marks it and the panel shows the reason.
   */
  readonly send_back: TaskSendBack | null;
  /**
   * Its size and build-time forecast (§4.32, D-085): the level shown — a
   * person's when one is set — the computed one beside it, and the p50–p80
   * range once the project has history. Null before one is computed, and
   * absent from a view served before LAI-771, which reads as null.
   */
  readonly size: TaskSize | null;
  /**
   * Live comments, derived at read time and excluding soft-deleted ones
   * (LAI-072), so it cannot disagree with the thread the reader opens.
   *
   * Declared here, rendered by LAI-223.
   */
  readonly comment_count: number;
  /**
   * Tag names, served since LAI-079.
   *
   * **Plain strings, and no colour anywhere.** D-027 settled that deliberately:
   * a per-tag palette means a colour that has to be chosen, stored, kept
   * distinguishable in both themes, and explained to whoever adds the tenth
   * tag. The board's chips are neutral, and the word is the identity.
   */
  readonly tags: readonly string[];
  /**
   * When the task first entered `in_progress`, and when it reached `done`
   * (LAI-126). Unix ms, `null` until each happens.
   *
   * **Actuals, not a plan.** D-014 gives tasks no dates so the timeline stays a
   * rendering pass over sprint boundaries rather than a scheduling engine —
   * these record what *happened*, where a Gantt bar asserts what is *planned*.
   * Declaring them is right; **drawing task bars from them is a separate
   * decision that needs the owner** (D-040 refused the design's task-level
   * timeline for exactly this reason). `routes/screens/timeline/` has a guard
   * that fails if a task-derived value reaches the axis, and it should stay
   * failing until someone reopens D-014 deliberately.
   */
  readonly started_at: number | null;
  readonly completed_at: number | null;
  /**
   * The task this is a **subtask** of, or `null` (§4.5, D-066). One level —
   * a task with a parent never has children — same project, and not a
   * dependency: `ready` ignores it. Its children are `GET …/tasks?parent=`.
   */
  readonly parent_task_id: string | null;
  /**
   * The plan, as distinct from the actuals above (D-066): unix-ms at a UTC
   * midnight, date-only like a sprint's `starts_on`. "Overdue" is derived
   * here from `due_on` and the status (`api/date-only.ts`), never served.
   */
  readonly due_on: number | null;
  readonly planned_start: number | null;
  /** Last branch seen working on it — the plugin writes it (LAI-286). */
  readonly branch: string | null;
  /**
   * The id this card has somewhere else — an **outside id**, `LAI-780` or a
   * Jira key, which every tool that takes a task key takes too (LAI-780;
   * {@link isOutsideId}) — or the pull request the webhook last recorded,
   * `owner/repo#N` (LAI-286).
   */
  readonly external_ref: string | null;
  /**
   * The agent meant to do the work, or null (§4.5, D-114 item 7, LAI-535) —
   * **not** the assignee and not a claim: selecting one opens a work request
   * and changes nothing else. Its owner rides with it. Optional because a view
   * served before LAI-535 has none, which reads as null
   * (`selectedAgentOf`).
   */
  readonly selected_agent?: SelectedAgent | null;
  /**
   * The task's live agent claim — `active` or `paused` — or null (§6.4,
   * LAI-568). An expired, released or transferred claim is never here; its
   * history is the task's activity. Optional because a view served before
   * LAI-568 has none, which reads as null.
   */
  readonly claim?: TaskLiveClaim | null;
  /**
   * Saves and hand-off in brief (§6.4, LAI-1005). Optional because a view
   * served before it has none, which reads as nothing to show.
   */
  readonly handoff?: TaskHandoff;
  readonly created_at: number;
  readonly updated_at: number;
}

/**
 * A task in full: `GET /tasks/:id` and the answer to every write (§6.4). Only
 * the task panel holds one.
 */
export interface Task extends TaskSummary {
  readonly description_md: string | null;
  /** Acceptance criteria, as written. Markdown source, not rendered. */
  readonly acceptance_md: string | null;
}

/** The fields `?fields=slim` leaves out of a list, and {@link toSummary} drops. */
export const SLIM_OMITS = ['description_md', 'acceptance_md'] as const;

/**
 * A task as a list holds it. A write answers the task in full, and the store
 * keeps it without the texts: held with them, the next slim read of the same
 * task would differ by two fields and glow as a change nobody made (LAI-708).
 *
 * The same object when there is nothing to drop, so an unchanged card keeps it.
 */
export function toSummary(task: TaskSummary | Task): TaskSummary {
  if (!SLIM_OMITS.some((field) => field in task)) return task;
  const { description_md: _description, acceptance_md: _acceptance, ...summary } = task as Task;
  return summary;
}

/**
 * The §6.3 page envelope. The array is **`data`**, not `items`.
 *
 * Worth a comment because getting it wrong is silent: a client reading `items`
 * finds `undefined`, renders an empty board, and looks exactly like a project
 * with no tasks. Caught against a live server, not in review.
 */
export interface Page<T> {
  readonly data: readonly T[];
  readonly next_cursor: string | null;
}

export interface TaskFilter {
  readonly status?: TaskStatus | undefined;
  /** One project status, where `status` is its whole category (LAI-738). */
  readonly status_id?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  /** A user id, or the literal `none` for unassigned. */
  readonly assignee?: string | undefined;
  readonly ready?: boolean | undefined;
  /**
   * A sprint id, or the literal `none` for tasks in no sprint.
   *
   * The server has accepted this since LAI-011 (`c.req.query('sprint')` in
   * `http/routes/tasks.ts`); the client type simply never declared it, so the
   * board could not scope to a sprint even though the API could.
   */
  readonly sprint?: string | undefined;
  /**
   * A tag name. The server has accepted `?tag=` since LAI-079. **The board no
   * longer sends it**: since LAI-724 it holds the project's whole task set and
   * applies this filter in memory (`task-filter.ts`), meaning what the
   * server's `?tag=` means.
   */
  readonly tag?: string | undefined;
  /**
   * Unix ms, inclusive: only tasks changed at or after it (SPEC §6.3). The
   * server has always accepted it; the client declares it for the board's
   * *Updated within* filter (LAI-487).
   */
  readonly updated_since?: number | undefined;
  /** A task id: only its subtasks (§6.4, D-066). */
  readonly parent?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function toQuery(filter: TaskFilter): string {
  // Every list the app reads is slim (LAI-795): the store's walk and its live
  // refresh, the Timeline's sprints, a panel's subtasks.
  const params = new URLSearchParams({ fields: 'slim' });
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.status_id !== undefined) params.set('status_id', filter.status_id);
  if (filter.priority !== undefined) params.set('priority', filter.priority);
  if (filter.assignee !== undefined) params.set('assignee', filter.assignee);
  if (filter.ready !== undefined) params.set('ready', String(filter.ready));
  if (filter.sprint !== undefined) params.set('sprint', filter.sprint);
  if (filter.tag !== undefined) params.set('tag', filter.tag);
  if (filter.updated_since !== undefined) params.set('updated_since', String(filter.updated_since));
  if (filter.parent !== undefined) params.set('parent', filter.parent);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.cursor !== undefined) params.set('cursor', filter.cursor);

  return `?${params.toString()}`;
}

/** A page of the project's tasks, without their texts — {@link TaskSummary}. */
export function listTasks(
  slug: string,
  filter: TaskFilter = {},
  signal?: AbortSignal,
): Promise<Page<TaskSummary>> {
  return request<Page<TaskSummary>>(
    `/projects/${encodeURIComponent(slug)}/tasks${toQuery(filter)}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * What the everyone's-work list takes (`GET /tasks`, LAI-887): the four
 * filters the server accepts there and nothing else — it answers `422` to
 * `priority`, `tag` or `ready` rather than ignoring them.
 */
export interface AllTasksFilter {
  /** A project slug: only that space's tasks. */
  readonly project?: string | undefined;
  readonly status?: TaskStatus | undefined;
  /** A user id, or the literal `none` for unassigned. */
  readonly assignee?: string | undefined;
  /** A sprint id, or the literal `none` for tasks in no sprint. */
  readonly sprint?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/**
 * A page of tasks from **every project the caller may read** (LAI-887,
 * LAI-952), slim, in the per-project list's order. Which projects those are is
 * the server's answer; the client never widens or narrows it.
 */
export function listAllTasks(
  filter: AllTasksFilter = {},
  signal?: AbortSignal,
): Promise<Page<TaskSummary>> {
  const params = new URLSearchParams({ fields: 'slim' });
  setAllTasksFilters(params, filter);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
  return request<Page<TaskSummary>>(
    `/tasks?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/** The four filters `GET /tasks` and `GET /tasks/summary` share. */
function setAllTasksFilters(params: URLSearchParams, filter: AllTasksFilter): void {
  if (filter.project !== undefined) params.set('project', filter.project);
  if (filter.status !== undefined) params.set('status', filter.status);
  if (filter.assignee !== undefined) params.set('assignee', filter.assignee);
  if (filter.sprint !== undefined) params.set('sprint', filter.sprint);
}

/**
 * One share of the counted work, ranked by the server: `user_id` null is
 * nobody's, and a final `others` entry holds everyone past the top ten.
 */
export interface TasksSummaryAssignee {
  readonly user_id: string | null;
  readonly name: string;
  readonly count: number;
}

/** The figures for everyone's work under a filter (LAI-974). */
export interface TasksSummary {
  readonly total: number;
  readonly by_status: Readonly<Record<TaskStatus, number>>;
  readonly by_assignee: readonly TasksSummaryAssignee[];
  readonly overdue: number;
  readonly blocked: number;
  readonly unassigned: number;
}

/**
 * Counts over the same tasks `listAllTasks` pages through (LAI-974, LAI-975),
 * so the Work page's figures are the server's and never a sum of rows the
 * client happens to hold.
 */
export function getTasksSummary(
  filter: Omit<AllTasksFilter, 'limit' | 'cursor'> = {},
  signal?: AbortSignal,
): Promise<TasksSummary> {
  const params = new URLSearchParams();
  setAllTasksFilters(params, filter);
  const query = params.toString();
  return request<TasksSummary>(
    `/tasks/summary${query === '' ? '' : `?${query}`}`,
    signal === undefined ? {} : { signal },
  );
}

export interface CreateTaskInput {
  readonly title: string;
  readonly priority?: TaskPriority | undefined;
  readonly status?: TaskStatus | undefined;
  /** A specific project status — a column — rather than a category. */
  readonly status_id?: string | undefined;
  /** Files it as a subtask of that task (D-066). */
  readonly parent_task_id?: string | undefined;
}

/**
 * Create a task (SPEC §6.4, LAI-011 — first reachable from the UI in LAI-065).
 *
 * `created_via` is sent explicitly as `web`. The server defaults it, but §9
 * attributes activity by it and a task made in the browser that claims to have
 * come from an agent is a lie in the audit trail. Saying so costs one field.
 *
 * The body is strict — an unrecognised key is `unprocessable`, not ignored — so
 * only fields the form actually collects are sent.
 */
export function createTask(slug: string, input: CreateTaskInput): Promise<Task> {
  return request<Task>(`/projects/${encodeURIComponent(slug)}/tasks`, {
    method: 'POST',
    body: {
      title: input.title,
      created_via: 'web',
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.status_id === undefined ? {} : { status_id: input.status_id }),
      ...(input.parent_task_id === undefined ? {} : { parent_task_id: input.parent_task_id }),
    },
  });
}

/**
 * Assign a task, or clear it.
 *
 * `null` unassigns — the ordinary state, not an error. `PATCH` distinguishes
 * "leave it alone" (absent) from "clear it" (`null`), which is why this always
 * sends the key.
 */
/**
 * One task by id (§6.4).
 *
 * Capacity serves `in_progress_tasks` and `tasks_in_review` as **ids** — ULIDs,
 * not keys — and a screen answering *"who takes the next task"* cannot show
 * `01M1EN3K…`. Resolving a reference is not deriving a figure, so this stays
 * inside LAI-439's "every number comes from a response".
 *
 * **It was visibly slow** — a request per id, 133 on one Capacity load — and
 * this said the answer was a bulk endpoint rather than a client cache. The
 * owner chose the cache (D-075): Capacity now resolves ids from the project's
 * one task set (`task-store.ts`) and calls this only for tasks in other
 * projects. The bulk answer — capacity sending key and title beside each id —
 * is still the way to retire those too.
 */
export function getTask(taskId: string, signal?: AbortSignal): Promise<Task> {
  return request<Task>(
    `/tasks/${encodeURIComponent(taskId)}`,
    signal === undefined ? {} : { signal },
  );
}

export function assignTask(taskId: string, assigneeId: string | null): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: { assignee_id: assigneeId },
  });
}

/**
 * Claim a task for yourself.
 *
 * A separate endpoint from `assignTask` because the server does a
 * **compare-and-swap** here: it only writes where `assignee_id IS NULL`, and
 * answers `409` with the winner's id in `details.assignee_id` when someone got
 * there first. The client must not re-implement that race — it sends the
 * request and renders whichever answer comes back.
 */
export function claimTask(taskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST' });
}

/** Who won a claim we lost, if the server said. */
export function claimWinner(cause: unknown): string | undefined {
  if (!(cause instanceof ApiError) || cause.code !== 'conflict') return undefined;
  const details: unknown = cause.details;
  if (typeof details !== 'object' || details === null) return undefined;
  const id = (details as { readonly assignee_id?: unknown }).assignee_id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Move a task between columns.
 *
 * The server validates the transition (§5) and answers `422` when it is illegal.
 * That rejection is the whole reason the board does not move the card until this
 * resolves — see `use-board.ts`.
 */
/**
 * Move one card in its project's manual order (§6.4, LAI-472, D-070).
 *
 * Addressed by **neighbours**, never an index: `after_task_id` is the card it
 * lands directly below, `before_task_id` the card directly above. The server
 * computes the key and writes one row; `409` means the order changed under the
 * drag, and the board reloads rather than guessing.
 */
export function reorderTask(
  taskId: string,
  to: { readonly after_task_id?: string | undefined; readonly before_task_id?: string | undefined },
): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/reorder`, {
    method: 'POST',
    body: {
      ...(to.after_task_id === undefined ? {} : { after_task_id: to.after_task_id }),
      ...(to.before_task_id === undefined ? {} : { before_task_id: to.before_task_id }),
    },
  });
}

/**
 * Where a status change sends a task (LAI-738): a **specific** project status
 * — a board column — or a whole category, which the server files under that
 * category's first status. The board and every picker send `status_id`; the
 * category form is for callers that only know the kind.
 */
export type StatusTarget = { readonly status_id: string } | { readonly status: TaskStatus };

export function changeStatus(taskId: string, to: StatusTarget): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: to,
  });
}

export interface ProjectSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export function listProjects(signal?: AbortSignal): Promise<Page<ProjectSummary>> {
  return request<Page<ProjectSummary>>('/projects', signal === undefined ? {} : { signal });
}

export interface Member {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly created_at: number;
}

/**
 * Members come back as `{ members: [...] }` — **not** the `{ data, next_cursor }`
 * page envelope every other list uses.
 *
 * Typed as a page originally, which read `.data`, got `undefined`, and left the
 * member map empty — so every name on the board and in the detail panel
 * degraded silently to a raw ULID. Same class of failure as the `items` vs
 * `data` bug in LAI-049: a wrong envelope does not throw, it just renders
 * something almost right.
 */
export interface MemberList {
  readonly members: readonly Member[];
}

export function listMembers(slug: string, signal?: AbortSignal): Promise<MemberList> {
  return request<MemberList>(
    `/projects/${encodeURIComponent(slug)}/members`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Edit a task's own fields (`PATCH /tasks/:id`, LAI-284).
 *
 * **`status` is not among them.** §6.4's `PATCH` refuses it `422`; moving a task
 * is `changeStatus`, because the server validates the transition and a `PATCH`
 * that quietly accepted one would skip that. The type says so rather than a
 * comment, so a caller that tries cannot compile.
 *
 * Unknown fields are `422` too, so this sends only what it is given — never a
 * whole task object with the unchanged fields along for the ride.
 */
export interface TaskEdit {
  readonly title?: string;
  readonly description_md?: string;
  readonly acceptance_md?: string;
  readonly priority?: TaskPriority;
  readonly assignee_id?: string | null;
  readonly sprint_id?: string | null;
  /** `null` detaches it from its parent; a string re-parents it (D-066). */
  readonly parent_task_id?: string | null;
  /** `null` clears; unix-ms at a UTC midnight sets (`api/date-only.ts`). */
  readonly due_on?: number | null;
  readonly planned_start?: number | null;
  /** An outside id (LAI-780); the server upper-cases it. `null` clears it. */
  readonly external_ref?: string | null;
  /**
   * The agent to send a work request to (LAI-535); `null` withdraws it. Only
   * the caller's own, active agent granted `full` here is accepted — anything
   * else is `422` with `details.reason` (`selected-agent.ts`).
   */
  readonly selected_agent_id?: string | null;
}

/**
 * An outside id's shape (LAI-780): a prefix of 1–16 letters, digits and `_`
 * that starts with a letter, a dash, and 1–9 digits. The server's
 * `OUTSIDE_ID_PATTERN`, character for character — `tasks.test.ts` reads it
 * and fails if they drift. A pull request's `owner/repo#N` never fits.
 */
export const OUTSIDE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;

export function isOutsideId(value: string): boolean {
  return OUTSIDE_ID_PATTERN.test(value.trim());
}

export function updateTask(taskId: string, edit: TaskEdit): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: edit });
}

/**
 * Watching (`PUT`/`DELETE /tasks/:id/watch`, §6.4).
 *
 * `PUT` rather than `POST` because watching is **idempotent state, not an
 * event**: pressing Watch twice leaves one row. Both answer `204`, so neither
 * returns the task — nothing about it changed, and a body would invite a caller
 * to diff something identical either way.
 */
export function watchTask(taskId: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}/watch`, { method: 'PUT' });
}

export function unwatchTask(taskId: string): Promise<void> {
  return request<void>(`/tasks/${encodeURIComponent(taskId)}/watch`, { method: 'DELETE' });
}

/**
 * Who is watching — **user ids**, not people.
 *
 * The server returns ids and filters them to who can still read the task. Names
 * and roles come from the project's members, which the drawer already holds; a
 * second lookup here would be a second answer to "who is this".
 */
export interface WatcherList {
  readonly watchers: readonly string[];
}

export function listWatchers(taskId: string, signal?: AbortSignal): Promise<WatcherList> {
  return request<WatcherList>(
    `/tasks/${encodeURIComponent(taskId)}/watchers`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Dependencies (`POST`/`DELETE /tasks/:id/dependencies`, LAI-233).
 *
 * The field is `blocked_by_task_id` — **not** `depends_on`, which is what
 * LAI-407's fixture sent and what the route answered `422` for while nothing
 * looked. Named here once so no caller has to remember it.
 *
 * The server rejects a cycle and a self-reference; the client does not
 * pre-judge either, it sends and renders the answer.
 */
export function addDependency(taskId: string, blockedByTaskId: string): Promise<Task> {
  return request<Task>(`/tasks/${encodeURIComponent(taskId)}/dependencies`, {
    method: 'POST',
    body: { blocked_by_task_id: blockedByTaskId },
  });
}

export function removeDependency(taskId: string, blockedByTaskId: string): Promise<Task> {
  return request<Task>(
    `/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(blockedByTaskId)}`,
    { method: 'DELETE' },
  );
}
