import type { ActivityEvent } from '../../../api/activity.ts';
import type { AgentSession, RegisteredAgent } from '../../../api/agents.ts';
import { DAY_MS, dateLabelShort, isOverdue, startOfUtcDay } from '../../../api/date-only.ts';
import type { PersonHandoffView } from '../../../api/handoffs.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { taskHref } from '../my-day/task-link.ts';
import type { MineTask } from '../my-day/plate-derive.ts';

/**
 * What the Command Center shows (LAI-1202, proposal
 * `ia-command-center-proactive.md` §2), derived only from what the server
 * already sent: the reader's open tasks across every space, the review queue,
 * the hand-offs waiting on them, their own agents and the organisation feed.
 *
 * **No figure the server did not send.** Overdue is `isOverdue` — the board's
 * own rule (`date-only.ts`); blocked is "a blocker that is not finished", the
 * rule *On your plate* reads (`plate-derive.ts`); connection is the server's
 * `connection` word, never a clock the client runs on its own.
 *
 * **Every count is a link** to the place that lists the same set, or as close
 * to it as an address can say (`listHref`).
 */

export type Tone = 'ok' | 'bad' | 'wait';

/** One actionable row. `href` is where it opens — a task, the review dialog. */
export interface HomeRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly href: string;
  /** A short fact beside it: `Due 3 Nov`, `CI failed`, `Waiting on LAI-3`. */
  readonly note?: string | undefined;
  readonly tone?: Tone | undefined;
  /** The space's name, when the page spans several. */
  readonly space?: string | undefined;
}

/** A group of rows and the link its count opens. */
export interface HomeGroup {
  readonly rows: readonly HomeRow[];
  /** How many there are — `rows` may be capped for the page. */
  readonly count: number;
  /** The server stopped short, so `count` is a floor. */
  readonly floor?: boolean | undefined;
  readonly href: string;
}

/** At most this many rows a group: a page to start from, not a second inbox. */
export const HOME_CAP = 5;
/** The window *Coming up* looks ahead, in days. */
export const COMING_UP_DAYS = 7;

const finished = (status: string): boolean => status === 'done' || status === 'cancelled';

/** The first `cap` rows. */
export function cap<T>(rows: readonly T[], most: number = HOME_CAP): readonly T[] {
  return rows.slice(0, most);
}

/* -------------------------------------------------------------- the links */

/** A space's slug and name, as the page knows them. */
export interface SpaceRef {
  readonly slug: string;
  readonly name: string;
}

/**
 * Where a group's count leads: **one space** — the List of that space,
 * filtered to the reader and whatever else the group means (`overdue`,
 * `blocked`, which the List reads, `filter-keys.ts`); **several** — the
 * Organisation page's Work tab, filtered to the reader, which spans every
 * space but has no overdue or blocked filter (a server gap, noted in the
 * task log).
 */
export function listHref(
  slugs: readonly string[],
  meId: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  const spaces = [...new Set(slugs)];
  if (spaces.length === 1) {
    const params = new URLSearchParams({ project: spaces[0] ?? '', assignee: meId, ...extra });
    return `/list?${params.toString()}`;
  }
  return `/organisation?${new URLSearchParams({ tab: 'work', person: meId }).toString()}`;
}

/** The review queue, on the reader's own view. */
export const REVIEW_HREF = '/inbox?tab=review';
/** Review's hand-off view: *Needs your approval* heads it. */
export const HANDOFFS_HREF = '/inbox?tab=review&view=handoffs';
/** Where the reader's agents are managed. */
export const AGENTS_HREF = '/developer';

/** The review dialog, open on one item (LAI-1169's `?item=`). */
export function reviewItemHref(taskId: string): string {
  return `${REVIEW_HREF}&item=${encodeURIComponent(taskId)}`;
}

/* -------------------------------------------------------- needs attention */

export interface Attention {
  /** What waits on the reader's decision; `undefined` while the queue is unread. */
  readonly review: HomeGroup | undefined;
  /** Hand-offs waiting on their approval; `undefined` while unread. */
  readonly handoffs: HomeGroup | undefined;
  /** Their own open work past its due date; `undefined` while unread or refused. */
  readonly overdue: HomeGroup | undefined;
}

function ciNote(item: ReviewQueueItem): Pick<HomeRow, 'note' | 'tone'> {
  const ci = item.round?.ci;
  if (ci === null || ci === undefined || ci.total === 0) return {};
  if (ci.failed > 0) return { note: 'CI failed', tone: 'bad' };
  if (ci.pending > 0) return { note: 'CI pending', tone: 'wait' };
  return { note: 'CI passed', tone: 'ok' };
}

/** The review rows the reader may decide, oldest first, each opening the dialog. */
export function reviewGroup(queue: readonly ReviewQueueItem[], capped: boolean): HomeGroup {
  const mine = queue
    .filter((item) => item.can_decide)
    .sort((a, b) => a.waiting_since - b.waiting_since);
  return {
    rows: cap(mine).map((item) => ({
      id: item.task.id,
      key: item.task.key,
      title: item.task.title,
      href: reviewItemHref(item.task.id),
      space: item.project.name,
      ...ciNote(item),
    })),
    count: mine.length,
    floor: capped,
    href: REVIEW_HREF,
  };
}

/** Hand-offs waiting on the reader, each opening its task (and its hand-off). */
export function handoffGroup(rows: readonly PersonHandoffView[], waiting: number): HomeGroup {
  return {
    rows: cap(rows).map((row) => ({
      id: row.id,
      key: row.task_key,
      title: row.task_title,
      href: taskHref({ id: row.task_id, key: row.task_key }, row.project_slug),
      note: row.kind === 'recovery' ? 'Recovery to approve' : 'Hand-off to approve',
      tone: 'wait' as const,
    })),
    // The server's own count, which knows past the page.
    count: Math.max(waiting, rows.length),
    href: HANDOFFS_HREF,
  };
}

function spaceName(slug: string, spaces: ReadonlyMap<string, SpaceRef>): string {
  return spaces.get(slug)?.name ?? slug;
}

function taskRow(
  { task, slug }: MineTask,
  spaces: ReadonlyMap<string, SpaceRef>,
  note?: string,
  tone?: Tone,
): HomeRow {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    href: taskHref(task, slug),
    space: spaceName(slug, spaces),
    note,
    tone,
  };
}

/** The reader's own open work past its due date, the most overdue first. */
export function overdueGroup(
  mine: readonly MineTask[],
  meId: string,
  now: number,
  spaces: ReadonlyMap<string, SpaceRef>,
): HomeGroup {
  const late = mine
    .filter(({ task }) => isOverdue(task, now))
    .sort((a, b) => (a.task.due_on ?? 0) - (b.task.due_on ?? 0));
  return {
    rows: cap(late).map((m) =>
      taskRow(m, spaces, `Due ${dateLabelShort(m.task.due_on ?? 0)}`, 'bad'),
    ),
    count: late.length,
    href: listHref(
      late.map((m) => m.slug),
      meId,
      { overdue: 'true' },
    ),
  };
}

/** Nothing in any group: the section says so in one line. */
export function attentionEmpty(attention: Attention): boolean {
  return (
    (attention.review?.count ?? 0) === 0 &&
    (attention.handoffs?.count ?? 0) === 0 &&
    (attention.overdue?.count ?? 0) === 0
  );
}

/* ------------------------------------------------------------ blocked */

/** What is known of a task holding one of the reader's up. */
export interface BlockerInfo {
  readonly key: string;
  readonly status: string;
  /** Its assignee's name, `null` for nobody, `undefined` when not known. */
  readonly owner?: string | null | undefined;
}

/**
 * The blockers still holding a task: those not finished, and those the reader
 * could not read (`undefined` — it still blocks, unnamed).
 */
export function holding(
  task: TaskSummary,
  blockers: ReadonlyMap<string, BlockerInfo>,
): readonly (BlockerInfo | undefined)[] {
  return task.blocked_by
    .map((id) => blockers.get(id))
    .filter((b) => b === undefined || !finished(b.status));
}

/** `LAI-3 (Sam Okafor)`, `LAI-3 (unassigned)`, `a task you can't open`. */
export function blockerLabel(blocker: BlockerInfo | undefined): string {
  if (blocker === undefined) return 'a task you can’t open';
  if (blocker.owner === undefined) return blocker.key;
  return `${blocker.key} (${blocker.owner ?? 'unassigned'})`;
}

/** The reader's open tasks with a blocker not yet finished, naming it and its owner. */
export function blockedGroup(
  mine: readonly MineTask[],
  blockers: ReadonlyMap<string, BlockerInfo>,
  meId: string,
  spaces: ReadonlyMap<string, SpaceRef>,
): HomeGroup {
  const held = mine
    .filter(({ task }) => !finished(task.status) && holding(task, blockers).length > 0)
    .sort((a, b) => b.task.updated_at - a.task.updated_at);
  return {
    rows: cap(held).map((m) =>
      taskRow(
        m,
        spaces,
        `Waiting on ${holding(m.task, blockers).map(blockerLabel).join(', ')}`,
        'bad',
      ),
    ),
    count: held.length,
    href: listHref(
      held.map((m) => m.slug),
      meId,
      { blocked: 'true' },
    ),
  };
}

/** Ids of blockers to look up: every one of an open task that is not the reader's own. */
export function blockerIdsOf(mine: readonly MineTask[]): readonly string[] {
  const own = new Set(mine.map((m) => m.task.id));
  const ids = new Set<string>();
  for (const { task } of mine) {
    if (finished(task.status)) continue;
    for (const id of task.blocked_by) if (!own.has(id)) ids.add(id);
  }
  return [...ids];
}

/* -------------------------------------------------------- active work */

/** Words for a live claim, as the server reported it. */
export function claimNote(task: TaskSummary): Pick<HomeRow, 'note' | 'tone'> {
  const claim = task.claim;
  if (claim === null || claim === undefined) return {};
  if (claim.connection === 'suspect') return { note: 'Connection lost', tone: 'bad' };
  if (claim.state === 'paused') return { note: 'Agent paused', tone: 'wait' };
  return { note: 'Agent working', tone: 'ok' };
}

/**
 * The reader's work: in progress first, then up next (`todo`), each newest
 * first. A blocked task is not here — it is under *Blocked*, as *On your
 * plate* draws it.
 */
export function activeGroup(
  mine: readonly MineTask[],
  blockers: ReadonlyMap<string, BlockerInfo>,
  meId: string,
  spaces: ReadonlyMap<string, SpaceRef>,
): HomeGroup {
  const rank = (status: string): number => (status === 'in_progress' ? 0 : 1);
  const active = mine
    .filter(
      ({ task }) =>
        (task.status === 'in_progress' || task.status === 'todo') &&
        holding(task, blockers).length === 0,
    )
    .sort(
      (a, b) => rank(a.task.status) - rank(b.task.status) || b.task.updated_at - a.task.updated_at,
    );
  return {
    rows: cap(active).map((m) => {
      const claim = claimNote(m.task);
      return {
        ...taskRow(m, spaces, claim.note ?? m.task.status_name, claim.tone),
      };
    }),
    count: active.length,
    href: listHref(
      active.map((m) => m.slug),
      meId,
    ),
  };
}

/* ---------------------------------------------------------- coming up */

/**
 * Open work due from today through the next {@link COMING_UP_DAYS} days,
 * soonest first. **A client-side filter** of the reader's own open tasks,
 * which the page already read: `GET /tasks` has no due-date filter (a server
 * gap). Overdue work is not here — it is under *Needs your attention*.
 */
export function comingUpGroup(
  mine: readonly MineTask[],
  meId: string,
  now: number,
  spaces: ReadonlyMap<string, SpaceRef>,
): HomeGroup {
  const today = startOfUtcDay(now);
  const end = today + (COMING_UP_DAYS + 1) * DAY_MS;
  const soon = mine
    .filter(
      ({ task }) =>
        task.due_on !== null && !finished(task.status) && task.due_on >= today && task.due_on < end,
    )
    .sort((a, b) => (a.task.due_on ?? 0) - (b.task.due_on ?? 0));
  const slugs = [...new Set(soon.map((m) => m.slug))];
  return {
    rows: cap(soon).map((m) =>
      taskRow(
        m,
        spaces,
        m.task.due_on === today ? 'Due today' : `Due ${dateLabelShort(m.task.due_on ?? 0)}`,
        m.task.due_on === today ? 'wait' : undefined,
      ),
    ),
    count: soon.length,
    // One space: its Calendar, which draws due dates. Several: the Work tab.
    href:
      slugs.length === 1
        ? `/calendar?${new URLSearchParams({ project: slugs[0] ?? '' }).toString()}`
        : listHref(slugs, meId),
  };
}

/* ------------------------------------------------------------- agents */

export type Connection = 'live' | 'lost' | 'ended' | 'none' | 'unknown';

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly harness: string;
  readonly connection: Connection;
  /** The words for `connection`, from the server's own fields only. */
  readonly label: string;
  /** What it holds among the reader's tasks, each opening the task. */
  readonly claims: readonly HomeRow[];
}

const CONNECTION_WORDS: Readonly<Record<Exclude<Connection, 'unknown'>, string>> = {
  live: 'Connected',
  lost: 'Connection lost',
  ended: 'Session ended',
  none: 'No session yet',
};

/**
 * An agent's connection, from its newest session as `GET /agents/:id` sent it
 * (`connection`: `live`, `suspect`, `ended`). **Connection lost only from a
 * `suspect` session** — a heartbeat the server found too old — never from a
 * clock here. `undefined` sessions (the detail read failed) is `unknown`.
 */
export function connectionOf(sessions: readonly AgentSession[] | undefined): Connection {
  if (sessions === undefined) return 'unknown';
  const newest = sessions[0];
  if (newest === undefined) return 'none';
  if (newest.ended_at !== null || newest.connection === 'ended') return 'ended';
  return newest.connection === 'suspect' ? 'lost' : 'live';
}

/** The reader's active agents, each with its connection and its claims on their tasks. */
export function agentRows(
  agents: readonly RegisteredAgent[],
  sessions: ReadonlyMap<string, readonly AgentSession[]>,
  mine: readonly MineTask[],
  spaces: ReadonlyMap<string, SpaceRef>,
): readonly AgentRow[] {
  return agents
    .filter((agent) => agent.status === 'active')
    .map((agent) => {
      const connection = connectionOf(sessions.get(agent.id));
      const claims = mine
        .filter(({ task }) => task.claim?.agent_id === agent.id)
        .map((m) => {
          const claim = claimNote(m.task);
          return taskRow(m, spaces, claim.note, claim.tone);
        });
      return {
        id: agent.id,
        name: agent.display_name,
        harness: agent.harness,
        connection,
        label: connection === 'unknown' ? 'Connection not known' : CONNECTION_WORDS[connection],
        claims,
      };
    });
}

/* ----------------------------------------------------------- activity */

/** How many rows of the organisation feed the page shows. */
export const ACTIVITY_CAP = 8;

export interface ActivityRow {
  readonly event: ActivityEvent;
  /** The space's name, or `undefined` for an organisation row. */
  readonly space: string | undefined;
  /** Its task in its space, else the space's Activity tab, else nowhere. */
  readonly href: string | undefined;
}

/** The newest feed rows, each linking out to where it happened. */
export function activityRows(
  events: readonly ActivityEvent[],
  spacesById: ReadonlyMap<string, SpaceRef>,
): readonly ActivityRow[] {
  return events.slice(0, ACTIVITY_CAP).map((event) => {
    const space = event.project_id === null ? undefined : spacesById.get(event.project_id);
    const href =
      space === undefined
        ? undefined
        : event.task_id !== null
          ? taskHref({ id: event.task_id, key: '' }, space.slug)
          : `/activity?${new URLSearchParams({ project: space.slug }).toString()}`;
    return { event, space: space?.name, href };
  });
}
