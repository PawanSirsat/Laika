import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { agentProjectGrants, agents, handoffOffers, projects, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';

/**
 * A task's selected agent and the work request it opens (D-114 item 7,
 * proposal §3 and §4.4, LAI-535).
 *
 * ## Four facts, kept apart
 *
 * The **assignee** is the person accountable; the **selected agent** is the
 * agent meant to do the work; the **claim** is who is doing it (LAI-541); the
 * **owner** is whose agent it is. Selecting writes `tasks.selected_agent_id`
 * and opens a `work_request` addressed to that agent — and **nothing else**:
 * no assignee, no status, no claim, no process. A task can stay human-only.
 *
 * ## Who may select, and whom
 *
 * Whoever may edit the task (`task.write`) — the selection is a field of it,
 * as the size is (§3.2). Whom is narrower, and is the project's hand-off
 * policy at its defaults (proposal §4.5): **only the selector's own agents**,
 * active, granted `full` on the task's project, in a space that lets agents
 * write. Other members' agents wait for LAI-546's policy. The policy governs
 * this delegation and nothing more — reads and comments never pass here.
 *
 * Each refusal is `422 unprocessable` with `details: { field, reason,
 * selected_agent_id }`, the shape `assignee_id`'s `not_on_project` already
 * uses (§6.4): §6.3's codes are closed (D-021), and the reason is what tells a
 * caller what to fix.
 */

export const SELECTED_AGENT_REFUSALS = [
  'agent_not_found',
  'agent_other_owner',
  'agent_wrong_org',
  'agent_revoked',
  'agent_not_granted',
  'agent_read_only',
  'agents_off',
] as const;
export type SelectedAgentRefusal = (typeof SELECTED_AGENT_REFUSALS)[number];

/** A task's selected agent as `TaskView` carries it. Never a token, never a grant. */
export interface SelectedAgentView {
  id: string;
  display_name: string;
  /** Self-reported (§4.63); decides nothing. */
  harness: string;
  /** Self-reported (§4.63); decides nothing. */
  device_label: string | null;
  status: 'active' | 'revoked';
  owner: { id: string; name: string };
}

/** One open work request, as the agent it is addressed to reads it. */
export interface WorkRequestView {
  id: string;
  kind: 'work_request';
  state: 'open';
  task_id: string;
  task_key: string;
  task_title: string;
  project_id: string;
  agent_id: string;
  requested_by: string;
  created_at: number;
}

const MESSAGES: Record<SelectedAgentRefusal, string> = {
  agent_not_found: 'No agent with that id',
  agent_other_owner:
    "Only your own agents can be selected; another member's agent needs the project's hand-off policy (LAI-546)",
  agent_wrong_org: 'That agent belongs to another organisation',
  agent_revoked: 'That agent is revoked',
  agent_not_granted: 'That agent has no access to this project; grant it first',
  agent_read_only: 'That agent may only read in this project; it needs a full grant to do the work',
  agents_off: 'This space does not let agents make changes',
};

function refused(reason: SelectedAgentRefusal, agentId: string): ApiError {
  return new ApiError('unprocessable', MESSAGES[reason], {
    field: 'selected_agent_id',
    reason,
    selected_agent_id: agentId,
  });
}

type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

/**
 * Refuse an agent the selector may not delegate this project's work to.
 * Asked in order of what the caller can fix least: an agent that is not
 * theirs before one that is merely revoked or ungranted.
 */
export function assertAgentSelectable(
  db: Db,
  actor: ResolvedActor,
  project: Pick<ProjectRow, 'id' | 'orgId' | 'agentsAllowed'>,
  agentId: string,
): void {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (agent === undefined) throw refused('agent_not_found', agentId);
  if (agent.ownerUserId !== actor.userId) throw refused('agent_other_owner', agentId);
  if (agent.orgId !== project.orgId) throw refused('agent_wrong_org', agentId);
  if (agent.status !== 'active') throw refused('agent_revoked', agentId);

  const grant = db
    .select({ scope: agentProjectGrants.scope })
    .from(agentProjectGrants)
    .where(
      and(eq(agentProjectGrants.agentId, agentId), eq(agentProjectGrants.projectId, project.id)),
    )
    .get();
  if (grant === undefined) throw refused('agent_not_granted', agentId);
  if (grant.scope !== 'full') throw refused('agent_read_only', agentId);

  if (!project.agentsAllowed) throw refused('agents_off', agentId);
}

/**
 * **The seam for LAI-541 and LAI-546.** Changing the selected agent while a
 * session holds the task's live claim must go through a hand-off (proposal §3);
 * claims do not exist yet, so there is nothing to refuse and this returns. A
 * test pins today's behaviour and names both tasks, so the day `task_claims`
 * lands, the test that must change is the one that says so.
 */
export function assertSelectionChangeAllowed(_db: Db, _task: TaskRow): void {
  // TODO(LAI-541, LAI-546): refuse `409` while a live claim is held.
}

/**
 * Move the task's selection from what it is to `agentId`, inside the caller's
 * transaction: cancel the open work request, if any, and open one for the new
 * agent. `null` withdraws. The caller has already decided the selection
 * changes and that the agent is eligible.
 */
export function moveSelection(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  agentId: string | null,
  now: number,
): void {
  db.update(handoffOffers)
    .set({ state: 'cancelled', closedAt: now })
    .where(
      and(
        eq(handoffOffers.taskId, taskId),
        eq(handoffOffers.kind, 'work_request'),
        eq(handoffOffers.state, 'open'),
      ),
    )
    .run();

  if (agentId === null) return;

  db.insert(handoffOffers)
    .values({
      id: newId(),
      taskId,
      kind: 'work_request',
      toAgentId: agentId,
      state: 'open',
      createdByUserId: actor.userId,
      createdAt: now,
      closedAt: null,
    })
    .run();
}

/** Selected-agent views for a page of tasks, in one query whatever its size. */
export function selectedAgentViews(
  db: Db,
  rows: readonly Pick<TaskRow, 'selectedAgentId'>[],
): Map<string, SelectedAgentView> {
  const ids = [
    ...new Set(rows.map((r) => r.selectedAgentId).filter((id): id is string => id !== null)),
  ];
  if (ids.length === 0) return new Map();

  return new Map(
    db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        harness: agents.harness,
        deviceLabel: agents.deviceLabel,
        status: agents.status,
        ownerId: users.id,
        ownerName: users.name,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.ownerUserId))
      .where(inArray(agents.id, ids))
      .all()
      .map((r) => [
        r.id,
        {
          id: r.id,
          display_name: r.displayName,
          harness: r.harness,
          device_label: r.deviceLabel,
          status: r.status,
          owner: { id: r.ownerId, name: r.ownerName },
        },
      ]),
  );
}

export interface ListWorkRequestsOptions {
  limit: number;
  /** Keyset position, `(created_at, id)`, matching the ORDER BY below. */
  cursor: { sortKey: string | number; id: string } | null;
}

/**
 * The open work requests addressed to **the calling agent**, newest first.
 *
 * Only an agent's own token has a "me" to ask about: a session or a legacy
 * token is `403` with `reason: not_an_agent`, because answering with every one
 * of the person's agents' requests would be a different question with the same
 * name. A request on a task the agent can no longer read — its grant narrowed
 * since — is left out rather than disclosed.
 */
export function listOwnWorkRequests(
  db: Db,
  actor: ResolvedActor,
  options: ListWorkRequestsOptions,
): WorkRequestView[] {
  assertCan(actor, 'agent.read_own');
  const agent = actor.token?.agent;
  if (agent === null || agent === undefined) {
    throw new ApiError('forbidden', 'Only a registered agent’s token has work requests', {
      reason: 'not_an_agent',
    });
  }

  const agentId = agent.id;

  // Filtered in SQL rather than after the page is cut, so a page is never
  // short while more remain. The agent's grants bound it; its owner's
  // current role bounds those.
  const readable = [...agent.grants.keys()].filter((projectId) =>
    can(withProject(actor, projectId), 'project.read', { projectId }),
  );
  if (readable.length === 0) return [];

  const conditions: SQL[] = [
    eq(handoffOffers.toAgentId, agentId),
    inArray(tasks.projectId, readable),
    eq(handoffOffers.kind, 'work_request'),
    eq(handoffOffers.state, 'open'),
  ];
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(handoffOffers.createdAt, key),
        and(eq(handoffOffers.createdAt, key), lt(handoffOffers.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select({
      id: handoffOffers.id,
      taskId: tasks.id,
      number: tasks.number,
      title: tasks.title,
      projectId: tasks.projectId,
      prefix: projects.prefix,
      createdBy: handoffOffers.createdByUserId,
      createdAt: handoffOffers.createdAt,
    })
    .from(handoffOffers)
    .innerJoin(tasks, eq(tasks.id, handoffOffers.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...conditions))
    .orderBy(desc(handoffOffers.createdAt), desc(handoffOffers.id))
    .limit(options.limit + 1)
    .all()
    .map((r) => ({
      id: r.id,
      kind: 'work_request' as const,
      state: 'open' as const,
      task_id: r.taskId,
      task_key: `${r.prefix}-${String(r.number)}`,
      task_title: r.title,
      project_id: r.projectId,
      agent_id: agentId,
      requested_by: r.createdBy,
      created_at: r.createdAt,
    }));
}
