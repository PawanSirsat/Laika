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

/**
 * A look-back report, as SPEC §6.4 states it (D-080, LAI-757): `lookback:
 * true`, days of `{ day, pushed_keys }` only, each key 16 hex, each day once
 * and within today − 400 to today + 1 in `tz`, the same 16 KB.
 */
function lookbackViolation(b: Record<string, unknown>, now: Date): string | undefined {
  for (const key of Object.keys(b)) {
    if (![...TOP_KEYS, 'lookback'].includes(key)) return `unknown field ${key}`;
  }
  if (b.lookback !== true) return 'lookback is not true';
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
  if (!Array.isArray(b.days) || b.days.length < 1) return 'days empty';
  const today = dayIn(b.tz, now);
  const low = shift(today, -400);
  const high = shift(today, 1);
  const seen = new Set<string>();
  for (const entry of b.days as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'a day is not an object';
    const d = entry as Record<string, unknown>;
    for (const key of Object.keys(d)) {
      if (key !== 'day' && key !== 'pushed_keys') return `look-back day field ${key}`;
    }
    if (typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day))
      return 'day not YYYY-MM-DD';
    if (d.day < low || d.day > high) return 'day_out_of_range';
    if (seen.has(d.day)) return 'duplicate day';
    seen.add(d.day);
    if (!Array.isArray(d.pushed_keys) || d.pushed_keys.length < 1) return 'pushed_keys empty';
    for (const k of d.pushed_keys) {
      if (typeof k !== 'string' || !/^[0-9a-f]{16}$/.test(k)) return 'pushed key not 16 hex';
    }
  }
  return undefined;
}

const USAGE_ROW_KEYS = [
  'agent',
  'model',
  'task',
  'input',
  'output',
  'cache_write',
  'cache_read',
  'automated',
];
const SESSION_ROW_KEYS = ['key', 'model', 'input', 'output', 'cache_write', 'cache_read'];
const KEY16 = /^[0-9a-f]{16}$/;

/**
 * A usage report, as SPEC §6.4 states it (D-084, LAI-769): `usage: true`,
 * days of `{ day, rows }`, each row an agent kind, a model id, a Laika key or
 * null and four counts, at most 200 rows a day, each day once and within
 * today − 31 to today + 1 in `tz`, the same 16 KB. LAI-773 (design.md §2):
 * a day may carry `sessions`, at most 100, each a 16-hex key, a model id and
 * the four counts; the report may carry `excluded`, at most 200 16-hex keys.
 * LAI-787: a day may carry `session_tasks`, at most 200 `{ key, task, tokens }`.
 * LAI-315: a day may carry `dispatched`, at most 50 `{ key, task?, from,
 * seconds }`, `seconds` 1–288 whole numbers of 0–300.
 */
function usageViolation(b: Record<string, unknown>, now: Date): string | undefined {
  for (const key of Object.keys(b)) {
    if (![...TOP_KEYS, 'usage', 'excluded'].includes(key)) return `unknown field ${key}`;
  }
  if ('excluded' in b) {
    if (!Array.isArray(b.excluded) || b.excluded.length > 200) return 'excluded invalid';
    for (const k of b.excluded as unknown[]) {
      if (typeof k !== 'string' || !KEY16.test(k)) return 'an excluded key is not 16 hex';
    }
  }
  if (b.usage !== true) return 'usage is not true';
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
  if (!Array.isArray(b.days) || b.days.length < 1 || b.days.length > 33) return 'days not 1–33';
  const today = dayIn(b.tz, now);
  const low = shift(today, -31);
  const high = shift(today, 1);
  const seen = new Set<string>();
  for (const entry of b.days as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'a day is not an object';
    const d = entry as Record<string, unknown>;
    for (const key of Object.keys(d)) {
      if (!['day', 'rows', 'backfill', 'sessions', 'session_tasks', 'dispatched'].includes(key)) {
        return `usage day field ${key}`;
      }
    }
    // LAI-787: `session_tasks`, at most 200, each a 16-hex session key, a
    // task key and the session's headline tokens on it.
    if ('session_tasks' in d) {
      if (!Array.isArray(d.session_tasks) || d.session_tasks.length > 200) {
        return 'session_tasks invalid';
      }
      for (const entry of d.session_tasks as unknown[]) {
        if (typeof entry !== 'object' || entry === null) return 'a session task is not an object';
        const r = entry as Record<string, unknown>;
        for (const key of Object.keys(r)) {
          if (!['key', 'task', 'tokens'].includes(key)) return `unknown session task field ${key}`;
        }
        if (typeof r.key !== 'string' || !KEY16.test(r.key)) return 'session task key not 16 hex';
        if (typeof r.task !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/.test(r.task)) {
          return 'session task is not a key';
        }
        if (!isInt(r.tokens) || r.tokens > 1e12) return 'session task tokens invalid';
      }
    }
    // LAI-315: `dispatched`, at most 50 builders, each a 16-hex session key,
    // a task key or none, a bucket, and its seconds per five minutes.
    if ('dispatched' in d) {
      if (!Array.isArray(d.dispatched) || d.dispatched.length > 50) return 'dispatched invalid';
      for (const entry of d.dispatched as unknown[]) {
        if (typeof entry !== 'object' || entry === null) return 'a dispatched is not an object';
        const r = entry as Record<string, unknown>;
        for (const key of Object.keys(r)) {
          if (!['key', 'task', 'from', 'seconds'].includes(key)) {
            return `unknown dispatched field ${key}`;
          }
        }
        if (typeof r.key !== 'string' || !KEY16.test(r.key)) return 'dispatched key not 16 hex';
        if (
          'task' in r &&
          (typeof r.task !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/.test(r.task))
        ) {
          return 'dispatched task is not a key';
        }
        if (!isInt(r.from)) return 'dispatched from invalid';
        if (!Array.isArray(r.seconds) || r.seconds.length < 1 || r.seconds.length > 288) {
          return 'dispatched seconds invalid';
        }
        for (const n of r.seconds as unknown[]) {
          if (!isInt(n) || n > 300) return 'dispatched seconds invalid';
        }
      }
    }
    if ('sessions' in d) {
      if (!Array.isArray(d.sessions) || d.sessions.length > 100) return 'sessions invalid';
      for (const entry of d.sessions as unknown[]) {
        if (typeof entry !== 'object' || entry === null) return 'a session is not an object';
        const r = entry as Record<string, unknown>;
        for (const key of Object.keys(r)) {
          if (!SESSION_ROW_KEYS.includes(key)) return `unknown session field ${key}`;
        }
        if (typeof r.key !== 'string' || !KEY16.test(r.key)) return 'session key not 16 hex';
        if (typeof r.model !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(r.model)) {
          return 'session model invalid';
        }
        for (const key of ['input', 'output', 'cache_write', 'cache_read']) {
          const n = r[key];
          if (!isInt(n) || n > 1e12) return `session ${key} invalid`;
        }
      }
    }
    if ('backfill' in d && d.backfill !== true) return 'backfill is true or absent';
    if (typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day))
      return 'day not YYYY-MM-DD';
    if (d.day < low || d.day > high) return 'day_out_of_range';
    if (seen.has(d.day)) return 'duplicate day';
    seen.add(d.day);
    if (!Array.isArray(d.rows) || d.rows.length > 200) return 'rows invalid';
    for (const row of d.rows as unknown[]) {
      if (typeof row !== 'object' || row === null) return 'a row is not an object';
      const r = row as Record<string, unknown>;
      for (const key of Object.keys(r)) {
        if (!USAGE_ROW_KEYS.includes(key)) return `unknown row field ${key}`;
      }
      if (typeof r.agent !== 'string' || !/^[a-z0-9-]{1,32}$/.test(r.agent)) return 'agent invalid';
      if (typeof r.model !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(r.model)) {
        return 'model invalid';
      }
      // §6.4: `null`, a Laika key `PREFIX-n`, or an outside id (LAI-780) — a
      // prefix of 1–16 of A–Z, 0–9 and `_` from a letter, and 1–9 digits.
      if (
        r.task !== null &&
        (typeof r.task !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/.test(r.task))
      ) {
        return 'task is not a key, an outside id, or null';
      }
      for (const key of ['input', 'output', 'cache_write', 'cache_read']) {
        const n = r[key];
        if (!isInt(n) || n > 1e12) return `${key} invalid`;
      }
      // D-091: an automated session's row is marked `true`; anything else is refused.
      if ('automated' in r && r.automated !== true) return 'automated is true or absent';
    }
  }
  return undefined;
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
  if ('lookback' in b) return lookbackViolation(b, now);
  if ('usage' in b) return usageViolation(b, now);
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

/**
 * `PUT /api/v1/me/time-drafts`, as LAI-787's contract states it (SPEC §6.4):
 * `{ v: 1, collector_id, tz, days: [{ day, blocks: [{ start, end, minutes,
 * task, signals: { prompts, replies, sessions, commits, marks } }] }] }` —
 * 1 to 15 days, each once and within today − 14 to today + 1 in `tz`; at most
 * 48 blocks a day; a block's start before its end, on the day it names in
 * `tz`, its minutes 1 to ⌈(end − start) / 60 000⌉, a day's minutes at most
 * 1440; every count an integer 0 to 100 000; nothing else, and 16 KB at most.
 * Written from that text, not from the collector.
 */
export function timeDraftViolation(raw: string, now: Date): string | undefined {
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
  if (!Array.isArray(b.days) || b.days.length < 1 || b.days.length > 15) return 'days not 1–15';
  const today = dayIn(b.tz, now);
  const low = shift(today, -14);
  const high = shift(today, 1);
  const seen = new Set<string>();
  for (const entry of b.days as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return 'a day is not an object';
    const d = entry as Record<string, unknown>;
    for (const key of Object.keys(d)) {
      if (key !== 'day' && key !== 'blocks') return `time day field ${key}`;
    }
    if (typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day))
      return 'day not YYYY-MM-DD';
    if (d.day < low || d.day > high) return 'day_out_of_range';
    if (seen.has(d.day)) return 'duplicate day';
    seen.add(d.day);
    if (!Array.isArray(d.blocks) || d.blocks.length > 48) return 'blocks invalid';
    let minutes = 0;
    for (const block of d.blocks as unknown[]) {
      if (typeof block !== 'object' || block === null) return 'a block is not an object';
      const k = block as Record<string, unknown>;
      for (const key of Object.keys(k)) {
        if (!['start', 'end', 'minutes', 'task', 'signals', 'folder', 'branch'].includes(key)) {
          return `unknown block field ${key}`;
        }
      }
      // A work folder's chosen name and its branch (D-098): a name, never a path.
      if (
        k.folder !== undefined &&
        (typeof k.folder !== 'string' ||
          k.folder.length < 1 ||
          k.folder.length > 60 ||
          k.folder.trim() !== k.folder ||
          /[/\\\p{Cc}\p{Cf}]/u.test(k.folder))
      ) {
        return 'folder is not a name';
      }
      if (
        k.branch !== undefined &&
        (k.folder === undefined ||
          typeof k.branch !== 'string' ||
          !/^[A-Za-z0-9._/-]{1,255}$/.test(k.branch))
      ) {
        return 'branch is not a branch name with a folder';
      }
      if (!isInt(k.start) || !isInt(k.end) || k.end <= k.start) return 'start before end';
      if (dayIn(b.tz, new Date(k.start)) !== d.day) return 'a block starts on another day';
      if (!isInt(k.minutes) || k.minutes < 1 || k.minutes > Math.ceil((k.end - k.start) / 60_000)) {
        return 'minutes out of the span';
      }
      minutes += k.minutes;
      if (
        k.task !== null &&
        (typeof k.task !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/.test(k.task))
      ) {
        return 'task is not a key or null';
      }
      if (typeof k.signals !== 'object' || k.signals === null) return 'signals missing';
      const sig = k.signals as Record<string, unknown>;
      for (const key of Object.keys(sig)) {
        if (!['prompts', 'replies', 'sessions', 'commits', 'marks'].includes(key)) {
          return `unknown signal ${key}`;
        }
      }
      for (const key of ['prompts', 'replies', 'sessions', 'commits', 'marks']) {
        const n = sig[key];
        if (!isInt(n) || n > 100_000) return `signal ${key} invalid`;
      }
    }
    if (minutes > 1440) return 'invalid_blocks: more than a day';
  }
  return undefined;
}
