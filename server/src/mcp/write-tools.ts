import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { addComment } from '../services/comments.ts';
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
} from '../services/tasks.ts';
import { ago, answer, toolError } from './present.ts';

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
        project: z.string().min(1).max(120).describe('Project slug, as in the board URL.'),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(50_000).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        depends_on: z
          .array(TASK_REF)
          .max(20)
          .optional()
          .describe('Tasks this one is blocked by. Keys or ids.'),
        discovered_from: TASK_REF.optional(),
      }),
    },
    ({ project, title, description, priority, depends_on, discovered_from }) => {
      try {
        const task = createTask(sqlite, db, actor, project, {
          title,
          ...(description === undefined ? {} : { description_md: description }),
          ...(priority === undefined ? {} : { priority }),
          ...(discovered_from === undefined
            ? {}
            : { discovered_from: resolveTaskRef(db, discovered_from) }),
          // §7.1: an agent's task says so. Not a default the service guesses.
          created_via: 'mcp',
          now: clock(),
        });

        // Dependencies are a separate service call, as they are over REST — the
        // create endpoint does not take them either, and inventing a combined
        // write here would be the second path AC1 forbids.
        const blockers = (depends_on ?? []).map((ref) => resolveTaskRef(db, ref));
        for (const blocker of blockers) {
          addTaskDependencySafely(sqlite, db, actor, task.id, blocker);
        }

        const after = blockers.length === 0 ? task : getTask(db, actor, task.id);

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
