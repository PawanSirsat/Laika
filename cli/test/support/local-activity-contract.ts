/**
 * `PUT /api/v1/me/local-activity`, as `/tmp/laika-activity/CONTRACT.md` states
 * it (LAI-752). The stub boards in these tests refuse anything this refuses,
 * with the contract's 422, so a body the collector gets wrong fails the test
 * that sent it — not only the test that looks.
 *
 * Written from the contract's text, rule by rule, not from the collector's
 * code: it must be able to disagree with the collector.
 */

export const MAX_BODY_BYTES = 16 * 1024;

const TOP_KEYS = ['v', 'collector_id', 'tz', 'days'];
const DAY_KEYS = ['day', 'prompts', 'sessions', 'commits_local', 'pushed_keys'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function dayIn(tz: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shift(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** `undefined` when the body is valid; otherwise the first rule it breaks. */
export function contractViolation(raw: string, now: Date): string | undefined {
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return 'body over 16 KB';
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return 'not JSON';
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'not an object';
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (!TOP_KEYS.includes(key)) return `unknown field ${key}`;
  if (b.v !== 1) return 'v is not 1';
  if (typeof b.collector_id !== 'string' || !UUID_V4.test(b.collector_id)) {
    return 'collector_id is not a UUID v4';
  }
  if (typeof b.tz !== 'string') return 'tz missing';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: b.tz });
  } catch {
    return 'tz is not an IANA zone';
  }
  if (!Array.isArray(b.days) || b.days.length < 1 || b.days.length > 14) return 'days not 1–14';

  const today = dayIn(b.tz, now);
  const low = shift(today, -14);
  const high = shift(today, 1);
  const seen = new Set<string>();
  for (const entry of b.days as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'a day is not an object';
    const d = entry as Record<string, unknown>;
    for (const key of Object.keys(d))
      if (!DAY_KEYS.includes(key)) return `unknown day field ${key}`;
    if (typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day))
      return 'day not YYYY-MM-DD';
    if (d.day < low || d.day > high) return 'day_out_of_range';
    if (seen.has(d.day)) return 'duplicate day';
    seen.add(d.day);
    if (typeof d.prompts !== 'object' || d.prompts === null || Array.isArray(d.prompts)) {
      return 'prompts not an object';
    }
    for (const n of Object.values(d.prompts)) {
      if (!isInt(n) || n > 5000) return 'prompts count invalid';
    }
    if (!isInt(d.sessions) || d.sessions > 500) return 'sessions invalid';
    if (!isInt(d.commits_local) || d.commits_local > 2000) return 'commits_local invalid';
    if (!Array.isArray(d.pushed_keys) || d.pushed_keys.length > 2000) return 'pushed_keys invalid';
    for (const k of d.pushed_keys) {
      if (typeof k !== 'string' || !/^[0-9a-f]{16}$/.test(k)) return 'pushed key not 16 hex';
    }
  }
  return undefined;
}
