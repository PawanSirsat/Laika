/**
 * The `/me` read path (SPEC §6.4), as a service.
 *
 * This is the worked example for the layering rule in `docs/CONVENTIONS.md` §2:
 * a service takes an `Actor` and plain arguments, decides, and returns data. It
 * knows nothing about HTTP — no `Context`, no status codes, no headers — so the
 * REST route and the M3 MCP tool can both call it and **cannot** diverge. SPEC §7
 * calls MCP tools "a thin wrapper over the same service layer the REST routes
 * use"; that is only true if the logic lives here.
 *
 * Failures throw `ApiError` (§6.3). The transport layer maps it to a status; the
 * MCP layer will map the same error to a tool error.
 */

import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { ApiError } from '../errors.ts';

export interface Membership {
  project_id: string;
  role: string;
}

/** The wire shape of `GET /api/v1/me`. Snake_case, like the rest of the API. */
export interface MeProfile {
  id: string;
  email: string;
  name: string;
  org_role: string;
  is_active: boolean;
  memberships: Membership[];
}

/**
 * Who is this request, and what are they a member of.
 *
 * Takes the already-resolved actor rather than loading one: the auth middleware
 * has done that lookup, and §3.3 rule 2 puts the loading on the caller so the
 * decision layer stays pure and testable. Re-reading here would mean two queries
 * per request for the same row.
 */
export function getCurrentUser(actor: ResolvedActor | null): MeProfile {
  if (actor === null) {
    throw new ApiError('unauthorized', 'Not signed in');
  }

  // A deactivated user keeps their rows so history keeps its author (§4.1), but
  // an existing session must stop working the moment they are deactivated —
  // otherwise deactivation only takes effect whenever they next sign out.
  if (!actor.isActive) {
    throw new ApiError('forbidden', 'This account has been deactivated');
  }

  return {
    id: actor.userId,
    email: actor.email,
    name: actor.name,
    org_role: actor.orgRole,
    is_active: actor.isActive,
    memberships: actor.memberships.map((m) => ({ project_id: m.projectId, role: m.role })),
  };
}
