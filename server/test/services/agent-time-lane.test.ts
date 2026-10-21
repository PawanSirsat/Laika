import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { agentTimeBuckets, orgs, users } from '../../src/db/schema.ts';
import { pruneLocalActivity } from '../../src/jobs/jobs.ts';
import { agentDay } from '../../src/services/agent-time.ts';
import { deleteOwnLocalActivity } from '../../src/services/local-activity.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { createTask } from '../../src/services/tasks.ts';
import { recordTelemetry, sessionKey } from '../../src/services/token-telemetry.ts';
import { recordTokenUsage } from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * When the agent worked (LAI-833): Claude Code's `active_time` of
 * `type=cli`, kept per session and five minutes from the times the receiver's
 * points already carry, and served as My day's AGENTS lane — tied to a card
 * the way agent minutes are, grey where nothing tied it.
 */

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = '2026-10-20';
const AT = (h: number, m = 0) => Date.UTC(2026, 9, 20, h, m);
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const SESSION = '3f9c1d2e-8a7b-4c6d-9e0f-1a2b3c4d5e6f';
const OTHER = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

let t: TestDb;
let owner: ResolvedActor;

const ns = (ms: number): string => `${String(ms)}000000`;

/** `claude_code.active_time.total`, as Claude Code's exporter writes it. */
function activeTime(
  points: { session: string; type: 'user' | 'cli'; seconds: number; end: number; start: number }[],
  temporality: 1 | 2 = 1,
): unknown {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
        scopeMetrics: [
          {
            scope: { name: 'com.anthropic.claude_code' },
            metrics: [
              {
                name: 'claude_code.active_time.total',
                unit: 's',
                sum: {
                  aggregationTemporality: temporality,
                  isMonotonic: true,
                  dataPoints: points.map((p) => ({
                    attributes: [
                      { key: 'session.id', value: { stringValue: p.session } },
                      { key: 'type', value: { stringValue: p.type } },
                    ],
                    startTimeUnixNano: ns(p.start),
                    timeUnixNano: ns(p.end),
                    asDouble: p.seconds,
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function send(
  points: { session: string; type: 'user' | 'cli'; seconds: number; end: number; start: number }[],
  temporality: 1 | 2 = 1,
) {
  recordTelemetry(t.db, owner, activeTime(points, temporality), NOW);
}

function split(sessionTasks: { key: string; task: string; tokens: number }[], excluded?: string[]) {
  recordTokenUsage(
    t.db,
    owner,
    {
      v: 1,
      collector_id: COLLECTOR,
      tz: 'UTC',
      usage: true,
      ...(excluded === undefined ? {} : { excluded }),
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
            },
          ],
          session_tasks: sessionTasks,
        },
      ],
    },
    NOW,
  );
}

const lane = (tz = 'UTC', day = DAY) => agentDay(t.db, owner.userId, day, tz).lane;

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

describe('when the agent worked', () => {
  it('is kept by the five minutes its interval fell in — the agent working, never the keyboard', () => {
    send([
      { session: SESSION, type: 'cli', seconds: 60, start: AT(11, 50), end: AT(11, 51) },
      { session: SESSION, type: 'user', seconds: 60, start: AT(11, 50), end: AT(11, 51) },
    ]);
    expect(lane()).toEqual([[AT(11, 50), 60, 0]]);
  });

  it('spreads an interval over the buckets it covers, in proportion', () => {
    send([{ session: SESSION, type: 'cli', seconds: 120, start: AT(11, 54), end: AT(11, 56) }]);
    expect(lane()).toEqual([
      [AT(11, 50), 60, 0],
      [AT(11, 55), 60, 0],
    ]);
  });

  it('puts more seconds than an interval spans back from its end, five minutes to a bucket at most', () => {
    // 15 minutes of work reported over one minute: the 15 minutes before 12:00.
    send([{ session: SESSION, type: 'cli', seconds: 900, start: AT(11, 59), end: AT(12, 0) }]);
    expect(lane()).toEqual([
      [AT(11, 45), 300, 0],
      [AT(11, 50), 300, 0],
      [AT(11, 55), 300, 0],
    ]);
  });

  it('adds a cumulative series’ growth where it grew, and a repeat adds nothing', () => {
    const start = AT(11, 40);
    send([{ session: SESSION, type: 'cli', seconds: 60, start, end: AT(11, 41) }], 2);
    send([{ session: SESSION, type: 'cli', seconds: 120, start, end: AT(11, 46) }], 2);
    send([{ session: SESSION, type: 'cli', seconds: 120, start, end: AT(11, 46) }], 2);
    // 60 s in its first minute, then 60 s grown between 11:41 and 11:46.
    expect(lane()).toEqual([
      [AT(11, 40), 60 + 48, 0],
      [AT(11, 45), 12, 0],
    ]);
  });

  it('never holds more than five minutes in a bucket, whatever two series say', () => {
    send([{ session: SESSION, type: 'cli', seconds: 300, start: AT(11, 50), end: AT(11, 55) }]);
    // A second process of the same session, its own series, over the same minutes.
    send([{ session: SESSION, type: 'cli', seconds: 300, start: AT(11, 50), end: AT(11, 55) }], 2);
    expect(lane()).toEqual([[AT(11, 50), 300, 0]]);
  });

  it('is tied to a card when its session’s split ties it, and grey otherwise', () => {
    send([
      { session: SESSION, type: 'cli', seconds: 120, start: AT(9, 0), end: AT(9, 2) },
      { session: OTHER, type: 'cli', seconds: 60, start: AT(9, 1), end: AT(9, 2) },
    ]);
    split([{ key: sessionKey(SESSION), task: 'LAI-1', tokens: 40 }]);
    expect(lane()).toEqual([[AT(9, 0), 180, 120]]);
  });

  it('is the day of the person’s zone, midnight to midnight', () => {
    // 23:58 UTC on the 19th is 05:28 on the 20th in Kolkata.
    const late = Date.UTC(2026, 9, 19, 23, 58);
    send([{ session: SESSION, type: 'cli', seconds: 60, start: late - MIN, end: late }]);
    expect(lane('UTC', DAY)).toEqual([]);
    expect(lane('Asia/Kolkata', DAY)).toEqual([[Date.UTC(2026, 9, 19, 23, 55), 60, 0]]);
  });

  it('goes with a session the collector left out, and with the local-activity history', () => {
    send([
      { session: SESSION, type: 'cli', seconds: 60, start: AT(9, 0), end: AT(9, 1) },
      { session: OTHER, type: 'cli', seconds: 60, start: AT(9, 0), end: AT(9, 1) },
    ]);
    split([], [sessionKey(OTHER)]);
    expect(t.db.select({ key: agentTimeBuckets.sessionKey }).from(agentTimeBuckets).all()).toEqual([
      { key: sessionKey(SESSION) },
    ]);
    deleteOwnLocalActivity(t.db, owner);
    expect(t.db.select().from(agentTimeBuckets).all()).toEqual([]);
  });

  it('is kept 40 days', () => {
    send([{ session: SESSION, type: 'cli', seconds: 60, start: AT(9, 0), end: AT(9, 1) }]);
    pruneLocalActivity(t.db, NOW + 39 * 24 * 60 * MIN);
    expect(t.db.select().from(agentTimeBuckets).all()).toHaveLength(1);
    pruneLocalActivity(t.db, NOW + 41 * 24 * 60 * MIN);
    expect(t.db.select().from(agentTimeBuckets).all()).toEqual([]);
  });

  it('is served in My day’s agent minutes, the person’s own', () => {
    send([{ session: SESSION, type: 'cli', seconds: 60, start: AT(9, 0), end: AT(9, 1) }]);
    expect(getMyDay(t.db, owner, { day: DAY, tz: 'UTC' }, NOW).agent.lane).toEqual([
      [AT(9, 0), 60, 0],
    ]);
  });
});
