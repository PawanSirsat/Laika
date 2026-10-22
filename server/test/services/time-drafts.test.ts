import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  projectMemberships,
  projects,
  timeDrafts,
  timeEntries,
  timeEntryRevisions,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  clip,
  confirmDay,
  confirmDraft,
  deleteOwnDrafts,
  dismissDraft,
  draftsOn,
  proposeTimeDraft,
  recordTimeDrafts,
  splitDraft,
  type DraftBlockInput,
  updateDraft,
} from '../../src/services/time-drafts.ts';
import { createEntry, deleteEntry, updateEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';
import { work } from '../helpers/work.ts';

/**
 * Drafted time (D-088 items 3, 4, 11 and 13, LAI-787): a collector's blocks
 * and an agent's proposals, private to the person until they confirm them.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
// Tuesday 20 October 2026, 18:00 UTC: the day is the 20th in UTC.
const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const AT = (h: number, m = 0) => Date.UTC(2026, 9, 20, h, m);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const OTHER_MACHINE = '0b7d6f1c-2a4e-4c1e-9a55-3c8f1e2d4b6a';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

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
    signals: { prompts: 3, replies: 9, sessions: 1, commits: 1, marks: 0 },
    ...extra,
  };
}

function send(blocks: DraftBlockInput[], collector = COLLECTOR, who = bea, day = DAY) {
  return recordTimeDrafts(
    t.db,
    { ...who, token: TOKEN },
    { v: 1, collector_id: collector, tz: 'UTC', days: [{ day, blocks }] },
    NOW,
  );
}

function pending(userId = bea.userId) {
  return t.db
    .select()
    .from(timeDrafts)
    .where(and(eq(timeDrafts.userId, userId), eq(timeDrafts.state, 'pending')))
    .all()
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
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
  createProject(t.sqlite, t.db, owner, {
    name: 'Hidden',
    slug: 'hidden',
    prefix: 'HID',
    visibility: 'private',
    now: NOW,
  });
  createTask(t.sqlite, t.db, owner, 'hidden', { title: 'Secret', now: NOW }); // HID-1
  // Bea is on Laika only.
  const laikaProject = t.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, 'laika'))
    .get() ?? { id: '' };
  t.db
    .insert(projectMemberships)
    .values({
      id: newId(),
      projectId: laikaProject.id,
      userId: beaId,
      role: 'member',
      createdAt: NOW,
    })
    .run();
  bea = load(beaId);
  setOrgTimeMode(t.db, owner, 'drafts', NOW);
  setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
});

afterEach(() => {
  t.close();
});

describe('a collector’s upload', () => {
  it('is refused while either switch is off, before anything is kept', () => {
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    expect(reason(() => send([block(AT(9), AT(10))]))).toBe('forbidden:time_drafts_off');
    setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
    setOrgTimeMode(t.db, owner, 'manual', NOW);
    expect(reason(() => send([block(AT(9), AT(10))]))).toBe('forbidden:time_drafts_off');
    expect(t.db.select().from(timeDrafts).all()).toEqual([]);
  });

  it('keeps each block with its counts, ties a readable key and keeps an unreadable one as sent', () => {
    expect(
      send([
        block(AT(9), AT(10), 'LAI-1'),
        block(AT(11), AT(11, 30), 'HID-1'),
        block(AT(13), AT(13, 20)),
      ]),
    ).toEqual({ accepted_days: 1, stored_blocks: 3 });
    const rows = pending();
    expect(rows.map((r) => [r.minutes, r.taskId === null, r.taskKey])).toEqual([
      [60, false, null],
      [30, true, 'HID-1'],
      [20, true, null],
    ]);
    expect(JSON.parse(rows[0]?.signals ?? '{}')).toEqual({
      prompts: 3,
      replies: 9,
      sessions: 1,
      commits: 1,
      marks: 0,
    });
  });

  it('replaces its own pending blocks for the day: a retry stores the same, a grown block whole', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(pending()).toHaveLength(1);
    send([block(AT(9), AT(10, 40), 'LAI-1')]);
    expect(pending().map((r) => r.minutes)).toEqual([100]);
  });

  it('is clipped around time already confirmed, and its minutes shrink by the share', () => {
    send([block(AT(9), AT(10))]);
    const [first] = pending();
    confirmDraft(t.db, bea, first?.id ?? '', NOW);
    // The session went on: the collector now sends 09:00–11:00.
    send([block(AT(9), AT(11))]);
    expect(pending().map((r) => [r.startedAt, r.endedAt, r.minutes])).toEqual([
      [AT(10), AT(11), 60],
    ]);
  });

  it('never brings a dismissed block back', () => {
    send([block(AT(9), AT(10))]);
    dismissDraft(t.db, bea, pending()[0]?.id ?? '', NOW);
    send([block(AT(9), AT(10))]);
    expect(pending()).toEqual([]);
  });

  it('never overwrites a block the person edited', () => {
    send([block(AT(9), AT(10))]);
    updateDraft(t.db, bea, pending()[0]?.id ?? '', { task: 'LAI-2' }, NOW);
    send([block(AT(9), AT(10, 30))]);
    expect(pending().map((r) => [r.startedAt, r.endedAt, r.taskId !== null])).toEqual([
      [AT(9), AT(10), true],
      [AT(10), AT(10, 30), false],
    ]);
  });

  it('never overwrites a block the person titled (LAI-865)', () => {
    send([block(AT(9), AT(10))]);
    updateDraft(t.db, bea, pending()[0]?.id ?? '', { note: 'Planning the sprint' }, NOW);
    send([block(AT(9), AT(9, 40))]);
    expect(pending().map((r) => [r.startedAt, r.endedAt, r.note])).toEqual([
      [AT(9), AT(10), 'Planning the sprint'],
    ]);
  });

  it('is a union with another machine, never a sum', () => {
    send([block(AT(9), AT(10))]);
    send([block(AT(9, 30), AT(10, 30))], OTHER_MACHINE);
    expect(pending().map((r) => [r.startedAt, r.endedAt, r.minutes])).toEqual([
      [AT(9), AT(10), 60],
      [AT(10), AT(10, 30), 30],
    ]);
  });

  it('keeps parallel blocks of one upload as sent, each with its share', () => {
    // Two sessions on two tasks over the same hour: 30 minutes each.
    send([
      block(AT(9), AT(10), 'LAI-1', { minutes: 30 }),
      block(AT(9), AT(10), 'LAI-2', { minutes: 30 }),
    ]);
    expect(pending().reduce((n, r) => n + r.minutes, 0)).toBe(60);
  });

  it('refuses blocks that are not a day', () => {
    expect(reason(() => send([block(AT(10), AT(9))]))).toBe('unprocessable:invalid_blocks');
    expect(reason(() => send([block(AT(9), AT(10), null, { minutes: 61 })]))).toBe(
      'unprocessable:invalid_blocks',
    );
    // Starts on the 19th in UTC, sent as the 20th.
    expect(reason(() => send([block(AT(9) - 12 * HOUR, AT(10))]))).toBe(
      'unprocessable:invalid_blocks',
    );
    const many = Array.from({ length: 49 }, (_, i) => block(AT(0, i * 10), AT(0, i * 10 + 5)));
    expect(reason(() => send(many))).toBe('unprocessable:invalid_blocks');
    expect(reason(() => send([block(AT(9), AT(10))], COLLECTOR, bea, '2026-09-01'))).toBe(
      'unprocessable:day_out_of_range',
    );
    expect(pending()).toEqual([]);
  });

  it('writes no activity row', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(t.db.select().from(activity).where(eq(activity.actorId, bea.userId)).all()).toEqual([]);
  });
});

describe('clip', () => {
  it('returns the parts outside every cut', () => {
    expect(clip(0, 100, [])).toEqual([[0, 100]]);
    expect(clip(0, 100, [[20, 30]])).toEqual([
      [0, 20],
      [30, 100],
    ]);
    expect(
      clip(0, 100, [
        [-5, 10],
        [90, 200],
      ]),
    ).toEqual([[10, 90]]);
    expect(clip(0, 100, [[0, 100]])).toEqual([]);
    expect(clip(0, 100, [[100, 120]])).toEqual([[0, 100]]);
  });
});

describe('an agent’s proposal', () => {
  it('lands in the person’s drafts, never as an entry', () => {
    const draft = proposeTimeDraft(
      t.db,
      { ...bea, token: TOKEN },
      { minutes: 25, task: 'LAI-2', note: 'Client call', tz: 'UTC' },
      NOW,
    );
    // The agent is told the id, the minutes and the day — nothing of the
    // person's drafts (a token reads none, its own proposal included).
    expect(Object.keys(draft).sort()).toEqual(['day', 'id', 'minutes']);
    expect([draft.minutes, draft.day]).toEqual([25, DAY]);
    expect(
      draftsOn(t.db, bea.userId, DAY).map((d) => [
        d.id,
        d.source,
        d.minutes,
        d.started_at,
        d.task?.key,
        d.task?.title,
        d.note,
      ]),
    ).toEqual([[draft.id, 'agent', 25, null, 'LAI-2', 'My day', 'Client call']]);
    expect(t.db.select().from(timeEntries).all()).toEqual([]);
  });

  it('is refused when drafting is off, and for a card the person cannot read', () => {
    expect(
      reason(() =>
        proposeTimeDraft(t.db, { ...bea, token: TOKEN }, { minutes: 5, task: 'HID-1' }, NOW),
      ),
    ).toBe('not_found:');
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    expect(
      reason(() => proposeTimeDraft(t.db, { ...bea, token: TOKEN }, { minutes: 5 }, NOW)),
    ).toBe('forbidden:time_drafts_off');
  });

  it('is refused to a read-only token', () => {
    expect(
      reason(() =>
        proposeTimeDraft(
          t.db,
          { ...bea, token: { ...TOKEN, scope: 'read_only' } },
          { minutes: 5 },
          NOW,
        ),
      ),
    ).toBe('forbidden:');
  });
});

describe('the person’s hands', () => {
  beforeEach(() => {
    send([block(AT(9), AT(10)), block(AT(11), AT(12), 'LAI-1')]);
  });

  it('are refused to every token, the person’s own included', () => {
    const id = pending()[0]?.id ?? '';
    const token = { ...bea, token: TOKEN };
    expect(reason(() => getMyDay(t.db, token, { day: DAY, tz: 'UTC' }, NOW))).toBe(
      'forbidden:session_required',
    );
    expect(reason(() => confirmDraft(t.db, token, id, NOW))).toBe('forbidden:session_required');
    expect(reason(() => updateDraft(t.db, token, id, { general: true }, NOW))).toBe(
      'forbidden:session_required',
    );
    expect(reason(() => confirmDay(t.db, token, DAY, NOW))).toBe('forbidden:session_required');
  });

  it('cannot reach somebody else’s draft', () => {
    const id = pending()[0]?.id ?? '';
    expect(reason(() => confirmDraft(t.db, owner, id, NOW))).toBe('not_found:');
    expect(reason(() => dismissDraft(t.db, owner, id, NOW))).toBe('not_found:');
  });

  it('put a block on a card, on a project, or on General', () => {
    const id = pending()[0]?.id ?? '';
    expect(updateDraft(t.db, bea, id, { task: 'LAI-2' }, NOW).task?.key).toBe('LAI-2');
    const onProject = updateDraft(t.db, bea, id, { task: null, project: 'laika' }, NOW);
    expect([onProject.task, onProject.project?.slug, onProject.general]).toEqual([
      null,
      'laika',
      false,
    ]);
    const general = updateDraft(t.db, bea, id, { general: true }, NOW);
    expect([general.task, general.project, general.general]).toEqual([null, null, true]);
    expect(reason(() => updateDraft(t.db, bea, id, { task: 'HID-1' }, NOW))).toBe('not_found:');
  });

  it('give a block a title, trimmed, kept by every other edit and into its entry (LAI-865)', () => {
    const id = pending()[0]?.id ?? '';
    expect(updateDraft(t.db, bea, id, { note: '  Planning  ' }, NOW).note).toBe('Planning');
    expect(updateDraft(t.db, bea, id, { general: true }, NOW).note).toBe('Planning');
    expect(updateDraft(t.db, bea, id, { minutes: 50 }, NOW).note).toBe('Planning');
    expect(confirmDraft(t.db, bea, id, NOW).note).toBe('Planning');
  });

  it('a blank title is none, and null clears one (LAI-865)', () => {
    const id = pending()[0]?.id ?? '';
    expect(updateDraft(t.db, bea, id, { note: ' \t ' }, NOW).note).toBeNull();
    expect(updateDraft(t.db, bea, id, { note: 'Planning' }, NOW).note).toBe('Planning');
    expect(updateDraft(t.db, bea, id, { note: null }, NOW).note).toBeNull();
  });

  it('split a block at a minute inside it, minutes shared, evidence kept', () => {
    const id = pending()[0]?.id ?? '';
    const [a, b] = splitDraft(t.db, bea, id, AT(9, 20), NOW);
    expect([a.started_at, a.ended_at, a.minutes, b.started_at, b.ended_at, b.minutes]).toEqual([
      AT(9),
      AT(9, 20),
      20,
      AT(9, 20),
      AT(10),
      40,
    ]);
    expect(a.signals).toEqual(b.signals);
    expect(reason(() => splitDraft(t.db, bea, a.id, AT(11), NOW))).toBe(
      'unprocessable:outside_block',
    );
  });

  it('confirm one block into an entry with its first revision', () => {
    const id = pending()[1]?.id ?? '';
    const entry = confirmDraft(t.db, bea, id, NOW);
    expect(entry).toMatchObject({ source: 'draft', minutes: 60, revision: 1, day: DAY });
    expect(entry.task?.key).toBe('LAI-1');
    expect(
      t.db
        .select()
        .from(timeEntryRevisions)
        .all()
        .map((r) => r.change),
    ).toEqual(['created']);
    expect(reason(() => confirmDraft(t.db, bea, id, NOW))).toBe('not_found:');
  });

  it('confirm the whole day in one go; an untied block becomes General', () => {
    const entries = confirmDay(t.db, bea, DAY, NOW);
    expect(entries.map((e) => [e.minutes, e.task?.key ?? null, e.project])).toEqual([
      [60, null, null],
      [60, 'LAI-1', expect.objectContaining({ slug: 'laika' })],
    ]);
    expect(pending()).toEqual([]);
  });

  it('confirm nothing when the day would hold more than a day', () => {
    createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 1400, note: 'A very long day' }, NOW);
    expect(reason(() => confirmDay(t.db, bea, DAY, NOW))).toBe('unprocessable:day_full');
    expect(pending()).toHaveLength(2);
  });

  it('delete every unconfirmed draft, keeping what was confirmed', () => {
    const [first, second] = pending();
    confirmDraft(t.db, bea, first?.id ?? '', NOW);
    dismissDraft(t.db, bea, second?.id ?? '', NOW);
    send([block(AT(14), AT(15))]);
    deleteOwnDrafts(t.db, bea);
    expect(
      t.db
        .select({ state: timeDrafts.state })
        .from(timeDrafts)
        .all()
        .map((r) => r.state),
    ).toEqual(['confirmed']);
  });
});

/**
 * Review round 1, B1. The collector sends one block per task per stretch, so
 * the blocks of tasks worked in parallel overlap — the normal case, not the
 * edge. A re-sent day is matched to what the person settled by **identity**,
 * the same task's overlapping stretch, and only **minutes** are taken off:
 * settling one task's block never costs another task's, and nothing confirmed
 * comes back, whatever has happened to its entry since.
 */
describe('a re-sent day after the person settled part of it', () => {
  const shown = () =>
    draftsOn(t.db, bea.userId, DAY).map((d) => [
      d.task?.key ?? d.task_key,
      d.started_at,
      d.ended_at,
      d.minutes,
    ]);
  const idOf = (key: string | null): string =>
    draftsOn(t.db, bea.userId, DAY).find((d) => (d.task?.key ?? null) === key)?.id ?? '';

  it('keeps a parallel task’s block whole when the other task is confirmed', () => {
    const day = [
      block(AT(9), AT(10), 'LAI-1', { minutes: 30 }),
      block(AT(9), AT(10), 'LAI-2', { minutes: 30 }),
    ];
    send(day);
    confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    send(day);
    expect(shown()).toEqual([['LAI-2', AT(9), AT(10), 30]]);
  });

  it('keeps a block whole when an untied block inside it is dismissed', () => {
    const day = [block(AT(9), AT(9, 40), 'LAI-1'), block(AT(9, 10), AT(9, 30))];
    send(day);
    dismissDraft(t.db, bea, idOf(null), NOW);
    send(day);
    expect(shown()).toEqual([['LAI-1', AT(9), AT(9, 40), 40]]);
  });

  it('keeps the inner block when the outer one is confirmed', () => {
    const day = [block(AT(9), AT(9, 40), 'LAI-1'), block(AT(9, 10), AT(9, 30))];
    send(day);
    confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    send(day);
    expect(shown()).toEqual([[null, AT(9, 10), AT(9, 30), 20]]);
  });

  it('does not bring a confirmed block back when its entry is deleted', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    const entry = confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    deleteEntry(t.db, bea, entry.id, NOW);
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(shown()).toEqual([]);
  });

  it('does not bring a confirmed block back when its entry moves to another day', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    const entry = confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    updateEntry(t.db, bea, entry.id, { day: '2026-10-19' }, NOW);
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(shown()).toEqual([]);
  });

  it('drafts only the growth of a stretch whose start was confirmed', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    send([block(AT(9), AT(11), 'LAI-1')]);
    expect(shown()).toEqual([['LAI-1', AT(10), AT(11), 60]]);
  });

  it('does not draft again a confirmed stretch that a later commit tied to a card', () => {
    // Confirmed untied, as General; a commit then gives its last 11 minutes a key.
    send([block(AT(9), AT(9, 40))]);
    confirmDraft(t.db, bea, idOf(null), NOW);
    send([block(AT(9), AT(9, 29)), block(AT(9, 29), AT(9, 40), 'LAI-1')]);
    expect(shown()).toEqual([]);
  });

  it('keeps the minutes the person confirmed, not the ones the collector sent', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    updateDraft(t.db, bea, idOf('LAI-1'), { minutes: 45 }, NOW);
    confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(shown()).toEqual([]);
  });

  it('keeps what was confirmed settled when Draft my time is turned off and on', () => {
    send([block(AT(9), AT(10), 'LAI-1')]);
    confirmDraft(t.db, bea, idOf('LAI-1'), NOW);
    setTimeSettings(t.db, bea, { draft_my_time: false }, NOW);
    setTimeSettings(t.db, bea, { draft_my_time: true }, NOW);
    send([block(AT(9), AT(10), 'LAI-1')]);
    expect(shown()).toEqual([]);
  });
});

/**
 * Review round 1, item 4. A timeless manual entry — a call, a meeting —
 * overlaps nothing it can be compared with, so the day's 1440 minutes are what
 * keep drafts and manual time from being confirmed past a day.
 */
describe('manual time and drafts on one day', () => {
  it('cannot be confirmed past the day’s 1440 minutes, one by one or all at once', () => {
    send([
      block(AT(0), AT(8, 20), 'LAI-1', { minutes: 500 }),
      block(AT(9), AT(17, 20), 'LAI-2', { minutes: 500 }),
    ]);
    createEntry(t.db, bea, { day: DAY, tz: 'UTC', minutes: 600, note: 'Workshop' }, NOW);
    const [first, second] = draftsOn(t.db, bea.userId, DAY);
    expect(reason(() => confirmDay(t.db, bea, DAY, NOW))).toBe('unprocessable:day_full');
    expect(reason(() => confirmDraft(t.db, bea, first?.id ?? '', NOW))).toBe('no error');
    expect(reason(() => confirmDraft(t.db, bea, second?.id ?? '', NOW))).toBe(
      'unprocessable:day_full',
    );
    expect(
      getMyDay(t.db, bea, { day: DAY, tz: 'UTC' }, NOW).entries.reduce((n, e) => n + e.minutes, 0),
    ).toBe(1100);
  });
});

describe('the work an upload does', () => {
  it('reads by index and does not grow with the person’s history', () => {
    for (let back = 1; back <= 10; back += 1) {
      const d = new Date(NOW - back * 86_400_000).toISOString().slice(0, 10);
      const base = Date.parse(`${d}T08:00:00Z`);
      send(
        Array.from({ length: 10 }, (_, i) => block(base + i * HOUR, base + i * HOUR + 30 * MIN)),
        COLLECTOR,
        bea,
        d,
      );
    }
    const blocks = Array.from({ length: 20 }, (_, i) =>
      block(AT(0) + i * HOUR, AT(0) + i * HOUR + 30 * MIN, i % 2 === 0 ? 'LAI-1' : null),
    );
    const measured = work(t.sqlite, () => send(blocks));
    // `orgs` holds exactly one row (§4.2): the switches find it by a scan of one.
    expect(measured.scans.filter((s) => !/^SCAN orgs\b/.test(s))).toEqual([]);
    // The day's own rows and the key's task, never the ten days before it.
    expect(measured.rows).toBeLessThan(20);
  });
});
