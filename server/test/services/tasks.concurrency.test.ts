import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, users } from '../../src/db/schema.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;

const WORKER = fileURLToPath(new URL('tasks.worker.ts', import.meta.url));

interface WorkerResult {
  numbers: number[];
  outcomes: string[];
  errors: string[];
}

function run(input: Record<string, unknown>): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { path: t.path, ...input },
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

function makeUser(): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole: 'admin',
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, loadActor(t.db, adminId)!, {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  });
});
afterEach(() => {
  t.close();
});

describe('task numbering under concurrent creates (AC9)', () => {
  it('produces a dense, duplicate-free sequence across four connections', async () => {
    const PER_WORKER = 15;
    const WORKERS = 4;

    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        run({
          mode: 'create',
          userId: adminId,
          slug: 'laika',
          count: PER_WORKER,
          label: `w${String(i)}`,
        }),
      ),
    );

    expect(results.flatMap((r) => r.errors)).toEqual([]);

    const numbers = results.flatMap((r) => r.numbers).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: WORKERS * PER_WORKER }, (_, i) => i + 1));
  }, 60_000);
});

describe('claim is a compare-and-swap under real concurrency (AC3)', () => {
  it('lets exactly one of six connections win the same task', async () => {
    const task = createTask(t.sqlite, t.db, loadActor(t.db, adminId)!, 'laika', { title: 'race' });
    const claimants = Array.from({ length: 6 }, () => makeUser());

    const results = await Promise.all(
      claimants.map((id) =>
        run({ mode: 'claim', userId: id, slug: 'laika', taskId: task.id, count: 1, label: 'c' }),
      ),
    );

    const outcomes = results.flatMap((r) => r.outcomes);

    // Two agents on one task is the failure this exists to prevent.
    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(5);
    expect(outcomes.filter((o) => o === 'unexpected')).toEqual([]);
  }, 60_000);
});
