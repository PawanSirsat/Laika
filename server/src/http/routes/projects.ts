import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addMember,
  archivedTombstones,
  changeMemberRole,
  createProject,
  getProject,
  joinPublicProject,
  listMembers,
  listProjects,
  removeMember,
  updateProject,
  type ProjectView,
} from '../../services/projects.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince, tombstone, type WithTombstones } from '../updated-since.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Projects and memberships (SPEC §6.4). Transport only — every decision lives in
 * `services/projects.ts` so the M3 MCP tools reuse it unchanged (CONVENTIONS §2).
 */

const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'A slug is lowercase words joined by hyphens');

const Prefix = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z][A-Za-z0-9]{1,7}$/,
    'A prefix is 2-8 letters and digits, starting with a letter',
  );

const CreateBody = strictObject({
  name: z.string().trim().min(1).max(120),
  slug: Slug,
  prefix: Prefix,
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const UpdateBody = strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  context_md: z.string().max(100_000).optional(),
  archived: z.boolean().optional(),
});

const MemberBody = strictObject({
  user_id: z.string().min(1),
  role: z.enum(['lead', 'member', 'viewer']),
});

const RoleBody = strictObject({ role: z.enum(['lead', 'member', 'viewer']) });

/** Every route needs a signed-in actor; the gate is `can()`, this is the 401. */
function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export interface ProjectRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

export function projectRoutes(options: ProjectRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    const updatedSince = parseUpdatedSince(c.req.query('updated_since'));

    const rows = listProjects(db, actor, { limit, cursor, updatedSince });

    // Paginate the raw rows first: the cursor is `(updated_at, id)` and a
    // tombstone carries neither, so mapping before paging would lose the key.
    const paged = buildPage(rows, limit, (row) => ({ sortKey: row.updatedAt, id: row.id }));

    // §6.3 tombstones. An archived project is this resource's soft-delete: it
    // stays reachable by slug but must disappear from a catching-up client's
    // list, and a client that only saw changed rows would keep showing it.
    const archived = new Set(archivedTombstones(paged.data));

    const page: Page<WithTombstones<ProjectView>> = {
      data: paged.data.map((row) =>
        archived.has(row.id)
          ? tombstone(row.id)
          : ({
              id: row.id,
              slug: row.slug,
              prefix: row.prefix,
              name: row.name,
              description: row.description,
              visibility: row.visibility,
              context_md: row.contextMd,
              archived_at: row.archivedAt,
              created_at: row.createdAt,
              updated_at: row.updatedAt,
            } satisfies ProjectView),
      ),
      next_cursor: paged.next_cursor,
    };

    return c.json(page);
  });

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));

    return c.json(createProject(sqlite, db, actor, body), 201);
  });

  app.get('/:slug', (c) => c.json(getProject(db, requireActor(c), c.req.param('slug'))));

  app.patch('/:slug', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UpdateBody, await c.req.json().catch(() => null));

    return c.json(updateProject(db, actor, c.req.param('slug'), body));
  });

  app.post('/:slug/join', (c) =>
    c.json({ members: joinPublicProject(db, requireActor(c), c.req.param('slug')) }, 201),
  );

  app.get('/:slug/members', (c) =>
    c.json({ members: listMembers(db, requireActor(c), c.req.param('slug')) }),
  );

  app.post('/:slug/members', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(MemberBody, await c.req.json().catch(() => null));

    return c.json(
      { members: addMember(db, actor, c.req.param('slug'), body.user_id, body.role) },
      201,
    );
  });

  app.patch('/:slug/members/:userId', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RoleBody, await c.req.json().catch(() => null));

    return c.json({
      members: changeMemberRole(db, actor, c.req.param('slug'), c.req.param('userId'), body.role),
    });
  });

  app.delete('/:slug/members/:userId', (c) =>
    c.json({
      members: removeMember(db, requireActor(c), c.req.param('slug'), c.req.param('userId')),
    }),
  );

  return app;
}
