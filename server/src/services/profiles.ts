import {
  and,
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
 * A `manager` profile carries no `current_work`, `delivery` or `agents` block —
 * **absent, not empty**, the convention `unlisted` and the org's `ai` block use
 * — and that is all `profile_kind` does. `can()` never reads it.
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

/**
 * The most any of the profile's growing lists carries — ratings, open work,
 * agent tokens — each beside its total, so the page can say *"and N more"*
 * (LAI-746). A history that grows without bound is not a page.
 */
export const PROFILE_LIST_LIMIT = 50;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  assignee: { id: string; name: string };
}

export interface ProfileReview {
  accepted: number;
  sent_back: number;
  /** Newest first, the most recent few. */
  recent: ReviewDecision[];
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

export interface ProfileAgents {
  /**
   * Tokens still usable — not revoked, not expired — most recently used first;
   * at most `PROFILE_LIST_LIMIT`.
   */
  tokens: ProfileAgentToken[];
  /** All of them, however many `tokens` carries. */
  tokens_total: number;
  online: AgentPresence;
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
      recent: theirDecisions.slice(0, RECENT_DECISIONS).map((d) => d.view),
    },
    ratings: ratingsFor(db, userId),
    ratings_total: ratingCount(db, userId),
  };

  if (person.profileKind === 'manager') return profile;

  return {
    ...profile,
    current_work: currentWork(theirTasks),
    delivery: {
      accepted_per_week: perWeek(accepted, since),
      accepted: accepted.length,
      sent_back: onTheirTasks.filter(
        (m) => isSendBack(m.move) && m.actorId !== null && m.actorId !== userId,
      ).length,
      reopened: onTheirTasks.filter((m) => isReopen(m.move)).length,
      cycle_time: cycleTime(theirTasks, since, now),
    },
    agents: { ...agentTokens(db, userId, now), online: agentPresenceFor(db, userId, now) },
  };
}

/** Their open work, each list capped beside its total (LAI-746). */
function currentWork(theirTasks: readonly TheirTask[]): ProfileCurrentWork {
  const inProgress = theirTasks.filter((x) => x.status === 'in_progress');
  const inReview = theirTasks.filter((x) => x.status === 'review');
  return {
    in_progress: inProgress.slice(0, PROFILE_LIST_LIMIT).map(toProfileTask),
    in_progress_total: inProgress.length,
    in_review: inReview.slice(0, PROFILE_LIST_LIMIT).map(toProfileTask),
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

function toProfileTask(task: TheirTask): ProfileTask {
  return {
    id: task.id,
    key: `${task.prefix}-${String(task.number)}`,
    title: task.title,
    project_slug: task.projectSlug,
    status: task.status,
    status_name: task.statusName,
    started_at: task.startedAt,
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
  view: ReviewDecision;
}

/**
 * Their review decisions on somebody else's work in the window, newest first:
 * acceptances and send-backs they made on tasks assigned to another person.
 */
function loadDecisionsOnOthers(db: Db, userId: string, since: number, now: number): Decision[] {
  const rows = db
    .select({
      row: activity,
      taskId: tasks.id,
      number: tasks.number,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
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
        isNotNull(tasks.assigneeId),
        ne(tasks.assigneeId, userId),
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
    if (move === null || r.assigneeId === null) return [];

    const decision = isAcceptance(move) ? 'accepted' : isSendBack(move) ? 'sent_back' : null;
    if (decision === null) return [];

    return [
      {
        decision,
        projectId: r.projectId,
        view: {
          task_id: r.taskId,
          key: `${r.prefix}-${String(r.number)}`,
          title: r.title,
          project_slug: r.projectSlug,
          decision,
          at: r.row.createdAt,
          assignee: { id: r.assigneeId, name: nameOf.get(r.assigneeId) ?? '' },
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
