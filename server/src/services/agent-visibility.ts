import { inArray } from 'drizzle-orm';
import { isSystemPrincipal, type ServiceCaller } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { agents, tasks } from '../db/schema.ts';
import { liveClaimViews } from './claims.ts';

/**
 * Whom a registered agent may be named to (D-120, D-121 item 7, LAI-1011).
 *
 * Another person's agent is **missing, not hidden**. A read names an agent only
 * to:
 *
 * - its owner, or
 * - a reader of a task that already shows that agent, as its selected agent or
 *   as the holder of its live claim. The task view names it there anyway, so
 *   naming it again beside the same task tells the reader nothing new.
 *
 * Everyone else reads *an agent*. This is the one gate: rounds (LAI-1001) and
 * every activity surface (`eventView`) ask it, so the two cannot drift.
 */

/** The reader's user id, or `null` for a principal with no user (a delivery), who is shown none. */
export type AgentReader = string | null;

export function agentReader(caller: ServiceCaller): AgentReader {
  return isSystemPrincipal(caller) ? null : caller.userId;
}

/** Answers "may this reader see agent A beside task T?" for one page of reads. */
export interface AgentLens {
  visible(taskId: string | null, agentId: string): boolean;
}

/** A lens that names no agent at all, for a reader with no user. */
export const BLIND_LENS: AgentLens = { visible: () => false };

/**
 * One lens for a page: the owner of each agent asked about, and what each task
 * already shows. **Two queries plus the live claims, whatever the page holds.**
 *
 * The task's selected agent and live claim are read **now**, the predicate the
 * task's own view uses (`liveClaimViews`, lapsed leases and the boot grace
 * included). A claim the task no longer shows names nobody here either.
 */
export function agentLens(
  db: Db,
  reader: AgentReader,
  taskIds: readonly (string | null)[],
  agentIds: readonly string[],
): AgentLens {
  if (reader === null) return BLIND_LENS;
  const wantedAgents = [...new Set(agentIds)];
  if (wantedAgents.length === 0) return BLIND_LENS;

  const ownerOf = new Map(
    db
      .select({ id: agents.id, owner: agents.ownerUserId })
      .from(agents)
      .where(inArray(agents.id, wantedAgents))
      .all()
      .map((a) => [a.id, a.owner] as const),
  );

  const wantedTasks = [...new Set(taskIds.flatMap((t) => (t === null ? [] : [t])))];
  const shownOnTask = new Map<string, Set<string>>();
  const show = (taskId: string, agentId: string | null): void => {
    if (agentId === null) return;
    shownOnTask.set(taskId, (shownOnTask.get(taskId) ?? new Set()).add(agentId));
  };
  if (wantedTasks.length > 0) {
    for (const t of db
      .select({ id: tasks.id, selected: tasks.selectedAgentId })
      .from(tasks)
      .where(inArray(tasks.id, wantedTasks))
      .all()) {
      show(t.id, t.selected);
    }
    for (const [taskId, claim] of liveClaimViews(db, wantedTasks, Date.now())) {
      show(taskId, claim.agent_id);
    }
  }

  return {
    visible(taskId, agentId) {
      const owner = ownerOf.get(agentId);
      if (owner === undefined) return false;
      return owner === reader || (taskId !== null && shownOnTask.get(taskId)?.has(agentId) === true);
    },
  };
}
