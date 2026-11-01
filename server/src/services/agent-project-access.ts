import { and, eq } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AgentGrantScope, type ProjectRole } from '../db/enums.ts';
import { agentProjectGrants } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, effectiveProjectRole } from '../policy/can.ts';
import { requireOwnAgent } from './agents.ts';
import { requireReadableProjectBySlug } from './projects.ts';

/**
 * One of your tools against one project, as Project setup asks it (SPEC §6.4,
 * plan LAI-1042 §E.5, LAI-1052).
 *
 * **Two facts, never one.** What *you* may do in the project (your membership)
 * and what *the tool* was given there (its grant, §4.64) are separate rows and
 * are answered as separate fields, because a screen that showed one word for
 * both could not say why a tool you lead with only reads. `effective` is their
 * intersection, worked out by the rule `can()` already applies to an agent's
 * token — this module reads that rule and changes nothing in it.
 *
 * **Only the owner, signed in.** The question is the owner's while choosing a
 * grant, so a token — the agent's own included — is refused
 * `403 session_required`. Another owner's agent and an id that names nothing
 * are the one `404` {@link ApiError.agentNotFound} answers everywhere, and a
 * project the owner cannot read is the slug's `404`, so nothing here says
 * whether either exists.
 *
 * It reads and writes no grant. Changing one is `PUT /agents/:id/grants`,
 * which already validates every project against the owner.
 */

export type ProjectAccessLevel = 'none' | AgentGrantScope;

/** Why `can_grant.max` is what it is, or `null` when the owner may grant `full`. */
export type GrantLimitReason = 'viewer_role' | 'agent_revoked';

export interface ProjectAccessView {
  agent_id: string;
  project: {
    id: string;
    slug: string;
    name: string;
    prefix: string;
    /** The space's own switch (§4.3): `false` lets an agent only read there. */
    agents_allowed: boolean;
  };
  /** The owner's own standing in the project — never the tool's. */
  member: {
    /** `null`: no membership row, and none implied by the org role. */
    role: ProjectRole | null;
    can_read: boolean;
    can_write: boolean;
  };
  /** The tool's grant row, `null` when it has none (no access). */
  grant: { scope: AgentGrantScope | null };
  /** What the tool can actually do there: grant ∩ owner ∩ space. */
  effective: ProjectAccessLevel;
  /** The widest grant the owner may usefully give; `null` gives nothing. */
  can_grant: { max: AgentGrantScope | null; reason: GrantLimitReason | null };
}

export function getAgentProjectAccess(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  projectSlug: string,
): ProjectAccessView {
  assertCan(actor, 'agent.read_own');
  if (actor.token !== null && actor.token !== undefined) {
    throw new ApiError('forbidden', 'This needs a signed-in web session, not a token', {
      action: 'agent.read_own',
      reason: 'session_required',
    });
  }
  const agent = requireOwnAgent(db, actor, agentId);
  const project = requireReadableProjectBySlug(db, actor, projectSlug);

  const scoped = withProject(actor, project.id);
  const resource = { projectId: project.id };
  const canRead = can(scoped, 'project.read', resource);
  const canWrite = can(scoped, 'task.write', resource);

  const grant =
    db
      .select({ scope: agentProjectGrants.scope })
      .from(agentProjectGrants)
      .where(
        and(eq(agentProjectGrants.agentId, agent.id), eq(agentProjectGrants.projectId, project.id)),
      )
      .get()?.scope ?? null;

  const active = agent.status === 'active';
  const ownerMax: ProjectAccessLevel = canWrite ? 'full' : canRead ? 'read_only' : 'none';
  const spaceMax: ProjectAccessLevel = project.agentsAllowed ? 'full' : 'read_only';
  const effective = active ? narrowest(grant ?? 'none', ownerMax, spaceMax) : 'none';

  const canGrant: ProjectAccessView['can_grant'] = !active
    ? { max: null, reason: 'agent_revoked' }
    : canWrite
      ? { max: 'full', reason: null }
      : { max: 'read_only', reason: 'viewer_role' };

  return {
    agent_id: agent.id,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      prefix: project.prefix,
      agents_allowed: project.agentsAllowed,
    },
    member: { role: effectiveProjectRole(scoped), can_read: canRead, can_write: canWrite },
    grant: { scope: grant },
    effective,
    can_grant: canGrant,
  };
}

const RANK: Readonly<Record<ProjectAccessLevel, number>> = { none: 0, read_only: 1, full: 2 };

function narrowest(...levels: ProjectAccessLevel[]): ProjectAccessLevel {
  return levels.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}
