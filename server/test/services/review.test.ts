import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  orgs,
  projectStatuses,
  taskEvidence,
  taskReviews,
  tasks,
  tokens,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { listComments } from '../../src/services/comments.ts';
import { createProjectStatus, deleteProjectStatus } from '../../src/services/project-statuses.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { acceptTask, listReviewQueue, sendBackTask } from '../../src/services/review.ts';
import { listTaskRounds } from '../../src/services/rounds.ts';
import { ALLOWED_TRANSITIONS, canTransition } from '../../src/services/task-lifecycle.ts';
import {
  changeStatus,
  claimTask,
  createTask,
  finishTask,
  getTask,
  updateTask,
} from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The review gate, step 1 (D-081, LAI-758): agents never move a task into
 * done, a finish carries proof as a round, and a person accepts or sends back.
 *
 * Every refusal below asserts the **reason**, not merely that something threw
 * (CLAUDE.md §5): `agent_cannot_mark_done` is the gate, and an `unprocessable`
 * from the lifecycle table would also stop an agent while proving nothing
 * about it.
 */

let t: TestDb;
let adminId: string;

function makeUser(orgRole: OrgRole, name = 'Person'): string {
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

/** The same person through a token that has told the server its client name. */
function agent(userId: string, client: string | null = 'codex'): ResolvedActor {
  const id = newId();
  t.db
    .insert(tokens)
    .values({
      id,
      userId,
      name: 'Codex on laptop',
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

function newTask(extra: Record<string, unknown> = {}) {
  return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Work', ...extra });
}

/** A task an agent has claimed and finished, waiting in review. */
function inReview(by: ResolvedActor = agent(adminId), extra: Record<string, unknown> = {}) {
  const task = newTask();
  claimTask(t.sqlite, t.db, by, task.id);
  return finishTask(t.sqlite, t.db, by, task.id, { summary: 'Did it', ...extra });
}

function status(taskId: string) {
  return t.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin', 'Ada');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

describe('an agent never moves a task into done (D-081, LAIKA-455, audit H6)', () => {
  it('is refused review → done by category, with the reason and the way forward', () => {
    const task = inReview();

    const err = refusal(() => changeStatus(t.db, agent(adminId), task.id, 'done'));
    expect(err.code).toBe('forbidden');
    expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done', status: 'done' });
    expect(err.message).toContain('finish_task');
    expect(status(task.id).status).toBe('review');
  });

  it('is refused a renamed or extra done status, by id and by name', () => {
    createProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', {
      name: 'Shipped',
      category: 'done',
    });
    const shipped = t.db
      .select()
      .from(projectStatuses)
      .all()
      .find((s) => s.name === 'Shipped')!;
    const task = inReview();

    for (const target of [{ status_id: shipped.id }, { status_name: 'shipped' }] as const) {
      const err = refusal(() => changeStatus(t.db, agent(adminId), task.id, target));
      expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done' });
    }
    expect(status(task.id).status).toBe('review');
  });

  it('is refused a move between two done statuses, so done stays a person’s', () => {
    createProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', {
      name: 'Shipped',
      category: 'done',
    });
    const shipped = t.db
      .select()
      .from(projectStatuses)
      .all()
      .find((s) => s.name === 'Shipped')!;
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, 'done');

    const err = refusal(() =>
      changeStatus(t.db, agent(adminId), task.id, { status_id: shipped.id }),
    );
    expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done' });
  });

  it('is refused creating a task straight into done, by status and by status_id', () => {
    const done = t.db
      .select()
      .from(projectStatuses)
      .all()
      .find((s) => s.category === 'done')!;

    for (const input of [{ status: 'done' as const }, { status_id: done.id }]) {
      const err = refusal(() =>
        createTask(t.sqlite, t.db, agent(adminId), 'laika', { title: 'Done already', ...input }),
      );
      expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done' });
    }
    expect(t.db.select().from(tasks).all()).toHaveLength(0);
  });

  it('is refused deleting a status when that would carry work into done', () => {
    createProjectStatus(t.sqlite, t.db, actor(adminId), 'laika', {
      name: 'Shipped',
      category: 'done',
    });
    const all = t.db.select().from(projectStatuses).all();
    const shipped = all.find((s) => s.name === 'Shipped')!;
    const done = all.find((s) => s.name === 'Done')!;
    const task = newTask();
    changeStatus(t.db, actor(adminId), task.id, { status_id: shipped.id });

    const err = refusal(() =>
      deleteProjectStatus(t.sqlite, t.db, agent(adminId), 'laika', shipped.id, done.id),
    );
    expect(err.details).toMatchObject({ reason: 'agent_cannot_mark_done' });
  });

  it('leaves a person’s move into done alone', () => {
    const task = inReview();
    expect(changeStatus(t.db, actor(adminId), task.id, 'done').status).toBe('done');
  });

  it('has no edge into done in the agent table, and the person’s table keeps it', () => {
    expect(ALLOWED_TRANSITIONS.review).not.toContain('done');
    for (const from of Object.keys(ALLOWED_TRANSITIONS) as (keyof typeof ALLOWED_TRANSITIONS)[]) {
      expect(canTransition(from, 'done', 'agent'), from).toBe(false);
    }
    expect(canTransition('review', 'done', 'human')).toBe(true);
  });
});

describe('who may move a task into done (M7)', () => {
  function projectMember(role: 'member' | 'lead' = 'member'): string {
    const id = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', id, role);
    return id;
  }

  it('refuses a plain member who is not the assignee, as review does', () => {
    const assigneeId = projectMember();
    const bystanderId = projectMember();
    const task = newTask();
    updateTask(t.db, actor(adminId), task.id, { assignee_id: assigneeId });
    changeStatus(t.db, actor(assigneeId), task.id, 'in_progress');
    changeStatus(t.db, actor(assigneeId), task.id, 'review');

    const err = refusal(() => changeStatus(t.db, actor(bystanderId), task.id, 'done'));
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe(
      'Only the assignee, a project lead or an admin may move a task to done',
    );
    expect(status(task.id).status).toBe('review');
  });

  it('allows the assignee and a lead', () => {
    const assigneeId = projectMember();
    const leadId = projectMember('lead');
    const a = newTask();
    const b = newTask();
    for (const task of [a, b]) {
      updateTask(t.db, actor(adminId), task.id, { assignee_id: assigneeId });
      changeStatus(t.db, actor(assigneeId), task.id, 'in_progress');
      changeStatus(t.db, actor(assigneeId), task.id, 'review');
    }

    expect(changeStatus(t.db, actor(assigneeId), a.id, 'done').status).toBe('done');
    expect(changeStatus(t.db, actor(leadId), b.id, 'done').status).toBe('done');
  });
});

describe('claim takes a task only from where work starts (M7)', () => {
  it('refuses a done, cancelled or review task', () => {
    const done = newTask();
    changeStatus(t.db, actor(adminId), done.id, 'done');
    const cancelled = newTask();
    changeStatus(t.db, actor(adminId), cancelled.id, 'cancelled');
    const review = newTask();
    changeStatus(t.db, actor(adminId), review.id, 'review');

    for (const [task, from] of [
      [done, 'done'],
      [cancelled, 'cancelled'],
      [review, 'review'],
    ] as const) {
      const err = refusal(() => claimTask(t.sqlite, t.db, agent(adminId), task.id));
      expect(err.code, from).toBe('unprocessable');
      expect(err.details).toMatchObject({ from, to: 'in_progress' });
      expect(status(task.id).assigneeId, 'nothing moved').toBeNull();
      expect(status(task.id).status, 'nothing moved').toBe(from);
    }
  });

  it('takes a todo task, records the real status it came from, and keeps the first start', () => {
    const task = newTask({ status: 'todo' });
    const first = claimTask(t.sqlite, t.db, agent(adminId), task.id, 1_000);
    updateTask(t.db, actor(adminId), task.id, { assignee_id: null });
    changeStatus(t.db, actor(adminId), task.id, 'todo');
    const again = claimTask(t.sqlite, t.db, agent(adminId), task.id, 9_000);

    expect(first.started_at).toBe(1_000);
    expect(again.started_at).toBe(1_000);
    const claims = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'task.status_changed' && r.payloadJson.includes('"via":"claim"'))
      .map((r) => JSON.parse(r.payloadJson) as { from: string });
    expect(claims.map((c) => c.from)).toEqual(['todo', 'todo']);
  });

  it('takes over a released in-progress task without moving its column', () => {
    const task = newTask();
    claimTask(t.sqlite, t.db, actor(adminId), task.id);
    updateTask(t.db, actor(adminId), task.id, { assignee_id: null });

    const taken = claimTask(t.sqlite, t.db, agent(adminId), task.id);
    expect(taken).toMatchObject({ status: 'in_progress', assignee_id: adminId });
  });

  it('still tells a second claimant who holds it, before the status rule', () => {
    const task = newTask();
    claimTask(t.sqlite, t.db, actor(adminId), task.id);

    const err = refusal(() => claimTask(t.sqlite, t.db, agent(makeUser('admin')), task.id));
    expect(err.code).toBe('conflict');
    expect(err.details).toMatchObject({ assignee_id: adminId });
  });
});

describe('finish_task stores each finish as a round with its proof (LAIKA-476)', () => {
  const PROOF = {
    commits: [
      { sha: 'ABCDEF1234567', message: 'feat: the thing\n\nA body nobody reads here' },
      { sha: '0123456789abcdef0123456789abcdef01234567' },
    ],
    branch: 'build-review-gate',
    pull_request: 'https://github.com/PawanSirsat/Laika/pull/9',
    tests: [
      { command: 'pnpm test', exit_code: 0 },
      { command: 'pnpm lint', exit_code: 1 },
    ],
  };

  it('keeps every item, in order, each claimed, and names the agent', () => {
    const task = inReview(agent(adminId, 'codex'), PROOF);
    const { rounds, send_back } = listTaskRounds(t.db, actor(adminId), task.id);

    expect(send_back).toBeNull();
    expect(rounds).toHaveLength(1);
    const round = rounds[0]!;
    expect(round).toMatchObject({ number: 1, client_name: 'codex', finished_by: adminId });
    expect(round.summary_md).toBe('Did it');
    expect(round.commits.map((c) => [c.sha, c.message])).toEqual([
      ['abcdef1234567', 'feat: the thing'],
      ['0123456789abcdef0123456789abcdef01234567', null],
    ]);
    expect(round.branch?.name).toBe('build-review-gate');
    expect(round.pull_request?.url).toBe('https://github.com/PawanSirsat/Laika/pull/9');
    expect(round.tests.map((x) => [x.command, x.exit_code])).toEqual([
      ['pnpm test', 0],
      ['pnpm lint', 1],
    ]);
    const states = t.db
      .select()
      .from(taskEvidence)
      .all()
      .map((r) => r.state);
    expect(states).toEqual(['claimed', 'claimed', 'claimed', 'claimed', 'claimed', 'claimed']);
  });

  it('still works with only today’s arguments, and falls back to the token’s name', () => {
    const task = inReview(agent(adminId, null));
    const round = listTaskRounds(t.db, actor(adminId), task.id).rounds[0]!;

    expect(round).toMatchObject({ number: 1, client_name: 'Codex on laptop' });
    expect(round.commits).toEqual([]);
    expect(round.branch).toBeNull();
    expect(round.pull_request).toBeNull();
    expect(round.tests).toEqual([]);
  });

  it.each([
    ['a sha that is not hex', { commits: [{ sha: 'not-a-sha!' }] }, 'commits'],
    ['a pull request that is not http(s)', { pull_request: 'javascript:alert(1)' }, 'pull_request'],
    ['a branch with a newline', { branch: 'main\nrm -rf' }, 'branch'],
    [
      'more commits than the limit',
      { commits: Array.from({ length: 51 }, () => ({ sha: 'abcdef1' })) },
      'commits',
    ],
    ['a fractional exit code', { tests: [{ command: 'x', exit_code: 1.5 }] }, 'tests.exit_code'],
  ])('refuses %s and moves nothing', (_label, proof, field) => {
    const task = newTask();
    const by = agent(adminId);
    claimTask(t.sqlite, t.db, by, task.id);

    const err = refusal(() =>
      finishTask(t.sqlite, t.db, by, task.id, { summary: 'Did it', ...proof }),
    );
    expect(err.code).toBe('unprocessable');
    expect(err.details).toMatchObject({ field });
    expect(status(task.id).status).toBe('in_progress');
    expect(listTaskRounds(t.db, actor(adminId), task.id).rounds).toEqual([]);
  });
});

describe('accept and send back (LAIKA-478)', () => {
  it('accept moves to the first visible done status and records who accepted', () => {
    const task = inReview();
    const accepted = acceptTask(t.sqlite, t.db, actor(adminId), task.id);

    expect(accepted.status).toBe('done');
    expect(accepted.status_name).toBe('Done');
    const [decision] = t.db.select().from(taskReviews).all();
    expect(decision).toMatchObject({ decision: 'accepted', decidedBy: adminId });
    expect(decision?.roundId).not.toBeNull();
    const via = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.payloadJson.includes('"via":"accept"'));
    expect(via).toHaveLength(1);
  });

  it('send back needs a reason, posts it as a marked comment, and the task carries it', () => {
    const task = inReview();

    expect(
      refusal(() => sendBackTask(t.sqlite, t.db, actor(adminId), task.id, '  ')).details,
    ).toMatchObject({ field: 'reason' });

    const back = sendBackTask(t.sqlite, t.db, actor(adminId), task.id, 'The lint run failed');
    expect(back.status).toBe('in_progress');
    expect(back.send_back).toMatchObject({ reason_md: 'The lint run failed', decided_by: adminId });

    const rows = listComments(t.db, actor(adminId), task.id, {
      limit: 50,
      cursor: null,
      updatedSince: null,
    });
    expect(rows.map((r) => r.bodyMd)).toContain('The lint run failed');
    const via = t.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.payloadJson.includes('"via":"send_back"'));
    expect(via).toHaveLength(1);
    expect(listTaskRounds(t.db, actor(adminId), task.id).send_back).toMatchObject({
      reason_md: 'The lint run failed',
      round_number: 1,
    });
  });

  it('the send-back lasts until the next finish, which is round 2, and both rounds are kept', () => {
    const by = agent(adminId);
    const task = inReview(by, { tests: [{ command: 'pnpm lint', exit_code: 1 }] });
    sendBackTask(t.sqlite, t.db, actor(adminId), task.id, 'Lint is red');

    expect(getTask(t.db, actor(adminId), task.id).send_back?.reason_md).toBe('Lint is red');

    const again = finishTask(t.sqlite, t.db, by, task.id, {
      summary: 'Fixed lint',
      tests: [{ command: 'pnpm lint', exit_code: 0 }],
    });
    expect(again.send_back).toBeNull();
    const { rounds, send_back } = listTaskRounds(t.db, actor(adminId), task.id);
    expect(send_back).toBeNull();
    expect(rounds.map((r) => [r.number, r.tests[0]?.exit_code])).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });

  it('both are a web session’s: a token is refused session_required and nothing moves', () => {
    const task = inReview();

    for (const decide of [
      () => acceptTask(t.sqlite, t.db, agent(adminId), task.id),
      () => sendBackTask(t.sqlite, t.db, agent(adminId), task.id, 'No'),
    ]) {
      const err = refusal(decide);
      expect(err.code).toBe('forbidden');
      expect(err.details).toMatchObject({ reason: 'session_required' });
    }
    expect(status(task.id).status).toBe('review');
    expect(t.db.select().from(taskReviews).all()).toHaveLength(0);
  });

  it('both refuse a task that is not waiting for review', () => {
    const task = newTask();
    const err = refusal(() => acceptTask(t.sqlite, t.db, actor(adminId), task.id));
    expect(err.code).toBe('conflict');
    expect(err.details).toMatchObject({ reason: 'not_in_review' });
  });

  it('both need the done permission: a plain member who is not the assignee is refused', () => {
    const memberId = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');
    const task = inReview();

    for (const decide of [
      () => acceptTask(t.sqlite, t.db, actor(memberId), task.id),
      () => sendBackTask(t.sqlite, t.db, actor(memberId), task.id, 'No'),
    ]) {
      expect(refusal(decide).code).toBe('forbidden');
    }
    expect(status(task.id).status).toBe('review');
  });
});

describe('the review queue', () => {
  it('lists review tasks oldest waiting first, with the round, names and who may decide', () => {
    const memberId = makeUser('member', 'Bea');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');

    const a = newTask();
    claimTask(t.sqlite, t.db, agent(adminId, 'codex'), a.id, 1_000);
    finishTask(t.sqlite, t.db, agent(adminId, 'codex'), a.id, {
      summary: 'A',
      tests: [{ command: 'pnpm test', exit_code: 0 }],
      now: 5_000,
    });
    const b = newTask();
    changeStatus(t.db, actor(adminId), b.id, 'review', 2_000);
    newTask(); // in backlog: not listed

    const queue = listReviewQueue(t.db, actor(adminId));
    expect(queue.truncated).toBe(false);
    expect(queue.tasks.map((i) => i.task.key)).toEqual(['LAI-2', 'LAI-1']);
    expect(queue.tasks.map((i) => i.waiting_since)).toEqual([2_000, 5_000]);
    const first = queue.tasks[1]!;
    expect(first).toMatchObject({
      assignee_name: 'Ada',
      finished_by_name: 'Ada',
      can_decide: true,
      project: { slug: 'laika', prefix: 'LAI' },
    });
    expect(first.round).toMatchObject({ number: 1, client_name: 'codex' });
    expect(queue.tasks[0]!.round).toBeNull();

    // A plain member sees the queue of a project they work in and may decide
    // neither task: neither is theirs, and they are not a lead.
    const theirs = listReviewQueue(t.db, actor(memberId));
    expect(theirs.tasks.map((i) => i.can_decide)).toEqual([false, false]);
  });

  it('shows nothing from a project the person is not on', () => {
    const outsiderId = makeUser('member');
    inReview();

    expect(listReviewQueue(t.db, actor(outsiderId)).tasks).toEqual([]);
  });
});
