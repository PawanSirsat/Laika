/**
 * One worker = one independent SQLite connection to the same file.
 *
 * better-sqlite3 is synchronous, so nothing inside a single process can produce
 * the interleaving the §4.15 rules are written against — "at most one active
 * sprint" and "no overlapping dates" are only interesting when two connections
 * read before either writes.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { openDb } from '../../src/db/client.ts';
import { createSprint, updateSprint } from '../../src/services/sprints.ts';

interface WorkerInput {
  path: string;
  mode: 'activate' | 'create-overlapping';
  userId: string;
  slug: string;
  sprintId: string;
  startsOn: number;
  endsOn: number;
  label: string;
}

const input = workerData as WorkerInput;
const { db, sqlite } = openDb({ path: input.path, createDir: false });
const actor = loadActor(db, input.userId);

const outcomes: string[] = [];
const errors: string[] = [];

function record(fn: () => unknown, conflictPattern: RegExp): void {
  try {
    fn();
    outcomes.push('won');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcomes.push(conflictPattern.test(message) ? 'conflict' : 'unexpected');
    if (!conflictPattern.test(message)) errors.push(message);
  }
}

if (actor === null) {
  errors.push(`no actor for ${input.userId}`);
} else if (input.mode === 'activate') {
  record(
    () => updateSprint(sqlite, db, actor, input.sprintId, { status: 'active' }),
    /is already active/,
  );
} else {
  record(
    () =>
      createSprint(sqlite, db, actor, input.slug, {
        name: `Race ${input.label}`,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
      }),
    /overlap sprint/,
  );
}

sqlite.close();
parentPort?.postMessage({ outcomes, errors });
