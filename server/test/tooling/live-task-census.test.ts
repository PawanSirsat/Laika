import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * **Every read of `tasks` says whether an archived task belongs in it**
 * (LAI-1353).
 *
 * An archived task leaves every board, list and queue because each of those
 * reads adds `liveTask()` (`src/db/live-task.ts`). A new reader that forgets
 * would quietly bring archived work back into one screen or one agent's queue
 * — and nothing else would notice. So every file under `src/` that reads the
 * table is named here, once, as one of two things:
 *
 * - a **live reader** — "the work there is" — which must use `liveTask()`
 *   (or, in raw SQL, `liveTaskSql(alias)`);
 * - a **history or by-id reader** — time, activity, estimates, usage, one task
 *   by its id — with the reason an archived task belongs in it.
 *
 * A file that reads `tasks` and is in neither list fails; so does an entry
 * whose file no longer reads it, and a live reader that stops filtering.
 */

/** Files whose reads are current work, and must leave archived tasks out. */
const LIVE_READERS: readonly string[] = [
  'src/jobs/jobs.ts',
  'src/services/heartbeats.ts',
  'src/services/meeting-reviews.ts',
  'src/services/offboarding.ts',
  'src/services/people-load.ts',
  'src/services/presence.ts',
  'src/services/profiles.ts',
  'src/services/projects.ts',
  'src/services/review.ts',
  'src/services/sprint-forecast.ts',
  'src/services/sprints.ts',
  'src/services/tasks.ts',
  'src/services/teams-posting.ts',
  'src/services/token-budgets.ts',
  'src/services/watchers.ts',
  'src/services/work-requests.ts',
];

/** Files whose reads keep archived tasks, and why. */
const HISTORY_READERS: ReadonlyMap<string, string> = new Map([
  ['src/db/agent-events.ts', 'names the task an event was about, by id'],
  ['src/db/backfill.ts', 'timestamps and positions span every task, so no key collides'],
  ['src/db/migrate.ts', 'schema, not a read of work'],
  ['src/db/numbering.ts', 'a number counts every task ever made, so none is reused'],
  ['src/http/middleware/idempotency.ts', 'one task by id'],
  ['src/services/agent-capacity.ts', 'one task by id'],
  ['src/services/agent-time.ts', 'time already spent is history'],
  ['src/services/agent-visibility.ts', 'tasks by id, to decide who may see an agent'],
  ['src/services/attachments.ts', "one task's files by id; a new one is refused"],
  ['src/services/checkpoints.ts', "one task's saves by id"],
  ['src/services/claims.ts', "one task's claim by id; archiving releases it"],
  ['src/services/comments.ts', "one task's thread by id; a new comment is refused"],
  ['src/services/context-revisions.ts', 'one task by id'],
  ['src/services/email-inbound.ts', "a reply's task by id; its comment is refused"],
  ['src/services/email-notify.ts', 'one task by id, for a mail already due'],
  ['src/services/email-outbox.ts', 'one task by id, for a mail already queued'],
  ['src/services/estimates.ts', 'estimates learn from what was finished'],
  ['src/services/github-proof.ts', 'one round by id'],
  ['src/services/handoffs.ts', "one task's offers; archiving closes them"],
  ['src/services/metrics.ts', 'throughput and cycle time are history'],
  ['src/services/notices.ts', 'notices already sent are history'],
  ['src/services/outside-ids.ts', 'an archived task keeps its outside id'],
  ['src/services/project-statuses.ts', "a status's tasks move with it, archived or not"],
  ['src/services/rounds.ts', "one task's rounds by id"],
  ['src/services/task-time.ts', "one task's time by id"],
  ['src/services/time-drafts.ts', 'time records are kept'],
  ['src/services/time-entries.ts', 'time records are kept'],
  ['src/services/time-member-entries.ts', 'time records are kept'],
  ['src/services/time-report.ts', 'time records are kept'],
  ['src/services/time-solidtime.ts', 'time records are kept'],
  ['src/services/time-timer.ts', "the running timer's task, by id"],
  ['src/services/token-usage.ts', 'spending is history'],
  ['src/services/webhooks.ts', 'by id, after the branch resolves to a live task'],
]);

/** Where nothing reads work: the table itself, the filter, and migrations. */
const NOT_SCANNED = new Set(['src/db/schema.ts', 'src/db/live-task.ts']);

const READS_TASKS =
  /\.from\(tasks[),]|(?:inner|left)Join\(tasks,|\bFROM tasks\b|\bJOIN tasks\b|query\.tasks\./;
// `liveTask(` or raw SQL's `liveTaskSql(`. A hand-written `archived_at IS NULL`
// does not count: it would leave Trash in (LAI-1354).
const FILTERS_LIVE = /\bliveTask(?:Sql)?\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'migrations' ? [] : sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

const readers = new Map(
  sourceFiles(join(SERVER_ROOT, 'src'))
    .map((path) => [relative(SERVER_ROOT, path), readFileSync(path, 'utf8')] as const)
    .filter(([file, text]) => !NOT_SCANNED.has(file) && READS_TASKS.test(text)),
);

describe('live-task census (LAI-1353)', () => {
  it('finds the readers it is meant to find', () => {
    // The instrument first: a pattern that matched nothing would pass below.
    expect(readers.has('src/services/tasks.ts')).toBe(true);
    // Each shape a read takes, raw SQL included; and not a word in prose.
    for (const read of [
      '.from(tasks)',
      '.from(tasks, x)',
      '.innerJoin(tasks, eq(a, b))',
      '.leftJoin(tasks, eq(a, b))',
      'sql`SELECT id FROM tasks t`',
      'sql`… JOIN tasks dep ON …`',
    ]) {
      expect(READS_TASKS.test(read), read).toBe(true);
    }
    expect(READS_TASKS.test('// counts the tasks of a sprint')).toBe(false);
  });

  it('names every file that reads tasks, once', () => {
    const named = new Set([...LIVE_READERS, ...HISTORY_READERS.keys()]);
    const unnamed = [...readers.keys()].filter((file) => !named.has(file));
    expect(unnamed, 'add each to LIVE_READERS or HISTORY_READERS with a reason').toEqual([]);

    const twice = LIVE_READERS.filter((file) => HISTORY_READERS.has(file));
    expect(twice).toEqual([]);
  });

  it('names no file that has stopped reading tasks', () => {
    const stale = [...LIVE_READERS, ...HISTORY_READERS.keys()].filter((f) => !readers.has(f));
    expect(stale).toEqual([]);
  });

  it('every live reader leaves archived tasks out', () => {
    const unfiltered = LIVE_READERS.filter((file) => !FILTERS_LIVE.test(readers.get(file) ?? ''));
    expect(unfiltered).toEqual([]);
  });
});
