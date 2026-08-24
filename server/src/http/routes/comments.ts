import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addComment,
  commentView,
  deleteComment,
  editComment,
  listComments,
  type CommentView,
} from '../../services/comments.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince, tombstone, type WithTombstones } from '../updated-since.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/** Comments (SPEC §6.4). Transport only — the rules live in `services/comments.ts`. */

const BodyMd = z.string().trim().min(1).max(100_000);
const CreateBody = strictObject({ body_md: BodyMd });
const EditBody = strictObject({ body_md: BodyMd });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** Mounted at `/api/v1/tasks` — comments hang off a task. */
export function taskCommentRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/comments', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    const updatedSince = parseUpdatedSince(c.req.query('updated_since'));

    const rows = listComments(db, actor, c.req.param('id'), { limit, cursor, updatedSince });

    // Paginate the raw rows: the cursor is `(created_at, id)` and a tombstone
    // carries neither.
    const paged = buildPage(rows, limit, (row) => ({ sortKey: row.createdAt, id: row.id }));

    const page: Page<WithTombstones<CommentView>> = {
      data: paged.data.map((row) =>
        row.deletedAt === null ? commentView(row) : tombstone(row.id),
      ),
      next_cursor: paged.next_cursor,
    };

    return c.json(page);
  });

  app.post('/:id/comments', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));

    return c.json(addComment(db, actor, c.req.param('id'), body.body_md), 201);
  });

  return app;
}

/** Mounted at `/api/v1/comments` — editing and deleting address the comment (§6.4). */
export function commentRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(EditBody, await c.req.json().catch(() => null));

    return c.json(editComment(db, actor, c.req.param('id'), body.body_md));
  });

  app.delete('/:id', (c) => {
    deleteComment(db, requireActor(c), c.req.param('id'));
    // 204: the resource is gone from every ordinary view, and there is no
    // representation worth returning.
    return c.body(null, 204);
  });

  return app;
}
