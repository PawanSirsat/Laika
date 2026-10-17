import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { AGENT_CLIENTS, agentClientSlug, type AgentClient } from '../auth/agent-clients.ts';
import { loadActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { presenceEnabled } from '../db/orgs.ts';
import { heartbeats, tasks, tokens, unlistedWork, users } from '../db/schema.ts';
import { assertCan, can } from '../policy/can.ts';
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

export interface CapacityEntry {
  user_id: string;
  name: string;
  /** Distinct tokens seen in the window, by heartbeat, `/mcp` call (D-076) or REST write (D-081). */
  active_sessions: number;
  in_progress_tasks: string[];
  /** Milliseconds since the oldest in-progress task started, or null. */
  oldest_in_progress_ms: number | null;
  tasks_in_review: string[];
  last_seen: number | null;
  /** Present only for a caller who passes `audit_log.export`. Absent, not empty. */
  unlisted?: string[];
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

export function capacityNow(db: Db, actor: ResolvedActor, now: number = Date.now()): CapacityView {
  assertCan(actor, 'capacity.read');

  const enabled = presenceEnabled(db);
  const everyone = db.select({ id: users.id, name: users.name }).from(users).all();
  if (everyone.length === 0) return { enabled, people: [] };

  const ids = everyone.map((u) => u.id);
  const mayReadUnlisted = can(actor, 'audit_log.export');

  // Batched, not per person (`creatingClientNames` and `commentCounts` are the
  // existing patterns). Five queries whatever the headcount.
  const openTasks = db
    .select({
      id: tasks.id,
      assigneeId: tasks.assigneeId,
      status: tasks.status,
      startedAt: tasks.startedAt,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(and(inArray(tasks.assigneeId, ids), inArray(tasks.status, ['in_progress', 'review'])))
    .all();

  const beats = enabled
    ? db
        .select({
          userId: heartbeats.userId,
          createdAt: heartbeats.createdAt,
          tokenId: heartbeats.tokenId,
        })
        .from(heartbeats)
        .leftJoin(tokens, eq(tokens.id, heartbeats.tokenId))
        .where(and(gt(heartbeats.createdAt, now - PRESENCE_WINDOW_MS), liveHeartbeat(now)))
        .all()
    : [];

  const calls = enabled ? tokenSessionsSince(db, now - PRESENCE_WINDOW_MS, now) : [];

  const notes = mayReadUnlisted
    ? db
        .select({ id: unlistedWork.id, userId: unlistedWork.userId })
        .from(unlistedWork)
        .where(inArray(unlistedWork.userId, ids))
        .all()
        .filter(() => true)
    : [];

  const people: CapacityEntry[] = everyone.map((person) => {
    const theirs = openTasks.filter(
      (task) => task.assigneeId === person.id && readable(actor, task.projectId),
    );
    const inProgress = theirs.filter((t) => t.status === 'in_progress');
    const started = inProgress.map((t) => t.startedAt).filter((v): v is number => v !== null);

    const theirBeats = beats.filter((b) => b.userId === person.id);
    const theirCalls = calls.filter((c) => c.userId === person.id);
    const seen = [...theirBeats.map((b) => b.createdAt), ...theirCalls.map((c) => c.at)];

    const entry: CapacityEntry = {
      user_id: person.id,
      name: person.name,
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
      last_seen: seen.length === 0 ? null : Math.max(...seen),
    };

    if (mayReadUnlisted) {
      entry.unlisted = notes
        .filter((n) => n.userId === person.id)
        .map((n) => n.id)
        .sort();
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
