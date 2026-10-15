import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import { type AgentClient } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { readPayload } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  type OrgRole,
  type ProfileKind,
  type ProjectRole,
  TASK_STATUSES,
  type TaskStatus,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  activity,
  memberRatings,
  projectMemberships,
  projects,
  projectStatuses,
  tasks,
  tokens,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { percentile } from './metrics.ts';
import { agentPresenceFor, clientOf, type AgentPresence } from './presence.ts';

/**
 * The member profile: one person's work as the board recorded it, a label, and
 * a private rating (SPEC §6.4, §11.4.2, D-078, LAI-743).
 *
 * ## Who may ask
 *
 * An owner or admin, signed in to the web app — §3.1's three `profile.*` rows,
 * each `(session only)`. Every function here asserts its action **before** it
 * looks the person up, so a caller who may not ask learns nothing about
 * whether an id exists: `forbidden` either way, and only an admin is told
 * `not_found`. The same order `listTokensFor` keeps.
 *
 * An admin reads every project (implicit lead, §3), so nothing here narrows by
 * project: the profile is the whole board's record of one person.
 *
 * ## Facts, not a score
 *
 * Every figure is a count of something the board recorded, in a fixed window,
 * and none is combined into a rating (D-078: no automatic score in v1). No new
 * data is collected for it: tasks, the activity log, tokens and presence are
 * read as they already are.
 *
 * ## The kind changes what is shown, never what is allowed
 *
 * A `manager` profile carries no `current_work`, `delivery` or `agents` block,
 * and a `builder` profile no `queue` block — **absent, not empty**, the
 * convention `unlisted` and the org's `ai` block use — and that is all
 * `profile_kind` does. `can()` never reads it.
 *
 * ## Ratings stay here
 *
 * `member_ratings` is read and written by this module and nothing else, and a
 * rating writes no `activity` row — so no feed, SSE stream, export or MCP tool
 * can carry one. A test holds both properties structurally.
 */

/** Re-exported so the route validates `profile_kind` without importing `db/`. */
export { PROFILE_KINDS } from '../db/enums.ts';

/** The window every figure counts in: this week and the eleven before it. */
export const PROFILE_WINDOW_WEEKS = 12;

/** A rating's note, after trimming (§4.21). */
export const RATING_NOTE_MAX = 500;

/** How many of a person's review decisions the profile lists. */
const RECENT_DECISIONS = 10;

/** `review.last_30_days`: decisions in the thirty days to now (LAI-750). */
const RECENT_DAYS = 30;

/**
 * The most any of the profile's growing lists carries — ratings, open work,
 * agent tokens — each beside its total, so the page can say *"and N more"*
 * (LAI-746). A history that grows without bound is not a page.
 */
export const PROFILE_LIST_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Categories a task can be sent back to from review (§5): earlier ones. */
const BEFORE_REVIEW: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress'];

/** Categories a reopened task is back in: work again, not cancelled. */
const WORK_AGAIN: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];

/** Not finished and not abandoned. */
const OPEN: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];

export interface ProfileUser {
  id: string;
  name: string;
  email: string;
  org_role: OrgRole;
  is_active: boolean;
  profile_kind: ProfileKind;
  created_at: number;
}

export interface ProfileProject {
  id: string;
  slug: string;
  name: string;
  /** The project's display prefix, `LAI`. */
  key: string;
  /** Their membership role, or `null` when they have work there but no row. */
  role: ProjectRole | null;
  archived: boolean;
  /** Their tasks there that are neither done nor cancelled. */
  open_tasks: number;
  /** Their work accepted there in the window. */
  accepted: number;
  /** Review decisions they made there on other people's work, in the window. */
  reviewed: number;
}

export interface ProfileTask {
  id: string;
  key: string;
  title: string;
  project_slug: string;
  status: TaskStatus;
  status_name: string;
  started_at: number | null;
  /**
   * When a task in Review last entered it, by the queue's rule (LAI-751) — so
   * the profile can say how long it has waited and list the longest first.
   * Null for work in progress, and when the log cannot say.
   */
  review_since: number | null;
}

export interface WeekCount {
  /** Monday 00:00 UTC. */
  week_start: number;
  accepted: number;
}

export interface ProfileCycleTime {
  /** Done in the window, with a start to measure from. */
  measured: number;
  /** Done in the window with no `started_at` — counted, not measured. */
  unmeasured: number;
  /** `null` when nothing was measured — not a zero nobody took. */
  p50_ms: number | null;
  p75_ms: number | null;
}

export interface ProfileDelivery {
  /** Oldest first, one per week of the window, zeros included. */
  accepted_per_week: WeekCount[];
  accepted: number;
  sent_back: number;
  reopened: number;
  cycle_time: ProfileCycleTime;
}

export interface ReviewDecision {
  task_id: string;
  key: string;
  title: string;
  project_slug: string;
  decision: 'accepted' | 'sent_back';
  at: number;
  /** Null for a task nobody was assigned (LAI-751): deciding one is a decision too. */
  assignee: { id: string; name: string } | null;
}

/** One week of their review decisions on other people's work (LAI-750). */
export interface ReviewWeek {
  /** Monday 00:00 UTC. */
  week_start: number;
  accepted: number;
  sent_back: number;
}

/**
 * How long their decisions took, from the task's latest entry into Review to
 * the decision (LAI-750).
 */
export interface ProfileDecideTime {
  /** Decisions made out of Review, with that entry in the activity log. */
  measured: number;
  /**
   * Decisions with nothing to measure from — made from outside Review, or on a
   * task whose entry into Review the log does not hold. Counted, not measured.
   */
  unmeasured: number;
  /** `null` when nothing was measured — not a zero nobody took. */
  p50_ms: number | null;
}

export interface ProfileReview {
  accepted: number;
  sent_back: number;
  /** Decisions in the thirty days to now — a part of the window. */
  last_30_days: number;
  /** Oldest first, one per week of the window, zeros included (LAI-750). */
  per_week: ReviewWeek[];
  time_to_decide: ProfileDecideTime;
  /** Newest first, the most recent few. */
  recent: ReviewDecision[];
}

/** One project they lead, and how much waits there for a decision (LAI-750). */
export interface QueueProject {
  project_id: string;
  waiting: number;
}

/**
 * A manager's review queue now (LAI-750). **Managers only** — absent for a
 * builder, as the builder blocks are absent for a manager.
 */
export interface ProfileQueue {
  /** Projects they lead — membership role `lead` — that are not archived. */
  projects_led: number;
  /** Tasks in a Review-category status there that are not theirs — anyone else's or nobody's. */
  waiting: number;
  /**
   * When the longest-waiting of those entered Review, from the activity log;
   * `null` when nothing waits or no entry is recorded.
   */
  oldest_waiting_since: number | null;
  /** Each led project, alphabetical, with what waits in it — zeros included. */
  projects: QueueProject[];
}

export interface ProfileAgentToken {
  id: string;
  name: string;
  client: AgentClient;
  /** The client's own name from its last `initialize` (D-076), or null. */
  client_name: string | null;
  last_used_at: number | null;
  last_mcp_at: number | null;
  created_at: number;
}

/** Their board writes through one agent, in the window (LAI-750). */
export interface AgentWrites {
  client: AgentClient;
  writes: number;
}

export interface ProfileAgents {
  /**
   * Tokens still usable — not revoked, not expired — most recently used first;
   * at most `PROFILE_LIST_LIMIT`.
   */
  tokens: ProfileAgentToken[];
  /** All of them, however many `tokens` carries. */
  tokens_total: number;
  online: AgentPresence;
  /**
   * Their `activity` rows made through a token in the window, grouped by the
   * agent that token last connected as (D-076), most first (LAI-750). Revoked
   * tokens count: the writes happened. One entry per agent, so no cap.
   */
  writes: AgentWrites[];
  /** The sum of `writes`. */
  writes_total: number;
}

export interface RatingView {
  id: string;
  score: number;
  note: string;
  rated_by: { id: string; name: string };
  created_at: number;
}

/** The twelve weeks every figure counts in, Monday 00:00 UTC to `until`. */
export interface ProfileWindow {
  weeks: number;
  since: number;
  until: number;
}

/** Oldest start first, each list at most `PROFILE_LIST_LIMIT`, with its total. */
export interface ProfileCurrentWork {
  in_progress: ProfileTask[];
  in_progress_total: number;
  in_review: ProfileTask[];
  in_review_total: number;
}

export interface ProfileView {
  user: ProfileUser;
  window: ProfileWindow;
  projects: ProfileProject[];
  review: ProfileReview;
  /** Newest first, at most `PROFILE_LIST_LIMIT`; the first is the current one. */
  ratings: RatingView[];
  /** Every rating they have, however many `ratings` carries. */
  ratings_total: number;
  /** Builders only — absent for a manager. */
  current_work?: ProfileCurrentWork;
  /** Builders only — absent for a manager. */
  delivery?: ProfileDelivery;
  /** Builders only — absent for a manager. */
  agents?: ProfileAgents;
  /** Managers only — absent for a builder (LAI-750). */
  queue?: ProfileQueue;
}

export interface RateMemberInput {
  score: number;
  note: string;
  /**
   * The request's `Idempotency-Key`, when it sent one (§6.3, LAI-746). Kept on
   * the rating, so a retry answers from it instead of writing another.
   */
  idempotencyKey?: string | undefined;
}

/** A rating written — or, for a retried key, the one written before. */
export interface RatingWrite {
  rating: RatingView;
  /** True when this answer is the earlier write's, for `Idempotent-Replay`. */
  replayed: boolean;
}

type UserRow = typeof users.$inferSelect;
type ActivityRow = typeof activity.$inferSelect;

interface Move {
  from: TaskStatus;
  to: TaskStatus;
}

// ------------------------------------------------------------------ reading

export function getProfile(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): ProfileView {
  assertCan(actor, 'profile.read', { targetUserId: userId });
  const person = requireUser(db, userId);

  const since = windowStart(now);

  const theirTasks = loadTheirTasks(db, userId);
  const onTheirTasks = loadMovesOnTheirTasks(db, userId, since, now);
  const theirDecisions = loadDecisionsOnOthers(db, userId, since, now);

  const accepted = onTheirTasks.filter(
    (m) => isAcceptance(m.move) && m.actorId !== null && m.actorId !== userId,
  );

  const profile: ProfileView = {
    user: toUser(person),
    window: { weeks: PROFILE_WINDOW_WEEKS, since, until: now },
    projects: projectsFor(db, userId, theirTasks, accepted, theirDecisions),
    review: {
      accepted: theirDecisions.filter((d) => d.decision === 'accepted').length,
      sent_back: theirDecisions.filter((d) => d.decision === 'sent_back').length,
      last_30_days: theirDecisions.filter((d) => d.view.at >= now - RECENT_DAYS * DAY_MS).length,
      per_week: reviewPerWeek(theirDecisions, since),
      time_to_decide: timeToDecide(db, theirDecisions),
      recent: theirDecisions.slice(0, RECENT_DECISIONS).map((d) => d.view),
    },
    ratings: ratingsFor(db, userId),
    ratings_total: ratingCount(db, userId),
  };

  if (person.profileKind === 'manager') return { ...profile, queue: queueFor(db, userId) };

  return {
    ...profile,
    current_work: currentWork(db, theirTasks),
    delivery: {
      accepted_per_week: perWeek(accepted, since),
      accepted: accepted.length,
      sent_back: onTheirTasks.filter(
        (m) => isSendBack(m.move) && m.actorId !== null && m.actorId !== userId,
      ).length,
      reopened: onTheirTasks.filter((m) => isReopen(m.move)).length,
      cycle_time: cycleTime(theirTasks, since, now),
    },
    agents: {
      ...agentTokens(db, userId, now),
      online: agentPresenceFor(db, userId, now),
      ...agentWrites(db, userId, since, now),
    },
  };
}

/**
 * Their open work, each list capped beside its total (LAI-746): in progress
 * oldest start first, in Review longest waiting first — by when each last
 * entered Review, the queue's rule (LAI-751) — those the log cannot place last.
 */
function currentWork(db: Db, theirTasks: readonly TheirTask[]): ProfileCurrentWork {
  const inProgress = theirTasks.filter((x) => x.status === 'in_progress');
  const reviewing = theirTasks.filter((x) => x.status === 'review');
  const history = movesOn(
    db,
    reviewing.map((x) => x.id),
  );
  const inReview = reviewing
    .map((task) => ({ task, since: reviewEntry(history.get(task.id) ?? [], task.createdAt) }))
    .sort(
      (a, b) =>
        (a.since ?? Number.MAX_SAFE_INTEGER) - (b.since ?? Number.MAX_SAFE_INTEGER) ||
        a.task.prefix.localeCompare(b.task.prefix) ||
        a.task.number - b.task.number,
    );
  return {
    in_progress: inProgress.slice(0, PROFILE_LIST_LIMIT).map((task) => toProfileTask(task)),
    in_progress_total: inProgress.length,
    in_review: inReview
      .slice(0, PROFILE_LIST_LIMIT)
      .map(({ task, since }) => toProfileTask(task, since)),
    in_review_total: inReview.length,
  };
}

// ------------------------------------------------------------------ writing

/**
 * Set a member's profile kind (§4.1). Answers the whole profile, because the
 * kind changes which blocks it carries.
 *
 * **No `activity` row.** The kind is a label on a page only admins see, and it
 * grants nothing; a §4.8 verb for it would rebuild the append-only `activity`
 * table, which D-078's additive-only rule excludes. D-078 records the trade.
 *
 * **`updated_at` is left alone** (LAI-746). It is what `GET /users?
 * updated_since=` reads, and the kind is not in that list's shape: a bump
 * would hand every member's catch-up a row that looks unchanged — an
 * unexplained edit about a person, from a page they cannot see.
 */
export function setProfileKind(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  kind: ProfileKind,
  now: number = Date.now(),
): ProfileView {
  assertCan(actor, 'profile.set_kind', { targetUserId: userId });
  const person = requireUser(db, userId);

  if (person.profileKind !== kind) {
    db.update(users).set({ profileKind: kind }).where(eq(users.id, userId)).run();
  }

  return getProfile(db, actor, userId, now);
}

/**
 * Append a rating (§4.21). Never an edit: a new rating supersedes the last.
 *
 * The score and note are checked here as well as at the route and in the
 * database, so every caller of the service — not only HTTP — gets the §6.3
 * `unprocessable` rather than a constraint error.
 *
 * ## A retried key answers from the rating, after the permission (LAI-746)
 *
 * §6.3's store answers a keyed POST before the route runs and keeps the whole
 * response — here, the private note — in `idempotency_keys`, keyed by user
 * rather than credential. This route is left out of it
 * (`http/middleware/idempotency.ts`) and keeps the key on the rating instead.
 * So `profile.rate` is asked on every attempt — a token is refused, whatever
 * key it holds — and the note lives only in `member_ratings`.
 *
 * Keys are per rater and never expire: the row they point at never does
 * either. The same key with a different rating is §6.3's `conflict`.
 */
export function rateMember(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  input: RateMemberInput,
  now: number = Date.now(),
): RatingWrite {
  assertCan(actor, 'profile.rate', { targetUserId: userId });
  requireUser(db, userId);

  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    throw new ApiError('unprocessable', 'A rating is a whole number from 1 to 5', {
      score: input.score,
    });
  }

  const note = input.note.trim();
  if (note.length === 0 || note.length > RATING_NOTE_MAX) {
    throw new ApiError(
      'unprocessable',
      `A rating needs a note of 1 to ${String(RATING_NOTE_MAX)} characters`,
      { note_length: note.length },
    );
  }

  const key = input.idempotencyKey;
  if (key !== undefined) {
    const before = db
      .select()
      .from(memberRatings)
      .where(and(eq(memberRatings.ratedBy, actor.userId), eq(memberRatings.idempotencyKey, key)))
      .get();

    if (before !== undefined) {
      if (before.userId !== userId || before.score !== input.score || before.note !== note) {
        throw new ApiError(
          'conflict',
          'This Idempotency-Key was already used with a different request body',
          { idempotency_key: key },
        );
      }
      return { rating: ratingView(before, actor), replayed: true };
    }
  }

  const row = {
    id: newId(),
    userId,
    ratedBy: actor.userId,
    score: input.score,
    note,
    idempotencyKey: key ?? null,
    createdAt: now,
  };
  db.insert(memberRatings).values(row).run();

  return { rating: ratingView(row, actor), replayed: false };
}

/** A rating this actor wrote, as the wire shape. */
function ratingView(
  row: { id: string; score: number; note: string; createdAt: number },
  rater: ResolvedActor,
): RatingView {
  return {
    id: row.id,
    score: row.score,
    note: row.note,
    rated_by: { id: rater.userId, name: rater.name },
    created_at: row.createdAt,
  };
}

// ------------------------------------------------------------------ helpers

function requireUser(db: Db, userId: string): UserRow {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (row === undefined) throw ApiError.notFound(`No user with id "${userId}"`);
  return row;
}

function toUser(row: UserRow): ProfileUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    org_role: row.orgRole,
    is_active: row.isActive === 1,
    profile_kind: row.profileKind,
    created_at: row.createdAt.getTime(),
  };
}

/** Monday 00:00 UTC, eleven weeks before the week holding `now`. */
function windowStart(now: number): number {
  const day = new Date(now);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const monday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - sinceMonday);
  return monday - (PROFILE_WINDOW_WEEKS - 1) * WEEK_MS;
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * A `task.status_changed` row's categories, read through the module that owns
 * the payload's format. `from` and `to` are categories (D-077), so a move
 * between two statuses of one category is equal on both sides and none of the
 * three tests below matches it.
 */
function moveOf(row: ActivityRow): Move | null {
  const payload = readPayload(row);
  if (typeof payload !== 'object' || payload === null) return null;

  const { from, to } = payload as { from?: unknown; to?: unknown };
  return isStatus(from) && isStatus(to) ? { from, to } : null;
}

/** Into a Done-category status from any other (D-077). */
function isAcceptance(move: Move): boolean {
  return move.to === 'done' && move.from !== 'done';
}

/** Out of review to an earlier category. */
function isSendBack(move: Move): boolean {
  return move.from === 'review' && BEFORE_REVIEW.includes(move.to);
}

/** Out of done into work again — cancelling a done task is not a reopen. */
function isReopen(move: Move): boolean {
  return move.from === 'done' && WORK_AGAIN.includes(move.to);
}

interface TheirTask {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  statusName: string;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  projectId: string;
  projectSlug: string;
  prefix: string;
}

/** Every task assigned to them, in-progress work oldest start first. */
function loadTheirTasks(db: Db, userId: string): TheirTask[] {
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      statusName: projectStatuses.name,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectSlug: projects.slug,
      prefix: projects.prefix,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(projectStatuses, eq(projectStatuses.id, tasks.statusId))
    .where(eq(tasks.assigneeId, userId))
    .all()
    .sort(
      (a, b) =>
        (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER) ||
        a.prefix.localeCompare(b.prefix) ||
        a.number - b.number,
    );
}

function toProfileTask(task: TheirTask, reviewSince: number | null = null): ProfileTask {
  return {
    id: task.id,
    key: `${task.prefix}-${String(task.number)}`,
    title: task.title,
    project_slug: task.projectSlug,
    status: task.status,
    status_name: task.statusName,
    started_at: task.startedAt,
    review_since: reviewSince,
  };
}

interface MoveRow {
  move: Move;
  actorId: string | null;
  at: number;
  projectId: string;
}

/** Status changes on tasks assigned to them now, inside the window. */
function loadMovesOnTheirTasks(db: Db, userId: string, since: number, now: number): MoveRow[] {
  return db
    .select({ row: activity, projectId: tasks.projectId })
    .from(activity)
    .innerJoin(tasks, eq(tasks.id, activity.taskId))
    .where(
      and(
        eq(activity.type, 'task.status_changed'),
        eq(tasks.assigneeId, userId),
        gte(activity.createdAt, since),
        lte(activity.createdAt, now),
      ),
    )
    .all()
    .flatMap(({ row, projectId }) => {
      const move = moveOf(row);
      return move === null ? [] : [{ move, actorId: row.actorId, at: row.createdAt, projectId }];
    });
}

interface Decision {
  decision: 'accepted' | 'sent_back';
  projectId: string;
  /** The `activity` row the decision is, for {@link timeToDecide}. */
  activityId: string;
  /** When the task was created — its entry into Review if it was created there. */
  taskCreatedAt: number;
  /** The category it was decided from — only a decision out of Review is timed. */
  from: TaskStatus;
  view: ReviewDecision;
}

/**
 * Their review decisions on work that is not theirs in the window, newest
 * first: acceptances and send-backs they made on tasks assigned to another
 * person **or to nobody** (LAI-751). An unassigned task in Review waits in
 * their queue ({@link queueFor}), so deciding it is a decision — the two
 * agree, and the (i) says so.
 */
function loadDecisionsOnOthers(db: Db, userId: string, since: number, now: number): Decision[] {
  const rows = db
    .select({
      row: activity,
      taskId: tasks.id,
      number: tasks.number,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      taskCreatedAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectSlug: projects.slug,
      prefix: projects.prefix,
    })
    .from(activity)
    .innerJoin(tasks, eq(tasks.id, activity.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(activity.type, 'task.status_changed'),
        eq(activity.actorId, userId),
        or(isNull(tasks.assigneeId), ne(tasks.assigneeId, userId)),
        gte(activity.createdAt, since),
        lte(activity.createdAt, now),
      ),
    )
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .all();

  const assigneeIds = [...new Set(rows.map((r) => r.assigneeId).filter((id) => id !== null))];
  const nameOf = new Map(
    assigneeIds.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, assigneeIds))
          .all()
          .map((u) => [u.id, u.name]),
  );

  return rows.flatMap((r) => {
    const move = moveOf(r.row);
    if (move === null) return [];

    const decision = isAcceptance(move) ? 'accepted' : isSendBack(move) ? 'sent_back' : null;
    if (decision === null) return [];

    return [
      {
        decision,
        projectId: r.projectId,
        activityId: r.row.id,
        taskCreatedAt: r.taskCreatedAt,
        from: move.from,
        view: {
          task_id: r.taskId,
          key: `${r.prefix}-${String(r.number)}`,
          title: r.title,
          project_slug: r.projectSlug,
          decision,
          at: r.row.createdAt,
          assignee:
            r.assigneeId === null
              ? null
              : { id: r.assigneeId, name: nameOf.get(r.assigneeId) ?? '' },
        },
      },
    ];
  });
}

/**
 * Projects they work in: a membership, a task assigned to them, or a review
 * decision they made there in the window. Alphabetical.
 */
function projectsFor(
  db: Db,
  userId: string,
  theirTasks: readonly TheirTask[],
  accepted: readonly MoveRow[],
  decisions: readonly Decision[],
): ProfileProject[] {
  const roles = new Map(
    db
      .select({ projectId: projectMemberships.projectId, role: projectMemberships.role })
      .from(projectMemberships)
      .where(eq(projectMemberships.userId, userId))
      .all()
      .map((m) => [m.projectId, m.role]),
  );

  const ids = new Set<string>([
    ...roles.keys(),
    ...theirTasks.map((x) => x.projectId),
    ...decisions.map((d) => d.projectId),
  ]);
  if (ids.size === 0) return [];

  return db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      prefix: projects.prefix,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(inArray(projects.id, [...ids]))
    .all()
    .map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      key: project.prefix,
      role: roles.get(project.id) ?? null,
      archived: project.archivedAt !== null,
      open_tasks: theirTasks.filter((x) => x.projectId === project.id && OPEN.includes(x.status))
        .length,
      accepted: accepted.filter((m) => m.projectId === project.id).length,
      reviewed: decisions.filter((d) => d.projectId === project.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

/** One bucket per week of the window, oldest first, zeros included. */
function perWeek(accepted: readonly MoveRow[], since: number): WeekCount[] {
  const weeks = Array.from({ length: PROFILE_WINDOW_WEEKS }, (_, i) => ({
    week_start: since + i * WEEK_MS,
    accepted: 0,
  }));

  for (const move of accepted) {
    const week = weeks[Math.floor((move.at - since) / WEEK_MS)];
    if (week !== undefined) week.accepted += 1;
  }

  return weeks;
}

/** Their decisions per week of the window, oldest first, zeros included. */
function reviewPerWeek(decisions: readonly Decision[], since: number): ReviewWeek[] {
  const weeks = Array.from({ length: PROFILE_WINDOW_WEEKS }, (_, i) => ({
    week_start: since + i * WEEK_MS,
    accepted: 0,
    sent_back: 0,
  }));

  for (const d of decisions) {
    const week = weeks[Math.floor((d.view.at - since) / WEEK_MS)];
    if (week !== undefined) week[d.decision] += 1;
  }

  return weeks;
}

/** A move into Review from another category — one between two Review statuses is not. */
function entersReview(move: Move): boolean {
  return move.to === 'review' && move.from !== 'review';
}

/**
 * When a task last entered Review, from its status changes **before** the
 * moment asked about, oldest first (LAI-750, LAI-751): the latest move into
 * Review from another category — or, when every logged move before then
 * stays inside Review (none at all included), its creation, because a task
 * with no move out of somewhere else was created in Review. `null` only when
 * the log cannot say: it shows the task elsewhere and never coming back.
 */
function reviewEntry(
  before: readonly { at: number; move: Move }[],
  createdAt: number,
): number | null {
  const entry = before.filter((m) => entersReview(m.move)).at(-1);
  if (entry !== undefined) return entry.at;
  return before.every((m) => m.move.from === 'review') ? createdAt : null;
}

/**
 * Each task's status changes, oldest first, for the tasks named — the history
 * {@link timeToDecide} and {@link queueFor} read entries into Review from.
 */
function movesOn(
  db: Db,
  taskIds: readonly string[],
): Map<string, { id: string; at: number; move: Move }[]> {
  const byTask = new Map<string, { id: string; at: number; move: Move }[]>();
  if (taskIds.length === 0) return byTask;

  const rows = db
    .select()
    .from(activity)
    .where(and(eq(activity.type, 'task.status_changed'), inArray(activity.taskId, [...taskIds])))
    .orderBy(asc(activity.createdAt), asc(activity.id))
    .all();

  for (const row of rows) {
    const move = moveOf(row);
    if (move === null || row.taskId === null) continue;
    const list = byTask.get(row.taskId) ?? [];
    list.push({ id: row.id, at: row.createdAt, move });
    byTask.set(row.taskId, list);
  }
  return byTask;
}

/**
 * The median time from a task's latest entry into Review to their decision on
 * it (LAI-750), the entry read by {@link reviewEntry} — so a task created
 * straight into Review is timed from its creation (LAI-751). Only a decision
 * made **out of** Review has a wait to measure; one made from anywhere else is
 * counted as unmeasured, never as zero.
 */
function timeToDecide(db: Db, decisions: readonly Decision[]): ProfileDecideTime {
  const history = movesOn(db, [...new Set(decisions.map((d) => d.view.task_id))]);

  const waits: number[] = [];
  for (const d of decisions) {
    if (d.from !== 'review') continue;
    const moves = history.get(d.view.task_id) ?? [];
    const at = moves.findIndex((m) => m.id === d.activityId);
    const entry = reviewEntry(moves.slice(0, Math.max(at, 0)), d.taskCreatedAt);
    if (entry !== null) waits.push(d.view.at - entry);
  }
  waits.sort((a, b) => a - b);

  return {
    measured: waits.length,
    unmeasured: decisions.length - waits.length,
    p50_ms: waits.length === 0 ? null : percentile(waits, 50),
  };
}

/**
 * A manager's queue now (LAI-750): the projects they lead, and the work in
 * Review there that waits for somebody's decision — anyone's task but their
 * own, unassigned included, as their decisions count (LAI-751). How long the
 * oldest has waited is read from its latest entry into Review by
 * {@link reviewEntry}, as {@link timeToDecide} reads it — a task created
 * straight into Review included, from its creation (LAI-751).
 *
 * Membership role `lead`, not the org role: an owner or admin leads every
 * project implicitly (§3), and counting that would make every admin's queue
 * the whole board's.
 */
function queueFor(db: Db, userId: string): ProfileQueue {
  const led = db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projectMemberships)
    .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
    .where(
      and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.role, 'lead'),
        isNull(projects.archivedAt),
      ),
    )
    .all()
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  if (led.length === 0) {
    return { projects_led: 0, waiting: 0, oldest_waiting_since: null, projects: [] };
  }

  const waiting = db
    .select({ id: tasks.id, projectId: tasks.projectId, createdAt: tasks.createdAt })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.projectId,
          led.map((p) => p.id),
        ),
        eq(tasks.status, 'review'),
        or(isNull(tasks.assigneeId), ne(tasks.assigneeId, userId)),
      ),
    )
    .all();

  const history = movesOn(
    db,
    waiting.map((x) => x.id),
  );
  const entered = waiting.flatMap((x) => {
    const entry = reviewEntry(history.get(x.id) ?? [], x.createdAt);
    return entry === null ? [] : [entry];
  });

  return {
    projects_led: led.length,
    waiting: waiting.length,
    oldest_waiting_since: entered.length === 0 ? null : Math.min(...entered),
    projects: led.map((p) => ({
      project_id: p.id,
      waiting: waiting.filter((x) => x.projectId === p.id).length,
    })),
  };
}

/**
 * `started_at` → `completed_at` for their tasks that are done now and were
 * completed in the window — `GET /projects/:slug/metrics`'s rule (LAI-124),
 * for one assignee. A task done with no start is counted and not measured.
 */
function cycleTime(theirTasks: readonly TheirTask[], since: number, now: number): ProfileCycleTime {
  const done = theirTasks.filter(
    (x) =>
      x.status === 'done' &&
      x.completedAt !== null &&
      x.completedAt >= since &&
      x.completedAt <= now,
  );

  const durations = done
    .filter((x) => x.startedAt !== null)
    .map((x) => x.completedAt! - x.startedAt!)
    .sort((a, b) => a - b);

  return {
    measured: durations.length,
    unmeasured: done.length - durations.length,
    p50_ms: durations.length === 0 ? null : percentile(durations, 50),
    p75_ms: durations.length === 0 ? null : percentile(durations, 75),
  };
}

/**
 * Tokens they can still use, most recently used first (D-076's metadata),
 * capped beside the total.
 */
function agentTokens(
  db: Db,
  userId: string,
  now: number,
): Pick<ProfileAgents, 'tokens' | 'tokens_total'> {
  const lastSeen = (x: ProfileAgentToken) => Math.max(x.last_used_at ?? 0, x.last_mcp_at ?? 0);

  const usable = db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.userId, userId),
        isNull(tokens.revokedAt),
        or(isNull(tokens.expiresAt), gt(tokens.expiresAt, now)),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      client: clientOf(row.lastClient, row.name),
      client_name: row.lastClientName,
      last_used_at: row.lastUsedAt,
      last_mcp_at: row.lastMcpAt,
      created_at: row.createdAt,
    }))
    .sort((a, b) => lastSeen(b) - lastSeen(a) || b.created_at - a.created_at);

  return { tokens: usable.slice(0, PROFILE_LIST_LIMIT), tokens_total: usable.length };
}

/**
 * Their writes through each agent in the window (LAI-750): `activity` rows they
 * made on a token, grouped by the agent that token last connected as (D-076's
 * `last_client`, through {@link clientOf}). A token that later connected as
 * another agent moves its history with it — the log keeps the token, not the
 * client — so this is a share, not an audit.
 */
function agentWrites(
  db: Db,
  userId: string,
  since: number,
  now: number,
): Pick<ProfileAgents, 'writes' | 'writes_total'> {
  const rows = db
    .select({
      n: count(),
      lastClient: tokens.lastClient,
      tokenName: tokens.name,
    })
    .from(activity)
    .leftJoin(tokens, eq(tokens.id, activity.actorTokenId))
    .where(
      and(
        eq(activity.actorId, userId),
        isNotNull(activity.actorTokenId),
        gte(activity.createdAt, since),
        lte(activity.createdAt, now),
      ),
    )
    .groupBy(activity.actorTokenId)
    .all();

  const byClient = new Map<AgentClient, number>();
  for (const row of rows) {
    const client = clientOf(row.lastClient, row.tokenName);
    byClient.set(client, (byClient.get(client) ?? 0) + row.n);
  }

  const writes = [...byClient]
    .map(([client, n]) => ({ client, writes: n }))
    .sort((a, b) => b.writes - a.writes || a.client.localeCompare(b.client));

  return { writes, writes_total: writes.reduce((sum, w) => sum + w.writes, 0) };
}

/** Their newest ratings, at most `PROFILE_LIST_LIMIT`, with who gave each. */
function ratingsFor(db: Db, userId: string): RatingView[] {
  return db
    .select({
      id: memberRatings.id,
      score: memberRatings.score,
      note: memberRatings.note,
      createdAt: memberRatings.createdAt,
      raterId: users.id,
      raterName: users.name,
    })
    .from(memberRatings)
    .innerJoin(users, eq(users.id, memberRatings.ratedBy))
    .where(eq(memberRatings.userId, userId))
    .orderBy(desc(memberRatings.createdAt), desc(memberRatings.id))
    .limit(PROFILE_LIST_LIMIT)
    .all()
    .map((row) => ({
      id: row.id,
      score: row.score,
      note: row.note,
      rated_by: { id: row.raterId, name: row.raterName },
      created_at: row.createdAt,
    }));
}

/** Every rating they have, for `ratings_total`. */
function ratingCount(db: Db, userId: string): number {
  return (
    db.select({ n: count() }).from(memberRatings).where(eq(memberRatings.userId, userId)).get()
      ?.n ?? 0
  );
}
