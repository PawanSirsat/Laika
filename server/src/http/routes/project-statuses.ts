import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  createProjectStatus,
  deleteProjectStatus,
  listProjectStatuses,
  reorderProjectStatuses,
  TASK_STATUSES,
  updateProjectStatus,
} from '../../services/project-statuses.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * A project's statuses (§6.4, LAI-738, D-077). Transport only — every rule
 * lives in `services/project-statuses.ts` (CONVENTIONS §2).
 *
 * **Every write answers with the project's whole list, by position.** Adding,
 * deleting or reordering one status moves others, and a client that
 * re-derived their positions would be guessing — the same reason LAI-266's
 * column routes returned the whole board.
 *
 * Not paginated: a project has a handful of statuses, and a cursor over them
 * would be ceremony around a list that is always one page.
 */

const Name = z.string().trim().min(1).max(40);

const CreateBody = strictObject({
  name: Name,
  category: z.enum(TASK_STATUSES),
  position: z.number().int().min(0).optional(),
});
const UpdateBody = strictObject({
  name: Name.optional(),
  hidden: z.boolean().optional(),
  // Accepted only to be refused in words: a strict-object "unknown key" error
  // would not tell the person that categories are fixed, or what to do instead.
  category: z.unknown().optional(),
});
const OrderBody = strictObject({ ids: z.array(z.string().min(1)).min(1) });
const DeleteBody = strictObject({ move_to: z.string().min(1) });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export interface ProjectStatusRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** Mounted at `/api/v1/projects`. */
export function projectStatusRoutes(options: ProjectStatusRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:slug/statuses', (c) =>
    c.json({ data: listProjectStatuses(db, requireActor(c), c.req.param('slug')) }),
  );

  app.post('/:slug/statuses', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(CreateBody, await body(c));

    return c.json(
      { data: createProjectStatus(sqlite, db, actor, c.req.param('slug'), input) },
      201,
    );
  });

  /*
   * The whole order, every id once. Registered before `/:id` so `order` is
   * never read as a status id — `PUT` has no `/:id` twin today, and this keeps
   * it from mattering if one arrives.
   */
  app.put('/:slug/statuses/order', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(OrderBody, await body(c));

    return c.json({
      data: reorderProjectStatuses(sqlite, db, actor, c.req.param('slug'), input.ids),
    });
  });

  app.patch('/:slug/statuses/:id', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(UpdateBody, await body(c));

    if (input.category !== undefined) {
      throw new ApiError(
        'unprocessable',
        'A status’s category cannot be changed. Make a new status in the category you want, then delete this one and move its work there.',
        { field: 'category' },
      );
    }
    if (input.name === undefined && input.hidden === undefined) {
      throw new ApiError('unprocessable', 'Send a name or a hidden flag to change');
    }

    return c.json({
      data: updateProjectStatus(sqlite, db, actor, c.req.param('slug'), c.req.param('id'), {
        name: input.name,
        hidden: input.hidden,
      }),
    });
  });

  /*
   * A body on `DELETE`, as LAI-266's column delete had: where somebody's work
   * goes is required, and a query string reads as optional.
   */
  app.delete('/:slug/statuses/:id', async (c) => {
    const actor = requireActor(c);
    const input = parseBody(DeleteBody, await body(c));

    return c.json(
      deleteProjectStatus(sqlite, db, actor, c.req.param('slug'), c.req.param('id'), input.move_to),
    );
  });

  return app;
}
