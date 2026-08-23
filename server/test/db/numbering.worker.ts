/**
 * One worker = one independent SQLite connection to the same file, so
 * `numbering.test.ts` exercises genuine cross-connection contention rather than
 * a simulation of it. better-sqlite3 is synchronous, so nothing in a single
 * process can produce the interleaving this is meant to catch.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { createTaskWithNumber } from '../../src/db/numbering.ts';

interface WorkerInput {
  path: string;
  projectId: string;
  userId: string;
  count: number;
  label: string;
}

const input = workerData as WorkerInput;
const { db, sqlite } = openDb({ path: input.path, createDir: false });

const numbers: number[] = [];
const errors: string[] = [];

for (let i = 0; i < input.count; i++) {
  try {
    const { number } = createTaskWithNumber(sqlite, db, {
      projectId: input.projectId,
      id: newId(),
      title: `${input.label}-${String(i)}`,
      createdBy: input.userId,
      createdVia: 'api',
    });
    numbers.push(number);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
}

sqlite.close();
parentPort?.postMessage({ numbers, errors });
