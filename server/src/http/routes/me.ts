import { Hono } from 'hono';
import { type AppEnv } from '../context.ts';
import { ApiError } from '../errors.ts';

export interface MeBody {
  id: string;
  email: string;
  name: string;
  org_role: string;
  is_active: boolean;
  memberships: { project_id: string; role: string }[];
}

/**
 * `GET /api/v1/me` (SPEC §6.4) — who am I, and what am I a member of.
 *
 * The SPA reads this to render the shell (LAI-007); an agent reads it to confirm
 * which user its token acts as. Same endpoint for both, which is what keeps the
 * API honest (§11.4).
 */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const actor = c.get('actor');

    if (actor === null) {
      throw new ApiError('unauthorized', 'Not signed in');
    }

    return c.json<MeBody>({
      id: actor.userId,
      email: actor.email,
      name: actor.name,
      org_role: actor.orgRole,
      is_active: actor.isActive,
      memberships: actor.memberships.map((m) => ({ project_id: m.projectId, role: m.role })),
    });
  });

  return app;
}
