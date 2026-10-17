import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AGENT_CLIENTS, agentClientSlug, type AgentClient } from '../auth/agent-clients.ts';
import { loadActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { boardDayOf } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type OrgRole, type ProfileKind } from '../db/enums.ts';
import { presenceEnabled } from '../db/orgs.ts';
import {
  activity,
  boardActivityDays,
  heartbeats,
  projects,
  sessions,
  tasks,
  tokens,
  unlistedWork,
  users,
} from '../db/schema.ts';
import { assertCan, can } from '../policy/can.ts';
import { addDays } from './calendar-days.ts';
import { resolveRepoProjects } from './heartbeats.ts';

/**
 * §9.3's derived views — presence and capacity (LAI-432).
 *
 * ## Nothing is stored, and that is the whole design
 *
 * §9.3: *"Presence and capacity attribute a heartbeat to a project by §9.1's
 * rule, **at request time**. Nothing is stored on the heartbeat"* — because a
 * single column could not hold a result that is legitimately many, and a second
 * store would fall out of sync with the first. So every read re-runs
 * `resolveRepoProjects`, and a person in a monorepo tracked by two projects is
 * present on **both**.
 *
 * ## Disabled is not empty
 *
 * §4.2: when `presence_enabled = 0`, these views show a **disabled** state
 * rather than an empty one, and §11.4.2 renders them differently. They are the
 * same JSON shape to a careless reader and opposite facts to a person: "nobody
 * is working" versus "this org does not record who is working".
 *
 * That distinction is why the flag is a **field on the response** rather than
 * something a client infers from an empty list. Since LAI-150 a disabled org
 * stores no heartbeats at all, so an empty table is the *only* thing left —
 * inferring "disabled" from it would be permanently wrong and silently so, and
 * inferring "nobody is working" would be wrong in the other direction.
 *
 * ## Two grades in one response
 *
 * Capacity's `unlisted` needs `audit_log.export` (§3.1's *"Export audit log"*
 * row, which is what `listUnlisted` already asks for). Everything else is every
 * role. So `unlisted` is **absent, not empty**, for a caller who may not see it
 * — an empty array would say "this person has logged nothing", which is a
 * different fact and one a Member would act on. Same shape as the org's `ai`
 * block (LAI-222).
 *
 * ## An MCP call is presence too (D-076)
 *
 * Only Claude Code's plugin hook sends heartbeats, so an agent in Codex,
 * Cursor, OpenCode or Gemini CLI never appeared. Every `/mcp` request now
 * stamps its token's `last_mcp_at`, and a token stamped inside the window is a
 * live agent session with or without a heartbeat. It carries **no location**:
 * `repo` and `branch` stay absent, which is how a client already reads "working,
 * somewhere it cannot be told". A heartbeat still supplies the location when
 * there is one. Nothing more is collected than the time and the client's name.
 *
 * ## So is a REST write (D-081)
 *
 * An agent on the REST API or the `laika` CLI never touches `/mcp`, so it was
 * never present, however busy. A token-authenticated REST **write** now stamps
 * `last_rest_write_at` under the same rules, and counts here exactly like an
 * `/mcp` call: no location, the token's agent by `clientOf`. A read does not
 * count — a script polling with somebody's token is not that person working.
 */

/** §9.3: "a heartbeat in the last 5 minutes". */
export const PRESENCE_WINDOW_MS = 5 * 60_000;

export interface PresenceEntry {
  user_id: string;
  name: string;
  /**
   * Where they are working — **only for a reader who can see a project the repo
   * attributes to** (LAI-438).
   *
   * `LAIKA_URL` and `LAIKA_TOKEN` live in `~/.claude/settings.json` — *user*
   * settings, not per-repository (D-046) — so the heartbeat hook fires in
   * **every** repository that person opens, not the org's. Without this gate, a
   * member who opens an unrelated private repo broadcasts its name and branch to
   * the whole org, in a view no individual can switch off.
   *
   * Consent to be seen working on the org's projects is not consent to publish
   * the name of everything else you open. §9.3 said "with repo, branch" and was
   * written before D-046 existed.
   *
   * **Absent, not an empty string.** `repo: ''` is a different claim and a
   * client would render it — the same rule as `unlisted` and the org's `ai`.
   */
  repo?: string;
  branch?: string;
  /** §9.2's resolution, or null. */
  matched_task_id: string | null;
  /** Every project the repo attributes to (§9.1) — legitimately more than one. */
  project_ids: string[];
  /**
   * An agent session, per §4.8's `actor_kind`: a heartbeat on a token, or a
   * token's `/mcp` call (D-076) or REST write (D-081).
   */
  is_agent: boolean;
  /**
   * The coding agent of the newest live agent session, as an `AGENT_CLIENTS`
   * slug, or null when no agent session is live (D-076).
   */
  client: AgentClient | null;
  /** Every distinct agent among this person's live sessions, newest first. */
  clients: AgentClient[];
  last_seen: number;
}

export interface PresenceView {
  /** `false` when the org has turned presence off (§4.2). Not the same as empty. */
  enabled: boolean;
  present: PresenceEntry[];
}

/**
 * Where a person stands, from {@link CapacityEntry.last_seen} (LAI-767):
 * `online` inside §9.3's five minutes, `away` inside the hour, `offline`
 * after it, `never` with no signal at all.
 */
export type PersonStatus = 'online' | 'away' | 'offline' | 'never';

/** Which kind of signal `last_seen` is (LAI-767). */
export type SeenVia = 'web' | 'board' | 'agent';

/** LAI-767's load badge, from {@link loadOf}'s fixed rule. */
export type LoadLevel = 'none' | 'light' | 'normal' | 'heavy';

/**
 * A person's open assigned work, counted over the projects the reader may read
 * (LAI-767).
 *
 * `in_progress`, `in_review` and `todo` partition `open` by category; `todo`
 * is assigned and not started, Backlog and To do alike. `overdue` and
 * `due_soon` cut across them, by the client's `isOverdue` rule: due before
 * today (UTC) is overdue, due today or within the next seven days is soon.
 */
export interface CapacityWorkload {
  in_progress: number;
  in_review: number;
  todo: number;
  overdue: number;
  due_soon: number;
  open: number;
}

/** One space a person has open work in, with the same counts (LAI-767). */
export interface CapacitySpace extends CapacityWorkload {
  project_id: string;
  slug: string;
  name: string;
}

/**
 * One coding agent beside a person (LAI-767, D-076's client names).
 *
 * `running` is §9.3's rule: a live session of that agent inside the window.
 */
export interface CapacityAgent {
  client: AgentClient;
  running: boolean;
  /** Its newest session, or for an owner or admin its token's newest use; null when unknown. */
  last_at: number | null;
}

export interface CapacityEntry {
  user_id: string;
  name: string;
  /** Visible to every role already, on the member list (`member_list.read`). */
  email: string;
  org_role: OrgRole;
  /** Distinct tokens seen in the window, by heartbeat, `/mcp` call (D-076) or REST write (D-081). */
  active_sessions: number;
  in_progress_tasks: string[];
  /** Milliseconds since the oldest in-progress task started, or null. */
  oldest_in_progress_ms: number | null;
  tasks_in_review: string[];
  /**
   * The newest of every signal (LAI-767): their last sign-in, their last
   * activity-log row, and their agents' last heartbeat, `/mcp` call or REST
   * write on a usable token. `null` when there is none, and always `null`
   * while presence is off.
   */
  last_seen: number | null;
  /** The kind of signal `last_seen` is; `null` exactly when it is. */
  last_seen_via: SeenVia | null;
  /** `null` while presence is off (§4.2): no status is a fact the org chose. */
  status: PersonStatus | null;
  workload: CapacityWorkload;
  load: LoadLevel;
  /** Spaces they have open work in, most open first. */
  spaces: CapacitySpace[];
  /**
   * Their agents. Everyone sees the ones running now, as `/presence` already
   * says; an owner or admin also sees every agent on their usable tokens
   * (D-076, D-078), which is token metadata a member is not shown.
   */
  agents: CapacityAgent[];
  /** Present only for a caller who passes `audit_log.export`. Absent, not empty. */
  unlisted?: string[];
  /** Present only for a caller who passes `profile.read` (D-078). Absent, not empty. */
  profile_kind?: ProfileKind;
  /**
   * Board actions on each of the last 14 UTC days, oldest first, ending today
   * (D-079's rollup). Present only for `profile.activity.read`. Absent, not empty.
   */
  activity_14d?: number[];
}

export interface CapacityView {
  enabled: boolean;
  people: CapacityEntry[];
}

/**
 * May the caller be told **where** this person is working?
 *
 * Only if the repo attributes to a project they can read. A repo tracked by a
 * project you cannot see is exactly as private as one tracked by nothing — so
 * "no projects" and "no projects you can read" are the same answer here, and the
 * two rules cannot drift apart because there is only one.
 *
 * **The person is still shown.** Presence answers "who is working right now",
 * which is org-level: dropping the entry would make the headcount depend on who
 * is asking, and that is the reasoning capacity already uses for somebody else's
 * task list.
 */
function maySeeLocation(actor: ResolvedActor, projectIds: readonly string[]): boolean {
  return projectIds.some((id) => can(withProject(actor, id), 'project.read', { projectId: id }));
}

/** One live session: a heartbeat, or a token's latest `/mcp` call or REST write. */
interface Session {
  tokenId: string | null;
  at: number;
  client: AgentClient | null;
}

/**
 * A token's agent: what it last said in `initialize`, or what its name says.
 *
 * The fallback covers a token that only ever sent heartbeats, which is a
 * Claude Code plugin that has not called `/mcp` since D-076 shipped.
 */
export function clientOf(lastClient: string | null, tokenName: string | null): AgentClient {
  return AGENT_CLIENTS.find((slug) => slug === lastClient) ?? agentClientSlug(null, tokenName);
}

/**
 * A token that can still make a request: not revoked, not expired (D-076).
 *
 * A token that can make no further call has no live session, however recently
 * it was seen, by heartbeat or by `/mcp`.
 */
function tokenStillUsable(now: number) {
  return and(isNull(tokens.revokedAt), or(isNull(tokens.expiresAt), gt(tokens.expiresAt, now)));
}

/**
 * A heartbeat that still counts: a signed-in session's (no token), or one on a
 * token that is still usable. Used with a left join to `tokens`.
 */
function liveHeartbeat(now: number) {
  return or(isNull(heartbeats.tokenId), tokenStillUsable(now));
}

/**
 * Tokens that called `/mcp` (D-076) or wrote through the REST API (D-081)
 * inside the window. One session per token, at the newer of the two.
 */
function tokenSessionsSince(db: Db, since: number, now: number) {
  return db
    .select({
      tokenId: tokens.id,
      userId: tokens.userId,
      lastMcpAt: tokens.lastMcpAt,
      lastRestWriteAt: tokens.lastRestWriteAt,
      lastClient: tokens.lastClient,
      tokenName: tokens.name,
      name: users.name,
    })
    .from(tokens)
    .innerJoin(users, eq(users.id, tokens.userId))
    .where(
      and(
        or(gt(tokens.lastMcpAt, since), gt(tokens.lastRestWriteAt, since)),
        tokenStillUsable(now),
      ),
    )
    .all()
    .map((row) => ({
      tokenId: row.tokenId,
      userId: row.userId,
      name: row.name,
      // At least one is inside the window: the `or` above says so. The column
      // types cannot.
      at: Math.max(row.lastMcpAt ?? 0, row.lastRestWriteAt ?? 0),
      client: clientOf(row.lastClient, row.tokenName),
    }));
}

export function presenceNow(db: Db, actor: ResolvedActor, now: number = Date.now()): PresenceView {
  assertCan(actor, 'presence.read');

  if (!presenceEnabled(db)) return { enabled: false, present: [] };

  const since = now - PRESENCE_WINDOW_MS;

  const rows = db
    .select({
      userId: heartbeats.userId,
      repo: heartbeats.repo,
      branch: heartbeats.branch,
      matchedTaskId: heartbeats.matchedTaskId,
      tokenId: heartbeats.tokenId,
      createdAt: heartbeats.createdAt,
      name: users.name,
      tokenName: tokens.name,
      lastClient: tokens.lastClient,
    })
    .from(heartbeats)
    .innerJoin(users, eq(users.id, heartbeats.userId))
    .leftJoin(tokens, eq(tokens.id, heartbeats.tokenId))
    .where(and(gt(heartbeats.createdAt, since), liveHeartbeat(now)))
    .orderBy(desc(heartbeats.createdAt))
    .all();

  const calls = tokenSessionsSince(db, since, now);

  // Per person: their newest heartbeat (it alone says *where*), and every live
  // session from either source.
  const people = new Map<
    string,
    { name: string; beat: (typeof rows)[number] | undefined; sessions: Session[] }
  >();
  const personFor = (userId: string, name: string) => {
    let person = people.get(userId);
    if (person === undefined) {
      person = { name, beat: undefined, sessions: [] };
      people.set(userId, person);
    }
    return person;
  };

  for (const row of rows) {
    const person = personFor(row.userId, row.name);
    // Newest first, so the first row for a person is their current one.
    person.beat ??= row;
    person.sessions.push({
      tokenId: row.tokenId,
      at: row.createdAt,
      client: row.tokenId === null ? null : clientOf(row.lastClient, row.tokenName),
    });
  }
  for (const call of calls) {
    personFor(call.userId, call.name).sessions.push(call);
  }

  const present: PresenceEntry[] = [];

  for (const [userId, person] of people) {
    const sessions = person.sessions.sort((a, b) => b.at - a.at);
    const agents = sessions.filter((session) => session.tokenId !== null);
    const clients = [
      ...new Set(agents.map((s) => s.client).filter((c): c is AgentClient => c !== null)),
    ];
    const { beat } = person;

    let location: Pick<PresenceEntry, 'repo' | 'branch' | 'matched_task_id' | 'project_ids'> = {
      matched_task_id: null,
      project_ids: [],
    };
    if (beat !== undefined) {
      const { projectIds } = resolveRepoProjects(db, beat.repo, beat.branch);
      // The task and the project list follow the same gate: all three name
      // *where* the work is, and one of them leaking would make the others'
      // absence decorative.
      if (maySeeLocation(actor, projectIds)) {
        location = {
          repo: beat.repo,
          branch: beat.branch,
          matched_task_id: beat.matchedTaskId,
          project_ids: projectIds,
        };
      }
    }

    present.push({
      user_id: userId,
      name: person.name,
      ...location,
      // A heartbeat on a token, as before, or any live `/mcp` call (D-076) or REST write (D-081).
      is_agent:
        (beat !== undefined && beat.tokenId !== null) || calls.some((c) => c.userId === userId),
      client: agents[0]?.client ?? null,
      clients,
      last_seen: sessions[0]?.at ?? 0,
    });
  }

  present.sort((a, b) => b.last_seen - a.last_seen);

  return { enabled: true, present };
}

/** "Away" (LAI-767): seen inside the last hour, not the last five minutes. */
export const AWAY_WINDOW_MS = 60 * 60_000;

/** "Due soon" (LAI-767): due today or within this many days after it. */
export const DUE_SOON_DAYS = 7;

/** How many days the admin-only board-activity series covers (LAI-767). */
export const ACTIVITY_DAYS = 14;

const DAY_MS = 86_400_000;

/** A task assigned and not finished: every category before Done (D-077). */
const OPEN_CATEGORIES = ['backlog', 'todo', 'in_progress', 'review'] as const;

/**
 * The load badge (LAI-767) — **a fixed rule, not a setting**, so a badge means
 * the same on every board:
 *
 * - `none`: nothing open is assigned to them.
 * - `heavy`: more than 5 in progress, **or** anything overdue, **or** more than
 *   15 open.
 * - `light`: at most 2 in progress and at most 5 open.
 * - `normal`: the rest.
 *
 * Counted over what the reader may read, as every other figure here is.
 */
export function loadOf(work: CapacityWorkload): LoadLevel {
  if (work.open === 0) return 'none';
  if (work.in_progress > 5 || work.overdue > 0 || work.open > 15) return 'heavy';
  if (work.in_progress <= 2 && work.open <= 5) return 'light';
  return 'normal';
}

/**
 * `online` inside §9.3's window — the same strict `>` as a live session —
 * `away` inside the hour, `offline` after it, `never` with nothing to go on.
 */
export function statusOf(lastSeen: number | null, now: number): PersonStatus {
  if (lastSeen === null) return 'never';
  if (lastSeen > now - PRESENCE_WINDOW_MS) return 'online';
  if (lastSeen > now - AWAY_WINDOW_MS) return 'away';
  return 'offline';
}

function emptyWorkload(): CapacityWorkload {
  return { in_progress: 0, in_review: 0, todo: 0, overdue: 0, due_soon: 0, open: 0 };
}

/** One open task into a set of counts, by category and by its due date. */
function countTask(
  work: CapacityWorkload,
  task: { status: string; dueOn: number | null },
  today: number,
): void {
  if (task.status === 'in_progress') work.in_progress += 1;
  else if (task.status === 'review') work.in_review += 1;
  else work.todo += 1;
  work.open += 1;
  if (task.dueOn === null) return;
  if (task.dueOn < today) work.overdue += 1;
  else if (task.dueOn <= today + DUE_SOON_DAYS * DAY_MS) work.due_soon += 1;
}

/** The newest of several dated signals, and which kind it was. */
interface Signal {
  at: number;
  via: SeenVia;
}

function newer(a: Signal | undefined, b: Signal): Signal {
  return a === undefined || b.at > a.at ? b : a;
}

/**
 * Capacity (§9.3, §11.4.2) — one entry per person, everything the page draws
 * (LAI-767).
 *
 * **Batched, not per person**: a fixed number of queries whatever the
 * headcount, each one an `IN` over the people or a window on an index — the
 * pattern `creatingClientNames` and `commentCounts` set.
 *
 * ## Last seen is the newest of every signal, and presence off hides it all
 *
 * A sign-in (the session row's `created_at`), a row in the activity log, and
 * an agent's heartbeat, `/mcp` call or REST write on a token that can still
 * make a request (D-076, D-081). **Not** a web session's `updated_at`:
 * better-auth slides it once a day on whatever request comes first, which is
 * an open tab's background poll as often as a person, so it would light a
 * sleeping person up. Reads never count, as D-081 settled for tokens.
 *
 * With presence off (§4.2) there is no status, no last seen and no running
 * agent — the org chose not to record who is working, and the activity log
 * must not answer it by the back door. The workload is board data and stays.
 */
export function capacityNow(db: Db, actor: ResolvedActor, now: number = Date.now()): CapacityView {
  assertCan(actor, 'capacity.read');

  const enabled = presenceEnabled(db);
  const everyone = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      orgRole: users.orgRole,
      profileKind: users.profileKind,
    })
    .from(users)
    .all();
  if (everyone.length === 0) return { enabled, people: [] };

  const ids = everyone.map((u) => u.id);
  const mayReadUnlisted = can(actor, 'audit_log.export');
  // Session only, both (D-078, D-079): a token is refused in `can()`.
  const mayReadProfiles = can(actor, 'profile.read');
  const mayReadActivity = can(actor, 'profile.activity.read');
  const today = Date.parse(`${boardDayOf(now)}T00:00:00Z`);

  const openTasks = db
    .select({
      id: tasks.id,
      assigneeId: tasks.assigneeId,
      status: tasks.status,
      startedAt: tasks.startedAt,
      dueOn: tasks.dueOn,
      projectId: tasks.projectId,
      slug: projects.slug,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(inArray(tasks.assigneeId, ids), inArray(tasks.status, [...OPEN_CATEGORIES])))
    .all();

  // `can()` once per project, not once per task.
  const visible = new Map<string, boolean>();
  const mayRead = (projectId: string): boolean => {
    let answer = visible.get(projectId);
    if (answer === undefined) {
      answer = readable(actor, projectId);
      visible.set(projectId, answer);
    }
    return answer;
  };

  const tasksOf = new Map<string, typeof openTasks>();
  for (const task of openTasks) {
    if (task.assigneeId === null || !mayRead(task.projectId)) continue;
    const list = tasksOf.get(task.assigneeId) ?? [];
    list.push(task);
    tasksOf.set(task.assigneeId, list);
  }

  const since = now - PRESENCE_WINDOW_MS;

  const beats = enabled
    ? db
        .select({
          userId: heartbeats.userId,
          createdAt: heartbeats.createdAt,
          tokenId: heartbeats.tokenId,
          tokenName: tokens.name,
          lastClient: tokens.lastClient,
        })
        .from(heartbeats)
        .leftJoin(tokens, eq(tokens.id, heartbeats.tokenId))
        .where(and(gt(heartbeats.createdAt, since), liveHeartbeat(now)))
        .all()
    : [];

  const calls = enabled ? tokenSessionsSince(db, since, now) : [];

  // ---- every signal, at any age (LAI-767) ---------------------------------
  const seen = new Map<string, Signal>();
  const note = (userId: string | null, at: number | null, via: SeenVia): void => {
    if (userId === null || at === null) return;
    seen.set(userId, newer(seen.get(userId), { at, via }));
  };

  // Usable tokens: their agents' last call or write, and — for an owner or
  // admin — which agents they use at all.
  const theirTokens = db
    .select({
      userId: tokens.userId,
      name: tokens.name,
      lastClient: tokens.lastClient,
      lastUsedAt: tokens.lastUsedAt,
      lastMcpAt: tokens.lastMcpAt,
      lastRestWriteAt: tokens.lastRestWriteAt,
    })
    .from(tokens)
    .where(and(inArray(tokens.userId, ids), tokenStillUsable(now)))
    .all();

  if (enabled) {
    for (const token of theirTokens) {
      note(token.userId, token.lastMcpAt, 'agent');
      note(token.userId, token.lastRestWriteAt, 'agent');
    }

    // Each person's newest heartbeat on `heartbeats_user_created_at_idx`, split
    // by whether a token sent it.
    const lastBeats = db
      .select({
        userId: heartbeats.userId,
        byToken: sql<number>`${heartbeats.tokenId} IS NOT NULL`,
        at: sql<number>`max(${heartbeats.createdAt})`,
      })
      .from(heartbeats)
      .leftJoin(tokens, eq(tokens.id, heartbeats.tokenId))
      .where(and(inArray(heartbeats.userId, ids), liveHeartbeat(now)))
      .groupBy(heartbeats.userId, sql`${heartbeats.tokenId} IS NOT NULL`)
      .all();
    for (const row of lastBeats) note(row.userId, row.at, row.byToken === 1 ? 'agent' : 'web');

    // The activity log: a web session's row is the person on the board; a
    // token's is their agent (§4.8's `actor_kind`).
    const lastActions = db
      .select({
        actorId: activity.actorId,
        actorKind: activity.actorKind,
        at: sql<number>`max(${activity.createdAt})`,
      })
      .from(activity)
      .where(inArray(activity.actorId, ids))
      .groupBy(activity.actorId, activity.actorKind)
      .all();
    for (const row of lastActions) {
      note(row.actorId, row.at, row.actorKind === 'user' ? 'board' : 'agent');
    }

    // A sign-in. `created_at`, not `updated_at` — see above.
    const signIns = db
      .select({ userId: sessions.userId, at: sql<number>`max(${sessions.createdAt})` })
      .from(sessions)
      .where(inArray(sessions.userId, ids))
      .groupBy(sessions.userId)
      .all();
    for (const row of signIns) note(row.userId, row.at, 'web');
  }

  const notes = mayReadUnlisted
    ? db
        .select({ id: unlistedWork.id, userId: unlistedWork.userId })
        .from(unlistedWork)
        .where(inArray(unlistedWork.userId, ids))
        .all()
    : [];

  const firstDay = addDays(boardDayOf(now), -(ACTIVITY_DAYS - 1));
  const days = mayReadActivity
    ? db
        .select({
          userId: boardActivityDays.userId,
          day: boardActivityDays.day,
          bySelf: boardActivityDays.bySelf,
          byAgents: boardActivityDays.byAgents,
        })
        .from(boardActivityDays)
        .where(
          and(
            inArray(boardActivityDays.userId, ids),
            gte(boardActivityDays.day, firstDay),
            lte(boardActivityDays.day, boardDayOf(now)),
          ),
        )
        .all()
    : [];

  const people: CapacityEntry[] = everyone.map((person) => {
    const theirs = tasksOf.get(person.id) ?? [];
    const inProgress = theirs.filter((t) => t.status === 'in_progress');
    const started = inProgress.map((t) => t.startedAt).filter((v): v is number => v !== null);

    const workload = emptyWorkload();
    const spaces = new Map<string, CapacitySpace>();
    for (const task of theirs) {
      countTask(workload, task, today);
      let space = spaces.get(task.projectId);
      if (space === undefined) {
        space = {
          project_id: task.projectId,
          slug: task.slug,
          name: task.projectName,
          ...emptyWorkload(),
        };
        spaces.set(task.projectId, space);
      }
      countTask(space, task, today);
    }

    const theirBeats = beats.filter((b) => b.userId === person.id);
    const theirCalls = calls.filter((c) => c.userId === person.id);

    // Agents: running now from the window's sessions, everyone's to see.
    const agents = new Map<AgentClient, CapacityAgent>();
    const running = (client: AgentClient, at: number): void => {
      const known = agents.get(client);
      agents.set(client, {
        client,
        running: true,
        last_at: Math.max(at, known?.last_at ?? 0),
      });
    };
    for (const b of theirBeats) {
      if (b.tokenId !== null) running(clientOf(b.lastClient, b.tokenName), b.createdAt);
    }
    for (const c of theirCalls) running(c.client, c.at);

    // And for an owner or admin, every agent on a usable token that has been
    // used — the profile's list (D-078), never a member's to read.
    if (mayReadProfiles) {
      for (const token of theirTokens) {
        if (token.userId !== person.id) continue;
        const used = Math.max(
          token.lastUsedAt ?? 0,
          token.lastMcpAt ?? 0,
          token.lastRestWriteAt ?? 0,
        );
        if (used === 0) continue;
        const client = clientOf(token.lastClient, token.name);
        const known = agents.get(client);
        agents.set(client, {
          client,
          running: known?.running ?? false,
          last_at: Math.max(used, known?.last_at ?? 0),
        });
      }
    }

    const last = enabled ? seen.get(person.id) : undefined;

    const entry: CapacityEntry = {
      user_id: person.id,
      name: person.name,
      email: person.email,
      org_role: person.orgRole,
      // Distinct agent sessions, per §11.4.2: an agent is a token, and two
      // tokens is two sessions. One token that both beats and calls `/mcp` is
      // one session (D-076).
      active_sessions: new Set([
        ...theirBeats.map((b) => b.tokenId ?? 'web'),
        ...theirCalls.map((c) => c.tokenId),
      ]).size,
      in_progress_tasks: inProgress.map((t) => t.id).sort(),
      oldest_in_progress_ms: started.length === 0 ? null : now - Math.min(...started),
      tasks_in_review: theirs
        .filter((t) => t.status === 'review')
        .map((t) => t.id)
        .sort(),
      last_seen: last?.at ?? null,
      last_seen_via: last?.via ?? null,
      status: enabled ? statusOf(last?.at ?? null, now) : null,
      workload,
      load: loadOf(workload),
      spaces: [...spaces.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      agents: [...agents.values()].sort(
        (a, b) =>
          Number(b.running) - Number(a.running) ||
          (b.last_at ?? 0) - (a.last_at ?? 0) ||
          a.client.localeCompare(b.client),
      ),
    };

    if (mayReadUnlisted) {
      entry.unlisted = notes
        .filter((n) => n.userId === person.id)
        .map((n) => n.id)
        .sort();
    }

    if (mayReadProfiles) entry.profile_kind = person.profileKind;

    if (mayReadActivity) {
      const perDay = new Map<string, number>();
      for (const d of days) {
        if (d.userId === person.id) perDay.set(d.day, d.bySelf + d.byAgents);
      }
      entry.activity_14d = Array.from(
        { length: ACTIVITY_DAYS },
        (_, i) => perDay.get(addDays(firstDay, i)) ?? 0,
      );
    }

    return entry;
  });

  return { enabled, people };
}

/** One person's live agents, for the member profile (LAI-743). */
export interface AgentPresence {
  /** `false` when the org has turned presence off (§4.2). Not the same as nobody. */
  enabled: boolean;
  /** Every distinct agent among their live sessions, newest first. */
  clients: AgentClient[];
  /** Their newest live session of any kind, or null when there is none. */
  last_seen: number | null;
}

/**
 * Which of one person's agents are online now — §9.3's rule, for one person
 * (LAI-743).
 *
 * The same sessions `presenceNow` counts: a heartbeat on a usable token or
 * none, or a usable token's `/mcp` call or REST write, inside the window. **No location**:
 * the profile says which agents, never where — `repo` and `branch` are not
 * read here at all.
 *
 * **It asks `can()` nothing.** It is called by `getProfile` after
 * `profile.read` has been asserted, and is not reachable from a route.
 */
export function agentPresenceFor(db: Db, userId: string, now: number = Date.now()): AgentPresence {
  if (!presenceEnabled(db)) return { enabled: false, clients: [], last_seen: null };

  const since = now - PRESENCE_WINDOW_MS;

  const beats: Session[] = db
    .select({
      tokenId: heartbeats.tokenId,
      at: heartbeats.createdAt,
      tokenName: tokens.name,
      lastClient: tokens.lastClient,
    })
    .from(heartbeats)
    .leftJoin(tokens, eq(tokens.id, heartbeats.tokenId))
    .where(and(eq(heartbeats.userId, userId), gt(heartbeats.createdAt, since), liveHeartbeat(now)))
    .all()
    .map((row) => ({
      tokenId: row.tokenId,
      at: row.at,
      client: row.tokenId === null ? null : clientOf(row.lastClient, row.tokenName),
    }));

  const calls = tokenSessionsSince(db, since, now).filter((call) => call.userId === userId);

  const sessions = [...beats, ...calls].sort((a, b) => b.at - a.at);
  const clients = [
    ...new Set(
      sessions
        .filter((s) => s.tokenId !== null)
        .map((s) => s.client)
        .filter((c): c is AgentClient => c !== null),
    ),
  ];

  return { enabled: true, clients, last_seen: sessions[0]?.at ?? null };
}

/** Project-scoped visibility, memoised per call by the caller's small project set. */
function readable(actor: ResolvedActor, projectId: string): boolean {
  return can(withProject(actor, projectId), 'project.read', { projectId });
}

export { loadActor };
