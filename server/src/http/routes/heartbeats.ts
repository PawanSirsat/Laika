import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { BRANCH_MAX_LENGTH, recordHeartbeat, REPO_MAX_LENGTH } from '../../services/heartbeats.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `POST /api/v1/heartbeats` (SPEC §9.1, §6.4, D-023).
 *
 * ## Token auth only, and why the route enforces it
 *
 * §9.1 says token auth only, and §8's hook sends a `Bearer`. A browser has no
 * reason to post presence: the board already knows a person is looking at it,
 * and accepting a cookie here would make a session's mere existence into a
 * claim about what somebody is working on.
 *
 * `can()` cannot express this — §3.1 grades by role, and this is a statement
 * about the **credential**. So the check lives here, next to the transport
 * concern it actually is, and the service keeps the permission question.
 *
 * `202`, not `201`: the row is accepted, and what it will eventually mean —
 * `matched_task_id`, presence, capacity — is resolved later or not at all (§9.2
 * is M5). `201 Created` would promise a resource a client can go and read, and
 * there is nothing to read yet.
 */

const HeartbeatBody = strictObject({
  repo: z.string().trim().min(1).max(REPO_MAX_LENGTH),
  branch: z.string().trim().min(1).max(BRANCH_MAX_LENGTH),
});

export interface HeartbeatRouteOptions {
  db: Db;
}

export function heartbeatRoutes(options: HeartbeatRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.post('/', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    // The credential check §9.1 asks for. A cookie resolves a perfectly good
    // actor — that is exactly why this has to be said explicitly rather than
    // left to `can()`, which would allow them.
    if (actor.token === null || actor.token === undefined) {
      throw new ApiError('forbidden', 'Heartbeats are sent with a personal access token', {
        reason: 'token_required',
      });
    }

    const body = parseBody(HeartbeatBody, await c.req.json().catch(() => null));
    const beat = recordHeartbeat(db, actor, body);

    // A heartbeat naming a repo no project tracks is accepted — §9.2's rule is
    // that unmatched input degrades and never errors — but it is almost always a
    // misconfigured plugin, and silently accepting it is how somebody finds out
    // weeks later that presence was empty the whole time. So it is said once,
    // here, where an operator reading logs will see it.
    if (beat.attribution === 'none') {
      c.get('log').warn('heartbeat.repo_unmatched', { repo: beat.repo });
    } else if (beat.project_ids.length > 1) {
      // Not a warning: LAI-108 permits this deliberately. Recorded so an
      // operator can tell "present on two projects" from a bug.
      c.get('log').info('heartbeat.repo_ambiguous', {
        repo: beat.repo,
        branch: beat.branch,
        project_count: beat.project_ids.length,
      });
    }

    // Nothing in the body: there is nothing useful to say, and returning the row
    // would invite a client to depend on `matched_task_id`, which is null until
    // §9.2 lands in M5. The resolution above is deliberately not serialised
    // either — widening §9.1's response is a contract change and belongs in its
    // own task, not as a ride-along here (LAI-116).
    return c.body(null, 202);
  });

  return app;
}
