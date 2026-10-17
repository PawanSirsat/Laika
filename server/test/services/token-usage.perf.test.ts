import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs } from '../../src/db/schema.ts';
import { createTask } from '../../src/services/tasks.ts';
import {
  getPersonUsage,
  getUsage,
  recordTokenUsage,
  type TokenUsageRowInput,
} from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * LAI-769's measured targets, on the size the criteria name: **300 people ×
 * 400 days** of token rows — six a day each (two agents × two models, one of
 * them on a task), every day, so 720,000 rows: more than the research's
 * estimate of 0.6 M a year, and every day rather than working days.
 *
 * - each Usage query under **50 ms** — the page's (organisation and project,
 *   30 and 90 days), the profile card's;
 * - a full report's upsert under **20 ms**.
 *
 * **Opt in** (`LAIKA_PERF=1`): seeding takes seconds, and a timing asserted
 * inside the root gate, where every suite runs at once, measures the machine's
 * load as much as the query. What the gate holds instead is that each query is
 * one range of one index (`token-usage.test.ts`, *every Usage query is one
 * indexed query*), which no load can change. The numbers are written to
 * `LAIKA_PERF_OUT` when it is set, for the task's report.
 */

const PERF = process.env.LAIKA_PERF === '1';
const NOW = Date.UTC(2026, 9, 17, 12);
const PEOPLE = 300;
const DAYS = 400;
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

let t: TestDb;
let owner: ResolvedActor;
let someone: string;
const results: Record<string, number> = {};

function dayBack(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
}

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

/** The median of `runs` timings of `fn`, in ms, after one warm-up. */
function median(fn: () => unknown, runs = 7): number {
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

describe.skipIf(!PERF)('token usage at 300 people × 400 days', () => {
  beforeAll(() => {
    t = freshDb();
    const s = seed(t.db, NOW);
    owner = load(s.userId);
    t.db.update(orgs).set({ developerInsights: 1 }).where(eq(orgs.id, s.orgId)).run();

    const taskIds: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      taskIds.push(createTask(t.sqlite, t.db, owner, 'laika', { title: `Task ${String(i)}` }).id);
    }

    const people: string[] = [];
    const insertUser = t.sqlite.prepare(
      `INSERT INTO users (id, email, name, org_role, is_active, share_local_activity, created_at, updated_at)
       VALUES (?, ?, ?, 'member', 1, 1, ?, ?)`,
    );
    const insertMember = t.sqlite.prepare(
      `INSERT INTO project_memberships (id, project_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)`,
    );
    const insertRow = t.sqlite.prepare(
      `INSERT INTO token_usage_days
         (user_id, collector_id, day, agent, model, task_id, project_id,
          input, output, cache_write, cache_read, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    t.sqlite.transaction(() => {
      for (let p = 0; p < PEOPLE; p += 1) {
        const id = newId();
        people.push(id);
        insertUser.run(id, `p${String(p)}@example.test`, `Person ${String(p)}`, NOW, NOW);
        insertMember.run(newId(), s.projectId, id, NOW);
        for (let d = 0; d < DAYS; d += 1) {
          const day = dayBack(d);
          const task = taskIds[(p + d) % taskIds.length] ?? null;
          for (const [agent, model] of [
            ['claude-code', 'claude-opus-5-5'],
            ['claude-code', 'claude-sonnet-5'],
            ['codex', 'gpt-5.2-codex'],
          ] as const) {
            insertRow.run(
              id,
              COLLECTOR,
              day,
              agent,
              model,
              null,
              null,
              10,
              900,
              5_000,
              300_000,
              NOW,
            );
          }
          for (const [agent, model] of [
            ['claude-code', 'claude-opus-5-5'],
            ['codex', 'gpt-5.2-codex'],
            ['gemini-cli', 'gemini-2.5-pro'],
          ] as const) {
            insertRow.run(
              id,
              COLLECTOR,
              day,
              agent,
              model,
              task,
              s.projectId,
              5,
              400,
              2_000,
              100_000,
              NOW,
            );
          }
        }
      }
    })();
    t.sqlite.exec('ANALYZE');
    someone = people[7] ?? '';
    const rows = t.sqlite.prepare('SELECT count(*) AS n FROM token_usage_days').get() as {
      n: number;
    };
    results.rows = rows.n;
  }, 300_000);

  afterAll(() => {
    if (process.env.LAIKA_PERF_OUT !== undefined) {
      writeFileSync(process.env.LAIKA_PERF_OUT, `${JSON.stringify(results, null, 2)}\n`);
    }
    t?.close();
  });

  it('holds 300 × 400 days of rows', () => {
    expect(results.rows).toBe(PEOPLE * DAYS * 6);
  });

  for (const days of [30, 90]) {
    it(`reads the organisation's page for ${String(days)} days, each query under 50 ms`, () => {
      const whole = median(() => getUsage(t.db, owner, { days }, NOW));
      results[`org page ${String(days)}d, all queries`] = whole;
      // The page is eight queries; each must be under 50 ms, so the slowest
      // is measured on its own: the per-developer split over the range.
      const people = median(() =>
        t.sqlite
          .prepare(
            `SELECT user_id, sum(input + output + cache_write), sum(cache_read)
               FROM token_usage_days WHERE day >= ? AND day <= ? GROUP BY user_id`,
          )
          .all(dayBack(days - 1), dayBack(0)),
      );
      results[`org by developer ${String(days)}d`] = people;
      const total = median(() =>
        t.sqlite
          .prepare(
            `SELECT sum(input + output + cache_write), sum(cache_read)
               FROM token_usage_days WHERE day >= ? AND day <= ?`,
          )
          .get(dayBack(days - 1), dayBack(0)),
      );
      results[`org total ${String(days)}d`] = total;
      const groups = median(() =>
        t.sqlite
          .prepare(
            `SELECT day, agent, model, sum(input), sum(output), sum(cache_write), sum(cache_read),
                    sum(CASE WHEN task_id IS NOT NULL THEN input + output + cache_write ELSE 0 END)
               FROM token_usage_days WHERE day >= ? AND day <= ? GROUP BY day, agent, model`,
          )
          .all(dayBack(days - 1), dayBack(0)),
      );
      results[`org day × agent × model ${String(days)}d`] = groups;
      const top = median(() =>
        t.sqlite
          .prepare(
            `SELECT task_id, sum(input + output + cache_write) AS n, sum(cache_read)
               FROM token_usage_days WHERE day >= ? AND day <= ? AND task_id IS NOT NULL
              GROUP BY task_id ORDER BY n DESC LIMIT 20`,
          )
          .all(dayBack(days - 1), dayBack(0)),
      );
      results[`org top tasks ${String(days)}d`] = top;
      for (const each of [people, total, groups, top]) expect(each).toBeLessThan(50);
    });

    it(`reads a project's page for ${String(days)} days, each query under 50 ms`, () => {
      const whole = median(() => getUsage(t.db, owner, { days, project: 'laika' }, NOW));
      results[`project page ${String(days)}d, all queries`] = whole;
      const people = median(() =>
        t.sqlite
          .prepare(
            `SELECT user_id, sum(input + output + cache_write), sum(cache_read)
               FROM token_usage_days WHERE project_id = (SELECT id FROM projects WHERE slug = 'laika')
                AND day >= ? AND day <= ? GROUP BY user_id`,
          )
          .all(dayBack(days - 1), dayBack(0)),
      );
      results[`project by developer ${String(days)}d`] = people;
      expect(people).toBeLessThan(50);
    });
  }

  it('reads a person’s card under 50 ms', () => {
    const card = median(() => getPersonUsage(t.db, owner, someone, NOW));
    results['person card (12 weeks), all queries'] = card;
    expect(card).toBeLessThan(50);
  });

  it('upserts a full report under 20 ms', () => {
    const actor = load(someone);
    const rows: TokenUsageRowInput[] = [
      ['claude-code', 'claude-opus-5-5'],
      ['claude-code', 'claude-sonnet-5'],
      ['claude-code', 'claude-fable-5-1'],
      ['codex', 'gpt-5.2-codex'],
      ['gemini-cli', 'gemini-2.5-pro'],
    ].map(([agent, model]) => ({
      agent: agent ?? '',
      model: model ?? '',
      task: null,
      input: 3_718,
      output: 2_094_668,
      cache_write: 5_615_538,
      cache_read: 648_995_995,
    }));
    // Fourteen days of five rows: about what fits the 16 KB body.
    const body = {
      v: 1 as const,
      collector_id: COLLECTOR,
      tz: 'UTC',
      usage: true as const,
      days: Array.from({ length: 14 }, (_, i) => ({ day: dayBack(i), rows })),
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(16 * 1024);
    const upsert = median(() => recordTokenUsage(t.db, actor, body, NOW));
    results['upsert 14 days × 5 rows'] = upsert;
    expect(upsert).toBeLessThan(20);
  });
});
