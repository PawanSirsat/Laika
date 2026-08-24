import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, sprints, users } from '../../src/db/schema.ts';
import { createProject } from '../../src/services/projects.ts';
import { createSprint } from '../../src/services/sprints.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;

const WORKER = fileURLToPath(new URL('sprints.worker.ts', import.meta.url));

const DAY = 86_400_000;
const JAN1 = Date.UTC(2026, 0, 1);
const jan = (n: number): number => JAN1 + (n - 1) * DAY;

interface WorkerResult {
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

describe('at most one active sprint, under real concurrency (AC3)', () => {
  it('lets exactly one of six connections activate', async () => {
    const actor = loadActor(t.db, adminId)!;
    const candidates = Array.from({ length: 6 }, (_, i) =>
      createSprint(t.sqlite, t.db, actor, 'laika', {
        name: `Sprint ${String(i)}`,
        // Non-overlapping, so the only thing being contended is `active`.
        starts_on: jan(1 + i * 10),
        ends_on: jan(9 + i * 10),
      }),
    );

    const results = await Promise.all(
      candidates.map((s) =>
        run({ mode: 'activate', userId: adminId, slug: 'laika', sprintId: s.id }),
      ),
    );

    const outcomes = results.flatMap((r) => r.outcomes);

    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(5);

    // The database is the real assertion: whatever the workers reported, there
    // can only be one active row.
    expect(t.db.select().from(sprints).where(eq(sprints.status, 'active')).all()).toHaveLength(1);
  }, 60_000);
});

describe('no overlapping sprints, under real concurrency (AC4)', () => {
  it('lets exactly one of four connections take the same fortnight', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        run({
          mode: 'create-overlapping',
          userId: adminId,
          slug: 'laika',
          startsOn: jan(1),
          endsOn: jan(14),
          label: `w${String(i)}`,
        }),
      ),
    );

    const outcomes = results.flatMap((r) => r.outcomes);

    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(3);
    expect(t.db.select().from(sprints).all()).toHaveLength(1);
  }, 60_000);
});
