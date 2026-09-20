import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { ApiError } from '../errors.ts';
import { addComment } from '../services/comments.ts';
import {
  getProjectContext,
  listMembers,
  projectSlugById,
  updateProjectContext,
} from '../services/projects.ts';
import {
  addTasksToSprint,
  createSprint,
  removeTaskFromSprint,
  SPRINT_STATUSES,
  updateSprint,
} from '../services/sprints.ts';
import { logUnlistedWork } from '../services/unlisted.ts';
import {
  addTaskDependency,
  changeStatus,
  claimTask,
  createTask,
  finishTask,
  getTask,
  resolveTaskRef,
  TASK_PRIORITIES,
  TASK_STATUSES,
  updateTask,
  type TaskView,
} from '../services/tasks.ts';
import { ago, answer, isoDate, toolError } from './present.ts';

/**
 * The tools that let an agent actually work the board (SPEC §7.1, LAI-408).
 *
 * Same rule as the read tools: each is a wrapper over **the service its REST
 * twin uses**. No second write path, no `db/` value import, `can()` inside the
 * service against the token's user.
 *
 * ## Why nothing here emits an SSE event
 *
 * Because nothing has to. `services/activity-feed.ts` **polls the `activity`
 * table** — "nothing publishes to this feed" — so a row written by a tool
 * becomes an event exactly as a row written by a route does. There is no emit
 * to forget, which is the point: M3's exit criterion is an agent's work
 * appearing live in a human's browser, and that now depends on writing the
 * activity row rather than on remembering a second step.
 *
 * Verified through a real stream rather than assumed (`write-tools.test.ts`),
 * because it rests on a design fact and design facts change.
 *
 * ## One task per call (§7.2)
 *
 * Every task-shaped input is a single `z.string()`. An array is refused by the
 * schema before a handler sees it, so "tools never bulk-mutate" is a property of
 * the type rather than a rule each handler remembers.
 */

const TASK_REF = z
  .string()
  .min(1)
  .max(120)
  .describe('One task — key such as `LAI-42`, or its id. Exactly one; arrays are refused.');

const PROJECT_REF = z
  .string()
  .min(1)
  .max(120)
  .describe('Project slug, as it appears in the board URL — for example `laika-core`.');

/**
 * A sprint is addressed by **id**, exactly as `PATCH /api/v1/sprints/:id` is.
 *
 * Not by name: `update_sprint` takes no project, so a name would have to be
 * resolved across every project the token can read, and two projects are
 * perfectly entitled to both have a "Sprint 3". `list_sprints` and
 * `create_sprint` both return the id in their markdown as well as their payload,
 * so the two-step is one extra call and never an ambiguous one.
 */
const SPRINT_REF = z
  .string()
  .min(1)
  .max(120)
  .describe('A sprint id, as `list_sprints` and `create_sprint` return it.');

/**
 * A date, in the form a person writes one.
 *
 * §4.15 gives sprint dates **date-only semantics**, so `2026-10-01` is the
 * honest input and unix-ms is the storage detail. The number is still accepted,
 * because an agent holding one from a previous response should not have to
 * convert it back.
 */
const DATE_INPUT = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.number().int().finite()])
  .describe('`YYYY-MM-DD`, or unix-ms if you already have one.');

/**
 * The MCP field names for a task's prose are `description` and `acceptance`,
 * not the `_md` the REST body uses.
 *
 * `create_task` has taken `description` since LAI-408, and an agent that files a
 * task and then edits it must not have to remember that the second call spells
 * the field differently. The lengths are that tool's too — 50k and 10k, tighter
 * than the route's 100k — for the same reason: one surface, one set of rules.
 */
const TASK_FIELDS = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000),
  acceptance: z.string().max(10_000),
  priority: z.enum(TASK_PRIORITIES),
  tags: z.array(z.string().trim().min(1).max(64)).max(20),
} as const;

/**
 * Who to assign work to — **a user id or the email of a project member**.
 *
 * An id passes through untouched, so the write is identical to the one `PATCH
 * /api/v1/tasks/:id` performs. An email is resolved against the project's own
 * membership: an agent reading a board sees names and addresses, not ULIDs, and
 * `list_members` is where both come from.
 */
const ASSIGNEE_REF = z
  .string()
  .min(1)
  .max(320)
  .describe('A user id, or the email of a project member. `null` unassigns.');

export interface WriteToolContext {
  db: Db;
  sqlite: Database.Database;
  actor: ResolvedActor;
  now?: () => number;
}

export function registerWriteTools(server: McpServer, context: WriteToolContext): void {
  const { db, sqlite, actor } = context;
  const clock = context.now ?? Date.now;

  // ------------------------------------------------------------ create_task

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'File a task on a project. Use `discovered_from` when you found this while working on something else — that chain is what stops incidental work being lost.',
      inputSchema: z.strictObject({
        project: PROJECT_REF,
        title: TASK_FIELDS.title,
        description: TASK_FIELDS.description.optional(),
        acceptance: TASK_FIELDS.acceptance.optional().describe('What "done" means here.'),
        priority: TASK_FIELDS.priority.optional(),
        tags: TASK_FIELDS.tags.optional(),
        assignee: ASSIGNEE_REF.optional(),
        sprint: SPRINT_REF.optional(),
        blocked_by: z
          .array(TASK_REF)
          .max(20)
          .optional()
          .describe('Tasks this one is blocked by. Keys or ids.'),
        discovered_from: TASK_REF.optional(),
      }),
    },
    ({
      project,
      title,
      description,
      acceptance,
      priority,
      tags,
      assignee,
      sprint,
      blocked_by,
      discovered_from,
    }) => {
      try {
        const now = clock();

        const task = createTask(sqlite, db, actor, project, {
          title,
          ...(description === undefined ? {} : { description_md: description }),
          ...(acceptance === undefined ? {} : { acceptance_md: acceptance }),
          ...(priority === undefined ? {} : { priority }),
          ...(tags === undefined ? {} : { tags }),
          ...(assignee === undefined
            ? {}
            : { assignee_id: resolveAssignee(db, actor, project, assignee) }),
          ...(discovered_from === undefined
            ? {}
            : { discovered_from: resolveTaskRef(db, discovered_from) }),
          // §7.1: an agent's task says so. Not a default the service guesses.
          created_via: 'mcp',
          now,
        });

        // Dependencies are a separate service call, as they are over REST — the
        // create endpoint does not take them either, and inventing a combined
        // write here would be the second path AC1 forbids.
        const blockers = (blocked_by ?? []).map((ref) => resolveTaskRef(db, ref));
        for (const blocker of blockers) {
          addTaskDependencySafely(sqlite, db, actor, task.id, blocker);
        }

        // Same reason as the blockers above: `POST /tasks` does not take a
        // sprint either, so this is the second REST call the human makes, not a
        // combined write only an agent can perform.
        if (sprint !== undefined) {
          moveTaskToSprint(sqlite, db, actor, task.id, sprint, now);
        }

        const after =
          blockers.length === 0 && sprint === undefined ? task : getTask(db, actor, task.id);

        return answer(
          `Created \`${after.key}\` **${after.title}** — ${after.priority}, ${after.status}.`,
          { task: after },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // --------------------------------------------------------- start_working

  server.registerTool(
    'start_working',
    {
      title: 'Start working on a task',
      description:
        'Claim a task and move it to in_progress. Fails with `conflict` if somebody already holds it — check the error before assuming you have it.',
      inputSchema: z.strictObject({ task: TASK_REF, branch: z.string().max(200).optional() }),
    },
    ({ task }) => {
      try {
        // `claimTask` already refuses a claimed task with `conflict` and names the
        // current assignee in `details` — surfaced as-is rather than reworded,
        // because §7.2 wants an agent branching on the code, not parsing prose.
        const claimed = claimTask(sqlite, db, actor, resolveTaskRef(db, task), clock());

        return answer(`Claimed \`${claimed.key}\` — now ${claimed.status}.`, { task: claimed });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // --------------------------------------------------------- update_status

  server.registerTool(
    'update_status',
    {
      title: 'Move a task',
      description:
        "Change a task's status. The transition is validated against §5 — not every move is legal, and an illegal one fails with `unprocessable` rather than being applied.",
      inputSchema: z.strictObject({
        task: TASK_REF,
        status: z.enum(TASK_STATUSES),
        note: z.string().max(10_000).optional(),
      }),
    },
    ({ task, status, note }) => {
      try {
        const id = resolveTaskRef(db, task);
        const now = clock();

        const moved = changeStatus(db, actor, id, status, now);
        // The note is a comment, not a field: §4.5 has nowhere to put it, and a
        // status change with an explanation is exactly what a comment is for.
        if (note !== undefined && note.trim() !== '') addComment(db, actor, id, note, now);

        return answer(`\`${moved.key}\` is now **${moved.status}**.`, { task: moved });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------------ add_comment

  server.registerTool(
    'add_comment',
    {
      title: 'Comment on a task',
      description: 'Post a comment. Markdown is kept verbatim.',
      inputSchema: z.strictObject({ task: TASK_REF, body: z.string().trim().min(1).max(50_000) }),
    },
    ({ task, body }) => {
      try {
        const comment = addComment(db, actor, resolveTaskRef(db, task), body, clock());

        return answer(`Commented on the task, ${ago(comment.created_at, clock())}.`, { comment });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------------ finish_task

  server.registerTool(
    'finish_task',
    {
      title: 'Hand a task back for review',
      description:
        "Move a task to review and post your summary as a comment. This is as far as an agent takes a task — closing it is a person's decision.",
      inputSchema: z.strictObject({
        task: TASK_REF,
        summary: z.string().trim().min(1).max(50_000),
        checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
      }),
    },
    ({ task, summary, checklist }) => {
      try {
        const finished = finishTask(sqlite, db, actor, resolveTaskRef(db, task), {
          summary,
          ...(checklist === undefined ? {} : { checklist }),
          now: clock(),
        });

        return answer(
          `\`${finished.key}\` is in **review** with your summary attached. A person takes it from here.`,
          { task: finished },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
  // ----------------------------------------------------- log_unlisted_work

  server.registerTool(
    'log_unlisted_work',
    {
      title: 'Log work outside any project',
      description:
        'Record something you noticed that belongs to no project — a repo-level chore, an idea, a problem with no home yet. A person triages it later and may promote it to a real task. Use this instead of inventing a task on a project it does not belong to.',
      inputSchema: z.strictObject({
        repo: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Repository name, such as `kvell/laika`. Not a path and not a URL.'),
        note: z
          .string()
          .trim()
          .min(1)
          .max(10_000)
          .describe(
            'What you noticed, in your own words. No file contents, no diffs, no prompt text (D-005).',
          ),
      }),
    },
    ({ repo, note }) => {
      try {
        const logged = logUnlistedWork(db, actor, { repo, note, now: clock() });

        return answer(
          `Logged against \`${logged.repo}\`. It is in the triage pile — somebody may promote it to a task.`,
          { unlisted: logged },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------------ update_task

  server.registerTool(
    'update_task',
    {
      title: 'Edit a task',
      description:
        'Change a task after it exists: its title, prose, priority, tags, who holds it, and which sprint it sits in. Every field is optional and an omitted one is left alone. **Status is not here** — moving a task is `update_status`, because §5 validates transitions and a field edit would route around the table.',
      inputSchema: z.strictObject({
        task: TASK_REF,
        title: TASK_FIELDS.title.optional(),
        description: TASK_FIELDS.description.optional(),
        // `null` clears it, absent leaves it alone — different requests, the
        // same distinction `PATCH /tasks/:id` draws.
        acceptance: TASK_FIELDS.acceptance.nullable().optional(),
        priority: TASK_FIELDS.priority.optional(),
        tags: TASK_FIELDS.tags.optional().describe('Replaces the whole set.'),
        assignee: ASSIGNEE_REF.nullable().optional(),
        sprint: SPRINT_REF.nullable().optional().describe('`null` takes it out of its sprint.'),
      }),
    },
    ({ task, title, description, acceptance, priority, tags, assignee, sprint }) => {
      try {
        const id = resolveTaskRef(db, task);
        const now = clock();

        const assigneeId =
          assignee === undefined || assignee === null
            ? assignee
            : resolveAssignee(
                db,
                actor,
                projectSlugById(db, actor, getTask(db, actor, id).project_id),
                assignee,
              );

        const updated = updateTask(db, actor, id, {
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description_md: description }),
          ...(acceptance === undefined ? {} : { acceptance_md: acceptance }),
          ...(priority === undefined ? {} : { priority }),
          ...(tags === undefined ? {} : { tags }),
          ...(assigneeId === undefined ? {} : { assignee_id: assigneeId }),
          now,
        });

        // The sprint is not a column `updateTask` writes — it is the same
        // service pair `set_task_sprint` calls, so both tools take one path and
        // the activity row says `sprint.tasks_changed` either way.
        const after =
          sprint === undefined ? updated : moveTaskToSprint(sqlite, db, actor, id, sprint, now);

        return answer(`Updated \`${after.key}\` — ${after.priority}, ${after.status}.`, {
          task: after,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------------- set_task_sprint

  server.registerTool(
    'set_task_sprint',
    {
      title: 'Put a task in a sprint',
      description:
        'Move one task into a sprint, or out of whichever it is in. `list_sprints` gives you the id. Moving a task between sprints is one call — you do not have to remove it first.',
      inputSchema: z.strictObject({
        task: TASK_REF,
        sprint: SPRINT_REF.nullable().describe(
          'The sprint to put it in, or `null` to take it out.',
        ),
      }),
    },
    ({ task, sprint }) => {
      try {
        const moved = moveTaskToSprint(
          sqlite,
          db,
          actor,
          resolveTaskRef(db, task),
          sprint,
          clock(),
        );

        return answer(
          sprint === null
            ? `\`${moved.key}\` is in no sprint.`
            : `\`${moved.key}\` is in sprint \`${sprint}\`.`,
          { task: moved },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ---------------------------------------------------------- create_sprint

  server.registerTool(
    'create_sprint',
    {
      title: 'Create a sprint',
      description:
        'Open a sprint on a project. Dates are inclusive at both ends and sprints on one project may not overlap — a clash fails with `conflict` naming the sprint it hit. A sprint carries dates and a goal and nothing else: Laika does not estimate.',
      inputSchema: z.strictObject({
        project: PROJECT_REF,
        name: z.string().trim().min(1).max(120),
        goal: z.string().trim().max(500).optional(),
        start_date: DATE_INPUT,
        end_date: DATE_INPUT,
        status: z
          .enum(SPRINT_STATUSES)
          .optional()
          .describe('Defaults to `planned`. Only one sprint per project may be `active`.'),
      }),
    },
    ({ project, name, goal, start_date, end_date, status }) => {
      try {
        const sprint = createSprint(sqlite, db, actor, project, {
          name,
          ...(goal === undefined ? {} : { goal }),
          starts_on: toTimestamp('start_date', start_date),
          ends_on: toTimestamp('end_date', end_date),
          ...(status === undefined ? {} : { status }),
          now: clock(),
        });

        return answer(
          `Created **${sprint.name}** — ${isoDate(sprint.starts_on)} to ${isoDate(sprint.ends_on)}, ${sprint.status}. Its id is \`${sprint.id}\`.`,
          { sprint },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ---------------------------------------------------------- update_sprint

  server.registerTool(
    'update_sprint',
    {
      title: 'Edit a sprint',
      description:
        'Change a sprint’s name, goal, dates or status. Every field is optional. Completing a sprint **does not touch its tasks** — unfinished work stays where it is and is moved deliberately.',
      inputSchema: z.strictObject({
        sprint: SPRINT_REF,
        name: z.string().trim().min(1).max(120).optional(),
        goal: z.string().trim().max(500).nullable().optional().describe('`null` clears it.'),
        start_date: DATE_INPUT.optional(),
        end_date: DATE_INPUT.optional(),
        status: z.enum(SPRINT_STATUSES).optional(),
      }),
    },
    ({ sprint, name, goal, start_date, end_date, status }) => {
      try {
        const updated = updateSprint(sqlite, db, actor, sprint, {
          ...(name === undefined ? {} : { name }),
          ...(goal === undefined ? {} : { goal }),
          ...(start_date === undefined ? {} : { starts_on: toTimestamp('start_date', start_date) }),
          ...(end_date === undefined ? {} : { ends_on: toTimestamp('end_date', end_date) }),
          ...(status === undefined ? {} : { status }),
          now: clock(),
        });

        return answer(
          `**${updated.name}** — ${isoDate(updated.starts_on)} to ${isoDate(updated.ends_on)}, ${updated.status}.`,
          { sprint: updated },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // ------------------------------------------------- update_project_context

  server.registerTool(
    'update_project_context',
    {
      title: 'Write the project brief',
      description:
        'Edit the shared context document every agent on this project starts from. `append` adds to the end and is what you want after a session; `replace` overwrites the whole document, which is a decision rather than an update. Read it first with `get_project_context`.',
      inputSchema: z.strictObject({
        project: PROJECT_REF,
        context_md: z.string().max(100_000),
        mode: z
          .enum(['replace', 'append'])
          .describe(
            'Required, deliberately: there is no safe default between adding a paragraph and discarding the document.',
          ),
      }),
    },
    ({ project, context_md, mode }) => {
      try {
        // `append` is read-then-write rather than a service-level concatenation,
        // because `updateProjectContext` takes a document and the document is
        // what `activity` records the length of. Two agents appending in the
        // same instant can lose one of the additions — the table is a single
        // markdown field with no merge, and pretending otherwise would need a
        // revision column §4.3 does not have.
        const document =
          mode === 'replace'
            ? context_md
            : append(getProjectContext(db, actor, project).context_md, context_md);

        const updated = updateProjectContext(db, actor, project, {
          context_md: document,
          now: clock(),
        });

        return answer(
          `The brief for ${project} is now ${String(updated.length)} characters of ${String(updated.limit)}.`,
          { context: updated },
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

/**
 * Dependencies added one at a time, through the service the REST route uses.
 *
 * Split out so `create_task` reads as one call plus its links rather than
 * hiding a loop mid-expression — and so the cycle check `addTaskDependency`
 * performs is the same one a route gets.
 */
function addTaskDependencySafely(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  dependsOn: string,
): void {
  addTaskDependency(sqlite, db, actor, taskId, dependsOn);
}

/**
 * In, out, or across — through the **same two services** `POST
 * /sprints/:id/tasks` and `DELETE /sprints/:id/tasks/:taskId` call.
 *
 * One helper because two tools need it (`set_task_sprint` and `update_task`),
 * and two tools reaching a sprint two different ways is how the activity rows
 * start to disagree.
 *
 * Taking a task **out** needs the sprint it is currently in, because that is
 * what the removal service is addressed by. A task already in no sprint is
 * returned unchanged rather than refused: `sprint: null` says where the task
 * should end up, and it is already there — where `DELETE` names a specific
 * sprint in its URL and a task that is not in *that* one is a wrong address.
 */
function moveTaskToSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  sprintId: string | null,
  now: number,
): TaskView {
  const current = getTask(db, actor, taskId);

  if (sprintId === null) {
    return current.sprint_id === null
      ? current
      : removeTaskFromSprint(sqlite, db, actor, current.sprint_id, taskId, now);
  }

  // `addTasksToSprint` moves a task that is already in another sprint and skips
  // one already in this one, so neither case needs handling here.
  const [moved] = addTasksToSprint(sqlite, db, actor, sprintId, [taskId], now);
  return moved ?? getTask(db, actor, taskId);
}

/**
 * A user id, or a project member's email.
 *
 * An id is passed through **untouched**, so the write an agent performs is
 * byte-for-byte the one `PATCH /api/v1/tasks/:id` performs with the same value.
 * An email is looked up in the project's membership — the `@` is what tells
 * them apart, and a ULID cannot contain one.
 *
 * Resolving against members rather than the org directory is deliberate: it
 * needs only `project.read`, which every actor who can see the task already
 * has, where the directory is behind `member_list.read`. Assigning work to
 * somebody who is not on the project is not a thing this should make easy.
 */
function resolveAssignee(db: Db, actor: ResolvedActor, slug: string, ref: string): string {
  if (!ref.includes('@')) return ref;

  const wanted = ref.toLowerCase();
  const member = listMembers(db, actor, slug).find((m) => m.email.toLowerCase() === wanted);

  if (member === undefined) {
    throw ApiError.notFound(`Nobody on ${slug} has the email "${ref}"`, {
      field: 'assignee',
      project: slug,
    });
  }

  return member.user_id;
}

/**
 * `YYYY-MM-DD` to unix-ms, refusing a date that is not real.
 *
 * **The round-trip is the whole check, and it is not belt-and-braces.**
 * Measured rather than assumed: `Date.parse('2026-02-31T00:00:00.000Z')`
 * does not fail — it returns the 3rd of March. A regex matches it and the
 * parse accepts it, so comparing the date back out is the only thing between an
 * agent's typo and a sprint that silently starts three days late. `2026-13-01`
 * is the case that *does* return `NaN`, and it is the one nobody would have got
 * wrong.
 */
function toTimestamp(field: string, value: string | number): number {
  if (typeof value === 'number') return value;

  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms) || isoDate(ms) !== value) {
    throw new ApiError('unprocessable', `${field} is not a real date`, { field, value });
  }

  return ms;
}

/** A blank line between what was there and what is being added — and nothing before a first paragraph. */
function append(existing: string, addition: string): string {
  return existing.trim() === '' ? addition : `${existing}\n\n${addition}`;
}
