import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { agentTimeDays, orgs, users } from '../../src/db/schema.ts';
import { agentDay } from '../../src/services/agent-time.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import { recordTelemetry, sessionKey } from '../../src/services/token-telemetry.ts';
import { recordTokenUsage } from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The builders the owner dispatched through Omnigent (LAI-315, the owner's
 * decision of 2026-10-22): their agent minutes, which the collector reads from
 * their transcripts and sends as a day's `dispatched`, draw on My day's AGENTS
 * lane — tied to the builder's card where its marks or branch tie it — and are
 * in no agent minutes, no card's split and no hours.
 */

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = '2026-10-20';
const AT = (h: number, m = 0) => Date.UTC(2026, 9, 20, h, m);
const BUCKET = (ms: number) => Math.floor(ms / 300_000);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const BUILDER = '3f9c1d2e-8a7b-4c6d-9e0f-1a2b3c4d5e6f';

let t: TestDb;
let owner: ResolvedActor;

type Dispatched = { key: string; task?: string; from: number; seconds: number[] };

function report(dispatched: Dispatched[]) {
  recordTokenUsage(
    t.db,
    owner,
    {
      v: 1,
      collector_id: COLLECTOR,
      tz: 'UTC',
      usage: true,
      days: [
        {
          day: DAY,
          rows: [
            {
              agent: 'claude-code',
              model: 'claude-opus-5-5',
              task: 'LAI-1',
              input: 10,
              output: 10,
              cache_write: 0,
              cache_read: 0,
              automated: true,
            },
          ],
          dispatched,
        },
      ],
    },
    NOW,
  );
}

const lane = () => agentDay(t.db, owner.userId, DAY, 'UTC').lane;

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  t.db.update(orgs).set({ developerInsights: 1 }).where(eq(orgs.id, s.orgId)).run();
  t.db.update(users).set({ shareLocalActivity: 1 }).where(eq(users.id, s.userId)).run();
  owner =
    loadActor(t.db, s.userId) ??
    (() => {
      throw new Error('no owner');
    })();
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'Drafts', now: NOW }); // LAI-1
});

afterEach(() => {
  t.close();
});

describe('a dispatched builder on the AGENTS lane', () => {
  it('draws its buckets, on its card', () => {
    report([
      { key: sessionKey(BUILDER), task: 'LAI-1', from: BUCKET(AT(9, 0)), seconds: [300, 0, 120] },
    ]);
    expect(lane()).toEqual([
      [AT(9, 0), 300, 300],
      [AT(9, 10), 120, 120],
    ]);
  });

  it('draws grey where no card ties it', () => {
    report([{ key: sessionKey(BUILDER), from: BUCKET(AT(9, 0)), seconds: [60] }]);
    expect(lane()).toEqual([[AT(9, 0), 60, 0]]);
  });

  it('is replaced by a resend, never added to', () => {
    const once: Dispatched = { key: sessionKey(BUILDER), from: BUCKET(AT(9, 0)), seconds: [200] };
    report([once]);
    report([once]);
    expect(lane()).toEqual([[AT(9, 0), 200, 0]]);
    report([{ key: sessionKey(BUILDER), from: BUCKET(AT(9, 5)), seconds: [90] }]);
    expect(lane()).toEqual([[AT(9, 5), 90, 0]]);
  });

  it('is in no agent minutes, no card’s split and no hours', () => {
    report([
      { key: sessionKey(BUILDER), task: 'LAI-1', from: BUCKET(AT(9, 0)), seconds: [300, 300] },
    ]);
    const day = getMyDay(t.db, owner, { day: DAY, tz: 'UTC' }, NOW);
    expect(day.agent.lane).toEqual([
      [AT(9, 0), 300, 300],
      [AT(9, 5), 300, 300],
    ]);
    expect(day.agent.minutes).toBe(0);
    expect(day.agent.by_task).toEqual([]);
    expect(day.agent.unattributed_minutes).toBe(0);
    expect(day.drafts).toEqual([]);
    expect(day.entries).toEqual([]);
    expect(day.week.every((d) => d.confirmed_minutes === 0 && d.drafted_minutes === 0)).toBe(true);
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
  });

  it('keeps its telemetry dropped at receipt', () => {
    report([{ key: sessionKey(BUILDER), from: BUCKET(AT(9, 0)), seconds: [60] }]);
    const ns = (ms: number) => `${String(ms)}000000`;
    recordTelemetry(
      t.db,
      owner,
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'claude_code.active_time.total',
                    sum: {
                      aggregationTemporality: 1,
                      dataPoints: [
                        {
                          attributes: [
                            { key: 'session.id', value: { stringValue: BUILDER } },
                            { key: 'type', value: { stringValue: 'cli' } },
                          ],
                          startTimeUnixNano: ns(AT(10, 0)),
                          timeUnixNano: ns(AT(10, 1)),
                          asDouble: 60,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      NOW,
    );
    expect(lane()).toEqual([[AT(9, 0), 60, 0]]);
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
  });
});
