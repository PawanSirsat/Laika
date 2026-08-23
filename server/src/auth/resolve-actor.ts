import { eq } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { type ProjectRole } from '../db/enums.ts';
import { projectMemberships, users } from '../db/schema.ts';
import { type Actor } from '../policy/can.ts';
import { type Auth } from './auth.ts';

/**
 * Turn a request into an `Actor`, or `null` when nobody is signed in.
 *
 * Shaped as "request in, actor out" deliberately (LAI-005 notes): personal access
 * tokens arrive in M3 as a second credential source, and they should slot in as
 * another branch here rather than as a second, parallel notion of who is asking.
 * Everything downstream — `can()`, the handlers, the MCP tools — sees one type.
 */

export interface ResolvedActor extends Actor {
  email: string;
  name: string;
  /** Every project the user belongs to, so `/me` can report them (§6.4). */
  memberships: { projectId: string; role: ProjectRole }[];
}

export interface ResolveActorOptions {
  auth: Auth;
  db: Db;
}

export async function resolveActor(
  request: Request,
  options: ResolveActorOptions,
): Promise<ResolvedActor | null> {
  const session = await options.auth.api.getSession({ headers: request.headers });
  if (session === null) return null;

  return loadActor(options.db, session.user.id);
}

/**
 * Load the actor from its id.
 *
 * Read from the database rather than trusted from the session payload: org role
 * and active status change, and a session minted before a demotion must not keep
 * carrying the old role around.
 */
export function loadActor(db: Db, userId: string): ResolvedActor | null {
  const row = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      orgRole: users.orgRole,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (row === undefined) return null;

  const memberships = db
    .select({ projectId: projectMemberships.projectId, role: projectMemberships.role })
    .from(projectMemberships)
    .where(eq(projectMemberships.userId, userId))
    .all();

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    orgRole: row.orgRole,
    isActive: row.isActive === 1,
    // `can()` takes one already-resolved project role (§3.3 rule 2). The caller
    // picks which project the request concerns; see `withProject`.
    projectRole: null,
    memberships,
    token: null,
  };
}

/**
 * The actor as `can()` wants it for a specific project — the membership row
 * resolved, or `null` for a non-member.
 *
 * A helper rather than something each handler does by hand: a handler that
 * forgets it passes `projectRole: null` and silently denies, which looks like a
 * permissions bug and is very hard to spot in review.
 */
export function withProject(actor: ResolvedActor, projectId: string): ResolvedActor {
  const membership = actor.memberships.find((m) => m.projectId === projectId);

  return { ...actor, projectRole: membership?.role ?? null };
}
