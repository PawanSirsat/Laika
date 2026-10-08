import { isPriority, isTagName } from '../../../api/task-filter.ts';
import type { Task, TaskPriority } from '../../../api/tasks.ts';
import { blockedTasks } from './dashboard-derive.ts';

/**
 * What the Status overview and Work by person cards count (LAI-732).
 *
 * The owner: the range buttons changed the stat cards *"but not this section
 * in the status overview and the work by person section"*, and *"add more
 * filter in that … in compact popup"*.
 *
 * ## The range
 *
 * A card follows the dashboard's range by counting the tasks **updated** within
 * it — the rule of the "N updated" stat card, the default proposed to the
 * owner. "All time" applies no bound, so with no card filter a card counts
 * exactly what it did before. A card may say **All tasks** instead, ignoring
 * the range.
 *
 * ## The filters
 *
 * Each card reads its own URL parameters, under its own prefix, so a refresh
 * or a shared link keeps them and the two never collide: `so_` for Status
 * overview, `wp_` for Work by person. Every value is checked the way LAI-487
 * checks the board's — an invalid one is **ignored and not counted**: a
 * priority or label by the server's rules (`task-filter.ts`), a sprint or
 * member against the lists this project has. A sprint or member is not applied
 * until those lists are known, so a link never flashes an empty card.
 *
 * Pure, so `card-filters.test.ts` can try the range under every filter.
 */

export const STATUS_KEYS = {
  sprint: 'so_sprint',
  assignee: 'so_assignee',
  priority: 'so_priority',
  tag: 'so_tag',
  agent: 'so_agent',
  range: 'so_range',
} as const;

export const PEOPLE_KEYS = {
  sprint: 'wp_sprint',
  priority: 'wp_priority',
  tag: 'wp_tag',
  status: 'wp_status',
  range: 'wp_range',
} as const;

/** `?so_sprint=active`: whichever sprint is active, as the board opens on (LAI-713). */
export const ACTIVE_SPRINT = 'active';
/** `?so_assignee=none`: unassigned work, the board's own value. */
export const UNASSIGNED = 'none';
/** `?so_range=all`: ignore the dashboard's range. */
export const ALL_TASKS = 'all';
/** `?wp_status=all`: count done work beside open work. */
export const INCLUDE_DONE = 'all';

/** The lists a sprint or member value is checked against; absent while loading. */
export interface Known {
  readonly sprintIds?: ReadonlySet<string> | undefined;
  readonly memberIds?: ReadonlySet<string> | undefined;
}

/** The narrowing both cards share, plus the range choice. */
export interface CardScope {
  /** `active`, or a sprint id. */
  readonly sprint?: string | undefined;
  /** `none`, or a user id. */
  readonly assignee?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly tag?: string | undefined;
  readonly agentOnly?: boolean | undefined;
  /** Ignore the dashboard's range and count every task. */
  readonly allTasks: boolean;
}

export interface StatusCardFilter extends CardScope {
  readonly agentOnly: boolean;
}

export interface PeopleCardFilter extends CardScope {
  readonly includeDone: boolean;
}

function readSprint(raw: string | null, known: Known): string | undefined {
  if (raw === null) return undefined;
  if (raw === ACTIVE_SPRINT) return raw;
  return known.sprintIds?.has(raw) === true ? raw : undefined;
}

function readPriority(raw: string | null): TaskPriority | undefined {
  return raw !== null && isPriority(raw) ? raw : undefined;
}

function readTag(raw: string | null): string | undefined {
  return raw !== null && isTagName(raw) ? raw.trim().toLowerCase() : undefined;
}

export function readStatusCard(params: URLSearchParams, known: Known): StatusCardFilter {
  const assignee = params.get(STATUS_KEYS.assignee);
  return {
    sprint: readSprint(params.get(STATUS_KEYS.sprint), known),
    assignee:
      assignee === UNASSIGNED || (assignee !== null && known.memberIds?.has(assignee) === true)
        ? assignee
        : undefined,
    priority: readPriority(params.get(STATUS_KEYS.priority)),
    tag: readTag(params.get(STATUS_KEYS.tag)),
    agentOnly: params.get(STATUS_KEYS.agent) === 'true',
    allTasks: params.get(STATUS_KEYS.range) === ALL_TASKS,
  };
}

export function readPeopleCard(params: URLSearchParams, known: Known): PeopleCardFilter {
  return {
    sprint: readSprint(params.get(PEOPLE_KEYS.sprint), known),
    priority: readPriority(params.get(PEOPLE_KEYS.priority)),
    tag: readTag(params.get(PEOPLE_KEYS.tag)),
    includeDone: params.get(PEOPLE_KEYS.status) === INCLUDE_DONE,
    allTasks: params.get(PEOPLE_KEYS.range) === ALL_TASKS,
  };
}

const set = (value: unknown): number => (value === undefined || value === false ? 0 : 1);

/** The card icon's badge: every field not at its default. */
export function statusCardActive(f: StatusCardFilter): number {
  return (
    set(f.sprint) +
    set(f.assignee) +
    set(f.priority) +
    set(f.tag) +
    set(f.agentOnly) +
    set(f.allTasks)
  );
}

export function peopleCardActive(f: PeopleCardFilter): number {
  return set(f.sprint) + set(f.priority) + set(f.tag) + set(f.includeDone) + set(f.allTasks);
}

/** The dashboard's state a card reads besides its own filter. */
export interface CardContext {
  /** The dashboard range's lower bound (`updated_at`); `undefined` is All time. */
  readonly since: number | undefined;
  /** The sprint `active` means, or `undefined` when none is. */
  readonly activeSprintId: string | undefined;
}

/** Does the card count only tasks updated within the dashboard's range? */
export function rangeApplies(scope: CardScope, ctx: CardContext): boolean {
  return !scope.allTasks && ctx.since !== undefined;
}

/**
 * The tasks a card counts, in the set's order. With no filter and no range it
 * is the set itself, so the card is exactly what it was before LAI-732.
 */
export function cardTasks(
  all: readonly Task[],
  scope: CardScope,
  ctx: CardContext,
): readonly Task[] {
  const since = rangeApplies(scope, ctx) ? ctx.since : undefined;
  const sprint = scope.sprint === ACTIVE_SPRINT ? (ctx.activeSprintId ?? null) : scope.sprint;
  const assignee = scope.assignee === UNASSIGNED ? null : scope.assignee;
  const narrowed =
    since !== undefined ||
    scope.sprint !== undefined ||
    scope.assignee !== undefined ||
    scope.priority !== undefined ||
    scope.tag !== undefined ||
    scope.agentOnly === true;
  if (!narrowed) return all;

  return all.filter((task) => {
    if (since !== undefined && task.updated_at < since) return false;
    if (scope.sprint !== undefined) {
      // "Active" with no active sprint matches nothing — not every task.
      if (sprint === null || task.sprint_id !== sprint) return false;
    }
    if (scope.assignee !== undefined && task.assignee_id !== assignee) return false;
    if (scope.priority !== undefined && task.priority !== scope.priority) return false;
    if (scope.tag !== undefined && !task.tags.includes(scope.tag)) return false;
    if (scope.agentOnly === true && task.created_via !== 'mcp') return false;
    return true;
  });
}

/** Blocked tasks judged from the **whole project**, for Work by person's rows. */
export function blockedIdsOf(all: readonly Task[]): ReadonlySet<string> {
  return new Set(blockedTasks(all).map((row) => row.task.id));
}
