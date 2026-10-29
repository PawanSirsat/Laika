import type { TaskLiveClaim } from './tasks.ts';

/**
 * **When each copy of a live claim reached this page** (LAI-597 review), on
 * the page's monotonic clock.
 *
 * A claim is aged as the server's `heartbeat_age_ms` plus the time elapsed
 * here since it arrived. That arrival has to be the **response's**, not the
 * first time a screen happened to draw it: a card whose Agent field is hidden
 * draws no state, and stamping it when the field is shown again would restart
 * its age from zero — *Working* ninety-five seconds after its heartbeat. So
 * the request client stamps every claim in a payload as it is parsed
 * ({@link stampClaims}), whether or not anything ever shows it.
 *
 * Keyed by object: a re-read brings new objects and new stamps, and the shared
 * GET cache hands the same objects back, so a cached answer keeps the age it
 * has really had.
 */
const RECEIVED = new WeakMap<object, number>();

/** The page's monotonic clock — never the wall clock. */
export function pageClock(): number {
  return performance.now();
}

/** A served `TaskLiveClaimView`: the fields only a live claim carries. */
function isLiveClaim(value: Record<string, unknown>): boolean {
  return (
    typeof value.suspect_after_ms === 'number' &&
    typeof value.session_id === 'string' &&
    typeof value.last_heartbeat_at === 'number'
  );
}

/**
 * How deep a claim can sit in a response: a list page's `data`, a row, its
 * `claim` — with room for one wrapper (`{ task, claim }`). Bounded so a large
 * unrelated payload is not walked to its leaves.
 */
const MAX_DEPTH = 5;

/** Stamp every live claim in a parsed response with `now`. Called by the request client. */
export function stampClaims(payload: unknown, now: number = pageClock()): void {
  visit(payload, now, 0);
}

function visit(value: unknown, now: number, depth: number): void {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item, now, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (isLiveClaim(record)) {
    if (!RECEIVED.has(record)) RECEIVED.set(record, now);
    return;
  }
  for (const key of Object.keys(record)) visit(record[key], now, depth + 1);
}

/**
 * When this copy arrived, or `undefined` for one that never came through the
 * request client — built by hand, as a test or a fixture does. Never stamped
 * here: reading is not receiving.
 */
export function receivedAt(claim: TaskLiveClaim): number | undefined {
  return RECEIVED.get(claim);
}
