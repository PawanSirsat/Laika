import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { timeTimers, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createTask } from '../../src/services/tasks.ts';
import { createEntry, entriesOn } from '../../src/services/time-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import {
  discardTimer,
  elapsedMs,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  timerOf,
} from '../../src/services/time-timer.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The timer (§4.61, D-110 item 1, LAI-500): one per person; pause banks the
 * segment; stop is a `createEntry` with the clock filled in, and every
 * refusal that path makes leaves the timer standing.
 */

// A Tuesday evening in Auckland: 2026-10-20 18:00 UTC is 07:00 on the 21st there.
const NOW = Date.UTC(2026, 9, 20, 18);
const MIN = 60_000;

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;
let taskKey: string;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  const beaId = newId();
  t.db
    .insert(users)
    .values({
      id: beaId,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  bea = load(beaId);
  setOrgTimeMode(t.db, owner, 'manual', NOW);
  taskKey = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Zoom presets', now: NOW }).key;
});

afterEach(() => {
  t.close();
});

describe('a timer', () => {
  it('starts running with what it is for, and only one runs at a time', () => {
    const made = startTimer(
      t.db,
      owner,
      { tz: 'UTC', task: taskKey, kind: 'review', title: '  Keyboard steps  ' },
      NOW,
    );
    expect(made).toEqual({
      started_at: NOW,
      resumed_at: NOW,
      paused_at: null,
      accumulated_ms: 0,
      tz: 'UTC',
      task: { id: expect.any(String), key: taskKey, title: 'Zoom presets' },
      kind: 'review',
      title: 'Keyboard steps',
    });
    expect(timerOf(t.db, owner.userId)).toEqual(made);
    expect(timerOf(t.db, bea.userId)).toBeNull();
    expect(reason(() => startTimer(t.db, owner, { tz: 'UTC' }, NOW + MIN))).toBe(
      'conflict:timer_running',
    );
    // Bea's own is not the owner's.
    expect(startTimer(t.db, bea, { tz: 'UTC' }, NOW).task).toBeNull();
  });

  it('refuses a zone it does not know, a card the person cannot see, and Time off', () => {
    expect(reason(() => startTimer(t.db, owner, { tz: 'Mars/Olympus' }, NOW))).toBe(
      'unprocessable:invalid_tz',
    );
    expect(reason(() => startTimer(t.db, owner, { tz: 'UTC', task: 'LAI-999' }, NOW))).toBe(
      'not_found:',
    );
    setOrgTimeMode(t.db, owner, 'off', NOW);
    expect(reason(() => startTimer(t.db, owner, { tz: 'UTC' }, NOW))).toMatch(/^forbidden:/);
  });

  it('pause banks the segment, resume opens a new one, and the elapsed time is honest', () => {
    startTimer(t.db, owner, { tz: 'UTC' }, NOW);
    const paused = pauseTimer(t.db, owner, NOW + 10 * MIN);
    expect(paused).toMatchObject({ accumulated_ms: 10 * MIN, paused_at: NOW + 10 * MIN });
    expect(reason(() => pauseTimer(t.db, owner, NOW + 11 * MIN))).toBe('conflict:timer_paused');
    // Paused, the clock does not move.
    const row = t.db.select().from(timeTimers).get();
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(elapsedMs(row, NOW + 60 * MIN)).toBe(10 * MIN);

    const resumed = resumeTimer(t.db, owner, NOW + 15 * MIN);
    expect(resumed).toMatchObject({
      resumed_at: NOW + 15 * MIN,
      paused_at: null,
      accumulated_ms: 10 * MIN,
      started_at: NOW,
    });
    expect(reason(() => resumeTimer(t.db, owner, NOW + 16 * MIN))).toBe('conflict:timer_running');
    const again = t.db.select().from(timeTimers).get();
    if (again === undefined) throw new Error('timer vanished');
    expect(elapsedMs(again, NOW + 25 * MIN)).toBe(20 * MIN);
  });

  it('stop writes a confirmed entry spanning first start to stop, with its words, and is gone', () => {
    startTimer(t.db, owner, { tz: 'UTC', task: taskKey, kind: 'review', title: 'Steps' }, NOW);
    pauseTimer(t.db, owner, NOW + 10 * MIN);
    resumeTimer(t.db, owner, NOW + 15 * MIN);
    const undo: string[] = [];
    const stopped = stopTimer(t.db, owner, NOW + 25 * MIN, (id) => undo.push(id));
    expect(stopped.crossed_midnight).toBe(false);
    expect(stopped.entry).toMatchObject({
      day: '2026-10-20',
      minutes: 20,
      started_at: NOW,
      ended_at: NOW + 25 * MIN,
      source: 'manual',
      kind: 'review',
      title: 'Steps',
      description: null,
      revision: 1,
    });
    expect(stopped.entry.task?.key).toBe(taskKey);
    expect(undo).toHaveLength(1);
    expect(timerOf(t.db, owner.userId)).toBeNull();
    expect(entriesOn(t.db, owner.userId, '2026-10-20').map((e) => e.id)).toEqual([
      stopped.entry.id,
    ]);
    expect(reason(() => stopTimer(t.db, owner, NOW + 30 * MIN))).toBe('not_found:no_timer');
  });

  it('a stop while paused ends where the pause began', () => {
    startTimer(t.db, owner, { tz: 'UTC' }, NOW);
    pauseTimer(t.db, owner, NOW + 7 * MIN);
    const stopped = stopTimer(t.db, owner, NOW + 40 * MIN);
    expect(stopped.entry).toMatchObject({ minutes: 7, ended_at: NOW + 7 * MIN });
  });

  it('under a minute saves nothing and keeps the timer; discard removes it', () => {
    startTimer(t.db, owner, { tz: 'UTC' }, NOW);
    expect(reason(() => stopTimer(t.db, owner, NOW + 59_000))).toBe(
      'unprocessable:timer_too_short',
    );
    expect(timerOf(t.db, owner.userId)).not.toBeNull();
    expect(reason(() => discardTimer(t.db, bea))).toBe('not_found:no_timer');
    discardTimer(t.db, owner);
    expect(timerOf(t.db, owner.userId)).toBeNull();
    expect(entriesOn(t.db, owner.userId, '2026-10-20')).toEqual([]);
  });

  it('over confirmed time it is refused as an entry would be, and stays', () => {
    createEntry(
      t.db,
      owner,
      { day: '2026-10-20', tz: 'UTC', minutes: 60, started_at: NOW, ended_at: NOW + 60 * MIN },
      NOW,
    );
    startTimer(t.db, owner, { tz: 'UTC' }, NOW + 30 * MIN);
    expect(reason(() => stopTimer(t.db, owner, NOW + 90 * MIN))).toBe(
      'conflict:overlaps_confirmed',
    );
    expect(timerOf(t.db, owner.userId)).not.toBeNull();
    expect(entriesOn(t.db, owner.userId, '2026-10-20')).toHaveLength(1);
  });

  it('past midnight in its zone it saves as the minutes run on the day it started, with no set time', () => {
    // 23:30 in Auckland on the 21st is 10:30 UTC on the 21st (UTC+13 in October).
    const lateStart = Date.UTC(2026, 9, 21, 10, 30);
    startTimer(t.db, owner, { tz: 'Pacific/Auckland', title: 'Late fix' }, lateStart);
    const stopped = stopTimer(t.db, owner, lateStart + 60 * MIN);
    expect(stopped.crossed_midnight).toBe(true);
    expect(stopped.entry).toMatchObject({
      day: '2026-10-21',
      tz: 'Pacific/Auckland',
      minutes: 60,
      started_at: null,
      ended_at: null,
      title: 'Late fix',
    });
    expect(timerOf(t.db, owner.userId)).toBeNull();
  });
});
