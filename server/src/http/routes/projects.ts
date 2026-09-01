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
  getProjectContext,
  joinPublicProject,
  listMembers,
  listProjects,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  projectSummaries,
  projectSummaryView,
  removeMember,
  updateProject,
  updateProjectContext,
  type ProjectSummary,
} from '../../services/projects.ts';
import { deleteTag, listProjectTags, renameTag } from '../../services/tags.ts';
import { mentionableUsers } from '../../services/mentions.ts';
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
  visibility: z.enum(PROJECT_VISIBILITIES).optional(),
});

const UpdateBody = strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  // `owner/name` (§4.3). Trimmed but not rewritten — the service refuses a URL
  // rather than guessing at one, and `null` clears the field.
  //
  // No `.max` (LAI-159): it was `REPO_MAX_LENGTH`, the constant the service
  // compares against, so zod refused first and the caller lost the
  // `{ expected: 'owner/name', example }` detail that says what the field should
  // look like rather than how long it may be.
  repo: z.string().trim().min(1).nullable().optional(),
  visibility: z.enum(PROJECT_VISIBILITIES).optional(),
  // `context_md` is **not** here since LAI-404. It has its own pair below, so
  // there is one writer of the column, one place enforcing the size bound, and
  // one shape of audit row. `.strict()` means a client still sending it here
  // gets a 422 naming the field rather than having it silently ignored.
  archived: z.boolean().optional(),
});

/**
 * The size bound is the service's (`CONTEXT_MD_LIMIT`), and **only** the
 * service's (LAI-228).
 *
 * This schema said the same thing with `.max(CONTEXT_MD_LIMIT)`, and the comment
 * above it already claimed the service owned the rule. Both were true and the
 * combination was not: **zod runs first**, so its refusal is the one a REST
 * caller got —
 *
 * ```
 * "Too big: expected string to have <=100000 characters"
 * ```
 *
 * — which names the limit and **not the actual length**. §7.3 asks for both, and
 * singles out the length as the half that matters: *"a caller that has to guess
 * how much to cut will guess wrong"*. Two layers enforcing one bound are enforced
 * by whichever runs first, and here that silently discarded the more informative
 * error. MCP, which does not pass through zod, had the better message all along.
 *
 * **The type check stays.** Dropping `.max` must not drop `z.string()`: a number
 * or a missing field is a malformed request, which is this schema's job, where
 * the size is the service's.
 */
const ContextBody = strictObject({
  context_md: z.string(),
});

const MemberBody = strictObject({
  user_id: z.string().min(1),
  role: z.enum(PROJECT_ROLES),
});

const RoleBody = strictObject({ role: z.enum(PROJECT_ROLES) });

// The shape is validated in `services/tags.ts` beside the CHECK it mirrors, so
// this only bounds the length — two regexes for one rule is how they drift.
const RenameTagBody = strictObject({ name: z.string().trim().min(1).max(64) });

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

    // One set of aggregates for the whole page (LAI-053). Computed after paging
    // so it covers exactly the rows being returned, and skipping tombstones —
    // an archived project's counts are not something a catching-up client wants.
    const summaries = projectSummaries(
      db,
      paged.data.filter((row) => !archived.has(row.id)).map((row) => row.id),
    );

    const page: Page<WithTombstones<ProjectSummary>> = {
      // `projectSummaryView` from the service, not a copy of it: this mapping used
      // to be written out here and was missing §4.3's `repo` the moment it landed.
      data: paged.data.map((row) =>
        archived.has(row.id) ? tombstone(row.id) : projectSummaryView(row, summaries.get(row.id)),
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

  // §6.4's dedicated pair. `GET` follows project read — a viewer sees it (§7.3);
  // `PATCH` is lead+ via `project.settings.edit`. Both `can()` calls are in the
  // service, where an MCP tool reaching the same function gets them too.
  app.get('/:slug/context', (c) =>
    c.json(getProjectContext(db, requireActor(c), c.req.param('slug'))),
  );

  app.patch('/:slug/context', async (c) => {
    const body = parseBody(ContextBody, await c.req.json().catch(() => null));

    return c.json(
      updateProjectContext(db, requireActor(c), c.req.param('slug'), {
        context_md: body.context_md,
      }),
    );
  });

  app.post('/:slug/join', (c) =>
    c.json({ members: joinPublicProject(db, requireActor(c), c.req.param('slug')) }, 201),
  );

  /**
   * §6.4's three tag endpoints (§4.16, LAI-079).
   *
   * They live on the project because a tag is project-scoped — `ui` on a server
   * project is not `ui` on the web one. There is no create endpoint: a tag comes
   * into existence by being applied to a task, which is `PATCH /tasks/:id`.
   */
  app.get('/:slug/tags', (c) =>
    c.json({ tags: listProjectTags(db, requireActor(c), c.req.param('slug')) }),
  );

  app.patch('/:slug/tags/:name', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RenameTagBody, await c.req.json().catch(() => null));

    return c.json(
      renameTag(sqlite, db, actor, c.req.param('slug'), c.req.param('name'), body.name),
    );
  });

  app.delete('/:slug/tags/:name', (c) =>
    // The count of tasks that lost the label. **Not** a count of anything
    // deleted — §4.16 is explicit that removing a tag removes join rows only.
    c.json(deleteTag(sqlite, db, requireActor(c), c.req.param('slug'), c.req.param('name'))),
  );

  /**
   * Who may be mentioned in a comment on this project (§4.19, §6.4, LAI-143).
   *
   * **Not the same as `/:slug/members`, and that is why it exists.** Org Owners
   * and Admins hold implicit `lead` everywhere and have **no membership row**
   * (D-006), so they are mentionable and absent from the member list. A picker
   * built on `/members` therefore omits names that would resolve, and a picker
   * built on org-wide `GET /users` offers names that will not — and the failure
   * is silent either way: the mention resolves to nobody, nothing is written, and
   * it reads as the mention feature being broken.
   *
   * The set is produced by the **same predicate** `resolveMentions` filters with,
   * so the two cannot disagree.
   */
  app.get('/:slug/mentionable', (c) =>
    c.json({ users: mentionableUsers(db, requireActor(c), c.req.param('slug')) }),
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
