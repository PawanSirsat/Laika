import { and, eq, gte, sql } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { PLAN_KINDS, PLAN_WINDOWS, type PlanKind, type PlanWindow } from '../db/enums.ts';

export { PLAN_KINDS, PLAN_WINDOWS };
import { planLimits, tokenArrivals } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { isTimeZone } from './calendar-days.ts';

/**
 * The plan-limit forecast (LAI-773, D-087): *"at this rate you reach your
 * limit around 15:40"* — **for the developer and nobody else**.
 *
 * ## Whose, and what it claims
 *
 * The developer's own: `plan_limit.own` is session only (§3.1) and every
 * function here reads the caller's own row — there is no parameter that could
 * name anybody else, no admin read and no token. The plan is a label they pick;
 * **no plan carries a token figure**, because no vendor states one: Anthropic
 * describes its plans' limits as a session that resets every five hours and a
 * weekly limit that resets at a fixed time (support.claude.com, *What is the
 * Max plan?*), not in tokens. So the limit is always the number the developer
 * entered, and the answer is labelled an estimate.
 *
 * ## The rate
 *
 * Usage arrives per day (§4.33), too coarse for a time of day. So every report
 * and every telemetry export records **what it added to the person's headline
 * tokens**, in five-minute buckets (§4.42) — when tokens reached the board,
 * which with the throttled `Stop` trigger is within one sync interval of when
 * they were spent (LAI-776). The rate is the last hour's arrivals; the window
 * is the last five hours (rolling — Laika cannot see when the vendor's session
 * started), today since local midnight, or the week since the reset the
 * developer gave. Kept eight days.
 */

/** Arrivals are kept in buckets this wide. */
export const ARRIVAL_BUCKET_MS = 5 * 60_000;
/** …for this long: a week's window and a day. */
export const ARRIVALS_KEPT_MS = 8 * 86_400_000;
/** The rate is what arrived over this long. */
const RATE_WINDOW_MS = 3_600_000;
const FIVE_HOURS_MS = 5 * 3_600_000;

/** Add `tokens` to the person's bucket for `now` (best effort, in the caller's transaction). */
export function recordArrival(
  tx: Pick<Db, 'insert'>,
  userId: string,
  tokens: number,
  now: number,
): void {
  const amount = Math.round(tokens);
  if (!(amount > 0)) return;
  const bucketMs = Math.floor(now / ARRIVAL_BUCKET_MS) * ARRIVAL_BUCKET_MS;
  tx.insert(tokenArrivals)
    .values({ userId, bucketMs, tokens: amount })
    .onConflictDoUpdate({
      target: [tokenArrivals.userId, tokenArrivals.bucketMs],
      set: { tokens: sql`${tokenArrivals.tokens} + ${amount}` },
    })
    .run();
}

// ------------------------------------------------------- zoned wall time

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function wallOf(tz: string, ms: number): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')),
    mi: Number(get('minute')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** The instant a wall-clock time in `tz` names (the later one in a fold). */
function zoned(tz: string, y: number, m: number, d: number, minute: number): number {
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  const offsetAt = (at: number) => {
    const w = wallOf(tz, at);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(at / 60_000) * 60_000;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** Local midnight of the day `now` is in, in `tz`. */
export function startOfDay(tz: string, now: number): number {
  const w = wallOf(tz, now);
  return zoned(tz, w.y, w.m, w.d, 0);
}

/** The most recent weekly reset at or before `now`: `weekday` 0 (Sunday)–6, `minute` after midnight, in `tz`. */
export function lastWeeklyReset(tz: string, now: number, weekday: number, minute: number): number {
  const w = wallOf(tz, now);
  let back = (w.weekday - weekday + 7) % 7;
  if (back === 0 && w.h * 60 + w.mi < minute) back = 7;
  return zoned(tz, w.y, w.m, w.d - back, minute);
}

function addLocalDays(tz: string, at: number, days: number, minute: number): number {
  const w = wallOf(tz, at);
  return zoned(tz, w.y, w.m, w.d + days, minute);
}

// ------------------------------------------------------------------- view

export interface PlanLimitInput {
  plan: PlanKind;
  window: PlanWindow;
  limit_tokens: number;
  tz: string;
  week_reset?: { weekday: number; minute: number } | undefined;
}

/** `GET /me/plan-limit` — the developer's own, and an estimate. */
export interface PlanLimitView {
  plan: PlanKind | null;
  window: PlanWindow | null;
  limit_tokens: number | null;
  week_reset: { weekday: number; minute: number } | null;
  tz: string;
  /** Headline tokens that reached the board in the current window. */
  used: number;
  /** Over the last hour, per hour. */
  rate_per_hour: number;
  window_start: number | null;
  /** When the window resets; `null` for the rolling five hours. */
  window_end: number | null;
  /** When the limit is reached at this rate; `null` with no rate, once reached, or after the reset. */
  reaches_limit_at: number | null;
  reached: boolean;
  estimate: true;
}

function arrivedSince(db: Db, userId: string, from: number): number {
  const row = db
    .select({ tokens: sql<number>`coalesce(sum(${tokenArrivals.tokens}), 0)`.mapWith(Number) })
    .from(tokenArrivals)
    .where(and(eq(tokenArrivals.userId, userId), gte(tokenArrivals.bucketMs, from)))
    .get();
  return row?.tokens ?? 0;
}

/** The caller's own forecast. Session only (`plan_limit.own`). */
export function getPlanLimit(
  db: Db,
  actor: ResolvedActor,
  now: number = Date.now(),
): PlanLimitView {
  assertCan(actor, 'plan_limit.own');
  const row = db.select().from(planLimits).where(eq(planLimits.userId, actor.userId)).get();
  const tz = row?.tz ?? 'UTC';
  const rate = arrivedSince(db, actor.userId, now - RATE_WINDOW_MS);

  let start: number;
  let end: number | null;
  if (row === undefined || row.limitWindow === '5h') {
    start = now - FIVE_HOURS_MS;
    end = null;
  } else if (row.limitWindow === 'day') {
    start = startOfDay(tz, now);
    end = addLocalDays(tz, start, 1, 0);
  } else {
    const minute = row.weekResetMinute ?? 0;
    start = lastWeeklyReset(tz, now, row.weekResetDay ?? 0, minute);
    end = addLocalDays(tz, start, 7, minute);
  }
  const used = arrivedSince(db, actor.userId, start);

  const limit = row?.limitTokens ?? null;
  const reached = limit !== null && used >= limit;
  let at: number | null = null;
  if (limit !== null && !reached && rate > 0) {
    const when = now + Math.round(((limit - used) / rate) * 3_600_000);
    at = end !== null && when > end ? null : when;
  }
  return {
    plan: row?.planKind ?? null,
    window: row?.limitWindow ?? null,
    limit_tokens: limit,
    week_reset:
      row?.weekResetDay === null || row?.weekResetDay === undefined
        ? null
        : { weekday: row.weekResetDay, minute: row.weekResetMinute ?? 0 },
    tz,
    used,
    rate_per_hour: rate,
    window_start: row === undefined ? null : start,
    window_end: row === undefined ? null : end,
    reaches_limit_at: at,
    reached,
    estimate: true,
  };
}

/** `PUT /me/plan-limit` — the caller's own. */
export function setPlanLimit(
  db: Db,
  actor: ResolvedActor,
  input: PlanLimitInput,
  now: number = Date.now(),
): PlanLimitView {
  assertCan(actor, 'plan_limit.own');
  if (!isTimeZone(input.tz)) {
    throw new ApiError('unprocessable', 'tz is not a time zone this server knows', {
      reason: 'invalid_tz',
      field: 'tz',
    });
  }
  const weekly = input.window === 'week';
  if (weekly !== (input.week_reset !== undefined)) {
    throw new ApiError(
      'unprocessable',
      weekly
        ? 'A weekly limit needs the day and time it resets'
        : 'Only a weekly limit has a reset',
      { field: 'week_reset' },
    );
  }
  const values = {
    planKind: input.plan,
    limitWindow: input.window,
    limitTokens: input.limit_tokens,
    weekResetDay: input.week_reset?.weekday ?? null,
    weekResetMinute: input.week_reset?.minute ?? null,
    tz: input.tz,
    updatedAt: now,
  };
  db.insert(planLimits)
    .values({ userId: actor.userId, ...values })
    .onConflictDoUpdate({ target: planLimits.userId, set: values })
    .run();
  return getPlanLimit(db, actor, now);
}

/** `DELETE /me/plan-limit` — the caller's own. */
export function clearPlanLimit(db: Db, actor: ResolvedActor): void {
  assertCan(actor, 'plan_limit.own');
  db.delete(planLimits).where(eq(planLimits.userId, actor.userId)).run();
}
