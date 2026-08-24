/**
 * One worker = one independent SQLite connection to the same file, so the
 * concurrency tests exercise genuine cross-connection contention. better-sqlite3
 * is synchronous, so nothing in a single process can produce the interleaving
 * these are meant to catch.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { openDb } from '../../src/db/client.ts';
import { claimTask, createTask } from '../../src/services/tasks.ts';

interface WorkerInput {
  path: string;
  mode: 'create' | 'claim';
  userId: string;
  slug: string;
  taskId: string;
  count: number;
  label: string;
}

const input = workerData as WorkerInput;
const { db, sqlite } = openDb({ path: input.path, createDir: false });
const actor = loadActor(db, input.userId);

const numbers: number[] = [];
const outcomes: string[] = [];
const errors: string[] = [];

if (actor === null) {
  errors.push(`no actor for ${input.userId}`);
} else if (input.mode === 'create') {
  for (let i = 0; i < input.count; i++) {
    try {
      numbers.push(
        createTask(sqlite, db, actor, input.slug, { title: `${input.label}-${String(i)}` }).number,
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
} else {
  try {
    claimTask(sqlite, db, actor, input.taskId);
    outcomes.push('won');
  } catch (err) {
    outcomes.push(
      err instanceof Error && err.message.includes('already claimed') ? 'conflict' : 'unexpected',
    );
  }
}

sqlite.close();
parentPort?.postMessage({ numbers, outcomes, errors });
