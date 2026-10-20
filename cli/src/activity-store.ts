import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { writePrivately } from './connect.ts';

/**
 * Everything `laika activity` keeps on this machine (LAI-752, D-079).
 *
 * One directory, `~/.laika/activity`, 0700, and every file in it 0600. Nothing
 * here is sent as it is: the sync reads it and sends per-day **counts** and
 * one-way commit keys. Repo paths, emails and the event log stay here.
 *
 * | file | what | written by |
 * | --- | --- | --- |
 * | `state.json` | the cached switch, the sync schedule, the last result | sync, `on` |
 * | `events.log` | `p <agent> <epoch>` / `s <agent> <epoch>` lines; `t`/`w`/`r omnigent <epoch> <session>` — an Omnigent orchestrator's turn started by the person, started by Omnigent (D-090), ending (LAI-792) | the hooks |
 * | `repos` | `<epoch>\t<toplevel>` — repos an agent session started in | session-start hook |
 * | `emails` | extra author emails, one per line | `laika activity emails` |
 * | `collector-id` | a random UUID v4, nothing derived from the machine | sync, `on` |
 * | `sent-keys` | `<key> <identity> <author epoch>` — keys the board accepted | sync |
 * | `last-error` | the last thing that went wrong, one line | sync |
 * | `usage-index.json` | token usage: what was read where, and what the board holds (LAI-769) | sync |
 * | `usage-data.json` | token usage: where each file was read to, each Laika mark's task key, Codex's and Gemini CLI's records, each day's counts as last made (LAI-769, LAI-770, LAI-776) | sync |
 * | `usage-days/<day>.json` | token usage: Claude Code's replies of that local day — counts, model, time, directory and session, by message id (LAI-776) | sync |
 * | `sessions` | `<epoch> <session id> <branch>` — a counted session's start (LAI-770) | session-start hook |
 * | `skip-sessions` | `<epoch> <session id>` — sessions nobody was typing in (LAI-775) | the hooks |
 * | `primary-sessions` | `<epoch> <session id>` — an orchestrator's primary, counted as the person's (D-088 item 9; an Omnigent orchestrator's own session, LAI-792) | session-start hook |
 * | `time-drafts.json` | time drafts: each day's blocks as the board last took them, as a signature (LAI-787) | sync |
 *
 * `sent-keys` holds hashes only: the contract's key, and a hash of (author
 * email, author time) used to recognise an amended or rebased commit. Never an
 * email or a SHA (the contract's "never stored").
 */

export type Scope = 'agent-repos' | 'laika-repos';

export interface LastResult {
  readonly at: number;
  readonly outcome: 'sent' | 'off' | 'rate_limited' | 'refused' | 'error';
  readonly accepted_days?: number;
  /** HTTP status, when there was one. */
  readonly status?: number;
}

/**
 * The cached switch and the schedule. **`collect` is the first key**, and the
 * whole file is one line: the hook reads it with the `read` builtin and looks
 * for `"collect":true` and `"next_sync_at":` without forking.
 */
export interface ActivityState {
  readonly collect: boolean;
  /** Epoch seconds. The hook launches a sync once this has passed. */
  readonly next_sync_at: number;
  readonly org_enabled: boolean;
  readonly enabled: boolean;
  readonly scope: Scope;
  readonly min_sync_interval_s: number;
  /**
   * Epoch seconds when this collector started counting. Prompts, sessions and
   * unpushed commits before it are not this collector's to report: a new
   * collector id starts whenever local history is discarded, so two ids can
   * never both count the same local work (see `rotate`).
   */
  readonly since: number;
  /** Last successful GET /me/activity-sharing, epoch seconds. */
  readonly checked_at: number;
  /** Consecutive failed syncs, for the backoff. */
  readonly failures: number;
  /**
   * Whether the board last said time drafting is on — the organisation's Time
   * setting at `drafts` and the person's own *Draft my time* (D-088 item 5,
   * LAI-787) — and when it was asked. Absent until it has been.
   */
  readonly drafting?: boolean;
  readonly drafting_checked_at?: number;
  /**
   * The board `laika activity on` was pointed at. Every sync goes there, with
   * that board's token, and to no other: a session whose environment names
   * another board neither sends this machine's counts to it nor lets that
   * board's 403 wipe them.
   */
  readonly board?: string;
  readonly last_result?: LastResult;
}

export interface ActivityPaths {
  readonly dir: string;
  readonly state: string;
  readonly events: string;
  /** Where `events.log` is moved while it is being compacted. */
  readonly eventsCompacting: string;
  readonly repos: string;
  readonly emails: string;
  readonly collectorId: string;
  readonly sentKeys: string;
  readonly lastError: string;
  readonly lock: string;
}

export function activityPaths(home: string): ActivityPaths {
  const dir = join(home, '.laika', 'activity');
  return {
    dir,
    state: join(dir, 'state.json'),
    events: join(dir, 'events.log'),
    eventsCompacting: join(dir, 'events.log.compacting'),
    repos: join(dir, 'repos'),
    emails: join(dir, 'emails'),
    collectorId: join(dir, 'collector-id'),
    sentKeys: join(dir, 'sent-keys'),
    lastError: join(dir, 'last-error'),
    lock: join(dir, 'sync.lock'),
  };
}

/** The server's default when it has not said: ten minutes. */
export const DEFAULT_MIN_SYNC_INTERVAL_S = 600;
/** Never more often than this, whatever a response claims. */
const FLOOR_MIN_SYNC_INTERVAL_S = 60;
export const DAY_S = 86_400;

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Create the directory 0700, narrowing it if it already exists. */
export function ensureDir(paths: ActivityPaths): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  chmodSync(paths.dir, 0o700);
}

/** Atomic, 0600: a temp file and a rename, so no reader sees half a file. */
export function writeFile600(path: string, content: string): void {
  writePrivately(path, content);
}

const isScope = (value: unknown): value is Scope =>
  value === 'agent-repos' || value === 'laika-repos';

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

export function clampInterval(value: unknown): number {
  return Math.max(FLOOR_MIN_SYNC_INTERVAL_S, num(value, DEFAULT_MIN_SYNC_INTERVAL_S));
}

/** `undefined` when activity has never been turned on here (or was turned off). */
export function readState(paths: ActivityPaths): ActivityState | undefined {
  const raw = readText(paths.state);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const s = parsed as Record<string, unknown>;
  const last = s.last_result as LastResult | undefined;
  return {
    collect: s.collect === true,
    next_sync_at: num(s.next_sync_at, 0),
    org_enabled: s.org_enabled === true,
    enabled: s.enabled === true,
    scope: isScope(s.scope) ? s.scope : 'agent-repos',
    min_sync_interval_s: clampInterval(s.min_sync_interval_s),
    since: num(s.since, 0),
    checked_at: num(s.checked_at, 0),
    failures: num(s.failures, 0),
    ...(typeof s.drafting === 'boolean' ? { drafting: s.drafting } : {}),
    ...(typeof s.drafting_checked_at === 'number'
      ? { drafting_checked_at: num(s.drafting_checked_at, 0) }
      : {}),
    ...(typeof s.board === 'string' && s.board !== '' ? { board: s.board } : {}),
    ...(typeof last === 'object' && last !== null ? { last_result: last } : {}),
  };
}

/** One line, `collect` first — see {@link ActivityState}. */
export function writeState(paths: ActivityPaths, state: ActivityState): void {
  const ordered: ActivityState = {
    collect: state.collect,
    next_sync_at: state.next_sync_at,
    org_enabled: state.org_enabled,
    enabled: state.enabled,
    scope: state.scope,
    min_sync_interval_s: state.min_sync_interval_s,
    since: state.since,
    checked_at: state.checked_at,
    failures: state.failures,
    ...(state.drafting === undefined ? {} : { drafting: state.drafting }),
    ...(state.drafting_checked_at === undefined
      ? {}
      : { drafting_checked_at: state.drafting_checked_at }),
    ...(state.board === undefined ? {} : { board: state.board }),
    ...(state.last_result === undefined ? {} : { last_result: state.last_result }),
  };
  writeFile600(paths.state, `${JSON.stringify(ordered)}\n`);
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** This machine's collector id, created on first use. Random; nothing derived. */
export function collectorId(paths: ActivityPaths): string {
  const existing = readText(paths.collectorId)?.trim();
  if (existing !== undefined && UUID_V4.test(existing)) return existing;
  const id = randomUUID();
  writeFile600(paths.collectorId, `${id}\n`);
  return id;
}

/**
 * Discard local history and start a new collector.
 *
 * Called when sharing turns out to be off (403 `local_activity_off`, or the
 * daily check). The log is cleared because the developer said stop; the id is
 * replaced so that, if they turn it back on the same day, the new snapshots
 * cannot overwrite what the old collector already reported for that day.
 */
export function rotate(paths: ActivityPaths): void {
  for (const path of [
    paths.events,
    paths.eventsCompacting,
    paths.sentKeys,
    paths.collectorId,
    // Token usage (D-084, LAI-769): what was read, and the answer to counting
    // the last 30 days — a new collector counts from its own start.
    join(paths.dir, 'usage-index.json'),
    join(paths.dir, 'usage-data.json'),
    join(paths.dir, 'usage-days'),
    // A counted session's id and branch (LAI-770): kept under the consent
    // that is ending. `skip-sessions` stays — it names sessions that were
    // never the developer's, whichever collector reads them.
    join(paths.dir, 'sessions'),
    join(paths.dir, 'sessions.compacting'),
    // Time drafts (LAI-787): what the board last took, and the orchestrator
    // primary sessions counted as the person's — kept under the same consent.
    join(paths.dir, 'time-drafts.json'),
    join(paths.dir, 'primary-sessions'),
  ]) {
    rmSync(path, { recursive: true, force: true });
  }
}

export function readEmails(paths: ActivityPaths): string[] {
  return (readText(paths.emails) ?? '')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function writeEmails(paths: ActivityPaths, emails: readonly string[]): void {
  writeFile600(paths.emails, emails.length === 0 ? '' : `${emails.join('\n')}\n`);
}

/** The last thing that went wrong, for `status`. Never printed by a background sync. */
export function recordError(paths: ActivityPaths, nowS: number, message: string): void {
  try {
    writeFile600(
      paths.lastError,
      `${new Date(nowS * 1000).toISOString()} ${message.replace(/\s+/g, ' ')}\n`,
    );
  } catch {
    // Nowhere left to say it. The sync's own result still carries `error`.
  }
}

/* -------------------------------------------------------------------------- */
/* The lock                                                                   */
/* -------------------------------------------------------------------------- */

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * When a process started, as `ps` prints it — to tell the lock's holder from an
 * unrelated process that was later given the same pid. `''` when `ps` cannot
 * say, which is then treated as "the same process" (the safe side: busy).
 *
 * **Always in UTC and the C locale.** `lstart` is printed in the caller's zone
 * and language, and the holder and the checker are started by different
 * agents with different environments: an agent run with another `TZ` once
 * looked like a reused pid and lost its lock to a second sync.
 */
function processStart(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
  } catch {
    return '';
  }
}

interface Holder {
  readonly pid: number;
  readonly start: string;
}

function readHolder(raw: string | undefined): Holder | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<Holder>;
    if (typeof parsed.pid === 'number') return { pid: parsed.pid, start: parsed.start ?? '' };
  } catch {
    // An older or torn lock file: its first word is the pid, if anything.
  }
  const pid = Number(raw.trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? { pid, start: '' } : undefined;
}

/**
 * Take the sync lock, or say it is held.
 *
 * **A live holder keeps it, however long it has held it.** A sync stuck on a
 * dead network mount is still a sync; taking its lock would start a second one,
 * and a third five minutes later — the pile-up this replaced. The sync's own
 * deadline is what ends a stuck one. Only a lock whose process is gone, or
 * whose pid now belongs to a process that started at another time (the pid was
 * reused), is broken and retaken.
 *
 * `wx` is the atomic part: two syncs started in the same instant cannot both
 * create the file. Release removes the file only while it is still ours.
 */
export function acquireLock(paths: ActivityPaths): (() => void) | undefined {
  const mine = JSON.stringify({ pid: process.pid, start: processStart(process.pid) });
  const release = (): void => {
    if (readText(paths.lock)?.trim() === mine) rmSync(paths.lock, { force: true });
  };
  const take = (): (() => void) | undefined => {
    let fd: number;
    try {
      fd = openSync(paths.lock, 'wx', 0o600);
    } catch {
      return undefined;
    }
    writeSync(fd, `${mine}\n`);
    closeSync(fd);
    return release;
  };

  const first = take();
  if (first !== undefined) return first;

  const holder = readHolder(readText(paths.lock));
  if (holder !== undefined && pidAlive(holder.pid)) {
    const now = holder.start === '' ? '' : processStart(holder.pid);
    if (holder.start === '' || now === '' || now === holder.start) return undefined;
  }
  rmSync(paths.lock, { force: true });
  const second = take();
  // Two syncs may have broken the same dead lock at once; the file says who won.
  return second !== undefined && readText(paths.lock)?.trim() === mine ? second : undefined;
}

export function activityOn(paths: ActivityPaths): boolean {
  return existsSync(paths.state);
}
