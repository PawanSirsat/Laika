import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  agentTimeDays,
  projectMemberships,
  timeDrafts,
  timeEntries,
  tokenSessionTasks,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { agentDay } from '../../src/services/agent-time.ts';
import { createTask } from '../../src/services/tasks.ts';
import { getTaskTime } from '../../src/services/task-time.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The confirmed time on a task (`GET /tasks/:id/time`, LAI-1122): live
 * confirmed entries summed, with how many entries and how many people — never
 * who — for anyone who may read the task. A draft is its person's alone and is
 * never counted; a deleted entry is not either.
 */

const NOW = Date.UTC(2026, 10, 4, 12);
const DAY = '2026-11-04';

let t: TestDb;
let owner: string;
let projectId: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, role: 'lead' | 'member' | 'viewer' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function entry(
  userId: string,
  taskId: string | null,
  minutes: number,
  extra: { deletedAt?: number } = {},
): void {
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      taskId,
      projectId: taskId === null ? null : projectId,
      day: DAY,
      tz: 'UTC',
      minutes,
      source: 'manual',
      deletedAt: extra.deletedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function draft(
  userId: string,
  taskId: string,
  minutes: number,
  state: 'pending' | 'confirmed' | 'dismissed' = 'pending',
): void {
  t.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId,
      source: 'collector',
      day: DAY,
      tz: 'UTC',
      minutes,
      taskId,
      projectId,
      state,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

/** One session's agent (`cli`) seconds on DAY, as telemetry stored them. */
function agentSeconds(
  userId: string,
  session: string,
  seconds: number,
  kind: 'cli' | 'user' = 'cli',
): void {
  t.db
    .insert(agentTimeDays)
    .values({ userId, day: DAY, sessionKey: session, kind, seconds, updatedAt: NOW })
    .run();
}

/** A collector's split: how many of that session's tokens went to this card. */
function tie(userId: string, session: string, taskId: string, tokens: number): void {
  t.db
    .insert(tokenSessionTasks)
    .values({
      userId,
      collectorId: 'c1',
      day: DAY,
      sessionKey: session,
      taskId,
      tokens,
      updatedAt: NOW,
    })
    .run();
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'no error';
}

const newTask = (title: string) =>
  createTask(t.sqlite, t.db, actor(owner), 'laika', { title, now: NOW });

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  projectId = s.projectId;
});

afterEach(() => {
  t.close();
});

describe('getTaskTime', () => {
  it('sums the confirmed entries on the task, by entries and people, and nothing else', () => {
    const bea = makeUser('Bea', 'member');
    member(bea);
    const task = newTask('Time on a task');
    const other = newTask('Another task');
    entry(owner, task.id, 50);
    entry(owner, task.id, 30);
    entry(bea, task.id, 50);
    // None of these is this task's confirmed time.
    entry(bea, task.id, 600, { deletedAt: NOW });
    entry(bea, other.id, 45);
    entry(bea, null, 20);
    draft(bea, task.id, 240);

    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 130,
      people: 2,
      entries: 3,
      agent_minutes: 0,
      // Bea's draft is hers: the owner's own drafts on it are none.
      my_draft_minutes: 0,
    });
    // A member reads the same totals — and her own draft, beside them.
    expect(getTaskTime(t.db, actor(bea), task.id)).toEqual({
      total_minutes: 130,
      people: 2,
      entries: 3,
      agent_minutes: 0,
      my_draft_minutes: 240,
    });
  });

  it('never counts a draft in the confirmed total; the caller sees their own beside it', () => {
    const task = newTask('Only drafted');
    draft(owner, task.id, 90);
    // Settled drafts are not held: confirmed is an entry, dismissed is nothing.
    draft(owner, task.id, 500, 'confirmed');
    draft(owner, task.id, 700, 'dismissed');
    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 0,
      people: 0,
      entries: 0,
      agent_minutes: 0,
      my_draft_minutes: 90,
    });
  });

  it('answers zeros for a task with no time, never a missing figure', () => {
    const task = newTask('Nothing logged');
    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 0,
      people: 0,
      entries: 0,
      agent_minutes: 0,
      my_draft_minutes: 0,
    });
  });

  it('names nobody: the answer carries counts, not people', () => {
    const task = newTask('Whose time');
    entry(owner, task.id, 15);
    const view = getTaskTime(t.db, actor(owner), task.id);
    expect(Object.keys(view).sort()).toEqual([
      'agent_minutes',
      'entries',
      'my_draft_minutes',
      'people',
      'total_minutes',
    ]);
    expect(JSON.stringify(view)).not.toContain(owner);
  });

  it('refuses somebody outside the project, and an unknown task', () => {
    const task = newTask('Private time');
    entry(owner, task.id, 15);
    const outsider = makeUser('Dee', 'member');
    expect(refusal(() => getTaskTime(t.db, actor(outsider), task.id))).toBe('forbidden');
    expect(refusal(() => getTaskTime(t.db, actor(owner), 'no-such-task'))).toBe('not_found');
  });

  it('ties agent minutes to the card by its share of each session-day, as My day does', () => {
    const bea = makeUser('Bea', 'member');
    member(bea);
    const task = newTask('Agent work');
    const other = newTask('Other agent work');
    // s1: 3 of 4 tokens on the card, so 3/4 of its 40 agent minutes.
    agentSeconds(owner, 's1', 40 * 60);
    tie(owner, 's1', task.id, 300);
    tie(owner, 's1', other.id, 100);
    // Keyboard time in the same session is a person's, never agent time.
    agentSeconds(owner, 's1', 99 * 60, 'user');
    // s2: Bea's session, all on the card.
    agentSeconds(bea, 's2', 20 * 60);
    tie(bea, 's2', task.id, 50);
    // s3: no split at all, so unattributed — never guessed onto a card.
    agentSeconds(owner, 's3', 60 * 60);

    const view = getTaskTime(t.db, actor(owner), task.id);
    expect(view.agent_minutes).toBe(30 + 20);
    // Never added to the people's confirmed total.
    expect(view.total_minutes).toBe(0);
    // The same rule as My day's agent lane, so the two agree card by card.
    const fromDays = [owner, bea]
      .flatMap((u) => agentDay(t.db, u, DAY).by_task)
      .filter((b) => b.task.id === task.id)
      .reduce((n, b) => n + b.minutes, 0);
    expect(view.agent_minutes).toBe(fromDays);
  });
});
