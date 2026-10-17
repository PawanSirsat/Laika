import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { listReviewQueue } from '../../services/review.ts';
import { type AppEnv } from '../context.ts';

/**
 * `/api/v1/review` — the review queue (SPEC §6.4, §11.4, D-081).
 *
 * Transport only: which projects count, the order and who may decide are
 * `services/review.ts`'s. Not paged: the queue is what is waiting for a
 * person, and it answers at most `REVIEW_QUEUE_LIMIT` tasks, oldest first,
 * with `truncated` saying when there were more.
 */
export function reviewRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json(listReviewQueue(options.db, actor));
  });

  return app;
}
