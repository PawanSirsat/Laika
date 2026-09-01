import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { loadActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { heartbeats, orgs, tasks, unlistedWork, users } from '../db/schema.ts';
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
 */

/** §9.3: "a heartbeat in the last 5 minutes". */
export const PRESENCE_WINDOW_MS = 5 * 60_000;

export interface PresenceEntry {
  user_id: string;
  name: string;
  repo: string;
  branch: string;
  /** §9.2's resolution, or null. */
  matched_task_id: string | null;
  /** Every project the repo attributes to (§9.1) — legitimately more than one. */
  project_ids: string[];
  /** An agent session, per §4.8's `actor_kind`: a heartbeat on a token. */
  is_agent: boolean;
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

function presenceEnabled(db: Db): boolean {
  return (db.select({ on: orgs.presenceEnabled }).from(orgs).limit(1).get()?.on ?? 1) === 1;
}

/** Can the caller read any of the projects this heartbeat attributes to? */
function visibleToReader(actor: ResolvedActor, projectIds: readonly string[]): boolean {
  // A heartbeat that attributes to no project names no project, so there is
  // nothing to leak — it says only that somebody is working, which is org-level
  // and no more than the member list already gives away.
  if (projectIds.length === 0) return true;

  return projectIds.some((id) => can(withProject(actor, id), 'project.read', { projectId: id }));
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
    })
    .from(heartbeats)
    .innerJoin(users, eq(users.id, heartbeats.userId))
    .where(gt(heartbeats.createdAt, since))
    .orderBy(desc(heartbeats.createdAt))
    .all();

  const present: PresenceEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    // Newest first, so the first row for a person is their current one.
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);

    const { projectIds } = resolveRepoProjects(db, row.repo, row.branch);
    if (!visibleToReader(actor, projectIds)) continue;

    present.push({
      user_id: row.userId,
      name: row.name,
      repo: row.repo,
      branch: row.branch,
      matched_task_id: row.matchedTaskId,
      project_ids: projectIds,
      is_agent: row.tokenId !== null,
      last_seen: row.createdAt,
    });
  }

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
  // existing patterns). Four queries whatever the headcount.
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
        .where(gt(heartbeats.createdAt, now - PRESENCE_WINDOW_MS))
        .all()
    : [];

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

    const entry: CapacityEntry = {
      user_id: person.id,
      name: person.name,
      // Distinct agent sessions, per §11.4.2: an agent is a heartbeat on a
      // token, and two tokens beating is two sessions.
      active_sessions: new Set(theirBeats.map((b) => b.tokenId ?? 'web')).size,
      in_progress_tasks: inProgress.map((t) => t.id).sort(),
      oldest_in_progress_ms: started.length === 0 ? null : now - Math.min(...started),
      tasks_in_review: theirs
        .filter((t) => t.status === 'review')
        .map((t) => t.id)
        .sort(),
      last_seen: theirBeats.length === 0 ? null : Math.max(...theirBeats.map((b) => b.createdAt)),
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

/** Project-scoped visibility, memoised per call by the caller's small project set. */
function readable(actor: ResolvedActor, projectId: string): boolean {
  return can(withProject(actor, projectId), 'project.read', { projectId });
}

export { loadActor };
