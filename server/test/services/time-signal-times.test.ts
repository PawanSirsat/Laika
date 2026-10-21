import { beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  confirmDraft,
  deleteOwnDrafts,
  dismissDraft,
  draftsOn,
  recordTimeDrafts,
  SIGNAL_BUCKET_MS,
  type DraftBlockInput,
} from '../../src/services/time-drafts.ts';
import {
  getTimeSettings,
  setOrgTimeMode,
  setTimeSettings,
} from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';
import { eq } from 'drizzle-orm';

/**
 * When a block's prompts and commits happened (LAI-834, D-096): counts per
 * five-minute bucket, sent beside the block's counts and served to the person
 * alone as the day's SIGNALS lane — never what was typed or committed.
 */

const MIN = 60_000;
// Tuesday 20 October 2026, 18:00 UTC: the day is the 20th in UTC.
const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const AT = (h: number, m = 0) => Date.UTC(2026, 9, 20, h, m);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const OTHER_MACHINE = '0b7d6f1c-2a4e-4c1e-9a55-3c8f1e2d4b6a';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;
/** The bucket an instant falls in, as the collector numbers it. */
const B = (ms: number) => Math.floor(ms / SIGNAL_BUCKET_MS);

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;

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

function block(
  start: number,
  end: number,
  task: string | null = null,
  extra: Partial<DraftBlockInput> = {},
): DraftBlockInput {
  return {
    start,
    end,
    minutes: Math.round((end - start) / MIN),
    task,
    signals: { prompts: 3, replies: 9, sessions: 1, commits: 2, marks: 0 },
    ...extra,
  };
}

function send(blocks: DraftBlockInput[], collector = COLLECTOR, who = bea) {
  return recordTimeDrafts(
    t.db,
    { ...who, token: TOKEN },
    { v: 1, collector_id: collector, tz: 'UTC', days: [{ day: DAY, blocks }] },
    NOW,
  );
}

function lane(who = bea) {
  return getMyDay(t.db, who, { day: DAY, tz: 'UTC' }, NOW).signal_times;
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
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Time drafts', now: NOW }); // LAI-1
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'My day', now: NOW }); // LAI-2
  const laika = t.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, 'laika'))
    .get() ?? { id: '' };
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId: laika.id, userId: beaId, role: 'member', createdAt: NOW })
    .run();
  bea = load(beaId);
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
  setTimeSettings(t.db, owner, { draft_my_time: true }, NOW);
});

describe('when a block’s signals happened', () => {
  it('is kept by five-minute bucket and served as the day’s lane, at each bucket’s start', () => {
    send([
      block(AT(9), AT(10), 'LAI-1', {
        at: {
          prompts: [
            [B(AT(9, 5)), 2],
            [B(AT(9, 40)), 1],
          ],
          commits: [[B(AT(9, 55)), 2]],
        },
      }),
    ]);
    expect(lane()).toEqual({
      prompts: [
        [AT(9, 5), 2],
        [AT(9, 40), 1],
      ],
      commits: [[AT(9, 55), 2]],
    });
    // The counts are unchanged beside it.
    expect(draftsOn(t.db, bea.userId, DAY)[0]?.signals).toEqual({
      prompts: 3,
      replies: 9,
      sessions: 1,
      commits: 2,
      marks: 0,
    });
  });

  it('is the union of the day’s blocks, whatever became of them; a bucket two blocks share is drawn once', () => {
    send([
      // Two tasks worked in parallel share the stretch's prompts.
      block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 10)), 2]] } }),
      block(AT(9), AT(10), 'LAI-2', { at: { prompts: [[B(AT(9, 10)), 2]] } }),
      block(AT(11), AT(12), null, { at: { commits: [[B(AT(11, 30)), 1]] } }),
      block(AT(14), AT(15), null, { at: { prompts: [[B(AT(14, 0)), 3]] } }),
    ]);
    const [first, , untied, later] = draftsOn(t.db, bea.userId, DAY);
    if (first === undefined || untied === undefined || later === undefined) {
      throw new Error('four blocks were sent');
    }
    confirmDraft(t.db, bea, first.id, NOW);
    dismissDraft(t.db, bea, untied.id, NOW);
    expect(lane()).toEqual({
      prompts: [
        [AT(9, 10), 2],
        [AT(14, 0), 3],
      ],
      commits: [[AT(11, 30), 1]],
    });
  });

  it('adds one machine’s buckets to another’s, never one in place of the other', () => {
    send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 0)), 1]] } })]);
    send(
      [block(AT(16), AT(17), 'LAI-1', { at: { prompts: [[B(AT(16, 20)), 1]] } })],
      OTHER_MACHINE,
    );
    expect(lane().prompts).toEqual([
      [AT(9, 0), 1],
      [AT(16, 20), 1],
    ]);
  });

  it('is nothing for a block sent without times, which keeps its counts', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(lane()).toEqual({ prompts: [], commits: [] });
    expect(draftsOn(t.db, bea.userId, DAY)[0]?.signals.prompts).toBe(3);
  });

  it('is replaced with the collector’s blocks, never piled up', () => {
    send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 0)), 1]] } })]);
    send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 45)), 1]] } })]);
    expect(lane().prompts).toEqual([[AT(9, 45), 1]]);
  });

  it('goes with the drafts: deleting them deletes the lane', () => {
    send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 0)), 1]] } })]);
    deleteOwnDrafts(t.db, bea);
    expect(lane()).toEqual({ prompts: [], commits: [] });
  });

  it('is the person’s own: somebody else’s day shows none of it', () => {
    send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 0)), 1]] } })]);
    expect(lane(owner)).toEqual({ prompts: [], commits: [] });
  });

  it('refuses a time outside its block, out of order, repeated, or more than the block counts', () => {
    const bad: [string, DraftBlockInput['at']][] = [
      ['before the block', { prompts: [[B(AT(8, 55)), 1]] }],
      ['after the block', { prompts: [[B(AT(10, 0)), 1]] }],
      [
        'out of order',
        {
          prompts: [
            [B(AT(9, 30)), 1],
            [B(AT(9, 10)), 1],
          ],
        },
      ],
      [
        'the same bucket twice',
        {
          prompts: [
            [B(AT(9, 10)), 1],
            [B(AT(9, 10)), 1],
          ],
        },
      ],
      ['more prompts than the block counts', { prompts: [[B(AT(9, 10)), 4]] }],
      ['more commits than the block counts', { commits: [[B(AT(9, 10)), 3]] }],
    ];
    for (const [what, at] of bad) {
      expect(
        reason(() => send([block(AT(9), AT(10), 'LAI-1', { at })])),
        what,
      ).toBe('unprocessable:invalid_blocks');
    }
    expect(draftsOn(t.db, bea.userId, DAY)).toEqual([]);
    // The last minute of a block is its own: 9:55 is inside 9:00–10:00.
    expect(
      reason(() => send([block(AT(9), AT(10), 'LAI-1', { at: { prompts: [[B(AT(9, 55)), 3]] } })])),
    ).toBe('no error');
  });
});

describe('the switches', () => {
  it('tell a collector the board takes signal times', () => {
    expect(getTimeSettings(t.db, bea).signal_times).toBe(true);
  });
});
