import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  localActivityDays,
  tokenSessionDays,
  tokenSessionSkips,
  tokenTelemetrySeries,
  tokenUsageDays,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { dayIn, isTimeZone } from './calendar-days.ts';
import { assertMaySendLocalActivity, TELEMETRY_COLLECTOR } from './local-activity.ts';

/**
 * The OpenTelemetry fallback (LAI-773, D-084 item 9, D-087): Claude Code's own
 * token metrics, received as OTLP/HTTP JSON, to fill what the session files
 * miss — the side calls (titles, classifiers, compaction) a transcript never
 * shows, about a fifth to a third of the output on the measured machine
 * (REPORT.md §1c).
 *
 * ## Metrics only, and only two of them
 *
 * `claude_code.token.usage` (attribute `type`: `input`, `output`, `cacheRead`,
 * `cacheCreation`; `model`; `session.id`) and `claude_code.cost.usage` (USD).
 * Everything else in a body — other metrics, `user.email`, `organization.id`,
 * the account ids, the terminal — is read past and **never stored**. Logs and
 * traces, which can carry prompt text, have no route at all (`routes/otlp.ts`
 * refuses them before reading a byte). Laika makes no call out (§13.4).
 *
 * ## Matched by session, so nothing counts twice
 *
 * A session id never leaves the developer's machine from the collector
 * (D-084 item 1): it sends a **one-way key**, the first 16 hex of
 * `sha256("laika-session:" + id)`, with each session's file totals per day
 * (§6.4). The receiver hashes the `session.id` attribute the same way on
 * receipt and keeps only the key. Then, per person, day and model, for each of
 * the four counts:
 *
 *     gap = max(0, Σ_session max(0, telemetry − files) − unplaced)
 *
 * where `unplaced` is the Claude Code file tokens of the day no listed session
 * holds — an older collector, or a day too big to list. Telemetry is a superset
 * of the files for a session it covers, so the inner `max` is exactly the side
 * calls; a session the files never saw (another machine, no collector) counts
 * in full; and **subtracting the unplaced tokens is what makes it safe**: they
 * may belong to a session telemetry also counted, so they are assumed to,
 * which can only ever under-fill the gap, never double a token. With every
 * session listed it is exact.
 *
 * The gap is written to `token_usage_days` as Claude Code's, unattributed,
 * under the collector id {@link TELEMETRY_COLLECTOR} — never a UUID, so never a
 * machine's — and recomputed whenever either side moves, so every read of the
 * rollup sees `max(files, telemetry)` per session without knowing telemetry
 * exists.
 *
 * ## Repeats are harmless
 *
 * A **cumulative** series (`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=
 * cumulative`, which Connect prints) keeps its largest value and adds only the
 * growth, so a retried or re-exported point adds nothing. One first seen more
 * than {@link FIRST_SIGHT_MS} after it began is a baseline: its first value
 * may hold tokens from before sharing was on, so only its growth counts. A **delta** series —
 * Claude Code's default — keeps where its last interval ended, and a point that
 * starts before that is a repeat. Either way a point arriving out of order can
 * only be dropped, never counted twice.
 *
 * ## Sessions nobody was typing in
 *
 * D-086 leaves an orchestrator's or CI's sessions out of the files; the
 * collector sends their keys, and those outside the developer's `laika-repos`
 * scope (D-079 item 4) — telemetry has no working directory — as `excluded`,
 * and telemetry for them is dropped, including what was added before the key
 * arrived.
 */

export { TELEMETRY_COLLECTOR };

/** A one-way session key, as both the collector and the receiver make it. */
export const SESSION_KEY_PATTERN = /^[0-9a-f]{16}$/;

/** At most this many keys a report may exclude. */
export const EXCLUDED_MAX = 200;
/** At most this many session rows one day of a report may carry. */
export const SESSIONS_PER_DAY_MAX = 100;
/** At most this many data points are read from one body; the rest are refused. */
const POINTS_MAX = 5000;
/**
 * A cumulative series first seen this long after it began is a **baseline**,
 * not news: its first value holds everything since its process started —
 * possibly before the developer turned sharing on, or while Laika could not be
 * reached — and none of that can be told apart. Five export intervals.
 */
export const FIRST_SIGHT_MS = 5 * 60_000;

/** The model id as the collector sends it (cli `modelId`). */
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/** A plain session id: Claude Code's are UUIDs. */
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function sessionKey(id: string): string {
  return createHash('sha256').update(`laika-session:${id}`).digest('hex').slice(0, 16);
}

/** One of the four counts, or Claude Code's own cost. */
export type TelemetryKind = 'input' | 'output' | 'cache_write' | 'cache_read' | 'cost';

const KIND_OF_TYPE: Readonly<Record<string, TelemetryKind>> = {
  input: 'input',
  output: 'output',
  cacheRead: 'cache_read',
  cacheCreation: 'cache_write',
};

export interface TelemetryPoint {
  readonly sessionKey: string;
  readonly model: string;
  readonly kind: TelemetryKind;
  readonly value: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly cumulative: boolean;
}

export interface OtlpRead {
  readonly points: TelemetryPoint[];
  /** Data points of the two metrics that could not be taken. */
  readonly rejected: number;
  readonly message?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** An OTLP `KeyValue` list → the string attributes in it. Anything else is skipped. */
function stringAttributes(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const kv of list(value)) {
    if (!isRecord(kv) || typeof kv.key !== 'string' || !isRecord(kv.value)) continue;
    const v = kv.value.stringValue;
    if (typeof v === 'string') out.set(kv.key, v);
  }
  return out;
}

/** Nanoseconds as a decimal string or number → milliseconds; `undefined` if not one. */
function msOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value / 1e6);
  }
  if (typeof value === 'string' && /^\d{1,25}$/.test(value)) {
    // int64 nanoseconds arrive as strings in JSON: cut to ms before Number().
    return value.length <= 6 ? 0 : Number(value.slice(0, -6));
  }
  return undefined;
}

/** A data point's value: `asInt` (a string in JSON for int64) or `asDouble`. */
function valueOf(point: Record<string, unknown>): number | undefined {
  const raw = point.asInt ?? point.asDouble;
  const n = typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : undefined;
}

/** `Claude-Opus-5-5[1m]` → `claude-opus-5-5`, as the collector writes it. */
function modelOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const id = (raw.trim().toLowerCase().split('/').pop() ?? '').replace(/\[[^\]]*\]$/, '');
  return MODEL.test(id) ? id : undefined;
}

/**
 * Read an OTLP/HTTP JSON `ExportMetricsServiceRequest` for the two metrics
 * Laika takes. A body that is not one is refused (`422`); a point that cannot
 * be used — no session id, no model, no value — is counted in `rejected` and
 * said once in `message`, which OTLP carries back as `partialSuccess`.
 */
export function readOtlpMetrics(body: unknown): OtlpRead {
  if (!isRecord(body) || !Array.isArray(body.resourceMetrics)) {
    throw new ApiError('unprocessable', 'Not an OTLP metrics request: resourceMetrics missing', {
      reason: 'otlp_invalid',
    });
  }
  const points: TelemetryPoint[] = [];
  let rejected = 0;
  const why = new Set<string>();
  for (const resource of body.resourceMetrics) {
    if (!isRecord(resource)) continue;
    const resourceAttrs = stringAttributes(
      isRecord(resource.resource) ? resource.resource.attributes : [],
    );
    for (const scope of list(resource.scopeMetrics)) {
      if (!isRecord(scope)) continue;
      for (const metric of list(scope.metrics)) {
        if (!isRecord(metric)) continue;
        const name = metric.name;
        if (name !== 'claude_code.token.usage' && name !== 'claude_code.cost.usage') continue;
        const sum = metric.sum;
        if (!isRecord(sum)) {
          rejected += 1;
          why.add(`${name} must be a sum`);
          continue;
        }
        const temporality = sum.aggregationTemporality;
        const cumulative =
          temporality === 2 || temporality === 'AGGREGATION_TEMPORALITY_CUMULATIVE';
        const delta = temporality === 1 || temporality === 'AGGREGATION_TEMPORALITY_DELTA';
        for (const point of list(sum.dataPoints)) {
          if (!isRecord(point)) continue;
          if (points.length >= POINTS_MAX) {
            rejected += 1;
            why.add(`at most ${String(POINTS_MAX)} points a request`);
            continue;
          }
          const attrs = stringAttributes(point.attributes);
          const session = attrs.get('session.id') ?? resourceAttrs.get('session.id');
          const model = modelOf(attrs.get('model') ?? resourceAttrs.get('model'));
          const kind =
            name === 'claude_code.cost.usage' ? 'cost' : KIND_OF_TYPE[attrs.get('type') ?? ''];
          const value = valueOf(point);
          const endMs = msOf(point.timeUnixNano);
          const startMs = msOf(point.startTimeUnixNano) ?? endMs;
          if (session === undefined || !SESSION_ID.test(session)) {
            rejected += 1;
            why.add('session.id is required (OTEL_METRICS_INCLUDE_SESSION_ID must stay on)');
            continue;
          }
          if (
            model === undefined ||
            kind === undefined ||
            value === undefined ||
            endMs === undefined ||
            startMs === undefined ||
            (!cumulative && !delta)
          ) {
            rejected += 1;
            why.add('each point needs a model, a known type, a value, a time and a temporality');
            continue;
          }
          points.push({
            sessionKey: sessionKey(session),
            model,
            kind,
            value,
            startMs,
            endMs,
            cumulative,
          });
        }
      }
    }
  }
  return {
    points,
    rejected,
    ...(why.size === 0 ? {} : { message: [...why].join('; ') }),
  };
}

// --------------------------------------------------------------- storage

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Writer = Db | Tx;

interface Counts {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const zero = (): Counts => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const FIELDS = ['input', 'output', 'cacheWrite', 'cacheRead'] as const;
const headlineOf = (c: Counts): number => c.input + c.output + c.cacheWrite;

/** The zone this person's collector last reported its days in, or UTC. */
export function zoneFor(db: Writer, userId: string): string {
  const row = db
    .select({ tz: localActivityDays.tz })
    .from(localActivityDays)
    .where(eq(localActivityDays.userId, userId))
    .orderBy(desc(localActivityDays.day))
    .limit(1)
    .get();
  return row !== undefined && isTimeZone(row.tz) ? row.tz : 'UTC';
}

/** One day of a collector's per-session file totals (§6.4's `sessions`). */
export interface SessionFilesInput {
  key: string;
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

/**
 * Replace one collector's per-session file totals for the days a usage report
 * carries — a day sent without `sessions` empties them, and its tokens become
 * the day's unplaced ones. Inside the report's transaction.
 */
export function storeSessionFiles(
  tx: Tx,
  userId: string,
  collectorId: string,
  days: readonly { day: string; sessions?: readonly SessionFilesInput[] | undefined }[],
  now: number,
): void {
  if (days.length === 0) return;
  tx.delete(tokenSessionDays)
    .where(
      and(
        eq(tokenSessionDays.userId, userId),
        eq(tokenSessionDays.source, 'files'),
        eq(tokenSessionDays.collectorId, collectorId),
        inArray(
          tokenSessionDays.day,
          days.map((d) => d.day),
        ),
      ),
    )
    .run();
  const rows = new Map<string, typeof tokenSessionDays.$inferInsert>();
  for (const day of days) {
    for (const s of day.sessions ?? []) {
      const id = `${day.day}\u0000${s.key}\u0000${s.model}`;
      const held = rows.get(id);
      if (held === undefined) {
        rows.set(id, {
          userId,
          source: 'files',
          collectorId,
          day: day.day,
          sessionKey: s.key,
          model: s.model,
          input: s.input,
          output: s.output,
          cacheWrite: s.cache_write,
          cacheRead: s.cache_read,
          updatedAt: now,
        });
      } else {
        held.input = (held.input ?? 0) + s.input;
        held.output = (held.output ?? 0) + s.output;
        held.cacheWrite = (held.cacheWrite ?? 0) + s.cache_write;
        held.cacheRead = (held.cacheRead ?? 0) + s.cache_read;
      }
    }
  }
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += 50) {
    tx.insert(tokenSessionDays)
      .values(values.slice(i, i + 50))
      .run();
  }
}

/**
 * The collector's excluded sessions (automated, or outside the scope): kept as
 * keys, and whatever telemetry they had sent dropped. Returns the days whose
 * gap must be recomputed.
 */
export function storeExcluded(
  tx: Tx,
  userId: string,
  keys: readonly string[],
  now: number,
): string[] {
  if (keys.length === 0) return [];
  const unique = [...new Set(keys)];
  tx.insert(tokenSessionSkips)
    .values(unique.map((sessionKey) => ({ userId, sessionKey, createdAt: now })))
    .onConflictDoNothing()
    .run();
  const days = tx
    .selectDistinct({ day: tokenSessionDays.day })
    .from(tokenSessionDays)
    .where(
      and(
        eq(tokenSessionDays.userId, userId),
        eq(tokenSessionDays.source, 'telemetry'),
        inArray(tokenSessionDays.sessionKey, unique),
      ),
    )
    .all()
    .map((r) => r.day);
  if (days.length > 0) {
    tx.delete(tokenSessionDays)
      .where(
        and(
          eq(tokenSessionDays.userId, userId),
          eq(tokenSessionDays.source, 'telemetry'),
          inArray(tokenSessionDays.sessionKey, unique),
        ),
      )
      .run();
  }
  return days;
}

/**
 * Write the gap telemetry adds for each of `days` (see the module comment),
 * replacing what was there. Returns the change in the person's headline tokens
 * across those days — what just arrived, for the plan-limit rate.
 *
 * Five indexed reads a day: a person's sessions on one day are a few dozen
 * rows.
 */
export function recomputeGap(tx: Tx, userId: string, days: readonly string[], now: number): number {
  let change = 0;
  for (const day of new Set(days)) {
    const sessions = tx
      .select({
        source: tokenSessionDays.source,
        sessionKey: tokenSessionDays.sessionKey,
        model: tokenSessionDays.model,
        input: tokenSessionDays.input,
        output: tokenSessionDays.output,
        cacheWrite: tokenSessionDays.cacheWrite,
        cacheRead: tokenSessionDays.cacheRead,
      })
      .from(tokenSessionDays)
      .where(and(eq(tokenSessionDays.userId, userId), eq(tokenSessionDays.day, day)))
      .all();
    const previous = tx
      .select({
        tokens:
          sql<number>`coalesce(sum(${tokenUsageDays.input} + ${tokenUsageDays.output} + ${tokenUsageDays.cacheWrite}), 0)`.mapWith(
            Number,
          ),
      })
      .from(tokenUsageDays)
      .where(
        and(
          eq(tokenUsageDays.userId, userId),
          eq(tokenUsageDays.day, day),
          eq(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        ),
      )
      .get();
    tx.delete(tokenUsageDays)
      .where(
        and(
          eq(tokenUsageDays.userId, userId),
          eq(tokenUsageDays.day, day),
          eq(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        ),
      )
      .run();
    const telemetered = sessions.filter((s) => s.source === 'telemetry');
    if (telemetered.length === 0) {
      change -= previous?.tokens ?? 0;
      continue;
    }

    // Per model: what each telemetered session has beyond its files, and the
    // day's file tokens no listed session holds.
    const files = new Map<string, Counts>();
    const listed = new Map<string, Counts>();
    for (const s of sessions) {
      if (s.source !== 'files') continue;
      const key = `${s.sessionKey}\u0000${s.model}`;
      const held = files.get(key) ?? zero();
      const perModel = listed.get(s.model) ?? zero();
      for (const f of FIELDS) {
        held[f] += s[f];
        perModel[f] += s[f];
      }
      files.set(key, held);
      listed.set(s.model, perModel);
    }
    const dayFiles = new Map<string, Counts>();
    for (const r of tx
      .select({
        model: tokenUsageDays.model,
        input: sql<number>`coalesce(sum(${tokenUsageDays.input}), 0)`.mapWith(Number),
        output: sql<number>`coalesce(sum(${tokenUsageDays.output}), 0)`.mapWith(Number),
        cacheWrite: sql<number>`coalesce(sum(${tokenUsageDays.cacheWrite}), 0)`.mapWith(Number),
        cacheRead: sql<number>`coalesce(sum(${tokenUsageDays.cacheRead}), 0)`.mapWith(Number),
      })
      .from(tokenUsageDays)
      .where(
        and(
          eq(tokenUsageDays.userId, userId),
          eq(tokenUsageDays.day, day),
          eq(tokenUsageDays.agent, 'claude-code'),
          ne(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        ),
      )
      .groupBy(tokenUsageDays.model)
      .all()) {
      dayFiles.set(r.model, r);
    }

    const beyond = new Map<string, Counts>();
    for (const s of telemetered) {
      const held = files.get(`${s.sessionKey}\u0000${s.model}`) ?? zero();
      const perModel = beyond.get(s.model) ?? zero();
      for (const f of FIELDS) perModel[f] += Math.max(0, s[f] - held[f]);
      beyond.set(s.model, perModel);
    }
    const rows: (typeof tokenUsageDays.$inferInsert)[] = [];
    let added = 0;
    for (const [model, extra] of beyond) {
      const all = dayFiles.get(model) ?? zero();
      const placed = listed.get(model) ?? zero();
      const gap = zero();
      for (const f of FIELDS) {
        const unplaced = Math.max(0, all[f] - placed[f]);
        gap[f] = Math.max(0, extra[f] - unplaced);
      }
      if (FIELDS.every((f) => gap[f] === 0)) continue;
      added += headlineOf(gap);
      rows.push({
        userId,
        collectorId: TELEMETRY_COLLECTOR,
        day,
        agent: 'claude-code',
        model,
        taskId: null,
        projectId: null,
        ...gap,
        updatedAt: now,
      });
    }
    if (rows.length > 0) tx.insert(tokenUsageDays).values(rows).run();
    change += added - (previous?.tokens ?? 0);
  }
  return change;
}

export interface TelemetryIngest {
  /** OTLP's `ExportMetricsServiceResponse`: empty, or a partial success. */
  readonly response: { partialSuccess?: { rejectedDataPoints: number; errorMessage: string } };
  /** The days whose rows moved, for the caller's after-work. */
  readonly days: string[];
  /** Headline tokens that just arrived (the plan-limit rate). */
  readonly arrived: number;
}

/**
 * `POST /otlp/v1/metrics`: store what is new, then recompute the gap for the
 * days it touched — in one transaction, so a reader never sees telemetry added
 * without the files subtracted.
 */
export function recordTelemetry(
  db: Db,
  actor: ResolvedActor,
  body: unknown,
  now: number = Date.now(),
): TelemetryIngest {
  assertMaySendLocalActivity(db, actor);
  const read = readOtlpMetrics(body);
  const userId = actor.userId;
  const tz = zoneFor(db, userId);

  const result = db.transaction((tx) => {
    const keys = [...new Set(read.points.map((p) => p.sessionKey))];
    const skipped = new Set(
      keys.length === 0
        ? []
        : tx
            .select({ key: tokenSessionSkips.sessionKey })
            .from(tokenSessionSkips)
            .where(
              and(
                eq(tokenSessionSkips.userId, userId),
                inArray(tokenSessionSkips.sessionKey, keys),
              ),
            )
            .all()
            .map((r) => r.key),
    );
    const points = read.points.filter((p) => !skipped.has(p.sessionKey));
    const seriesKeyOf = (p: TelemetryPoint) =>
      `${p.sessionKey}|${p.model}|${p.kind}|${p.cumulative ? String(p.startMs) : 'delta'}`;
    const seriesKeys = [...new Set(points.map(seriesKeyOf))];
    const series = new Map<string, { lastValue: number; lastEndMs: number }>();
    for (let i = 0; i < seriesKeys.length; i += 500) {
      for (const r of tx
        .select()
        .from(tokenTelemetrySeries)
        .where(
          and(
            eq(tokenTelemetrySeries.userId, userId),
            inArray(tokenTelemetrySeries.seriesKey, seriesKeys.slice(i, i + 500)),
          ),
        )
        .all()) {
        series.set(r.seriesKey, { lastValue: r.lastValue, lastEndMs: r.lastEndMs });
      }
    }

    // What each point adds: the growth of a cumulative series, a delta that
    // starts at or after where its series last ended.
    const added = new Map<
      string,
      Counts & { cost: number; day: string; key: string; model: string }
    >();
    const touched = new Set<string>();
    for (const p of [...points].sort((a, b) => a.endMs - b.endMs)) {
      const key = seriesKeyOf(p);
      const held = series.get(key) ?? { lastValue: 0, lastEndMs: 0 };
      let add = 0;
      if (p.cumulative) {
        if (p.endMs <= held.lastEndMs && p.value <= held.lastValue) continue;
        const firstSight = !series.has(key);
        // Seen late, it is where counting starts: only its growth from here.
        add =
          firstSight && p.endMs - p.startMs > FIRST_SIGHT_MS
            ? 0
            : Math.max(0, p.value - held.lastValue);
        series.set(key, {
          lastValue: Math.max(held.lastValue, p.value),
          lastEndMs: Math.max(held.lastEndMs, p.endMs),
        });
      } else {
        if (p.startMs < held.lastEndMs) continue;
        add = p.value;
        series.set(key, { lastValue: held.lastValue + p.value, lastEndMs: p.endMs });
      }
      touched.add(key);
      if (add <= 0) continue;
      const day = dayIn(tz, p.endMs);
      const id = `${day}\u0000${p.sessionKey}\u0000${p.model}`;
      const entry = added.get(id) ?? { ...zero(), cost: 0, day, key: p.sessionKey, model: p.model };
      if (p.kind === 'cost') entry.cost += add;
      else if (p.kind === 'cache_write') entry.cacheWrite += Math.round(add);
      else if (p.kind === 'cache_read') entry.cacheRead += Math.round(add);
      else entry[p.kind] += Math.round(add);
      added.set(id, entry);
    }

    for (const key of touched) {
      const s = series.get(key)!;
      tx.insert(tokenTelemetrySeries)
        .values({
          userId,
          seriesKey: key,
          lastValue: s.lastValue,
          lastEndMs: s.lastEndMs,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [tokenTelemetrySeries.userId, tokenTelemetrySeries.seriesKey],
          set: { lastValue: s.lastValue, lastEndMs: s.lastEndMs, updatedAt: now },
        })
        .run();
    }
    for (const e of added.values()) {
      tx.insert(tokenSessionDays)
        .values({
          userId,
          source: 'telemetry',
          collectorId: '',
          day: e.day,
          sessionKey: e.key,
          model: e.model,
          input: e.input,
          output: e.output,
          cacheWrite: e.cacheWrite,
          cacheRead: e.cacheRead,
          costUsd: e.cost,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            tokenSessionDays.userId,
            tokenSessionDays.day,
            tokenSessionDays.source,
            tokenSessionDays.collectorId,
            tokenSessionDays.sessionKey,
            tokenSessionDays.model,
          ],
          set: {
            input: sql`${tokenSessionDays.input} + ${e.input}`,
            output: sql`${tokenSessionDays.output} + ${e.output}`,
            cacheWrite: sql`${tokenSessionDays.cacheWrite} + ${e.cacheWrite}`,
            cacheRead: sql`${tokenSessionDays.cacheRead} + ${e.cacheRead}`,
            costUsd: sql`coalesce(${tokenSessionDays.costUsd}, 0) + ${e.cost}`,
            updatedAt: now,
          },
        })
        .run();
    }
    const days = [...new Set([...added.values()].map((e) => e.day))];
    const arrived = recomputeGap(tx, userId, days, now);
    return { days, arrived };
  });

  return {
    response:
      read.rejected === 0
        ? {}
        : {
            partialSuccess: {
              rejectedDataPoints: read.rejected,
              errorMessage: read.message ?? 'some points were refused',
            },
          },
    days: result.days,
    arrived: Math.max(0, result.arrived),
  };
}
