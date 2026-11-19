import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { assertTaskReachable } from '../../services/task-archive.ts';
import { type AppEnv } from '../context.ts';

/**
 * **A task in Trash does not exist to a token, anywhere under
 * `/api/v1/tasks/:id`** (LAI-1354 review). Mounted on the subtree, after
 * auth, so every route there — the task, its comments, files, rounds,
 * checkpoints, offers, watchers, estimate, time and usage — answers a token
 * the `404` a missing id gets, whichever of them it asks. The rule is the
 * service's (`assertTaskReachable`); this only puts it in front of them all.
 *
 * `:id` is whatever the path holds — `summary` too, which names no task and
 * passes straight through.
 */
export function trashGate(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    assertTaskReachable(db, c.get('actor'), c.req.param('id') ?? '');
    await next();
  });
}
