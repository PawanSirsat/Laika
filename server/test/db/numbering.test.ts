import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { createTaskWithNumber, nextTaskNumber } from '../../src/db/numbering.ts';
import { projects } from '../../src/db/schema.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

interface WorkerResult {
  numbers: number[];
  errors: string[];
}

const WORKER = fileURLToPath(new URL('numbering.worker.ts', import.meta.url));

function runWorker(label: string, count: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { path: t.path, projectId: s.projectId, userId: s.userId, count, label },
      execArgv: ['--experimental-strip-types', '--no-warnings'],
    });

    let result: WorkerResult | undefined;
    worker.on('message', (msg: WorkerResult) => {
      result = msg;
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited ${String(code)}`));
      else if (result === undefined) reject(new Error('worker sent no result'));
      else resolve(result);
    });
  });
}

describe('per-project task numbering (SPEC §4.5)', () => {
  it('starts at 1 and increments', () => {
    expect(nextTaskNumber(t.db, s.projectId)).toBe(1);

    const first = createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: newId(),
      title: 'first',
      createdBy: s.userId,
      createdVia: 'web',
    });
    const second = createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: newId(),
      title: 'second',
      createdBy: s.userId,
      createdVia: 'web',
    });

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  it('numbers each project independently', () => {
    const other = newId();
    const now = Date.now();
    t.db
      .insert(projects)
      .values({
        id: other,
        orgId: s.orgId,
        name: 'Other',
        slug: 'other',
        prefix: 'OTH',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: newId(),
      title: 'a',
      createdBy: s.userId,
      createdVia: 'web',
    });

    const otherFirst = createTaskWithNumber(t.sqlite, t.db, {
      projectId: other,
      id: newId(),
      title: 'b',
      createdBy: s.userId,
      createdVia: 'web',
    });

    expect(otherFirst.number).toBe(1);
  });

  it('leaves no gap when a transaction rolls back', () => {
    createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: newId(),
      title: 'one',
      createdBy: s.userId,
      createdVia: 'web',
    });

    expect(() => {
      createTaskWithNumber(t.sqlite, t.db, {
        projectId: s.projectId,
        id: newId(),
        title: 'doomed',
        // No such user — the FK fails and the whole transaction unwinds.
        createdBy: 'no-such-user',
        createdVia: 'web',
      });
    }).toThrow();

    const next = createTaskWithNumber(t.sqlite, t.db, {
      projectId: s.projectId,
      id: newId(),
      title: 'two',
      createdBy: s.userId,
      createdVia: 'web',
    });

    // A counter table would have burned 2 on the rollback and returned 3.
    expect(next.number).toBe(2);
  });

  /**
   * The property LAI-003 actually asks for: `LAI-1, LAI-2, …` with no gaps and
   * no duplicates *under concurrent inserts*.
   *
   * Four worker threads, four separate connections to one file, 20 tasks each.
   * A `MAX(number)+1` read-then-write — or a deferred `BEGIN` — produces
   * duplicates here; `BEGIN IMMEDIATE` plus `busy_timeout` does not.
   */
  it('produces a dense, duplicate-free sequence under concurrent writers', async () => {
    const PER_WORKER = 20;
    const WORKERS = 4;

    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => runWorker(`w${String(i)}`, PER_WORKER)),
    );

    const errors = results.flatMap((r) => r.errors);
    expect(errors).toEqual([]);

    const numbers = results.flatMap((r) => r.numbers).sort((a, b) => a - b);
    const expected = Array.from({ length: WORKERS * PER_WORKER }, (_, i) => i + 1);

    expect(numbers).toEqual(expected);

    const stored = t.db.all<{ number: number }>(
      sql`SELECT number FROM tasks WHERE project_id = ${s.projectId} ORDER BY number`,
    );
    expect(stored.map((r) => r.number)).toEqual(expected);
  }, 30_000);
});
