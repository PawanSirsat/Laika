import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { users } from '../../src/db/schema.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import { type DraftBlockInput, recordTimeDrafts } from '../../src/services/time-drafts.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * LAI-787's measured targets on a production-shaped fixture — the design
 * report's §3.7, on the heavy side: **300 people**, each with **30 days of 30
 * drafted blocks** (the retention window, 270,000 drafts) and **a working
 * year of confirmed time** (286 days × 5 entries, 429,000 entries and as many
 * revisions).
 *
 * - storing one person's day of drafts under **50 ms**;
 * - My day under 50 ms, which the gate holds as one indexed query per section
 *   (`my-day.test.ts`).
 *
 * **Opt in** (`LAIKA_PERF=1`), as `token-usage.perf.test.ts` is: seeding takes
 * seconds, and a timing asserted inside the root gate measures the machine's
 * load as much as the code. What the gate holds instead is the work — the
 * statements and the absence of any scan (`time-drafts.test.ts`,
 * `my-day.test.ts`). The numbers go to `LAIKA_PERF_OUT` when it is set.
 */

const PERF = process.env.LAIKA_PERF === '1';
const NOW = Date.UTC(2026, 9, 20, 18);
const PEOPLE = 300;
const DRAFT_DAYS = 30;
const BLOCKS = 30;
const ENTRY_DAYS = 286;
const ENTRIES_A_DAY = 5;
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const TOKEN = { id: 'tok_full', scope: 'full', projectIds: null } as const;

let t: TestDb;
let someone: ResolvedActor;
const results: Record<string, number> = {};

const dayBack = (n: number): string => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

function median(fn: () => unknown, runs = 9): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? Number.NaN;
}

/** One person's day: 30 blocks of 12 minutes from 08:00, every fourth on a task. */
function day(dayStr: string): DraftBlockInput[] {
  const base = Date.parse(`${dayStr}T08:00:00Z`);
  return Array.from({ length: BLOCKS }, (_, i) => ({
    start: base + i * 15 * 60_000,
    end: base + i * 15 * 60_000 + 12 * 60_000,
    minutes: 12,
    task: i % 4 === 0 ? `LAI-${String((i % 20) + 1)}` : null,
    signals: { prompts: 3, replies: 11, sessions: 1, commits: i % 3, marks: 0 },
  }));
}

describe.skipIf(!PERF)('time at 300 people', () => {
  beforeAll(() => {
    t = freshDb();
    const s = seed(t.db, NOW);
    const owner = loadActor(t.db, s.userId);
    if (owner === null) throw new Error('no owner');
    for (let i = 0; i < 20; i += 1) {
      createTask(t.sqlite, t.db, owner, 'laika', { title: `Task ${String(i)}`, now: NOW });
    }
    setOrgTimeMode(t.db, owner, 'drafts', NOW);

    const people: string[] = [];
    for (let p = 0; p < PEOPLE; p += 1) {
      const id = newId();
      t.db
        .insert(users)
        .values({
          id,
          email: `p${String(p)}@example.test`,
          name: `P${String(p)}`,
          orgRole: 'admin',
          createdAt: new Date(NOW),
          updatedAt: new Date(NOW),
        })
        .run();
      people.push(id);
    }

    const draft = t.sqlite.prepare(
      `INSERT INTO time_drafts (id, user_id, source, collector_id, day, tz, started_at, ended_at, minutes, signals, state, created_at, updated_at)
       VALUES (?, ?, 'collector', ?, ?, 'UTC', ?, ?, 12, '{"prompts":3}', 'pending', ?, ?)`,
    );
    const entry = t.sqlite.prepare(
      `INSERT INTO time_entries (id, user_id, day, tz, minutes, source, revision, created_at, updated_at)
       VALUES (?, ?, ?, 'UTC', 60, 'manual', 1, ?, ?)`,
    );
    const revision = t.sqlite.prepare(
      `INSERT INTO time_entry_revisions (id, entry_id, revision, change, changed_by, day, tz, minutes, created_at)
       VALUES (?, ?, 1, 'created', ?, ?, 'UTC', 60, ?)`,
    );
    t.sqlite.transaction(() => {
      for (const userId of people) {
        for (let d = 1; d <= DRAFT_DAYS; d += 1) {
          const dayStr = dayBack(d);
          const base = Date.parse(`${dayStr}T08:00:00Z`);
          for (let b = 0; b < BLOCKS; b += 1) {
            const start = base + b * 15 * 60_000;
            draft.run(newId(), userId, COLLECTOR, dayStr, start, start + 12 * 60_000, NOW, NOW);
          }
        }
        for (let d = 1; d <= ENTRY_DAYS; d += 1) {
          const dayStr = dayBack(d + Math.floor(d / 5) * 2);
          for (let e = 0; e < ENTRIES_A_DAY; e += 1) {
            const id = newId();
            entry.run(id, userId, dayStr, NOW, NOW);
            revision.run(newId(), id, userId, dayStr, NOW);
          }
        }
      }
    })();
    t.sqlite.exec('ANALYZE');

    const picked = loadActor(t.db, people[PEOPLE / 2] ?? '');
    if (picked === null) throw new Error('no such person');
    someone = picked;
    setTimeSettings(t.db, someone, { draft_my_time: true }, NOW);
  }, 600_000);

  afterAll(() => {
    if (process.env.LAIKA_PERF_OUT !== undefined) {
      writeFileSync(process.env.LAIKA_PERF_OUT, `${JSON.stringify(results, null, 2)}\n`);
    }
    t.close();
  });

  it('stores a day of drafts under 50 ms', () => {
    const today = dayBack(0);
    const blocks = day(today);
    results.store_day_ms = median(() =>
      recordTimeDrafts(
        t.db,
        { ...someone, token: TOKEN },
        { v: 1, collector_id: COLLECTOR, tz: 'UTC', days: [{ day: today, blocks }] },
        NOW,
      ),
    );
    results.drafts_held = Number(
      (t.sqlite.prepare('SELECT count(*) AS n FROM time_drafts').get() as { n: number }).n,
    );
    results.entries_held = Number(
      (t.sqlite.prepare('SELECT count(*) AS n FROM time_entries').get() as { n: number }).n,
    );
    expect(results.store_day_ms).toBeLessThan(50);
  });

  it('loads My day under 50 ms', () => {
    results.my_day_ms = median(() => getMyDay(t.db, someone, { tz: 'UTC' }, NOW));
    results.my_day_past_ms = median(() =>
      getMyDay(t.db, someone, { day: dayBack(3), tz: 'UTC' }, NOW),
    );
    expect(results.my_day_ms).toBeLessThan(50);
    expect(results.my_day_past_ms).toBeLessThan(50);
  });
});
