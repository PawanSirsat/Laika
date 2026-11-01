import type { AgentGrantScope } from './agents.ts';
import { request } from './client.ts';

/**
 * One of your tools against one project (SPEC §6.4, LAI-1052): what Project
 * setup asks before it offers a grant.
 *
 * **Your membership and the tool's grant are two facts**, and the screen
 * shows them as two lines: a lead whose tool only reads is a grant question,
 * not a role one. `effective` is their intersection, the space's switch
 * included. Signed in only; another person's agent is a `404`.
 *
 * Mirrors `ProjectAccessView` in `services/agent-project-access.ts`;
 * `view-type-drift.test.ts` holds the two in step. A grant changes through
 * `setAgentGrants` — there is no grant endpoint here.
 */

export type ProjectAccessLevel = 'none' | AgentGrantScope;

export type GrantLimitReason = 'viewer_role' | 'agent_revoked';

export interface ProjectAccess {
  readonly agent_id: string;
  readonly project: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly prefix: string;
    readonly agents_allowed: boolean;
  };
  readonly member: {
    readonly role: 'lead' | 'member' | 'viewer' | null;
    readonly can_read: boolean;
    readonly can_write: boolean;
  };
  readonly grant: { readonly scope: AgentGrantScope | null };
  readonly effective: ProjectAccessLevel;
  readonly can_grant: {
    readonly max: AgentGrantScope | null;
    readonly reason: GrantLimitReason | null;
  };
}

export function getProjectAccess(
  agentId: string,
  projectSlug: string,
  signal?: AbortSignal,
): Promise<ProjectAccess> {
  return request<ProjectAccess>(
    `/agents/${encodeURIComponent(agentId)}/project-access?project=${encodeURIComponent(projectSlug)}`,
    signal === undefined ? {} : { signal },
  );
}
