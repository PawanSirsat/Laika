import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { listProjectActivity } from '../services/activity.ts';
import { commentView, listComments } from '../services/comments.ts';
import {
  getProjectContext,
  listMembers,
  listProjects,
  projectSlugById,
  projectView,
} from '../services/projects.ts';
import { listSprints, sprintTaskCounts } from '../services/sprints.ts';
import {
  getTask,
  listTasks,
  resolveTaskRef,
  subtaskProgress,
  type TaskView,
} from '../services/tasks.ts';
import { ago, answer, bullets, isoDate, nameLookup, toolError } from './present.ts';

/**
 * The four tools an agent calls before it does anything (SPEC §7.1, LAI-407).
 *
 * ## Every one is a wrapper, and that is the whole design
 *
 * Each calls the **same service function a REST route calls** — `listProjects`,
 * `listTasks`, `getTask`, `getProjectContext`. No query is written twice and
 * `mcp/` imports no `db/`, so a tool and a route cannot answer differently.
 * §13.3's parity tests then confirm a property the structure already guarantees
 * rather than being the only thing holding it up.
 *
 * `can()` comes free with that: it is called inside each service, against the
 * token's user. A viewer sees what a viewer sees, and a token narrowed to one
 * project sees one project, without this file knowing either rule.
 *
 * ## These tools do not write
 *
 * Not an `activity` row, not a status, nothing. The only thing a read tool
 * touches is `tokens.last_used_at`, stamped by the auth layer once a minute at
 * most (LAI-403) — that is the request being authenticated, not the tool acting.
 */

/**
 * Inputs are **strict** objects, not bare shapes.
 *
 * §7.2 requires an unknown field to be refused rather than ignored, and zod's
 * default is to *strip* it — so passing a raw shape to `registerTool` would
 * silently accept `{ project, sudo: true }` and drop the second key. That is the
 * failure §6.3 already rules out for HTTP bodies, arriving through a different
 * door. Measured, not assumed: the test for it failed until these became strict.
 */
const NO_INPUT = z.strictObject({});

const PROJECT_REF = z
  .string()
  .min(1)
  .max(120)
  .describe('Project slug, as it appears in the board URL — for example `laika-core`.');

const TASK_REF = z
  .string()
  .min(1)
  .max(120)
  .describe('Task key such as `LAI-42`, or its id. The key is what other tools return.');

export interface ReadToolContext {
  db: Db;
  actor: ResolvedActor;
  now?: () => number;
}

/**
 * Every row of a list service, not the first page (LAI-704).
 *
 * The list services page by `(sort key, id)` and return `limit + 1` rows so a
 * caller can tell there is more. These tools took one page of 200 and treated
 * the 201 rows as the whole list — so on a 328-task project
 * `get_project_context` counted 201 tasks, and `list_ready_tasks` sorted only
 * the oldest-updated 201 ready ones, sending an agent past a newer p1. This
 * walks the same cursor the REST route hands a browser, to the end.
 *
 * **Capped, and the cap is reported.** 50 pages is 10,000 rows — a runaway
 * guard, not a working size — and reaching it sets `truncated` so a tool can
 * say its counts are a floor rather than print a short number as if whole.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

interface Cursor {
  sortKey: string | number;
  id: string;
}

function everyRow<T>(
  fetchPage: (page: { limit: number; cursor: Cursor | null }) => T[],
  keyOf: (row: T) => Cursor,
): { rows: T[]; truncated: boolean } {
  const rows: T[] = [];
  let cursor: Cursor | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = fetchPage({ limit: PAGE_SIZE, cursor });
    rows.push(...batch.slice(0, PAGE_SIZE));
    const last = batch[PAGE_SIZE - 1];
    if (batch.length <= PAGE_SIZE || last === undefined) return { rows, truncated: false };
    cursor = keyOf(last);
  }
  return { rows, truncated: true };
}

/** The `(sort key, id)` each service orders by — the same keys its REST route pages on. */
const byTaskUpdated = (t: TaskView): Cursor => ({ sortKey: t.updated_at, id: t.id });
const byRowUpdated = (r: { updatedAt: number; id: string }): Cursor => ({
  sortKey: r.updatedAt,
  id: r.id,
});

export function registerReadTools(server: McpServer, context: ReadToolContext): void {
  const { db, actor } = context;
  const clock = context.now ?? Date.now;

  // --------------------------------------------------------- list_projects

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Every project you can read, with its slug, task counts and how recently it moved. Start here when you do not know which project a piece of work belongs to.',
      inputSchema: NO_INPUT,
    },
    () => {
      try {
        // Through the service's own view, so a tool cannot expose a field the
        // REST API does not — then **`context_md` is dropped**.
        //
        // Not a permission difference: `GET /projects` returns it and this tool
        // may see everything that endpoint does. It is a size decision. A
        // ten-project org would put up to a megabyte of briefs into a response
        // whose job is to answer "which project?" — exactly the failure §7.3
        // warns about, a document that silently blows an agent's context window.
        // `get_project_context` is how you ask for one, deliberately.
        const rows = everyRow(
          (page) => listProjects(db, actor, { ...page, updatedSince: null }),
          byRowUpdated,
        )
          .rows.map(projectView)
          .map(({ context_md, ...rest }) => ({ ...rest, context_length: context_md.length }));
        const now = clock();

        const markdown = [
          `## Projects (${String(rows.length)})`,
          '',
          bullets(
            rows.map(
              (p) =>
                `**${p.slug}** — ${p.name}${p.archived_at === null ? '' : ' _(archived)_'}, updated ${ago(p.updated_at, now)}`,
            ),
            'You can read no projects yet.',
          ),
        ].join('\n');

        return answer(markdown, { projects: rows });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ----------------------------------------------------- list_ready_tasks

  server.registerTool(
    'list_ready_tasks',
    {
      title: 'List ready tasks',
      description:
        'Tasks that can be picked up right now: unassigned, not blocked by anything unfinished, in backlog or todo (§4.5). Sorted p1 first, then oldest. This is the answer to "what should I work on".',
      inputSchema: z.strictObject({
        project: PROJECT_REF.optional().describe(
          'Restrict to one project. Omit to search every project you can read.',
        ),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    ({ project, limit }) => {
      try {
        const slugs =
          project === undefined
            ? everyRow(
                (page) => listProjects(db, actor, { ...page, updatedSince: null }),
                byRowUpdated,
              ).rows.map((p) => p.slug)
            : [project];

        // `ready: true` is the **same filter the REST `?ready=` query uses**, which
        // is the same derived `isReady` the board's Ready column shows. A second
        // definition here would not fail a test — it would quietly send an agent
        // to a different task than the board says is next.
        // Every ready task, then sorted: sorting one page would rank only the
        // oldest-updated 201 and could miss the newest p1 (LAI-704).
        const found = slugs.flatMap(
          (slug) =>
            everyRow(
              (page) => listTasks(db, actor, slug, { ...page, ready: true, updatedSince: null }),
              byTaskUpdated,
            ).rows,
        );

        const ordered = found.sort(byPriorityThenAge).slice(0, limit ?? 25);
        const now = clock();

        const markdown = [
          `## Ready tasks (${String(ordered.length)})`,
          '',
          bullets(
            ordered.map(
              (t) =>
                `\`${t.key}\` **${t.title}** — ${t.priority}, ${t.status}, opened ${ago(t.created_at, now)}`,
            ),
            'Nothing is ready. Everything is either assigned, blocked, or already moving.',
          ),
        ].join('\n');

        return answer(markdown, { tasks: ordered });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ---------------------------------------------------- get_task_context

  server.registerTool(
    'get_task_context',
    {
      title: 'Get task context',
      description:
        'Everything needed to start on one task in a single call: the task, what it depends on and whether those are done, what it blocks, its parent and its subtasks with how many are done, its comments, its recent activity, and the chain of tasks it was discovered from.',
      inputSchema: z.strictObject({ task: TASK_REF }),
    },
    ({ task }) => {
      try {
        const view = getTask(db, actor, resolveTaskRef(db, task));
        const now = clock();

        // A task carries a project id and every service here takes a slug, so
        // this hop is unavoidable — one indexed lookup through the service that
        // asserts `project.read` on the way, rather than a scan of the readable
        // list, which is what this was until LAI-611 needed the same hop on the
        // write side.
        const slug = projectSlugById(db, actor, view.project_id);
        const members = listMembers(db, actor, slug);
        const nameOf = nameLookup(members);

        const related = new Map<string, TaskView>();
        for (const id of [...view.blocked_by, ...view.blocks]) {
          related.set(id, getTask(db, actor, id));
        }

        // Soft-deleted comments are dropped, not tombstoned. A tombstone exists so
        // a client syncing with `updated_since` learns a row went away; an agent
        // reading a task for the first time should simply not see it.
        const comments = everyRow(
          (page) => listComments(db, actor, view.id, { ...page, updatedSince: null }),
          (row) => ({ sortKey: row.createdAt, id: row.id }),
        )
          .rows.filter((row) => row.deletedAt === null)
          .map(commentView);

        const activity = listProjectActivity(db, actor, slug, {
          taskId: view.id,
          limit: 10,
          cursor: null,
        });

        const chain = discoveredFromChain(db, actor, view);

        // Containment, read from both ends (D-066). The parent is read through
        // `getTask` so a parent this token cannot see is reported as such
        // rather than failing the call — the same stance as the chain above.
        let parent: ReturnType<typeof summarise> | null = null;
        if (view.parent_task_id !== null) {
          try {
            parent = summarise(getTask(db, actor, view.parent_task_id), view.parent_task_id);
          } catch {
            parent = summarise(undefined, view.parent_task_id);
          }
        }
        const subtasks = everyRow(
          (page) => listTasks(db, actor, slug, { ...page, updatedSince: null, parent: view.id }),
          byTaskUpdated,
        ).rows.map((t) => ({
          id: t.id,
          key: t.key,
          title: t.title,
          status: t.status,
          assignee_id: t.assignee_id,
        }));
        const { done: subtasksDone, total: subtasksTotal } = subtaskProgress(subtasks);

        const markdown = [
          `## \`${view.key}\` ${view.title}`,
          '',
          `${view.priority} · ${view.status} · assigned to ${nameOf(view.assignee_id)} · ${view.ready ? 'ready' : 'not ready'}`,
          '',
          '### Description',
          view.description_md ?? '_None._',
          '',
          '### Done means',
          view.acceptance_md ?? '_Not stated._',
          '',
          '### Blocked by',
          bullets(
            view.blocked_by.map((id) => describeRelated(related.get(id), id)),
            'Nothing — this is unblocked.',
          ),
          '',
          '### Blocks',
          bullets(
            view.blocks.map((id) => describeRelated(related.get(id), id)),
            'Nothing else is waiting on this.',
          ),
          '',
          '### Discovered from',
          bullets(
            chain.map((t) => `\`${t.key}\` ${t.title}`),
            'Not discovered from another task.',
          ),
          '',
          '### Parent',
          parent === null
            ? '_Not a subtask._'
            : parent.visible
              ? `\`${parent.key}\` ${parent.title} — **${parent.status}**`
              : `\`${parent.id}\` _(not visible to you)_`,
          '',
          `### Subtasks (${String(subtasksDone)}/${String(subtasksTotal)} done)`,
          bullets(
            subtasks.map(
              (t) => `\`${t.key}\` ${t.title} — **${t.status}**, ${nameOf(t.assignee_id)}`,
            ),
            'None.',
          ),
          '',
          `### Comments (${String(comments.length)})`,
          bullets(
            comments.map((c) => `${nameOf(c.author_id)}, ${ago(c.created_at, now)}: ${c.body_md}`),
            'No comments.',
          ),
          '',
          '### Recent activity',
          bullets(
            activity.map((e) => `${e.type} by ${nameOf(e.actor_id)}, ${ago(e.created_at, now)}`),
            'Nothing recorded.',
          ),
        ].join('\n');

        return answer(markdown, {
          task: view,
          blocked_by: view.blocked_by.map((id) => summarise(related.get(id), id)),
          blocks: view.blocks.map((id) => summarise(related.get(id), id)),
          discovered_from_chain: chain.map((t) => ({ key: t.key, title: t.title, id: t.id })),
          parent,
          subtasks,
          subtasks_done: subtasksDone,
          subtasks_total: subtasksTotal,
          comments,
          recent_activity: activity,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------- get_project_context

  server.registerTool(
    'get_project_context',
    {
      title: 'Get project context',
      description:
        'The project brief every agent on this project should start from: the shared context document, how it has changed, what is open, and who is on the team.',
      inputSchema: z.strictObject({ project: PROJECT_REF }),
    },
    ({ project }) => {
      try {
        const doc = getProjectContext(db, actor, project);
        const members = listMembers(db, actor, project);
        const nameOf = nameLookup(members);
        const everyTask = everyRow(
          (page) => listTasks(db, actor, project, { ...page, updatedSince: null }),
          byTaskUpdated,
        );
        const open = everyTask.rows;
        const now = clock();

        // §7.1 says "last 10 decisions". Laika has **no decision entity**: §7.3
        // puts decisions *inside* `context_md`, appended by the meeting path of
        // §10.2, which is unbuilt. The nearest true thing is the document's own
        // edit history, and that is what this returns — named for what it is
        // rather than dressed up as something the data model does not hold.
        const edits = listProjectActivity(db, actor, project, { limit: 10, cursor: null }).filter(
          (e) => JSON.stringify(e.payload).includes('"context_md"'),
        );

        const byStatus = new Map<string, number>();
        for (const t of open) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);

        const markdown = [
          `## ${project}`,
          '',
          '### Context document',
          doc.context_md === ''
            ? '_Empty. Nobody has written the project brief yet._'
            : doc.context_md,
          '',
          doc.updated_at === null
            ? '_Never edited._'
            : `_Last edited by ${nameOf(doc.updated_by)}, ${ago(doc.updated_at, now)} — ${String(doc.length)} of ${String(doc.limit)} characters._`,
          '',
          '### Recent edits to this document',
          bullets(
            edits.map((e) => `${nameOf(e.actor_id)} on ${isoDate(e.created_at)}`),
            'No recorded edits.',
          ),
          '',
          '### Open work',
          bullets(
            [...byStatus.entries()].map(([status, count]) => `${status}: ${String(count)}`),
            'No tasks.',
          ),
          ...(everyTask.truncated
            ? ['', `_Counted from the first ${String(open.length)} tasks; there are more._`]
            : []),
          '',
          '### Team',
          bullets(
            members.map((m) => `${m.name} — ${m.role}`),
            'No members.',
          ),
        ].join('\n');

        return answer(markdown, {
          context: doc,
          context_edits: edits,
          task_counts: Object.fromEntries(byStatus),
          open_task_count: open.length,
          members,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------------ list_sprints

  server.registerTool(
    'list_sprints',
    {
      title: 'List sprints',
      description:
        'Every sprint on a project, oldest first, with its dates, status and how many tasks sit in it. The `id` each row carries is what `set_task_sprint` and `update_sprint` take.',
      inputSchema: z.strictObject({ project: PROJECT_REF }),
    },
    ({ project }) => {
      try {
        const rows = everyRow(
          (page) => listSprints(db, actor, project, { ...page, updatedSince: null }),
          (sprint) => ({ sortKey: sprint.starts_on, id: sprint.id }),
        ).rows;

        // Counted by the service in one grouped query. Bucketing a page of
        // tasks here would be short by however many the page cut off, and
        // nothing about the number would say so.
        const counts = sprintTaskCounts(db, actor, project);
        const empty = { total: 0, by_status: {} as Record<string, number> };

        const sprints = rows.map((sprint) => ({
          ...sprint,
          task_counts: counts.get(sprint.id) ?? empty,
        }));

        const markdown = [
          `## Sprints on ${project} (${String(sprints.length)})`,
          '',
          bullets(
            sprints.map(
              (s) =>
                `**${s.name}** — ${isoDate(s.starts_on)} to ${isoDate(s.ends_on)}, ${s.status}, ${String(s.task_counts.total)} tasks · \`${s.id}\``,
            ),
            'This project has no sprints.',
          ),
        ].join('\n');

        return answer(markdown, { sprints });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------------ list_members

  server.registerTool(
    'list_members',
    {
      title: 'List project members',
      description:
        'Who is on a project and what role each holds. The `user_id` and `email` here are what `update_task` takes as an assignee — this is how you find out who you may assign work to.',
      inputSchema: z.strictObject({ project: PROJECT_REF }),
    },
    ({ project }) => {
      try {
        const members = listMembers(db, actor, project);

        const markdown = [
          `## Members of ${project} (${String(members.length)})`,
          '',
          bullets(
            members.map((m) => `**${m.name}** — ${m.role}, ${m.email} · \`${m.user_id}\``),
            'Nobody is a member of this project.',
          ),
        ].join('\n');

        return answer(markdown, { members });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

// ------------------------------------------------------------------ helpers

/** p1 before p2 before p3; within a priority, the oldest first. */
function byPriorityThenAge(a: TaskView, b: TaskView): number {
  return a.priority === b.priority
    ? a.created_at - b.created_at
    : a.priority.localeCompare(b.priority);
}

function describeRelated(task: TaskView | undefined, id: string): string {
  return task === undefined
    ? `\`${id}\` _(not visible to you)_`
    : `\`${task.key}\` ${task.title} — **${task.status}**`;
}

function summarise(task: TaskView | undefined, id: string) {
  return task === undefined
    ? { id, visible: false }
    : { id: task.id, key: task.key, title: task.title, status: task.status, visible: true };
}

/**
 * The whole `discovered_from` chain, not just the immediate parent.
 *
 * Walks upward with a seen-set: the column is not constrained against cycles,
 * and a cycle here would hang the tool rather than fail it.
 */
function discoveredFromChain(db: Db, actor: ResolvedActor, from: TaskView): TaskView[] {
  const chain: TaskView[] = [];
  const seen = new Set<string>([from.id]);

  let current = from.discovered_from;
  while (current !== null && !seen.has(current)) {
    seen.add(current);

    let parent: TaskView;
    try {
      parent = getTask(db, actor, current);
    } catch {
      // A parent in a project this token cannot read ends the chain rather than
      // failing the call — the visible part is still worth having.
      break;
    }

    chain.push(parent);
    current = parent.discovered_from;
  }

  return chain;
}
