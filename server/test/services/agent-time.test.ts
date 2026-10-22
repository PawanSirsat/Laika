import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { agentTimeDays, orgs, tokenSessionTasks, users } from '../../src/db/schema.ts';
import { agentDay } from '../../src/services/agent-time.ts';
import { deleteOwnLocalActivity } from '../../src/services/local-activity.ts';
import { createTask } from '../../src/services/tasks.ts';
import { recordTelemetry, sessionKey } from '../../src/services/token-telemetry.ts';
import { recordTokenUsage } from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Agent minutes (D-088 item 8, LAI-787): Claude Code's own `active_time`,
 * `user` (at the keyboard in Claude Code) apart from `cli` (the agent
 * working), received by D-087's OTLP receiver under its switches, tied to
 * cards by the session's own token split — and always minutes, never hours.
 */

const NOW = Date.UTC(2026, 9, 20, 12);
const DAY = '2026-10-20';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const SESSION = '3f9c1d2e-8a7b-4c6d-9e0f-1a2b3c4d5e6f';
const OTHER = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

let t: TestDb;
let owner: ResolvedActor;

const ns = (ms: number): string => `${String(ms)}000000`;

/** `claude_code.active_time.total`, as Claude Code's exporter writes it. */
function activeTime(
  points: {
    session: string;
    type: 'user' | 'cli';
    seconds: number;
    end?: number;
    start?: number;
  }[],
  temporality: 1 | 2 = 2,
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
                      { key: 'user.email', value: { stringValue: 'ada@example.test' } },
                    ],
                    startTimeUnixNano: ns(p.start ?? (p.end ?? NOW) - 60_000),
                    timeUnixNano: ns(p.end ?? NOW),
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

function usage(sessionTasks: { key: string; task: string; tokens: number }[], excluded?: string[]) {
  return recordTokenUsage(
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
  createTask(t.sqlite, t.db, owner, 'laika', { title: 'My day', now: NOW }); // LAI-2
});

afterEach(() => {
  t.close();
});

describe('active time over OTLP', () => {
  it('is kept per session and day, keyboard apart from agent, and a repeat adds nothing', () => {
    const exported = activeTime([
      { session: SESSION, type: 'cli', seconds: 1800 },
      { session: SESSION, type: 'user', seconds: 300 },
    ]);
    recordTelemetry(t.db, owner, exported, NOW);
    recordTelemetry(t.db, owner, exported, NOW);
    const rows = t.db.select().from(agentTimeDays).all();
    expect(rows.map((r) => [r.day, r.sessionKey, r.kind, r.seconds]).sort()).toEqual([
      [DAY, sessionKey(SESSION), 'cli', 1800],
      [DAY, sessionKey(SESSION), 'user', 300],
    ]);
    // Never the session id, never the email.
    expect(JSON.stringify(rows)).not.toContain(SESSION);
    expect(JSON.stringify(rows)).not.toContain('ada@example.test');
  });

  it('adds a cumulative series’ growth, and each interval of a delta series once', () => {
    // Cumulative: one series from one start, 600 s then 900 s — 900 in all.
    const start = NOW - 60_000;
    recordTelemetry(
      t.db,
      owner,
      activeTime([{ session: SESSION, type: 'cli', seconds: 600 }]),
      NOW,
    );
    recordTelemetry(
      t.db,
      owner,
      activeTime([{ session: SESSION, type: 'cli', seconds: 900, start, end: NOW + 60_000 }]),
      NOW,
    );
    expect(agentDay(t.db, owner.userId, DAY).minutes).toBe(15);
    // Delta: two intervals of 300 s, the second sent twice — 600 in all.
    const first = activeTime([{ session: OTHER, type: 'cli', seconds: 300 }], 1);
    const second = activeTime(
      [{ session: OTHER, type: 'cli', seconds: 300, end: NOW + 60_000 }],
      1,
    );
    recordTelemetry(t.db, owner, first, NOW);
    recordTelemetry(t.db, owner, second, NOW);
    recordTelemetry(t.db, owner, second, NOW);
    expect(agentDay(t.db, owner.userId, DAY).minutes).toBe(25);
  });

  it('takes nothing for a session the collector left out, and drops what it had', () => {
    recordTelemetry(t.db, owner, activeTime([{ session: OTHER, type: 'cli', seconds: 600 }]), NOW);
    usage([], [sessionKey(OTHER)]);
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
    recordTelemetry(
      t.db,
      owner,
      activeTime([{ session: OTHER, type: 'cli', seconds: 1200, end: NOW + 60_000 }]),
      NOW,
    );
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
  });

  it('is refused like tokens while the organisation\'s switch is off', () => {
    t.db.update(orgs).set({ developerInsights: 0 }).run();
    expect(() =>
      recordTelemetry(
        t.db,
        owner,
        activeTime([{ session: SESSION, type: 'cli', seconds: 60 }]),
        NOW,
      ),
    ).toThrow(/Developer insights are off/);
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
  });

  it('is kept with the person\'s old switch off: the organisation\'s alone decides (D-102 amended)', () => {
    t.db.update(users).set({ shareLocalActivity: 0 }).where(eq(users.id, owner.userId)).run();
    recordTelemetry(
      t.db,
      owner,
      activeTime([{ session: SESSION, type: 'cli', seconds: 60 }]),
      NOW,
    );
    expect(t.db.select().from(agentTimeDays).all()).not.toEqual([]);
  });
});

describe('agent minutes tied to cards', () => {
  it('follow the session’s own token split, and say what no split placed', () => {
    recordTelemetry(
      t.db,
      owner,
      activeTime([
        { session: SESSION, type: 'cli', seconds: 3600 },
        { session: OTHER, type: 'cli', seconds: 600 },
        { session: SESSION, type: 'user', seconds: 1200 },
      ]),
      NOW,
    );
    usage([
      { key: sessionKey(SESSION), task: 'LAI-1', tokens: 300 },
      { key: sessionKey(SESSION), task: 'LAI-2', tokens: 100 },
    ]);
    const view = agentDay(t.db, owner.userId, DAY);
    expect([view.minutes, view.keyboard_minutes, view.unattributed_minutes]).toEqual([70, 20, 10]);
    expect(view.by_task.map((t) => [t.task.key, t.minutes])).toEqual([
      ['LAI-1', 45],
      ['LAI-2', 15],
    ]);
    // Minutes, never hours: the view has no field that could say an hour.
    expect(Object.keys(view).some((k) => /hour/i.test(k))).toBe(false);
  });

  it('replaces a collector’s split with its next report', () => {
    usage([{ key: sessionKey(SESSION), task: 'LAI-1', tokens: 300 }]);
    usage([{ key: sessionKey(SESSION), task: 'LAI-2', tokens: 50 }]);
    expect(t.db.select({ tokens: tokenSessionTasks.tokens }).from(tokenSessionTasks).all()).toEqual(
      [{ tokens: 50 }],
    );
  });

  it('goes with the person’s local-activity history', () => {
    recordTelemetry(t.db, owner, activeTime([{ session: SESSION, type: 'cli', seconds: 60 }]), NOW);
    usage([{ key: sessionKey(SESSION), task: 'LAI-1', tokens: 1 }]);
    deleteOwnLocalActivity(t.db, owner);
    expect(t.db.select().from(agentTimeDays).all()).toEqual([]);
    expect(t.db.select().from(tokenSessionTasks).all()).toEqual([]);
  });
});
