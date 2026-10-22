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
  tokenUsageZones,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import {
  type AgentBucketSeconds,
  type AgentSeconds,
  dropAgentTime,
  spreadActive,
  storeAgentBuckets,
  storeAgentTime,
} from './agent-time.ts';
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
 * may hold tokens from before Developer insights was on, so only its growth
 * counts. A **delta** series — Claude Code's default — keeps where its last
 * interval ended, and a point that starts before that is a repeat. Either way
 * a point arriving out of order can only be dropped, never counted twice.
 *
 * ## Agent minutes (D-088 item 8, LAI-787)
 *
 * `claude_code.active_time.total` (seconds; attribute `type`: `user`, time at
 * the keyboard in Claude Code, or `cli`, the agent working; `session.id`) is
 * read the same way — the same series state, so a repeat adds nothing — and
 * kept per session key and day in `agent_time_days` (`agent-time.ts`). It
 * never touches a token row, and it is never hours.
 *
 * ## Sessions nobody was typing in
 *
 * D-086 leaves an orchestrator's or CI's sessions out of the files; the
 * collector sends their keys, and those outside the developer's `laika-repos`
 * scope (D-079 item 4) — telemetry has no working directory — as `excluded`,
 * and telemetry for them is dropped, including what was added before the key
 * arrived. A builder the owner dispatched through Omnigent is named in its
 * day's `dispatched` instead (LAI-315), and its telemetry is dropped the same.
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
 * possibly before the organisation turned Developer insights on, or while
 * Laika could not be reached — and none of that can be told apart. Five
 * export intervals.
 */
export const FIRST_SIGHT_MS = 5 * 60_000;

/** The last instant a JavaScript `Date` can hold. */
const MAX_DATE_MS = 8.64e15;

/**
 * Points are taken for the days a usage report may carry (§6.4): today − 31 to
 * today + 1 in the person's zone — `TOKEN_USAGE_DAYS_BACK`, which a test holds
 * equal. Anything else is refused as `day_out_of_range`, before it can be
 * stored or move a series (review).
 */
export const TELEMETRY_DAYS_BACK = 31;

/** The model id as the collector sends it (cli `modelId`). */
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/** A plain session id: Claude Code's are UUIDs. */
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function sessionKey(id: string): string {
  return createHash('sha256').update(`laika-session:${id}`).digest('hex').slice(0, 16);
}

/** One of the four counts, Claude Code's own cost, or its active time by type. */
export type TelemetryKind =
  'input' | 'output' | 'cache_write' | 'cache_read' | 'cost' | 'active_user' | 'active_cli';

const ACTIVE_TIME = 'claude_code.active_time.total';

const ACTIVE_KIND_OF_TYPE: Readonly<Record<string, TelemetryKind>> = {
  user: 'active_user',
  cli: 'active_cli',
};

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
  let ms: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    ms = Math.floor(value / 1e6);
  } else if (typeof value === 'string' && /^\d{1,25}$/.test(value)) {
    // int64 nanoseconds arrive as strings in JSON: cut to ms before Number().
    ms = value.length <= 6 ? 0 : Number(value.slice(0, -6));
  }
  // Past the last instant a Date can hold, it is no time at all (review): a
  // 25-digit value must be a refused point, never a server error.
  return ms !== undefined && ms <= MAX_DATE_MS ? ms : undefined;
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
 * Read an OTLP/HTTP JSON `ExportMetricsServiceRequest` for the metrics Laika
 * takes. A body that is not one is refused (`422`); a point that cannot
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
        if (
          name !== 'claude_code.token.usage' &&
          name !== 'claude_code.cost.usage' &&
          name !== ACTIVE_TIME
        ) {
          continue;
        }
        const active = name === ACTIVE_TIME;
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
          // Active time carries no model: it is the session's, whatever ran.
          const model = active ? '' : modelOf(attrs.get('model') ?? resourceAttrs.get('model'));
          const kind = active
            ? ACTIVE_KIND_OF_TYPE[attrs.get('type') ?? '']
            : name === 'claude_code.cost.usage'
              ? 'cost'
              : KIND_OF_TYPE[attrs.get('type') ?? ''];
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

/**
 * The zone telemetry's days are read in (review B1): the one the person's
 * usage reports last stated — the files' own days — else a snapshot's, else
 * UTC. A day read in the wrong zone is still matched, by session over its
 * span; this keeps the gap on the day the files put the work.
 */
export function zoneFor(db: Writer, userId: string): string {
  const stated = db
    .select({ tz: tokenUsageZones.tz })
    .from(tokenUsageZones)
    .where(eq(tokenUsageZones.userId, userId))
    .get();
  if (stated !== undefined && isTimeZone(stated.tz)) return stated.tz;
  const row = db
    .select({ tz: localActivityDays.tz })
    .from(localActivityDays)
    .where(eq(localActivityDays.userId, userId))
    .orderBy(desc(localActivityDays.day))
    .limit(1)
    .get();
  return row !== undefined && isTimeZone(row.tz) ? row.tz : 'UTC';
}

/** Remember the zone a usage report stated, for telemetry's days (review B1). */
export function storeZone(tx: Tx, userId: string, tz: string, now: number): void {
  tx.insert(tokenUsageZones)
    .values({ userId, tz, updatedAt: now })
    .onConflictDoUpdate({ target: tokenUsageZones.userId, set: { tz, updatedAt: now } })
    .run();
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
 *
 * `dispatched` — the builders the owner dispatched through Omnigent (LAI-315)
 * — are left out the same way, but for their buckets: those are the lane the
 * collector sent for them (`storeDispatched`), not telemetry's.
 */
export function storeExcluded(
  tx: Tx,
  userId: string,
  keys: readonly string[],
  now: number,
  dispatched: readonly string[] = [],
): string[] {
  const unique = [...new Set([...keys, ...dispatched])];
  if (unique.length === 0) return [];
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
  // Their agent minutes are not the developer's either (LAI-787).
  const lane = new Set(dispatched.filter((k) => !keys.includes(k)));
  dropAgentTime(
    tx,
    userId,
    unique.filter((k) => !lane.has(k)),
  );
  dropAgentTime(tx, userId, [...lane], false);
  return days;
}

/** Spread `total` over `weights` by largest remainder: whole tokens, the sum exact. */
function apportion(total: number, weights: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return out;
  const shares = [...weights].map(([key, w]) => {
    const exact = (total * w) / sum;
    return { key, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = total - shares.reduce((n, x) => n + x.whole, 0);
  shares.sort((a, b) => b.rest - a.rest || a.key.localeCompare(b.key));
  for (const x of shares) {
    out.set(x.key, x.whole + (left > 0 ? 1 : 0));
    if (left > 0) left -= 1;
  }
  return out;
}

const DAY_MS = 86_400_000;
const neighbour = (day: string, by: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

type SessionRow = Counts & { source: string; sessionKey: string; model: string; day: string };

/**
 * Write the gap telemetry adds (see the module comment) for `days` and every
 * day the sessions on them reach, replacing what was there. Returns the change
 * in the person's headline tokens over those days — what just arrived, for the
 * plan-limit rate.
 *
 * **Matched per session over its whole span, then floored** (review B1). The
 * files put a reply on the day it was written; telemetry puts a token on the
 * day its export ended — up to a minute later, so across midnight, or in
 * another zone, the same tokens sit on two days. Flooring each day on its own
 * counted them twice: 300 files on the 16th, 300 telemetry on the 17th, a
 * gap of 300. So a session's telemetry and files are totalled over every day
 * it has, the gap is `max(0, telemetry − files)` per session, less the file
 * tokens no session list placed on those days and the days beside them, and
 * only then spread back onto the days by where the telemetry ran ahead.
 *
 * A handful of indexed reads whatever the span: the days' telemetered
 * sessions, their rows (by person and key), and the days' totals.
 */
export function recomputeGap(tx: Tx, userId: string, days: readonly string[], now: number): number {
  if (days.length === 0) return 0;
  // The days asked about and the days beside them: a reply written before
  // midnight and its export after it are a day apart, so a change on one day
  // can move the gap on the next.
  const span = new Set(days.flatMap((d) => [neighbour(d, -1), d, neighbour(d, 1)]));

  // Grown by every day a telemetered session on the span has rows on, until
  // no new session turns up. Sessions with no telemetry add no gap and are
  // left where they are.
  const keys = new Set<string>();
  const seen = new Set<string>();
  const rows: SessionRow[] = [];
  let frontier = [...span];
  while (frontier.length > 0) {
    const found = tx
      .selectDistinct({ key: tokenSessionDays.sessionKey })
      .from(tokenSessionDays)
      .where(and(eq(tokenSessionDays.userId, userId), inArray(tokenSessionDays.day, frontier)))
      .all()
      .map((r) => r.key)
      .filter((k) => !seen.has(k));
    frontier = [];
    for (const k of found) seen.add(k);
    for (let i = 0; i < found.length; i += 500) {
      const loaded = tx
        .select({
          source: tokenSessionDays.source,
          sessionKey: tokenSessionDays.sessionKey,
          model: tokenSessionDays.model,
          day: tokenSessionDays.day,
          input: tokenSessionDays.input,
          output: tokenSessionDays.output,
          cacheWrite: tokenSessionDays.cacheWrite,
          cacheRead: tokenSessionDays.cacheRead,
        })
        .from(tokenSessionDays)
        .where(
          and(
            eq(tokenSessionDays.userId, userId),
            inArray(tokenSessionDays.sessionKey, found.slice(i, i + 500)),
          ),
        )
        .all();
      const telemetered = new Set(
        loaded.filter((r) => r.source === 'telemetry').map((r) => r.sessionKey),
      );
      for (const r of loaded) {
        if (!telemetered.has(r.sessionKey)) continue;
        keys.add(r.sessionKey);
        rows.push(r);
        if (!span.has(r.day)) {
          span.add(r.day);
          frontier.push(r.day);
        }
      }
    }
  }
  const spanDays = [...span];

  const previous =
    tx
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
          inArray(tokenUsageDays.day, spanDays),
          eq(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        ),
      )
      .get()?.tokens ?? 0;
  tx.delete(tokenUsageDays)
    .where(
      and(
        eq(tokenUsageDays.userId, userId),
        inArray(tokenUsageDays.day, spanDays),
        eq(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
      ),
    )
    .run();
  if (keys.size === 0) return -previous;

  // Per session and model, over the whole span; per day, where telemetry ran ahead.
  const totals = new Map<string, { model: string; tel: Counts; files: Counts }>();
  const ahead = new Map<string, Map<string, Counts>>();
  const byDay = new Map<string, { tel: Counts; files: Counts }>();
  for (const r of rows) {
    const id = `${r.sessionKey}\u0000${r.model}`;
    const t = totals.get(id) ?? { model: r.model, tel: zero(), files: zero() };
    const d = byDay.get(`${id}\u0000${r.day}`) ?? { tel: zero(), files: zero() };
    for (const f of FIELDS) {
      if (r.source === 'telemetry') {
        t.tel[f] += r[f];
        d.tel[f] += r[f];
      } else {
        t.files[f] += r[f];
        d.files[f] += r[f];
      }
    }
    totals.set(id, t);
    byDay.set(`${id}\u0000${r.day}`, d);
  }
  for (const [id, d] of byDay) {
    const [, model, day] = id.split('\u0000') as [string, string, string];
    const perModel = ahead.get(model) ?? new Map<string, Counts>();
    const c = perModel.get(day) ?? zero();
    for (const f of FIELDS) c[f] += Math.max(0, d.tel[f] - d.files[f]);
    perModel.set(day, c);
    ahead.set(model, perModel);
  }

  // The file tokens no session list placed, on the span and the days beside
  // it: they may be any session's, so they are taken to be these. Not an
  // automated session's (D-091): the collector names those in `excluded`
  // whenever this machine sends telemetry, or in `dispatched` (LAI-315), so no telemetry of theirs is kept
  // to match, and taking them as unplaced would empty the person's own gap.
  const near = [...new Set(spanDays.flatMap((d) => [neighbour(d, -1), d, neighbour(d, 1)]))];
  const dayFiles = new Map<string, Counts>();
  for (const r of tx
    .select({
      day: tokenUsageDays.day,
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
        inArray(tokenUsageDays.day, near),
        eq(tokenUsageDays.agent, 'claude-code'),
        ne(tokenUsageDays.collectorId, TELEMETRY_COLLECTOR),
        eq(tokenUsageDays.automated, false),
      ),
    )
    .groupBy(tokenUsageDays.day, tokenUsageDays.model)
    .all()) {
    dayFiles.set(`${r.day}\u0000${r.model}`, r);
  }
  const listed = new Map<string, Counts>();
  for (const r of tx
    .select({
      day: tokenSessionDays.day,
      model: tokenSessionDays.model,
      input: sql<number>`coalesce(sum(${tokenSessionDays.input}), 0)`.mapWith(Number),
      output: sql<number>`coalesce(sum(${tokenSessionDays.output}), 0)`.mapWith(Number),
      cacheWrite: sql<number>`coalesce(sum(${tokenSessionDays.cacheWrite}), 0)`.mapWith(Number),
      cacheRead: sql<number>`coalesce(sum(${tokenSessionDays.cacheRead}), 0)`.mapWith(Number),
    })
    .from(tokenSessionDays)
    .where(
      and(
        eq(tokenSessionDays.userId, userId),
        inArray(tokenSessionDays.day, near),
        eq(tokenSessionDays.source, 'files'),
      ),
    )
    .groupBy(tokenSessionDays.day, tokenSessionDays.model)
    .all()) {
    listed.set(`${r.day}\u0000${r.model}`, r);
  }
  const unplaced = new Map<string, Counts>();
  for (const [id, all] of dayFiles) {
    const model = id.split('\u0000')[1] ?? '';
    const placed = listed.get(id) ?? zero();
    const u = unplaced.get(model) ?? zero();
    for (const f of FIELDS) u[f] += Math.max(0, all[f] - placed[f]);
    unplaced.set(model, u);
  }

  // The gap per model: each session's excess over the span, less the unplaced.
  const excess = new Map<string, Counts>();
  for (const t of totals.values()) {
    const e = excess.get(t.model) ?? zero();
    for (const f of FIELDS) e[f] += Math.max(0, t.tel[f] - t.files[f]);
    excess.set(t.model, e);
  }
  const out = new Map<string, Counts>();
  for (const [model, e] of excess) {
    const u = unplaced.get(model) ?? zero();
    const perDay = ahead.get(model) ?? new Map<string, Counts>();
    for (const f of FIELDS) {
      const gap = Math.max(0, e[f] - u[f]);
      const weights = new Map([...perDay].map(([day, c]) => [day, c[f]] as const));
      for (const [day, n] of apportion(gap, weights)) {
        const id = `${day}\u0000${model}`;
        const c = out.get(id) ?? zero();
        c[f] += n;
        out.set(id, c);
      }
    }
  }
  const inserts: (typeof tokenUsageDays.$inferInsert)[] = [];
  let added = 0;
  for (const [id, gap] of out) {
    if (FIELDS.every((f) => gap[f] === 0)) continue;
    const [day, model] = id.split('\u0000') as [string, string];
    added += headlineOf(gap);
    inserts.push({
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
  for (let i = 0; i < inserts.length; i += 50) {
    tx.insert(tokenUsageDays)
      .values(inserts.slice(i, i + 50))
      .run();
  }
  return added - previous;
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
  const today = dayIn(tz, now);
  const earliest = neighbour(today, -TELEMETRY_DAYS_BACK);
  const latest = neighbour(today, 1);
  const inWindow = read.points.filter((p) => {
    if (p.startMs > p.endMs) return false;
    const day = dayIn(tz, p.endMs);
    return day >= earliest && day <= latest;
  });
  const outOfRange = read.points.length - inWindow.length;

  const result = db.transaction((tx) => {
    const keys = [...new Set(inWindow.map((p) => p.sessionKey))];
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
    const points = inWindow.filter((p) => !skipped.has(p.sessionKey));
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
    const activeAdded = new Map<string, AgentSeconds>();
    // When the agent worked (LAI-833): its seconds where its interval fell.
    const bucketsAdded: AgentBucketSeconds[] = [];
    const touched = new Set<string>();
    for (const p of [...points].sort((a, b) => a.endMs - b.endMs)) {
      const key = seriesKeyOf(p);
      const held = series.get(key) ?? { lastValue: 0, lastEndMs: 0 };
      // What a point adds accrued over its own interval — a delta's, or a
      // cumulative series' growth since its last point.
      const since = p.cumulative ? Math.max(p.startMs, held.lastEndMs) : p.startMs;
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
      if (p.kind === 'active_user' || p.kind === 'active_cli') {
        const kind = p.kind === 'active_user' ? 'user' : 'cli';
        if (kind === 'cli') bucketsAdded.push(...spreadActive(p.sessionKey, since, p.endMs, add));
        const id = `${day}\u0000${p.sessionKey}\u0000${kind}`;
        const held = activeAdded.get(id) ?? { day, sessionKey: p.sessionKey, kind, seconds: 0 };
        held.seconds += add;
        activeAdded.set(id, held);
        continue;
      }
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
    storeAgentTime(tx, userId, [...activeAdded.values()], now);
    storeAgentBuckets(tx, userId, bucketsAdded, now);
    const days = [...new Set([...added.values()].map((e) => e.day))];
    const arrived = recomputeGap(tx, userId, days, now);
    return { days, arrived };
  });

  return {
    response:
      read.rejected + outOfRange === 0
        ? {}
        : {
            partialSuccess: {
              rejectedDataPoints: read.rejected + outOfRange,
              errorMessage: [
                ...(read.message === undefined ? [] : [read.message]),
                ...(outOfRange === 0
                  ? []
                  : [
                      `day_out_of_range: points are taken for ${earliest} to ${latest} in ${tz}, as usage reports are`,
                    ]),
              ].join('; '),
            },
          },
    days: result.days,
    arrived: Math.max(0, result.arrived),
  };
}
