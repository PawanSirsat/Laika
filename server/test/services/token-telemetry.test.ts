import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import {
  localActivityDays,
  orgs,
  tokenSessionDays,
  tokenSessionSkips,
  tokenTelemetrySeries,
  tokenUsageDays,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  readOtlpMetrics,
  recordTelemetry,
  sessionKey,
  TELEMETRY_COLLECTOR,
} from '../../src/services/token-telemetry.ts';
import { recordTokenUsage, type TokenUsageReport } from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';
import { work } from '../helpers/work.ts';

/**
 * The OpenTelemetry fallback (LAI-773, D-087): Claude Code's own metrics,
 * metrics only, matched to the collector's session files **by one-way session
 * key**, so telemetry fills what the files miss — side calls — and never
 * counts a token twice.
 */

const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = '2026-10-17';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const SESSION = '3f9c1d2e-8a7b-4c6d-9e0f-1a2b3c4d5e6f';
const OTHER_SESSION = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

let t: TestDb;
let orgId: string;
let owner: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function sharing(on: boolean): void {
  t.db
    .update(orgs)
    .set({ developerInsights: on ? 1 : 0 })
    .where(eq(orgs.id, orgId))
    .run();
  t.db
    .update(users)
    .set({ shareLocalActivity: on ? 1 : 0 })
    .where(eq(users.id, owner))
    .run();
}

type Kind = 'input' | 'output' | 'cacheRead' | 'cacheCreation';

interface Point {
  kind: Kind | 'cost';
  value: number;
  session?: string | undefined;
  model?: string;
  start?: number;
  end?: number;
}

const ns = (ms: number): string => `${String(ms)}000000`;

/** An OTLP/HTTP JSON body as Claude Code's exporter writes one. */
function body(points: Point[], temporality: 1 | 2 = 2, onResource?: string): unknown {
  const tokens = points.filter((p) => p.kind !== 'cost');
  const cost = points.filter((p) => p.kind === 'cost');
  const dataPoint = (p: Point) => ({
    attributes: [
      ...(p.session === undefined
        ? []
        : [{ key: 'session.id', value: { stringValue: p.session } }]),
      { key: 'model', value: { stringValue: p.model ?? 'claude-opus-5-5' } },
      { key: 'user.email', value: { stringValue: 'ada@example.test' } },
      ...(p.kind === 'cost' ? [] : [{ key: 'type', value: { stringValue: p.kind } }]),
    ],
    // A minute before its time: a series Laika sees from (nearly) its start.
    startTimeUnixNano: ns(p.start ?? (p.end ?? NOW) - 60_000),
    timeUnixNano: ns(p.end ?? NOW),
    ...(p.kind === 'cost' ? { asDouble: p.value } : { asInt: String(p.value) }),
  });
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'claude-code' } },
            ...(onResource === undefined
              ? []
              : [{ key: 'session.id', value: { stringValue: onResource } }]),
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'com.anthropic.claude_code' },
            metrics: [
              {
                name: 'claude_code.token.usage',
                unit: 'tokens',
                sum: {
                  aggregationTemporality: temporality,
                  isMonotonic: true,
                  dataPoints: tokens.map(dataPoint),
                },
              },
              {
                name: 'claude_code.cost.usage',
                unit: 'USD',
                sum: {
                  aggregationTemporality: temporality,
                  isMonotonic: true,
                  dataPoints: cost.map(dataPoint),
                },
              },
              {
                name: 'claude_code.lines_of_code.count',
                unit: 'count',
                sum: {
                  aggregationTemporality: temporality,
                  dataPoints: [{ attributes: [], asInt: '12', timeUnixNano: ns(NOW) }],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** One session's four counts, as cumulative points. */
function session(
  id: string,
  counts: { input: number; output: number; cacheWrite: number; cacheRead: number },
  model = 'claude-opus-5-5',
): Point[] {
  return [
    { kind: 'input', value: counts.input, session: id, model },
    { kind: 'output', value: counts.output, session: id, model },
    { kind: 'cacheCreation', value: counts.cacheWrite, session: id, model },
    { kind: 'cacheRead', value: counts.cacheRead, session: id, model },
  ];
}

/** What the person's rows for `day` add up to: the files' and telemetry's. */
function totals(day = TODAY) {
  const rows = t.db
    .select()
    .from(tokenUsageDays)
    .where(and(eq(tokenUsageDays.userId, owner), eq(tokenUsageDays.day, day)))
    .all();
  const sum = (pick: (r: (typeof rows)[number]) => number, of = rows) =>
    of.reduce((s, r) => s + pick(r), 0);
  const gap = rows.filter((r) => r.collectorId === TELEMETRY_COLLECTOR);
  return {
    input: sum((r) => r.input),
    output: sum((r) => r.output),
    cacheWrite: sum((r) => r.cacheWrite),
    cacheRead: sum((r) => r.cacheRead),
    gapOutput: sum((r) => r.output, gap),
    gapRows: gap.length,
  };
}

/** A collector's report for today: rows, and the same split by session. */
function filesReport(
  sessions: { id: string; input: number; output: number; cacheWrite: number; cacheRead: number }[],
  options: { listSessions?: boolean; excluded?: string[] } = {},
): TokenUsageReport {
  const sum = (pick: (s: (typeof sessions)[number]) => number) =>
    sessions.reduce((n, s) => n + pick(s), 0);
  return {
    v: 1,
    collector_id: COLLECTOR,
    tz: 'UTC',
    usage: true,
    ...(options.excluded === undefined
      ? {}
      : { excluded: options.excluded.map((id) => sessionKey(id)) }),
    days: [
      {
        day: TODAY,
        rows: [
          {
            agent: 'claude-code',
            model: 'claude-opus-5-5',
            task: null,
            input: sum((s) => s.input),
            output: sum((s) => s.output),
            cache_write: sum((s) => s.cacheWrite),
            cache_read: sum((s) => s.cacheRead),
          },
        ],
        ...(options.listSessions === false
          ? {}
          : {
              sessions: sessions.map((s) => ({
                key: sessionKey(s.id),
                model: 'claude-opus-5-5',
                input: s.input,
                output: s.output,
                cache_write: s.cacheWrite,
                cache_read: s.cacheRead,
              })),
            }),
      },
    ],
  };
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  orgId = s.orgId;
  owner = s.userId;
  sharing(true);
});

afterEach(() => {
  t.close();
});

describe('reading an OTLP/HTTP JSON body', () => {
  it('keeps the token and cost points and nothing else, never the session id itself', () => {
    const read = readOtlpMetrics(
      body([
        ...session(SESSION, { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }),
        {
          kind: 'cost',
          value: 0.25,
          session: SESSION,
        },
      ]),
    );
    expect(read.rejected).toBe(0);
    expect(read.points.map((p) => p.kind).sort()).toEqual([
      'cache_read',
      'cache_write',
      'cost',
      'input',
      'output',
    ]);
    for (const p of read.points) {
      expect(p.sessionKey).toBe(sessionKey(SESSION));
      expect(p.sessionKey).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(p)).not.toContain(SESSION);
      expect(JSON.stringify(p)).not.toContain('example.test');
    }
  });

  it('finds the session on the resource when the point has none', () => {
    const read = readOtlpMetrics(body([{ kind: 'output', value: 7 }], 2, SESSION));
    expect(read.points).toHaveLength(1);
    expect(read.points[0]?.sessionKey).toBe(sessionKey(SESSION));
  });

  it('refuses a token point with no session id — it could not be matched, so it could count twice', () => {
    const read = readOtlpMetrics(body([{ kind: 'output', value: 7 }]));
    expect(read.points).toHaveLength(0);
    expect(read.rejected).toBe(1);
    expect(read.message).toMatch(/session\.id/);
  });

  it('removes a context suffix from the model, as the collector does', () => {
    const read = readOtlpMetrics(
      body([{ kind: 'output', value: 7, session: SESSION, model: 'Claude-Opus-5-5[1m]' }]),
    );
    expect(read.points[0]?.model).toBe('claude-opus-5-5');
  });

  it('refuses a body that is not OTLP', () => {
    expect(() => readOtlpMetrics({ resourceLogs: [] })).toThrow(ApiError);
    expect(() => readOtlpMetrics('nope')).toThrow(ApiError);
  });
});

describe('receiving telemetry', () => {
  it('needs both switches on, like every other report', () => {
    sharing(false);
    let code = '';
    try {
      recordTelemetry(
        t.db,
        actor(owner),
        body(session(SESSION, { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 })),
        NOW,
      );
    } catch (err) {
      code =
        err instanceof ApiError
          ? String((err.details as { reason?: string } | null)?.reason)
          : 'other';
    }
    expect(code).toBe('local_activity_off');
    expect(t.db.select().from(tokenSessionDays).all()).toHaveLength(0);
  });

  it('counts a cumulative series once however often it is sent', () => {
    const counts = { input: 10, output: 400, cacheWrite: 50, cacheRead: 9000 };
    for (let i = 0; i < 3; i += 1) {
      recordTelemetry(t.db, actor(owner), body(session(SESSION, counts)), NOW);
    }
    expect(totals()).toMatchObject({ input: 10, output: 400, cacheWrite: 50, cacheRead: 9000 });

    // It grew: only the growth is added.
    recordTelemetry(
      t.db,
      actor(owner),
      // The same series — the same start — a minute on.
      body(
        session(SESSION, { ...counts, output: 700 }).map((p) => ({
          ...p,
          start: NOW - 60_000,
          end: NOW + 60_000,
        })),
      ),
      NOW + 60_000,
    );
    expect(totals().output).toBe(700);
  });

  it('takes a cumulative series first seen long after it began as a baseline, never as new tokens', () => {
    // A session running since an hour before sharing went on: its first
    // point carries everything since its start, consented or not.
    const start = NOW - 3_600_000;
    recordTelemetry(
      t.db,
      actor(owner),
      body([{ kind: 'output', value: 5000, session: SESSION, start, end: NOW }]),
      NOW,
    );
    expect(totals().output).toBe(0);
    // From there, only what it grows by.
    recordTelemetry(
      t.db,
      actor(owner),
      body([{ kind: 'output', value: 5300, session: SESSION, start, end: NOW + 60_000 }]),
      NOW + 60_000,
    );
    expect(totals().output).toBe(300);
  });

  it('counts a delta point once, and a retried one not at all', () => {
    const first: Point = {
      kind: 'output',
      value: 100,
      session: SESSION,
      start: NOW - 60_000,
      end: NOW,
    };
    recordTelemetry(t.db, actor(owner), body([first], 1), NOW);
    recordTelemetry(t.db, actor(owner), body([first], 1), NOW);
    expect(totals().output).toBe(100);
    const next: Point = { ...first, value: 30, start: NOW, end: NOW + 60_000 };
    recordTelemetry(t.db, actor(owner), body([next], 1), NOW + 60_000);
    expect(totals().output).toBe(130);
  });

  it('keeps Claude Code’s own cost figure for the session, but no cost column in the rollup', () => {
    recordTelemetry(
      t.db,
      actor(owner),
      body([
        { kind: 'cost', value: 1.5, session: SESSION },
        { kind: 'output', value: 5, session: SESSION },
      ]),
      NOW,
    );
    const rows = t.db.select().from(tokenSessionDays).all();
    expect(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)).toBeCloseTo(1.5);
    expect(rows.every((r) => r.source === 'telemetry' && r.collectorId === '')).toBe(true);
  });

  it('puts the day in the zone the person’s collector last reported', () => {
    t.db
      .insert(localActivityDays)
      .values({
        userId: owner,
        day: TODAY,
        collectorId: COLLECTOR,
        tz: 'Pacific/Kiritimati',
        updatedAt: NOW,
      })
      .run();
    // 23:30 UTC on the 17th is already the 18th at UTC+14.
    const late = Date.UTC(2026, 9, 17, 23, 30);
    recordTelemetry(
      t.db,
      actor(owner),
      body([{ kind: 'output', value: 9, session: SESSION, end: late }]),
      late,
    );
    expect(totals('2026-10-18').output).toBe(9);
  });
});

describe('telemetry never counts a token the files already counted', () => {
  it('adds only what the session files are missing, session by session', () => {
    recordTokenUsage(
      t.db,
      actor(owner),
      filesReport([{ id: SESSION, input: 10, output: 300, cacheWrite: 40, cacheRead: 8000 }]),
      NOW,
    );
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(SESSION, { input: 10, output: 420, cacheWrite: 40, cacheRead: 9000 })),
      NOW,
    );
    // max(files, telemetry) per field: the side calls the transcript never shows.
    expect(totals()).toMatchObject({ input: 10, output: 420, cacheWrite: 40, cacheRead: 9000 });
    expect(totals().gapOutput).toBe(120);
  });

  it('adds nothing where the files say more than the telemetry did', () => {
    recordTokenUsage(
      t.db,
      actor(owner),
      filesReport([{ id: SESSION, input: 10, output: 300, cacheWrite: 40, cacheRead: 8000 }]),
      NOW,
    );
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(SESSION, { input: 1, output: 100, cacheWrite: 4, cacheRead: 80 })),
      NOW,
    );
    expect(totals()).toMatchObject({
      input: 10,
      output: 300,
      cacheWrite: 40,
      cacheRead: 8000,
      gapRows: 0,
    });
  });

  it('counts a session the files never saw in full — another machine, no collector', () => {
    recordTokenUsage(
      t.db,
      actor(owner),
      filesReport([{ id: SESSION, input: 10, output: 300, cacheWrite: 40, cacheRead: 8000 }]),
      NOW,
    );
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(OTHER_SESSION, { input: 5, output: 50, cacheWrite: 5, cacheRead: 500 })),
      NOW,
    );
    expect(totals()).toMatchObject({ output: 350, cacheRead: 8500 });
  });

  it('stays safe when the collector did not say which session its tokens were in', () => {
    // An older collector, or a day too big to list: 300 output tokens no
    // session holds. Telemetry's 420 for SESSION may include them, so only
    // what exceeds them is added — never 420 on top of 300.
    recordTokenUsage(
      t.db,
      actor(owner),
      filesReport([{ id: SESSION, input: 10, output: 300, cacheWrite: 40, cacheRead: 8000 }], {
        listSessions: false,
      }),
      NOW,
    );
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(SESSION, { input: 10, output: 420, cacheWrite: 40, cacheRead: 9000 })),
      NOW,
    );
    expect(totals()).toMatchObject({ input: 10, output: 420, cacheWrite: 40, cacheRead: 9000 });
  });

  it('follows the files as they catch up, whichever arrives first', () => {
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(SESSION, { input: 10, output: 420, cacheWrite: 40, cacheRead: 9000 })),
      NOW,
    );
    expect(totals().output).toBe(420);
    recordTokenUsage(
      t.db,
      actor(owner),
      filesReport([{ id: SESSION, input: 10, output: 300, cacheWrite: 40, cacheRead: 8000 }]),
      NOW,
    );
    expect(totals()).toMatchObject({ output: 420, gapOutput: 120 });
  });

  it('leaves out a session the collector excluded — automated, or out of scope', () => {
    recordTokenUsage(t.db, actor(owner), filesReport([], { excluded: [OTHER_SESSION] }), NOW);
    expect(t.db.select().from(tokenSessionSkips).all()).toHaveLength(1);
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(OTHER_SESSION, { input: 5, output: 50, cacheWrite: 5, cacheRead: 500 })),
      NOW,
    );
    expect(totals()).toMatchObject({ output: 0, gapRows: 0 });
    expect(
      t.db.select().from(tokenSessionDays).where(eq(tokenSessionDays.source, 'telemetry')).all(),
    ).toHaveLength(0);
  });

  it('drops what telemetry had already added when the exclusion arrives later', () => {
    recordTelemetry(
      t.db,
      actor(owner),
      body(session(OTHER_SESSION, { input: 5, output: 50, cacheWrite: 5, cacheRead: 500 })),
      NOW,
    );
    expect(totals().output).toBe(50);
    recordTokenUsage(t.db, actor(owner), filesReport([], { excluded: [OTHER_SESSION] }), NOW);
    expect(totals()).toMatchObject({ output: 0, gapRows: 0 });
  });

  it('keeps its own series state per person, so another person’s session is never theirs', () => {
    recordTelemetry(
      t.db,
      actor(owner),
      body([{ kind: 'output', value: 3, session: SESSION }]),
      NOW,
    );
    const series = t.db.select().from(tokenTelemetrySeries).all();
    expect(series).toHaveLength(1);
    expect(series[0]?.userId).toBe(owner);
    expect(series[0]?.seriesKey).not.toContain(SESSION);
    // The id never reaches the database in any table.
    const dump = JSON.stringify(t.sqlite.prepare('SELECT * FROM token_session_days').all());
    expect(dump).not.toContain(SESSION);
  });
});

describe('what a report costs with telemetry on (LAI-779: work, not time)', () => {
  /** Telemetry for SESSION on each of the last `days` days. */
  function history(days: number): void {
    for (let i = days; i >= 1; i -= 1) {
      const end = NOW - i * 86_400_000;
      recordTelemetry(
        t.db,
        actor(owner),
        body([
          {
            kind: 'output',
            value: 10 * (days - i + 1),
            session: SESSION,
            start: NOW - 40 * 86_400_000,
            end,
          },
        ]),
        end,
      );
    }
  }

  it('recomputes only the days it carries: the same statements after 3 days of telemetry as after 25', () => {
    history(3);
    const small = work(t.sqlite, () => {
      recordTokenUsage(
        t.db,
        actor(owner),
        filesReport([{ id: SESSION, input: 1, output: 5, cacheWrite: 1, cacheRead: 9 }]),
        NOW,
      );
    });
    t.close();
    t = freshDb();
    const s = seed(t.db, NOW);
    orgId = s.orgId;
    owner = s.userId;
    sharing(true);
    history(25);
    const large = work(t.sqlite, () => {
      recordTokenUsage(
        t.db,
        actor(owner),
        filesReport([{ id: SESSION, input: 1, output: 5, cacheWrite: 1, cacheRead: 9 }]),
        NOW,
      );
    });
    expect(large.statements).toBe(small.statements);
    expect(large.scans.filter((s) => s.includes('token_'))).toEqual([]);
  });

  it('an export recomputes one day, whatever the history', () => {
    history(25);
    const one = work(t.sqlite, () => {
      recordTelemetry(
        t.db,
        actor(owner),
        body([{ kind: 'output', value: 999, session: SESSION, start: NOW - 40 * 86_400_000 }]),
        NOW,
      );
    });
    expect(one.scans.filter((s) => s.includes('token_'))).toEqual([]);
    expect(one.statements).toBeLessThan(25);
  });
});
