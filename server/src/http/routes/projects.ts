import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addMember,
  ARCHIVED_FILTERS,
  archivedTombstones,
  changeMemberRole,
  createProject,
  getProject,
  getProjectContext,
  joinPublicProject,
  leaveProject,
  type LeaveProjectView,
  listMembers,
  listProjects,
  PROJECT_COLORS,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  projectSummaries,
  projectSummaryView,
  removeMember,
  TASK_CREATE_MIN_ROLES,
  updateProject,
  updateProjectContext,
  type ProjectSummary,
} from '../../services/projects.ts';
import { deleteTag, listProjectTags, renameTag } from '../../services/tags.ts';
import { getEstimateAccuracy, type EstimateAccuracyView } from '../../services/estimates.ts';
import { mentionableUsers } from '../../services/mentions.ts';
import {
  type ContextDeliveriesView,
  type ContextDiffView,
  type ContextRevisionSummaryView,
  type ContextRevisionView,
  diffProjectContext,
  getContextRevision,
  listContextDeliveries,
  listContextRevisions,
} from '../../services/context-revisions.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince, tombstone, type WithTombstones } from '../updated-since.ts';
import {
  OpenTasksSchema,
  parseBody,
  parseParams,
  parseQuery,
  strictObject,
  z,
} from '../validation.ts';

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
  // LAI-266. `null` is "never"; a number is a count of days.
  board_hide_done_days: z.number().int().min(0).nullable().optional(),
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
  // LAI-266's setting, which `CreateBody` took and this refused until LAI-976:
  // the board's own control had no way to save it.
  board_hide_done_days: z.number().int().min(0).nullable().optional(),
  // D-103 (LAI-976): the settings page. `null` clears the colour.
  color: z.enum(PROJECT_COLORS).nullable().optional(),
  // A new key prefix. Old keys keep resolving; the service refuses one any
  // other space holds or held (D-103 item 3).
  prefix: Prefix.optional(),
  task_create_min_role: z.enum(TASK_CREATE_MIN_ROLES).optional(),
  agents_allowed: z.boolean().optional(),
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
  /**
   * The revision this write replaces (proposal §4.6, LAI-555) — required: a
   * write that does not say what it read is the silent overwrite revisions
   * exist to refuse. A stale one is the service's `409`.
   */
  base_revision: z.number().int().min(0),
});

/** A revision number in a path or query: digits only, 0 or more. */
const RevisionNumber = z
  .string()
  .regex(/^\d{1,15}$/, 'a revision number, 0 or more')
  .transform(Number);

const RevisionParams = z.object({ revision: RevisionNumber });

const DiffQuery = strictObject({ from: RevisionNumber, to: RevisionNumber.optional() });

const DeliveriesQuery = strictObject({
  revision: RevisionNumber.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

const MemberBody = strictObject({
  user_id: z.string().min(1),
  role: z.enum(PROJECT_ROLES),
});

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const RoleBody = strictObject({ role: z.enum(PROJECT_ROLES) });

/** `DELETE /:slug/members/:userId` — an optional body, for their open tasks (LAI-986). */
const RemoveMemberBody = strictObject({ open_tasks: OpenTasksSchema.optional() });

// The shape is validated in `services/tags.ts` beside the CHECK it mirrors, so
// this only bounds the length — two regexes for one rule is how they drift.
const RenameTagBody = strictObject({ name: z.string().trim().min(1).max(64) });

/** Every route needs a signed-in actor; the gate is `can()`, this is the 401. */
function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/**
 * `?archived=include|only` (D-103 item 10). Absent or empty is today's list;
 * anything else is a `400` naming the value, as `?fields=` does.
 */
function parseArchived(raw: string | undefined): (typeof ARCHIVED_FILTERS)[number] | undefined {
  if (raw === undefined || raw === '') return undefined;
  const known = ARCHIVED_FILTERS.find((value) => value === raw);
  if (known === undefined) {
    throw new ApiError('bad_request', 'archived is include or only', { archived: raw });
  }
  return known;
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
    const archived = parseArchived(c.req.query('archived'));

    const rows = listProjects(db, actor, { limit, cursor, updatedSince, archived });

    // Paginate the raw rows first: the cursor is `(updated_at, id)` and a
    // tombstone carries neither, so mapping before paging would lose the key.
    const paged = buildPage(rows, limit, (row) => ({ sortKey: row.updatedAt, id: row.id }));

    // §6.3 tombstones. An archived project is this resource's soft-delete: it
    // stays reachable by slug but must disappear from a catching-up client's
    // list, and a client that only saw changed rows would keep showing it.
    //
    // Unless the caller asked for archived projects (D-103 item 10): then they
    // are what was asked for, and come back whole.
    const tombstones = new Set(archived === undefined ? archivedTombstones(paged.data) : []);

    // One set of aggregates for the whole page (LAI-053). Computed after paging
    // so it covers exactly the rows being returned, and skipping tombstones —
    // an archived project's counts are not something a catching-up client wants.
    const summaries = projectSummaries(
      db,
      paged.data.filter((row) => !tombstones.has(row.id)).map((row) => row.id),
    );

    const page: Page<WithTombstones<ProjectSummary>> = {
      // `projectSummaryView` from the service, not a copy of it: this mapping used
      // to be written out here and was missing §4.3's `repo` the moment it landed.
      data: paged.data.map((row) =>
        tombstones.has(row.id) ? tombstone(row.id) : projectSummaryView(row, summaries.get(row.id)),
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
    // Who is asking before what they sent: an anonymous caller is `401`, not
    // a lesson in the body's shape.
    const actor = requireActor(c);
    const body = parseBody(ContextBody, await c.req.json().catch(() => null));

    return c.json(
      updateProjectContext(db, actor, c.req.param('slug'), {
        context_md: body.context_md,
        base_revision: body.base_revision,
      }),
    );
  });

  // The context document's history (§4.68, LAI-555). Project read, like the
  // document: the `can()` calls are in the service.
  app.get('/:slug/context/revisions', (c) =>
    c.json<ContextRevisionSummaryView[]>(
      listContextRevisions(db, requireActor(c), c.req.param('slug')),
    ),
  );

  app.get('/:slug/context/revisions/:revision', (c) => {
    const { revision } = parseParams(RevisionParams, { revision: c.req.param('revision') });
    return c.json<ContextRevisionView>(
      getContextRevision(db, requireActor(c), c.req.param('slug'), revision),
    );
  });

  app.get('/:slug/context/diff', (c) => {
    const { from, to } = parseQuery(DiffQuery, c.req.query());
    return c.json<ContextDiffView>(
      diffProjectContext(db, requireActor(c), c.req.param('slug'), from, to),
    );
  });

  // Which revision each agent session was last delivered (§4.69, LAI-1003).
  // Project read, in the service; the table keeps the latest delivery only,
  // so the answer says `scope: 'latest_per_session'`.
  app.get('/:slug/context/deliveries', (c) => {
    const query = parseQuery(DeliveriesQuery, c.req.query());
    const { limit, cursor } = parsePageQuery({ limit: query.limit, cursor: query.cursor });
    const { project, rows } = listContextDeliveries(db, requireActor(c), c.req.param('slug'), {
      revision: query.revision ?? null,
      limit,
      cursor,
    });
    const page = buildPage(rows, limit, (row) => ({
      sortKey: row.delivered_at,
      id: row.session_id,
    }));
    return c.json<ContextDeliveriesView>({
      scope: 'latest_per_session',
      revision: query.revision ?? null,
      current_revision: project.contextRevision,
      ...page,
    });
  });

  // D-103 item 5: any member leaves; the last space admin is refused 409.
  app.post('/:slug/leave', (c) =>
    c.json<LeaveProjectView>(leaveProject(db, requireActor(c), c.req.param('slug'))),
  );

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
  /**
   * How good this project's size and time forecasts have been (§6.4, D-085):
   * frozen-at-claim forecasts against what happened, the back-test against the
   * plain median, and agent clients only where three people use them. Never
   * per person.
   */
  app.get('/:slug/estimates/accuracy', (c) =>
    c.json<EstimateAccuracyView>(getEstimateAccuracy(db, requireActor(c), c.req.param('slug'))),
  );

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

  app.delete('/:slug/members/:userId', async (c) => {
    const actor = requireActor(c);
    // No body is "no choice", not a malformed request: most removals need none.
    const text = await c.req.text();
    const raw: unknown = text.trim() === '' ? {} : parseJsonOrNull(text);
    const body = parseBody(RemoveMemberBody, raw);

    return c.json({
      members: removeMember(
        db,
        actor,
        c.req.param('slug'),
        c.req.param('userId'),
        Date.now(),
        body.open_tasks,
      ),
    });
  });

  return app;
}
