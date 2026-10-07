/**
 * One worker = one independent SQLite connection to the same file, so the
 * concurrency tests exercise genuine cross-connection contention. better-sqlite3
 * is synchronous, so nothing in a single process can produce the interleaving
 * these are meant to catch.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { openDb } from '../../src/db/client.ts';
import { ApiError } from '../../src/errors.ts';
import { claimTask, createTask, reorderTask } from '../../src/services/tasks.ts';

interface WorkerInput {
  path: string;
  mode: 'create' | 'claim' | 'reorder';
  userId: string;
  slug: string;
  taskId: string;
  count: number;
  label: string;
  /** `reorder`: the cards this worker moves, in order, into one gap. */
  cards?: string[];
  afterId?: string;
  beforeId?: string;
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
} else if (input.mode === 'reorder') {
  for (const card of input.cards ?? []) {
    try {
      reorderTask(sqlite, db, actor, card, {
        after_task_id: input.afterId,
        before_task_id: input.beforeId,
      });
      outcomes.push('moved');
    } catch (err) {
      outcomes.push(err instanceof ApiError ? err.code : `unexpected: ${String(err)}`);
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
