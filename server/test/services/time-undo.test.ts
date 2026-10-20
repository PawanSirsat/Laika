import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { timeDrafts, timeUndo } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  confirmDraft,
  recordTimeDrafts,
  splitDraft,
  updateDraft,
} from '../../src/services/time-drafts.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { undoChange } from '../../src/services/time-undo.ts';
import { UNDO_WINDOW_MS } from '../../src/services/time-undo-log.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Undo, row by row (LAI-831, CHIEF's addition B). The route test compares what
 * My day serves; this compares **every column** — a block's collector, its
 * origin, its counts — because "exactly the previous state" is about what the
 * next collector upload sees, not only what the page shows.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const at = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m);

let t: TestDb;
let owner: ResolvedActor;

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

const rows = () => t.db.select().from(timeDrafts).orderBy(timeDrafts.id).all();

beforeEach(() => {
  t = freshDb();
  const actor = loadActor(t.db, seed(t.db, NOW).userId);
  if (actor === null) throw new Error('no such user');
  owner = actor;
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time', now: NOW }); // LAI-1
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, owner, { draft_my_time: true }, NOW);
  recordTimeDrafts(
    t.db,
    owner,
    {
      v: 1,
      collector_id: COLLECTOR,
      tz: 'UTC',
      days: [
        {
          day: DAY,
          blocks: [
            {
              start: at(9),
              end: at(10),
              minutes: 60,
              task: 'LAI-1',
              signals: { prompts: 4, commits: 1 },
            },
          ],
        },
      ],
    },
    NOW,
  );
});

afterEach(() => {
  t.close();
  ids = [];
});

/** The id each change answers with, newest last. */
let ids: string[] = [];
const keep = (id: string): void => {
  ids.push(id);
};
const last = (): string => ids.at(-1) ?? '';

const only = () => {
  const [row] = rows();
  if (row === undefined) throw new Error('no draft');
  return row;
};

describe('every column back', () => {
  it('a split block returns whole, under its id, with its collector and origin', () => {
    const before = rows();
    splitDraft(t.db, owner, only().id, at(9, 30), NOW + 1_000, keep);
    expect(rows()).toHaveLength(2);
    undoChange(t.db, owner, last(), NOW + 2_000);
    expect(rows()).toEqual(before);
  });

  it('an edit returns the block to its collector — unheld, its key and span as sent', () => {
    const before = rows();
    expect(before[0]?.collectorId).toBe(COLLECTOR);
    updateDraft(
      t.db,
      owner,
      only().id,
      { general: true, started_at: at(9, 5), ended_at: at(10), minutes: 55 },
      NOW + 1_000,
      keep,
    );
    expect(only().collectorId).toBe('');
    undoChange(t.db, owner, last(), NOW + 2_000);
    expect(rows()).toEqual(before);
  });
});

describe('only while it can be', () => {
  it('a change older than the window is not there to undo', () => {
    confirmDraft(t.db, owner, only().id, NOW + 1_000, keep);
    expect(reason(() => undoChange(t.db, owner, last(), NOW + 1_000 + UNDO_WINDOW_MS + 1))).toBe(
      'not_found:',
    );
  });

  it('a change undone once is not undone twice', () => {
    confirmDraft(t.db, owner, only().id, NOW + 1_000, keep);
    undoChange(t.db, owner, last(), NOW + 2_000);
    expect(reason(() => undoChange(t.db, owner, last(), NOW + 3_000))).toBe('not_found:');
    expect(t.db.select().from(timeUndo).all()).toEqual([]);
  });

  it('takes back the change it names, never a later one; newest first, each by its id', () => {
    const before = rows();
    const id = only().id;
    updateDraft(t.db, owner, id, { general: true }, NOW + 1_000, keep);
    updateDraft(t.db, owner, id, { minutes: 50 }, NOW + 2_000, keep);
    const [general, minutes] = ids;
    // General's Undo, with the minutes change after it: refused, nothing moves.
    expect(reason(() => undoChange(t.db, owner, general ?? '', NOW + 3_000))).toBe(
      'conflict:newer_change',
    );
    expect(only()).toMatchObject({ general: 1, minutes: 50 });
    undoChange(t.db, owner, minutes ?? '', NOW + 3_000);
    expect(only()).toMatchObject({ general: 1, minutes: 60 });
    // The block is again exactly as General left it, so General can go too.
    undoChange(t.db, owner, general ?? '', NOW + 4_000);
    expect(rows()).toEqual(before);
  });

  it('refuses a change something else has moved on since', () => {
    const id = only().id;
    updateDraft(t.db, owner, id, { general: true }, NOW + 1_000, keep);
    // Not through a recorded change: the block is simply not as General left it.
    t.db
      .update(timeDrafts)
      .set({ updatedAt: NOW + 2_000 })
      .where(eq(timeDrafts.id, id))
      .run();
    expect(reason(() => undoChange(t.db, owner, last(), NOW + 3_000))).toBe(
      'conflict:changed_since',
    );
    expect(only()).toMatchObject({ general: 1 });
  });

  it('retention takes what Undo could put back, after the window', () => {
    updateDraft(t.db, owner, only().id, { general: true }, NOW + 1_000);
    expect(t.db.select().from(timeUndo).all()).toHaveLength(1);
    pruneTime(t.db, NOW + 1_000 + UNDO_WINDOW_MS + 1);
    expect(t.db.select().from(timeUndo).where(eq(timeUndo.userId, owner.userId)).all()).toEqual([]);
  });
});
