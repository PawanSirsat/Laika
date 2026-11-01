import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  agents,
  orgs,
  taskEstimates,
  taskRounds,
  tasks,
  tokens,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { startScheduler } from '../../src/jobs/scheduler.ts';
import { FORECAST_AFTER } from '../../src/services/estimate-model.ts';
import {
  getEstimateAccuracy,
  getTaskEstimate,
  refitEstimates,
  refreshEstimate,
  setEstimateLogger,
} from '../../src/services/estimates.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { sendBackTask } from '../../src/services/review.ts';
import {
  addTaskDependency,
  changeStatus,
  claimTask,
  createTask,
  finishTask,
  getTask,
  removeTaskDependency,
  updateTask,
} from '../../src/services/tasks.ts';
import { captureLog } from '../helpers/app.ts';
import { immediateTransaction } from '../../src/db/numbering.ts';
import { atCategory, expectSqliteError, freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Sizes and build-time forecasts in the database (D-085, LAI-771): computed on
 * the writes that change what the model reads and on nothing else, frozen at
 * the first claim, kept as append-only history, overridden by anyone who may
 * edit the task, and measured per project — never per person.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * **Setup time never fails a test here** (LAI-771, the gate on 9ea021f2). Most
 * of these seed a project's history before they assert, and the gate's runner
 * timed the 120-task one out at 6.1 s; with every core of a laptop busy, even a
 * test that seeds nothing reported 8.2 s. The bound is on the run, not on what
 * is asserted: the 5 ms recompute budget below is its own assertion.
 */
vi.setConfig({ testTimeout: 60_000 });
const T0 = Date.UTC(2026, 8, 1);

let t: TestDb;
let adminId: string;

function makeUser(orgRole: OrgRole, name: string): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

/** The same person through a token whose agent calls itself `client`. */
function agent(userId: string, client: string): ResolvedActor {
  const id = newId();
  t.db
    .insert(tokens)
    .values({
      id,
      userId,
      name: `${client} token`,
      prefix: 'lai_test',
      tokenHash: `${id}-hash`,
      scope: 'full',
      projectIdsJson: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      lastClientName: client,
      createdAt: Date.now(),
    })
    .run();
  return { ...actor(userId), token: { id, scope: 'full', projectIds: null } };
}

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal, and the call succeeded');
}

const admin = () => actor(adminId);

function words(n: number, word = 'work'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

function newTask(extra: Record<string, unknown> = {}, now = T0) {
  return createTask(t.sqlite, t.db, admin(), 'laika', { title: 'Work', ...extra, now });
}

function row(taskId: string) {
  return t.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
}

function estimateRows(taskId: string) {
  return t.db
    .select()
    .from(taskEstimates)
    .where(eq(taskEstimates.taskId, taskId))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);
}

const TOPICS = [
  'migration schema sqlite',
  'board card lane',
  'token scope auth',
  'webhook github push',
];

/**
 * `count` finished tasks, each built in time proportional to its acceptance
 * text — the shape the R&D measured — by `by`, started and finished at the
 * moments given, so build time is exactly what the test says it is.
 */
function finishedTasks(count: number, by: () => ResolvedActor = admin, from = T0): string[] {
  // **One transaction for the whole history**, so each service's own
  // transaction is a savepoint inside it rather than a commit of its own:
  // seeding 120 tasks was four commits each, and on a slow runner the setup
  // alone outran vitest's 5 s default (LAI-771, the gate on 9ea021f2). What is
  // written, and every rule it goes through, is unchanged.
  return immediateTransaction(t.sqlite, () => seedFinished(count, by, from));
}

function seedFinished(count: number, by: () => ResolvedActor, from: number): string[] {
  const ids: string[] = [];
  let clock = from;
  for (let i = 0; i < count; i += 1) {
    const size = 20 + ((i * 37) % 300);
    const topic = TOPICS[i % TOPICS.length]!;
    const task = createTask(t.sqlite, t.db, admin(), 'laika', {
      title: `${topic} ${String(i)}`,
      acceptance_md: `${topic} ${words(size)}`,
      now: clock,
    });
    const build = Math.round(size * 0.4 * MIN * (1 + (i % 3) * 0.2));
    claimTask(t.sqlite, t.db, by(), task.id, clock + MIN);
    finishTask(t.sqlite, t.db, by(), task.id, { summary: 'Done', now: clock + MIN + build });
    changeStatus(t.db, admin(), task.id, 'done', clock + MIN + build + 5 * MIN);
    ids.push(task.id);
    clock += build + 2 * HOUR;
  }
  return ids;
}

beforeEach(() => {
  t = freshDb();
  adminId = makeUser('admin', 'Ada');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: T0, updatedAt: T0 })
    .run();
  createProject(t.sqlite, t.db, admin(), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

describe('every task gets a computed size', () => {
  it('on create: a level, the computed one beside it, not overridden, from a model row', () => {
    const task = newTask({ acceptance_md: words(120) });
    expect(task.size).toMatchObject({ computed: task.size!.level, overridden: false, subtasks: 0 });
    expect(['XS', 'S', 'M', 'L', 'XL']).toContain(task.size!.level);
    const rows = estimateRows(task.id);
    expect(rows.map((r) => r.source)).toEqual(['model']);
    expect(row(task.id).estimateId).toBe(rows[0]!.id);
  });

  it('sizes against the project’s own typical task: much longer text, bigger size', () => {
    for (let i = 0; i < 5; i += 1) newTask({ acceptance_md: words(100) });
    const small = newTask({ acceptance_md: words(10) });
    const large = newTask({ acceptance_md: words(900) });
    const order = ['XS', 'S', 'M', 'L', 'XL'];
    expect(order.indexOf(large.size!.level)).toBeGreaterThan(order.indexOf(small.size!.level));
  });
});

describe('cold start: size only, hours after FORECAST_AFTER finished tasks', () => {
  it('has no hours with fewer finished tasks', () => {
    finishedTasks(FORECAST_AFTER - 1);
    refitEstimates(t.db, T0 + 400 * HOUR);
    const task = newTask({ acceptance_md: words(80) }, T0 + 401 * HOUR);
    expect(task.size!.build_p50_ms).toBeNull();
    expect(task.size!.build_p80_ms).toBeNull();
    expect(getTaskEstimate(t.db, admin(), task.id).why?.early).toBe(true);
  });

  it('shows a p50–p80 build-time range once there are enough', () => {
    finishedTasks(FORECAST_AFTER);
    refitEstimates(t.db, T0 + 400 * HOUR);
    const task = newTask({ acceptance_md: words(80) }, T0 + 401 * HOUR);
    expect(task.size!.build_p50_ms).toBeGreaterThan(0);
    expect(task.size!.build_p80_ms!).toBeGreaterThan(task.size!.build_p50_ms!);
    expect(getTaskEstimate(t.db, admin(), task.id).why?.early).toBe(false);
  });
});

describe('recompute — on what the model reads, keyed on a hash of it', () => {
  it('recomputes on an edit of the title, description or acceptance', () => {
    const task = newTask({ acceptance_md: words(10) });
    const hash = row(task.id).estimateHash;

    updateTask(t.db, admin(), task.id, { acceptance_md: words(900) });
    expect(row(task.id).estimateHash).not.toBe(hash);
    const after = getTask(t.db, admin(), task.id);
    expect(after.size!.level).not.toBe(task.size!.level);
    expect(estimateRows(task.id)).toHaveLength(2);

    const before = row(task.id).estimateHash;
    updateTask(t.db, admin(), task.id, { title: 'Renamed' });
    expect(row(task.id).estimateHash).not.toBe(before);
    const again = row(task.id).estimateHash;
    updateTask(t.db, admin(), task.id, { description_md: 'More words here' });
    expect(row(task.id).estimateHash).not.toBe(again);
  });

  it('costs nothing for an edit the model does not read: no new hash, no new row', () => {
    const other = makeUser('member', 'Bea');
    addMember(t.db, admin(), 'laika', other, 'member');
    const task = newTask({ acceptance_md: words(50) });
    const hash = row(task.id).estimateHash;
    const rows = estimateRows(task.id).length;

    updateTask(t.db, admin(), task.id, { priority: 'p1' });
    updateTask(t.db, admin(), task.id, { assignee_id: other, due_on: T0 });
    updateTask(t.db, admin(), task.id, { assignee_id: null });
    changeStatus(t.db, admin(), task.id, 'todo', T0 + MIN);

    expect(row(task.id).estimateHash).toBe(hash);
    expect(estimateRows(task.id)).toHaveLength(rows);
  });

  it('writes a row only when the output moves: an extra word changes the hash and nothing else', () => {
    const task = newTask({ acceptance_md: words(200) });
    const hash = row(task.id).estimateHash;
    updateTask(t.db, admin(), task.id, { acceptance_md: `${words(200)} more` });
    expect(row(task.id).estimateHash).not.toBe(hash);
    expect(estimateRows(task.id)).toHaveLength(1);
  });

  it('recomputes on a dependency added or removed', () => {
    const task = newTask({ acceptance_md: words(50) });
    const blocker = newTask();
    // Settled against the model as it stands now: creating the blocker grew a
    // cold project, which refits it, and that is not what is under test.
    refreshEstimate(t.db, task.id, T0);
    const hash = row(task.id).estimateHash;
    addTaskDependency(t.sqlite, t.db, admin(), task.id, blocker.id);
    const added = row(task.id).estimateHash;
    expect(added).not.toBe(hash);
    removeTaskDependency(t.db, admin(), task.id, blocker.id);
    expect(row(task.id).estimateHash).toBe(hash);
  });

  it('recomputes on a tag change', () => {
    const task = newTask({ acceptance_md: words(50) });
    const hash = row(task.id).estimateHash;
    updateTask(t.db, admin(), task.id, { tags: ['docs'] });
    expect(row(task.id).estimateHash).not.toBe(hash);
  });
});

/**
 * **What a recompute costs, held in a way no runner's load can move** (LAI-779).
 *
 * The 5 ms budget LAI-771 set is real, and it is a wall-clock figure: GitHub's
 * shared two-core runner measured a p95 of 7.4 ms on the run after one that
 * passed, with the median here about 0.2 ms. A timing that strict in the gate
 * measures the machine as much as the code, and on `master` a flake is a deploy
 * that does not happen. So the gate counts the **work** — statements prepared
 * and rows read per recompute, which a per-task query or a scan of the project
 * grows and nothing else does — and keeps a wall-clock ceiling ten times the
 * budget, for an order-of-magnitude regression in the in-memory forecast. The
 * budget itself is `LAIKA_PERF=1`, as `token-usage.perf.test.ts` does it.
 */
describe('the cost of a recompute', () => {
  const PERF = process.env.LAIKA_PERF === '1';

  /** The task under measurement: a fresh hash every call, so each one computes. */
  function stale(taskId: string, i: number): void {
    t.db
      .update(tasks)
      .set({ estimateHash: `stale-${String(i)}` })
      .where(eq(tasks.id, taskId))
      .run();
  }

  /**
   * The database work `fn` does: statements prepared, rows they returned, and
   * every step of their query plans that walks a whole table or index rather
   * than searching one. A per-task query adds statements, a read of the
   * project's tasks adds rows, and a `count(*)` over an unindexed column — one
   * row, one statement — shows as a `SCAN`.
   */
  function work(fn: () => void): { statements: number; rows: number; scans: string[] } {
    const sqlite = t.sqlite;
    const prepare = sqlite.prepare.bind(sqlite);
    const ran: { source: string; params: unknown[] }[] = [];
    let statements = 0;
    let rows = 0;
    sqlite.prepare = ((source: string) => {
      statements += 1;
      const stmt = prepare(source) as Database.Statement<unknown[], unknown>;
      const [get, all, run] = [stmt.get.bind(stmt), stmt.all.bind(stmt), stmt.run.bind(stmt)];
      stmt.get = (...params: unknown[]) => {
        ran.push({ source, params });
        const row: unknown = get(...params);
        if (row !== undefined) rows += 1;
        return row;
      };
      stmt.all = (...params: unknown[]) => {
        ran.push({ source, params });
        const found: unknown[] = all(...params);
        rows += found.length;
        return found;
      };
      stmt.run = (...params: unknown[]) => {
        ran.push({ source, params });
        return run(...params);
      };
      return stmt;
    }) as typeof sqlite.prepare;
    try {
      fn();
    } finally {
      // The method lives on the prototype: dropping the shadow restores it.
      Reflect.deleteProperty(sqlite, 'prepare');
    }
    const scans = ran.flatMap(({ source, params }) =>
      (sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...params) as { detail: string }[])
        .map((step) => step.detail)
        .filter((detail) => detail.startsWith('SCAN ') && detail !== 'SCAN CONSTANT ROW'),
    );
    return { statements, rows, scans };
  }

  /** Per-recompute timings of `runs` calls, sorted, in ms. */
  function timings(taskId: string, now: number, runs = 60): number[] {
    const times: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      stale(taskId, i);
      const start = performance.now();
      refreshEstimate(t.db, taskId, now);
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b);
  }

  const at = (sorted: readonly number[], q: number) => sorted[Math.floor(sorted.length * q)]!;

  it('reads the same statements and rows on 1200 finished tasks as on 120', () => {
    finishedTasks(120);
    refitEstimates(t.db, T0 + 2000 * HOUR);
    const task = newTask({ acceptance_md: words(150) }, T0 + 2001 * HOUR);

    // A warm fit and figures that do not move — the steady state of an edit
    // the model reads — so both sides run the same path and write no row.
    const measure = (i: number, now: number) => {
      let wrote = true;
      stale(task.id, i);
      const counted = work(() => {
        wrote = refreshEstimate(t.db, task.id, now);
      });
      return { ...counted, wrote };
    };
    measure(0, T0 + 2002 * HOUR);
    const small = measure(1, T0 + 2002 * HOUR);

    finishedTasks(1080, admin, T0 + 3000 * HOUR);
    refitEstimates(t.db, T0 + 100_000 * HOUR);
    measure(2, T0 + 100_001 * HOUR);
    const large = measure(3, T0 + 100_001 * HOUR);

    // Positive control: the counter sees the recompute's reads at all.
    expect(small.statements).toBeGreaterThan(3);
    expect(small.rows).toBeGreaterThan(0);
    expect(small.wrote).toBe(false);
    expect(small.scans).toEqual([]);
    expect(large).toEqual(small);
    // Seeding 1200 tasks through the services took 13.6 s with every core of a
    // laptop busy: setup, never what is asserted, so it gets room of its own.
  }, 300_000);

  it('stays under 50 ms at p95 on 120 finished tasks: a ceiling for a blow-up, not the budget', () => {
    finishedTasks(120);
    refitEstimates(t.db, T0 + 2000 * HOUR);
    const task = newTask({ acceptance_md: words(150) }, T0 + 2001 * HOUR);
    const times = timings(task.id, T0 + 2002 * HOUR);
    expect(at(times, 0.95), `p95 ${at(times, 0.95).toFixed(3)} ms`).toBeLessThan(50);
  });

  it.skipIf(!PERF)(
    'takes under 5 ms per recompute, measured on a project with 120 finished tasks (LAIKA_PERF=1)',
    () => {
      finishedTasks(120);
      refitEstimates(t.db, T0 + 2000 * HOUR);
      const task = newTask({ acceptance_md: words(150) }, T0 + 2001 * HOUR);
      const times = timings(task.id, T0 + 2002 * HOUR);
      expect(at(times, 0.5), `median ${at(times, 0.5).toFixed(3)} ms`).toBeLessThan(5);
      expect(at(times, 0.95), `p95 ${at(times, 0.95).toFixed(3)} ms`).toBeLessThan(5);
    },
  );
});

describe('a parent’s size and forecast come from its children', () => {
  it('weighs the larger of its own text and its children’s sum, and counts them', () => {
    for (let i = 0; i < 4; i += 1) newTask({ acceptance_md: words(100) });
    const parent = newTask({ acceptance_md: words(5) });
    const smallAlone = getTask(t.db, admin(), parent.id).size!;
    for (let i = 0; i < 3; i += 1) {
      newTask({ parent_task_id: parent.id, acceptance_md: words(400) });
    }
    const rolled = getTask(t.db, admin(), parent.id).size!;
    expect(rolled.subtasks).toBe(3);
    expect(rolled.weight).toBeGreaterThan(smallAlone.weight);
    const order = ['XS', 'S', 'M', 'L', 'XL'];
    expect(order.indexOf(rolled.level)).toBeGreaterThan(order.indexOf(smallAlone.level));
    const why = getTaskEstimate(t.db, admin(), parent.id).why!;
    expect(why.factors.map((f) => f.key)).toContain('subtasks');
  });

  it('drops a cancelled child, and follows a child moved to another parent', () => {
    const a = newTask({ acceptance_md: words(5) });
    const b = newTask({ acceptance_md: words(5) });
    const one = newTask({ parent_task_id: a.id, acceptance_md: words(300) });
    newTask({ parent_task_id: a.id, acceptance_md: words(300) });
    expect(getTask(t.db, admin(), a.id).size!.subtasks).toBe(2);

    changeStatus(t.db, admin(), one.id, 'cancelled', T0 + MIN);
    expect(getTask(t.db, admin(), a.id).size!.subtasks).toBe(1);

    const two = newTask({ parent_task_id: a.id, acceptance_md: words(300) });
    updateTask(t.db, admin(), two.id, { parent_task_id: b.id });
    expect(getTask(t.db, admin(), a.id).size!.subtasks).toBe(1);
    expect(getTask(t.db, admin(), b.id).size!.subtasks).toBe(1);
  });

  it('forecasts a parent’s build time from its children’s ranges', () => {
    finishedTasks(FORECAST_AFTER + 5);
    refitEstimates(t.db, T0 + 900 * HOUR);
    const parent = newTask({ acceptance_md: words(5) }, T0 + 901 * HOUR);
    const kids = [0, 1, 2].map(() =>
      newTask({ parent_task_id: parent.id, acceptance_md: words(250) }, T0 + 901 * HOUR),
    );
    const sizes = kids.map((k) => getTask(t.db, admin(), k.id).size!);
    const rolled = getTask(t.db, admin(), parent.id).size!;
    const largest = Math.max(...sizes.map((s) => s.build_p50_ms!));
    expect(rolled.build_p50_ms!).toBeGreaterThan(largest);
  });
});

describe('frozen at claim', () => {
  it('keeps the estimate in force when work first started, whatever happens to the text after', () => {
    const task = newTask({ acceptance_md: words(10) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + MIN);
    const frozen = row(task.id).estimateAtStartId;
    expect(frozen).not.toBeNull();
    expect(frozen).toBe(row(task.id).estimateId);

    updateTask(t.db, admin(), task.id, { acceptance_md: words(900) });
    expect(row(task.id).estimateId).not.toBe(frozen);
    expect(row(task.id).estimateAtStartId).toBe(frozen);

    // Released and claimed again: the first start's copy stays, as started_at does.
    updateTask(t.db, admin(), task.id, { assignee_id: null });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 2 * MIN);
    expect(row(task.id).estimateAtStartId).toBe(frozen);

    const view = getTaskEstimate(t.db, admin(), task.id);
    expect(view.at_start?.level).toBe(task.size!.level);
    expect(view.size?.computed).not.toBe(task.size!.level);
  });

  it('freezes on a person moving the task into work, not only on a claim', () => {
    const task = newTask({ acceptance_md: words(40) });
    changeStatus(t.db, admin(), task.id, 'in_progress', T0 + MIN);
    expect(row(task.id).estimateAtStartId).toBe(row(task.id).estimateId);
  });

  it('does not freeze a task already started before estimates existed', () => {
    const task = newTask({ acceptance_md: words(40) });
    t.db.update(tasks).set({ startedAt: T0 }).where(eq(tasks.id, task.id)).run();
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + MIN);
    expect(row(task.id).estimateAtStartId).toBeNull();
  });
});

describe('estimates are append-only history', () => {
  it('refuses UPDATE and DELETE on task_estimates', () => {
    const task = newTask({ acceptance_md: words(40) });
    expectSqliteError(
      () =>
        t.db
          .update(taskEstimates)
          .set({ level: 'XL' })
          .where(eq(taskEstimates.taskId, task.id))
          .run(),
      /append-only/,
    );
    expectSqliteError(
      () => t.db.delete(taskEstimates).where(eq(taskEstimates.taskId, task.id)).run(),
      /append-only/,
    );
  });
});

describe('build time is first start to first finish; review wait and rework apart', () => {
  it('measures each from the task’s own history', () => {
    const task = newTask({ acceptance_md: words(40) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + 1 * HOUR);
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'One', now: T0 + 3 * HOUR });
    sendBackTask(t.sqlite, t.db, admin(), task.id, 'Not yet', T0 + 4 * HOUR);
    // A send-back puts it straight back into work: rework runs from here.
    expect(getTask(t.db, admin(), task.id).status).toBe('in_progress');
    finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Two', now: T0 + 6 * HOUR });
    changeStatus(t.db, admin(), task.id, 'done', T0 + 7 * HOUR);

    const actual = getTaskEstimate(t.db, admin(), task.id).actual;
    expect(actual.build_ms).toBe(2 * HOUR);
    expect(actual.review_wait_ms).toBe(HOUR + HOUR);
    expect(actual.rework_ms).toBe(2 * HOUR);
    expect(actual.finishes).toBe(2);
  });

  it('has no build time before the first finish', () => {
    const task = newTask({ acceptance_md: words(40) });
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + HOUR);
    expect(getTaskEstimate(t.db, admin(), task.id).actual.build_ms).toBeNull();
  });
});

describe('override — anyone who may edit the task', () => {
  it('lets a member set a size, shows it, and keeps the computed one visible', () => {
    const bea = makeUser('member', 'Bea');
    addMember(t.db, admin(), 'laika', bea, 'member');
    const task = newTask({ acceptance_md: words(40) });
    const computed = task.size!.computed;
    const level = computed === 'XL' ? 'XS' : 'XL';

    const after = updateTask(t.db, actor(bea), task.id, { size: level });
    expect(after.size).toMatchObject({ level, computed, overridden: true });

    const written = t.db
      .select()
      .from(activity)
      .where(and(eq(activity.taskId, task.id), eq(activity.type, 'task.updated')))
      .all()
      .map((r) => JSON.parse(r.payloadJson) as Record<string, unknown>)
      .find((p) => p.field === 'size');
    expect(written).toEqual({ field: 'size', from: null, to: level });

    const view = getTaskEstimate(t.db, admin(), task.id);
    expect(view.override).toMatchObject({ level, set_by: bea });
    expect(view.why).not.toBeNull();
  });

  it('refuses a viewer, who may not edit the task', () => {
    const vic = makeUser('viewer', 'Vic');
    addMember(t.db, admin(), 'laika', vic, 'viewer');
    const task = newTask({ acceptance_md: words(40) });
    expect(refusal(() => updateTask(t.db, actor(vic), task.id, { size: 'XL' })).code).toBe(
      'forbidden',
    );
    expect(row(task.id).sizeOverrideId).toBeNull();
  });

  it('clears back to the computed size with null, and keeps both in the history', () => {
    const task = newTask({ acceptance_md: words(40) });
    updateTask(t.db, admin(), task.id, { size: 'XL' });
    const cleared = updateTask(t.db, admin(), task.id, { size: null });
    expect(cleared.size).toMatchObject({ level: task.size!.computed, overridden: false });
    expect(estimateRows(task.id).map((r) => [r.source, r.level])).toEqual([
      ['model', task.size!.computed],
      ['person', 'XL'],
      ['person', null],
    ]);
  });

  it('can be set on create', () => {
    const task = newTask({ acceptance_md: words(40), size: 'L' });
    expect(task.size).toMatchObject({ level: 'L', overridden: true });
  });

  it('writes nothing when the size asked for is the one already set', () => {
    const task = newTask({ acceptance_md: words(40) });
    updateTask(t.db, admin(), task.id, { size: 'L' });
    const rows = estimateRows(task.id).length;
    updateTask(t.db, admin(), task.id, { size: 'L' });
    expect(estimateRows(task.id)).toHaveLength(rows);
  });
});

describe('why — each factor’s contribution, and links to the similar tasks', () => {
  it('adds up to the weight, and names finished tasks of this project', () => {
    const done = finishedTasks(30);
    refitEstimates(t.db, T0 + 3000 * HOUR);
    const task = newTask(
      {
        title: 'migration schema sqlite again',
        acceptance_md: `migration schema sqlite ${words(120)}`,
      },
      T0 + 3001 * HOUR,
    );
    const view = getTaskEstimate(t.db, admin(), task.id);
    const total = view.why!.factors.reduce((s, f) => s + f.levels, 0);
    expect(total).toBeCloseTo(Math.log2(view.size!.weight), 2);
    expect(view.why!.similar.length).toBeGreaterThan(0);
    for (const s of view.why!.similar) {
      expect(done).toContain(s.task_id);
      expect(s.key).toMatch(/^LAI-\d+$/);
    }
  });

  it('is read only by someone who may read the project', () => {
    const outsider = makeUser('member', 'Out');
    const task = newTask({ acceptance_md: words(40) });
    expect(refusal(() => getTaskEstimate(t.db, actor(outsider), task.id)).code).toBe('forbidden');
  });
});

describe('accuracy — per project, and never per person', () => {
  it('measures the frozen estimate against the actual build time', () => {
    finishedTasks(FORECAST_AFTER + 2);
    refitEstimates(t.db, T0 + 600 * HOUR);
    let clock = T0 + 601 * HOUR;
    for (let i = 0; i < 4; i += 1) {
      const task = newTask({ acceptance_md: words(60 + i * 40) }, clock);
      claimTask(t.sqlite, t.db, admin(), task.id, clock + MIN);
      finishTask(t.sqlite, t.db, admin(), task.id, { summary: 'Done', now: clock + 30 * MIN });
      clock += 2 * HOUR;
    }
    // Every finished task that started under a forecast — the four above,
    // and any of the history that started after the project had enough.
    const frozenWithForecast = t.db
      .select({ p50: taskEstimates.buildP50Ms })
      .from(tasks)
      .innerJoin(taskEstimates, eq(taskEstimates.id, tasks.estimateAtStartId))
      .all()
      .filter((r) => r.p50 !== null).length;
    const view = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(frozenWithForecast).toBeGreaterThanOrEqual(4);
    expect(view.live.n).toBe(frozenWithForecast);
    expect(view.live.typical_error).toBeGreaterThanOrEqual(1);
    expect(view.live.p80_hit_rate).toBeGreaterThanOrEqual(0);
    expect(view.finished).toBeGreaterThanOrEqual(FORECAST_AFTER + 2);
    expect(view.forecasts_after).toBe(FORECAST_AFTER);
  });

  it('reports a back-test against the plain project median once there is history', () => {
    finishedTasks(60);
    refitEstimates(t.db, T0 + 9000 * HOUR);
    const view = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(view.backtest).not.toBeNull();
    expect(view.backtest!.n).toBeGreaterThan(0);
    expect(view.backtest!.median_error).toBeGreaterThanOrEqual(1);
  });

  it('breaks down by agent client only when at least three people use it, and names nobody', () => {
    const people = ['Bea', 'Cy', 'Di'].map((name) => {
      const id = makeUser('member', name);
      addMember(t.db, admin(), 'laika', id, 'member');
      return id;
    });
    // Codex is used by three people, Gemini by one.
    let clock = T0;
    for (const [i, person] of people.entries()) {
      finishedTasks(4, () => agent(person, 'codex'), clock);
      clock += 100 * HOUR;
      if (i === 0) {
        finishedTasks(4, () => agent(person, 'gemini'), clock);
        clock += 100 * HOUR;
      }
    }
    refitEstimates(t.db, clock);
    for (const person of people) {
      const task = newTask({ acceptance_md: words(80) }, clock);
      const codex = agent(person, 'codex');
      claimTask(t.sqlite, t.db, codex, task.id, clock + MIN);
      finishTask(t.sqlite, t.db, codex, task.id, { summary: 'Done', now: clock + HOUR });
      clock += 2 * HOUR;
    }
    const lone = newTask({ acceptance_md: words(80) }, clock);
    const gemini = agent(people[0]!, 'gemini');
    claimTask(t.sqlite, t.db, gemini, lone.id, clock + MIN);
    finishTask(t.sqlite, t.db, gemini, lone.id, { summary: 'Done', now: clock + HOUR });

    const view = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(view.by_client.map((c) => c.client_name)).toEqual(['codex']);
    expect(view.by_client[0]!.people).toBeGreaterThanOrEqual(3);

    // No person's id, name or email anywhere in it.
    const text = JSON.stringify(view);
    for (const id of [adminId, ...people]) expect(text).not.toContain(id);
    for (const name of ['Ada', 'Bea', 'Cy', 'Di']) expect(text).not.toContain(name);
    expect(t.db.select().from(taskRounds).all().length).toBeGreaterThan(0);
  });
});

describe('the nightly refit, through the scheduler', () => {
  it('estimates tasks that have none, and a second run changes nothing', async () => {
    const a = newTask({ acceptance_md: words(40) });
    const b = newTask({ acceptance_md: words(400) });
    // As if they were written before estimates existed.
    t.db
      .update(tasks)
      .set({ estimateId: null, estimateHash: null })
      .where(eq(tasks.projectId, row(a.id).projectId))
      .run();

    const scheduler = startScheduler({
      db: t.db,
      sqlite: t.sqlite,
      log: captureLog().logger,
      backupDir: '/nonexistent',
      now: () => T0 + HOUR,
      setTimer: () => ({}),
      clearTimer: () => undefined,
    });
    try {
      const first = await scheduler.runOnce('estimate.refit');
      expect(first?.changed).toBe(2);
      expect(row(a.id).estimateId).not.toBeNull();
      expect(row(b.id).estimateId).not.toBeNull();
      const second = await scheduler.runOnce('estimate.refit');
      expect(second?.changed).toBe(0);
    } finally {
      scheduler.stop();
    }
  });
});

/**
 * The estimator is best effort, and the task write it rides on is not (LAI-771
 * review, B1). With every estimate write refused — a trigger on
 * `task_estimates` and one on the four pointers — a create, an edit, a claim
 * and a status change must each save **with its activity row**, and the
 * failure must be logged rather than thrown. Before the fix the create threw
 * and saved nothing, the edit threw after saving, and a move into work saved
 * its status and `started_at` and **no `task.status_changed` row**.
 */
describe('an estimator failure never breaks a task write (B1)', () => {
  const BROKEN = 'estimates refuse writes for this test';

  function breakEstimates(which: 'all' | 'freeze' = 'all'): void {
    if (which === 'all') {
      t.sqlite.exec(
        `CREATE TRIGGER test_estimates_refused BEFORE INSERT ON task_estimates BEGIN SELECT RAISE(ABORT, '${BROKEN}'); END`,
      );
      t.sqlite.exec(
        `CREATE TRIGGER test_estimate_pointers_refused BEFORE UPDATE OF estimate_id, estimate_at_start_id, size_override_id, estimate_hash ON tasks BEGIN SELECT RAISE(ABORT, '${BROKEN}'); END`,
      );
    } else {
      t.sqlite.exec(
        `CREATE TRIGGER test_freeze_refused BEFORE UPDATE OF estimate_at_start_id ON tasks WHEN NEW.estimate_at_start_id IS NOT NULL BEGIN SELECT RAISE(ABORT, '${BROKEN}'); END`,
      );
    }
  }

  function healEstimates(): void {
    for (const name of [
      'test_estimates_refused',
      'test_estimate_pointers_refused',
      'test_freeze_refused',
    ]) {
      t.sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
    }
  }

  function activityOf(taskId: string, type: (typeof activity.$inferSelect)['type']) {
    return t.db
      .select()
      .from(activity)
      .where(and(eq(activity.taskId, taskId), eq(activity.type, type)))
      .all();
  }

  it('saves a create, an edit, a claim and a status change, each with its activity row', () => {
    const log = captureLog();
    setEstimateLogger(log.logger);
    breakEstimates();

    // The setup is really broken: a direct estimate write is refused.
    const probe = newTask();
    expect(() => refreshEstimate(t.db, probe.id, T0)).not.toThrow();
    expect(estimateRows(probe.id)).toEqual([]);

    const task = newTask({ acceptance_md: words(40) });
    expect(row(task.id).title).toBe('Work');
    expect(activityOf(task.id, 'task.created')).toHaveLength(1);
    expect(task.size).toBeNull();

    const edited = updateTask(t.db, admin(), task.id, { acceptance_md: words(400), now: T0 + MIN });
    expect(row(task.id).acceptanceMd).toBe(words(400));
    expect(edited.acceptance_md).toBe(words(400));
    expect(activityOf(task.id, 'task.updated')).toHaveLength(1);

    changeStatus(t.db, admin(), task.id, 'in_progress', T0 + 2 * MIN);
    expect(row(task.id).status).toBe('in_progress');
    expect(row(task.id).startedAt).toBe(T0 + 2 * MIN);
    expect(activityOf(task.id, 'task.status_changed')).toHaveLength(1);

    const claimed = newTask({ acceptance_md: words(40) });
    claimTask(t.sqlite, t.db, admin(), claimed.id, T0 + 3 * MIN);
    expect(row(claimed.id).assigneeId).toBe(adminId);
    expect(activityOf(claimed.id, 'task.status_changed')).toHaveLength(1);

    // Logged, not thrown — and the nightly refit catches up once it can.
    const failed = log.find('estimate.failed');
    expect(String(failed?.error)).toContain(BROKEN);
    expect(failed?.level).toBe('error');
    healEstimates();
    refitEstimates(t.db, T0 + HOUR);
    expect(getTask(t.db, admin(), task.id).size).not.toBeNull();
  });

  it('refuses a size it cannot store, and then saves nothing of that edit', () => {
    const task = newTask({ acceptance_md: words(40) });
    breakEstimates();
    expect(() =>
      updateTask(t.db, admin(), task.id, { title: 'Renamed', size: 'XL', now: T0 + MIN }),
    ).toThrow(BROKEN);
    // A person's size is their write, not a derived figure: no half of it lands.
    expect(row(task.id).title).toBe('Work');
    expect(activityOf(task.id, 'task.updated')).toEqual([]);
  });

  it('freezes on the next refit when the freeze at claim was skipped — the estimate in force then', () => {
    const task = newTask({ acceptance_md: words(40) });
    const atCreate = row(task.id).estimateId;
    breakEstimates('freeze');
    claimTask(t.sqlite, t.db, admin(), task.id, T0 + HOUR);
    expect(row(task.id).estimateAtStartId).toBeNull();
    expect(activityOf(task.id, 'task.status_changed')).toHaveLength(1);
    healEstimates();

    // An edit after work started writes a newer estimate; it is not the one
    // work started under, and the retry must not pick it.
    updateTask(t.db, admin(), task.id, { acceptance_md: words(900), now: T0 + 90 * MIN });
    expect(row(task.id).estimateId).not.toBe(atCreate);

    refitEstimates(t.db, T0 + 2 * HOUR);
    expect(row(task.id).estimateAtStartId).toBe(atCreate);
  });

  it('never freezes a task that started before any estimate existed for it', () => {
    const task = newTask({ acceptance_md: words(40) }, T0);
    // Started an hour before its first estimate — as a task in flight when
    // estimates were deployed.
    t.db
      .update(tasks)
      .set({ startedAt: T0 - HOUR, ...atCategory(t.db, row(task.id).projectId, 'in_progress') })
      .where(eq(tasks.id, task.id))
      .run();
    refitEstimates(t.db, T0 + HOUR);
    expect(row(task.id).estimateAtStartId).toBeNull();
  });
});

describe('agent-client accuracy counts the people behind the measured tasks only (D-078 item 6)', () => {
  it('does not report a client used by three people when only two of them are on measured tasks', () => {
    const people = ['Bea', 'Cy', 'Di'].map((name) => {
      const id = makeUser('member', name);
      addMember(t.db, admin(), 'laika', id, 'member');
      return id;
    });
    const [bea, cy, di] = people as [string, string, string];
    // Bea's codex work came first, in a cold project: frozen without a
    // forecast, so it is never measured — though she did use the client.
    let clock = finishClock(finishedTasks(3, () => agent(bea, 'codex'), T0));
    clock = finishClock(finishedTasks(FORECAST_AFTER, admin, clock));
    refitEstimates(t.db, clock);
    clock = finishClock(finishedTasks(2, () => agent(cy, 'codex'), clock));
    clock = finishClock(finishedTasks(2, () => agent(di, 'codex'), clock));

    expect(getEstimateAccuracy(t.db, admin(), 'laika').by_client).toEqual([]);

    // Bea on a measured task makes three.
    finishedTasks(1, () => agent(bea, 'codex'), clock);
    const view = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(view.by_client.map((c) => [c.client_name, c.people])).toEqual([['codex', 3]]);
  });
});

describe('a registered agent counts under its harness, never its name (D-120, LAI-1001)', () => {
  /** The same person through a registered agent's token: named `name`, on `harness`. */
  function registered(userId: string, name: string, harness: string): ResolvedActor {
    const orgId = t.db.select().from(orgs).get()?.id ?? '';
    const agentId = newId();
    t.db
      .insert(agents)
      .values({
        id: agentId,
        orgId,
        ownerUserId: userId,
        displayName: name,
        harness,
        deviceLabel: `${name}'s laptop`,
        createdAt: Date.now(),
      })
      .run();
    const id = newId();
    t.db
      .insert(tokens)
      .values({
        id,
        userId,
        agentId,
        // An agent's token carries its name (D-114), and a generic client
        // leaves `last_client_name` blank: the round copies the token's name.
        name,
        prefix: 'lai_test',
        tokenHash: `${id}-hash`,
        scope: 'full',
        projectIdsJson: null,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        lastClientName: null,
        createdAt: Date.now(),
      })
      .run();
    return { ...actor(userId), token: { id, scope: 'full', projectIds: null } };
  }

  it('three people’s agents on one harness are one client, and no registered name is served', () => {
    const people = ['Bea', 'Cy', 'Di'].map((name) => {
      const id = makeUser('member', name);
      addMember(t.db, admin(), 'laika', id, 'member');
      return id;
    });
    const [bea, cy, di] = people as [string, string, string];
    let clock = finishClock(finishedTasks(FORECAST_AFTER, admin, T0));
    refitEstimates(t.db, clock);
    clock = finishClock(
      finishedTasks(1, () => registered(bea, 'Bea secret rig', 'claude-code'), clock),
    );
    clock = finishClock(
      finishedTasks(1, () => registered(cy, 'Cy secret rig', 'claude-code'), clock),
    );
    finishedTasks(1, () => registered(di, 'Di secret rig', 'claude-code'), clock);

    // The rounds did store the registered names: the grouping is what hides them.
    const stored = t.db.select({ client: taskRounds.clientName }).from(taskRounds).all();
    expect(stored.map((r) => r.client)).toContain('Bea secret rig');

    const view = getEstimateAccuracy(t.db, admin(), 'laika');
    expect(view.by_client.map((c) => [c.client_name, c.people])).toEqual([['claude-code', 3]]);
    expect(JSON.stringify(view)).not.toMatch(/secret rig/);
  });
});

/** Just after the last of these tasks finished, so the next batch starts later. */
function finishClock(ids: readonly string[]): number {
  return Math.max(...ids.map((id) => row(id).completedAt ?? 0)) + HOUR;
}
