import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  createBoardColumn,
  deleteBoardColumn,
  listBoardColumns,
  reorderBoardColumns,
  setColumnStatuses,
  TASK_STATUSES,
  updateBoardColumn,
} from '../../services/board-columns.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Board columns (LAI-266). Transport only — every rule lives in
 * `services/board-columns.ts`, so the MCP tools would get them unchanged by
 * calling the same functions (CONVENTIONS §2).
 *
 * **A file of its own rather than more of `routes/projects.ts`**, which is
 * already near three hundred lines across projects, members, context, tags and
 * mentionable. `structure.test.ts` then wants
 * `test/http/routes/board-columns.test.ts` beside it, which is the boundary this
 * wants anyway.
 *
 * `TASK_STATUSES` is imported through the service, never from `db/` —
 * CONVENTIONS §2 forbids `http/routes/` reaching into `db/`, and
 * `http/vocabularies.test.ts` exists because two route files once retyped a
 * vocabulary and the copies drifted.
 */

const Name = z.string().trim().min(1).max(40);
const Status = z.enum(TASK_STATUSES);

const CreateBody = strictObject({ name: Name });
const UpdateBody = strictObject({
  name: Name.optional(),
  hidden: z.boolean().optional(),
});
const StatusesBody = strictObject({
  /** Primary first — the order is the contract, not a detail. */
  statuses: z.array(Status).min(1),
});
const DeleteBody = strictObject({ reassign_to_column_id: z.string().min(1) });
const ReorderBody = strictObject({ column_ids: z.array(z.string().min(1)).min(1) });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export interface BoardColumnRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

export function projectBoardColumnRoutes(options: BoardColumnRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:slug/board-columns', (c) => {
    const actor = requireActor(c);

    // Not paginated, deliberately: a board has four to eight columns, and a
    // cursor over them would be ceremony around a list that is always one page.
    return c.json({ columns: listBoardColumns(db, actor, c.req.param('slug')) });
  });

  app.post('/:slug/board-columns', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(CreateBody, await body(c));

    return c.json(
      { columns: createBoardColumn(sqlite, db, actor, c.req.param('slug'), input) },
      201,
    );
  });

  app.patch('/:slug/board-columns/:id', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(UpdateBody, await body(c));

    if (input.name === undefined && input.hidden === undefined) {
      throw new ApiError('unprocessable', 'Send a name or a hidden flag to change');
    }

    return c.json({
      columns: updateBoardColumn(
        sqlite,
        db,
        actor,
        c.req.param('slug'),
        c.req.param('id'),
        input,
      ),
    });
  });

  /*
   * `PUT`, because it replaces the column's whole status list rather than adding
   * to it — and because one request per gesture is what keeps the invariant
   * safe. Two `PATCH`es moving `review` out of one column and into another can
   * half-apply, and the half that lands leaves `review` in no column at all.
   */
  app.put('/:slug/board-columns/:id/statuses', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(StatusesBody, await body(c));

    return c.json({
      columns: setColumnStatuses(
        sqlite,
        db,
        actor,
        c.req.param('slug'),
        c.req.param('id'),
        input.statuses,
      ),
    });
  });

  /*
   * A body on `DELETE`, which is unusual. The alternative is
   * `?reassign_to_column_id=`, and hiding the destination of somebody's tasks in
   * a query string reads as optional when it is required.
   */
  app.delete('/:slug/board-columns/:id', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(DeleteBody, await body(c));

    return c.json(
      deleteBoardColumn(
        sqlite,
        db,
        actor,
        c.req.param('slug'),
        c.req.param('id'),
        input.reassign_to_column_id,
      ),
    );
  });

  /*
   * `POST …/reorder` rather than `PUT …`, matching the spelling LAI-472 has
   * already written into a task file for the card equivalent. The body is the
   * **whole** order: a stale client sending a partial list is refused rather
   * than silently dropping a column.
   */
  app.post('/:slug/board-columns/reorder', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(ReorderBody, await body(c));

    return c.json({
      columns: reorderBoardColumns(sqlite, db, actor, c.req.param('slug'), input.column_ids),
    });
  });

  return app;
}
