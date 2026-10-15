import { appendFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { normaliseUrl } from './api.ts';
import {
  buildSnapshot,
  gitRunner,
  machineTimeZone,
  type GitRunner,
  type PendingKey,
  type Snapshot,
} from './activity-census.ts';
import {
  DAY_S,
  acquireLock,
  activityPaths,
  clampInterval,
  collectorId,
  ensureDir,
  readEmails,
  readState,
  readText,
  recordError,
  rotate,
  writeFile600,
  writeState,
  type ActivityPaths,
  type ActivityState,
  type LastResult,
  type Scope,
} from './activity-store.ts';
import { readSettings } from './config.ts';
import { readEnvFile } from './whoami.ts';

/**
 * `laika activity sync` — send the snapshot, on the board's schedule (LAI-752).
 *
 * ## The contract's rules, and where each lives
 *
 * - **Never more often than `min_sync_interval_s`**: `next_sync_at` in
 *   `state.json`. Every outcome moves it forward — a success by the interval,
 *   a 429 by `Retry-After`, a failure by a doubling backoff capped at a day.
 * - **403 `local_activity_off`**: stop, clear the local log, recheck in 24 h.
 * - **The switch is re-read at most once a day** (GET /me/activity-sharing),
 *   and that answer is what the hooks obey through `"collect"`.
 * - **5 s timeout** on both calls.
 * - **One at a time**: a lock file, so two hooks firing together cannot both
 *   send.
 * - **Errors go to `last-error`** and nowhere else when run from a hook.
 */

export const REQUEST_TIMEOUT_MS = 5_000;
/**
 * A sync that has not finished in this long is abandoned: its git children are
 * killed, its requests aborted, and a CLI run exits. A repo on a network mount
 * that has gone away is the case — without it, each session start left one
 * more process waiting on the mount.
 */
export const SYNC_DEADLINE_MS = 120_000;
/** Events older than this are dropped from the log after a successful send. */
const EVENTS_KEEP_S = 15 * DAY_S;
/** Failures back off, doubling from the interval, to at most this. */
export const MAX_BACKOFF_S = 6 * 3600;

export interface SyncContext {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowMs: () => number;
  readonly tz: string;
  readonly git?: GitRunner;
  /** Overrides {@link SYNC_DEADLINE_MS} — for tests. */
  readonly deadlineMs?: number;
}

export function defaultContext(home: string): SyncContext {
  return { home, env: process.env, nowMs: () => Date.now(), tz: machineTimeZone() };
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

export interface Credentials {
  readonly url: string;
  readonly token: string;
}

/**
 * The same order `laika whoami` reads them in: the environment, then
 * `laika init`'s `~/.claude/settings.json`, then `~/.laika/env`. A detached
 * sync started by a hook inherits whatever the agent had.
 */
export function findCredentials(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): Credentials | undefined {
  let settings: Record<string, string> | undefined;
  try {
    settings = readSettings(join(home, '.claude', 'settings.json')).env;
  } catch {
    settings = undefined;
  }
  const installed = readEnvFile(join(home, '.laika', 'env'));
  const pick = (key: string): string | undefined => {
    for (const value of [env[key], settings?.[key], installed[key]]) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return undefined;
  };
  const url = pick('LAIKA_URL');
  const token = pick('LAIKA_TOKEN');
  if (url === undefined || token === undefined) return undefined;
  return { url: normaliseUrl(url), token };
}

/**
 * The token for the board activity was turned on for, and for no other.
 *
 * `~/.laika/env` first — the file `install.sh` and `laika connect` write, and
 * the one a hook-launched sync can always read — then `laika init`'s
 * `~/.claude/settings.json`, then the environment; from each, only when its
 * `LAIKA_URL` is that board.
 */
export function credentialsFor(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  board: string,
): Credentials | undefined {
  let settings: Record<string, string> = {};
  try {
    settings = readSettings(join(home, '.claude', 'settings.json')).env ?? {};
  } catch {
    settings = {};
  }
  const sources: readonly Readonly<Record<string, string | undefined>>[] = [
    readEnvFile(join(home, '.laika', 'env')),
    settings,
    env,
  ];
  for (const source of sources) {
    const url = source.LAIKA_URL?.trim();
    const token = source.LAIKA_TOKEN?.trim();
    if (url !== undefined && token !== undefined && token !== '' && normaliseUrl(url) === board) {
      return { url: board, token };
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* The two calls                                                              */
/* -------------------------------------------------------------------------- */

export interface Sharing {
  readonly org_enabled: boolean;
  readonly enabled: boolean;
  readonly scope: Scope;
  readonly min_sync_interval_s: number;
}

export type Call<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly code?: string;
      readonly retryAfterS?: number;
      readonly message: string;
    };

async function request(
  creds: Credentials,
  method: 'GET' | 'PUT',
  path: string,
  body?: string,
  abort?: AbortSignal,
): Promise<Response | { readonly error: string }> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${creds.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      signal: abort === undefined ? timeout : AbortSignal.any([timeout, abort]),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    return {
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? `no answer within ${String(REQUEST_TIMEOUT_MS / 1000)} s`
          : `could not reach the board (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown; error?: { code?: unknown } };
    if (typeof body.code === 'string') return body.code;
    if (typeof body.error?.code === 'string') return body.error.code;
  } catch {
    // No JSON body — the status alone has to do.
  }
  return undefined;
}

/** `Retry-After` in seconds, either form RFC 9110 allows. */
export function retryAfterSeconds(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

async function failed<T>(response: Response, nowMs: number): Promise<Call<T>> {
  const code = await errorCode(response);
  const retryAfterS = retryAfterSeconds(response.headers.get('retry-after'), nowMs);
  return {
    ok: false,
    status: response.status,
    ...(code === undefined ? {} : { code }),
    ...(retryAfterS === undefined ? {} : { retryAfterS }),
    message: `the board answered ${String(response.status)}${code === undefined ? '' : ` ${code}`}`,
  };
}

export async function getSharing(
  creds: Credentials,
  nowMs: number,
  abort?: AbortSignal,
): Promise<Call<Sharing>> {
  const response = await request(creds, 'GET', '/api/v1/me/activity-sharing', undefined, abort);
  if ('error' in response) return { ok: false, message: response.error };
  if (!response.ok) return failed(response, nowMs);
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean' || typeof body.org_enabled !== 'boolean') {
      return { ok: false, status: response.status, message: 'the answer was not activity sharing' };
    }
    return {
      ok: true,
      value: {
        org_enabled: body.org_enabled,
        enabled: body.enabled,
        scope: body.scope === 'laika-repos' ? 'laika-repos' : 'agent-repos',
        min_sync_interval_s: clampInterval(body.min_sync_interval_s),
      },
    };
  } catch {
    return { ok: false, status: response.status, message: 'the answer was not JSON' };
  }
}

export async function putActivity(
  creds: Credentials,
  body: string,
  nowMs: number,
  abort?: AbortSignal,
): Promise<Call<{ readonly accepted_days: number }>> {
  const response = await request(creds, 'PUT', '/api/v1/me/local-activity', body, abort);
  if ('error' in response) return { ok: false, message: response.error };
  if (!response.ok) return failed(response, nowMs);
  let accepted = 0;
  try {
    const answer = (await response.json()) as { accepted_days?: unknown };
    if (typeof answer.accepted_days === 'number') accepted = answer.accepted_days;
  } catch {
    // A 200 is a 200; the count is only reported.
  }
  return { ok: true, value: { accepted_days: accepted } };
}

/* -------------------------------------------------------------------------- */
/* The local side of a successful send                                        */
/* -------------------------------------------------------------------------- */

/** Remember the keys the board accepted, dropping ones past the window. */
function rememberKeys(paths: ActivityPaths, keys: readonly PendingKey[], nowS: number): void {
  const lines = new Map<string, string>();
  for (const line of (readText(paths.sentKeys) ?? '').split('\n')) {
    const [key, identity, at] = line.split(' ');
    if (key === undefined || identity === undefined || at === undefined) continue;
    if (nowS - Number(at) > EVENTS_KEEP_S) continue;
    lines.set(key, line);
  }
  for (const k of keys) lines.set(k.key, `${k.key} ${k.identity} ${String(k.at)}`);
  writeFile600(paths.sentKeys, [...lines.values()].map((l) => `${l}\n`).join(''));
}

/**
 * Keep the last 15 days of the event log.
 *
 * The log is **moved aside first**, so a hook appending meanwhile starts a new
 * `events.log` rather than writing into a file about to be replaced. The kept
 * lines are then appended back in one write. A crash between the two leaves
 * `events.log.compacting`, which the next count reads too and the next
 * compaction finishes.
 */
export function compactEvents(paths: ActivityPaths, nowS: number): void {
  if (existsSync(paths.events)) {
    if (existsSync(paths.eventsCompacting)) {
      appendFileSync(paths.eventsCompacting, readText(paths.events) ?? '', { mode: 0o600 });
      rmSync(paths.events, { force: true });
    } else {
      renameSync(paths.events, paths.eventsCompacting);
    }
  }
  const old = readText(paths.eventsCompacting);
  if (old === undefined) return;
  const kept = old.split('\n').filter((line) => {
    const at = Number(line.split(' ')[2]);
    return Number.isFinite(at) && nowS - at <= EVENTS_KEEP_S;
  });
  if (kept.length > 0) {
    appendFileSync(paths.events, `${kept.join('\n')}\n`, { mode: 0o600 });
  }
  rmSync(paths.eventsCompacting, { force: true });
}

/* -------------------------------------------------------------------------- */
/* The sync                                                                   */
/* -------------------------------------------------------------------------- */

export type SyncOutcome =
  | { readonly kind: 'not-on' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'not-due'; readonly nextAt: number }
  | { readonly kind: 'off'; readonly recheckAt: number }
  | { readonly kind: 'sent'; readonly acceptedDays: number; readonly deferredKeys: number }
  | { readonly kind: 'rate-limited'; readonly nextAt: number }
  | { readonly kind: 'refused'; readonly message: string }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly nextAt: number;
      /** The overall deadline ended it; a CLI run should exit rather than wait. */
      readonly deadline?: true;
    };

/** Turn collection off locally: what both 403 and a "not enabled" answer mean. */
function stopCollecting(
  paths: ActivityPaths,
  state: ActivityState,
  nowS: number,
  sharing?: Sharing,
): ActivityState {
  rotate(paths);
  return {
    ...state,
    ...(sharing === undefined
      ? { enabled: false }
      : {
          org_enabled: sharing.org_enabled,
          enabled: sharing.enabled,
          scope: sharing.scope,
          min_sync_interval_s: sharing.min_sync_interval_s,
        }),
    collect: false,
    checked_at: nowS,
    next_sync_at: nowS + DAY_S,
    failures: 0,
    last_result: { at: nowS, outcome: 'off' },
  };
}

export function backoff(state: ActivityState, nowS: number, result: LastResult): ActivityState {
  const failures = state.failures + 1;
  const delay = Math.min(state.min_sync_interval_s * 2 ** (failures - 1), MAX_BACKOFF_S);
  return { ...state, failures, next_sync_at: nowS + delay, last_result: result };
}

/** Record why, and push the next attempt out by the backoff. */
function failed_(
  paths: ActivityPaths,
  nowS: number,
  message: string,
  status?: number,
): { readonly message: string; readonly nextAt: number } {
  recordError(paths, nowS, message);
  const state = readState(paths);
  if (state === undefined) return { message, nextAt: nowS };
  const next = backoff(state, nowS, {
    at: nowS,
    outcome: 'error',
    ...(status === undefined ? {} : { status }),
  });
  writeState(paths, next);
  return { message, nextAt: next.next_sync_at };
}

class Abandoned extends Error {}

/**
 * Send the snapshot, if one is due — one sync at a time, and never for longer
 * than the deadline.
 */
export async function sync(ctx: SyncContext): Promise<SyncOutcome> {
  const paths = activityPathsFor(ctx);
  if (readState(paths) === undefined) return { kind: 'not-on' };

  const release = acquireLock(paths);
  if (release === undefined) return { kind: 'busy' };

  const controller = new AbortController();
  const deadlineMs = ctx.deadlineMs ?? SYNC_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SyncOutcome>((done) => {
    timer = setTimeout(() => {
      controller.abort();
      const nowS = Math.floor(ctx.nowMs() / 1000);
      const f = failed_(
        paths,
        nowS,
        `the sync did not finish within ${String(deadlineMs / 1000)} s and was abandoned`,
      );
      done({ kind: 'error', ...f, deadline: true });
    }, deadlineMs);
  });
  try {
    return await Promise.race([syncLocked(ctx, paths, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    release();
  }
}

async function syncLocked(
  ctx: SyncContext,
  paths: ActivityPaths,
  signal: AbortSignal,
): Promise<SyncOutcome> {
  // Re-read under the lock: another sync may have just finished.
  let state = readState(paths);
  if (state === undefined) return { kind: 'not-on' };
  const nowS = Math.floor(ctx.nowMs() / 1000);
  if (nowS < state.next_sync_at) return { kind: 'not-due', nextAt: state.next_sync_at };

  // Once the deadline has answered, this run writes nothing more.
  const save = (next: ActivityState): void => {
    if (signal.aborted) throw new Abandoned();
    writeState(paths, next);
  };
  const fail = (message: string, status?: number): SyncOutcome => ({
    kind: 'error',
    ...failed_(paths, nowS, message, status),
  });

  try {
    // Claimed before any work, so a sync that hangs or dies still holds the
    // next launch off for an interval: session hooks cannot pile them up.
    state = { ...state, next_sync_at: nowS + state.min_sync_interval_s };
    save(state);

    // --- which board ---------------------------------------------------------
    const board = state.board;
    if (board === undefined) {
      return fail('activity was set up by an older laika — run `laika activity on` again');
    }
    const live = ctx.env.LAIKA_URL?.trim();
    if (live !== undefined && live !== '' && normaliseUrl(live) !== board) {
      const message = `this session points at ${normaliseUrl(live)}, but local activity is set up for ${board} — nothing sent`;
      recordError(paths, nowS, message);
      save({ ...state, last_result: { at: nowS, outcome: 'refused' } });
      return { kind: 'refused', message };
    }
    const creds = credentialsFor(ctx.home, ctx.env, board);
    if (creds === undefined) {
      return fail(`no token for ${board} in ~/.laika/env — run laika connect`);
    }

    // --- the switch and the scope, every time -----------------------------------
    // Cheap, and the only way a narrowed scope or a switch turned off takes
    // effect on the very next sync rather than a day later.
    const sharing = await getSharing(creds, ctx.nowMs(), signal);
    if (!sharing.ok) {
      return fail(`checking whether sharing is on: ${sharing.message}`, sharing.status);
    }
    if (!(sharing.value.org_enabled && sharing.value.enabled)) {
      save(stopCollecting(paths, state, nowS, sharing.value));
      return { kind: 'off', recheckAt: nowS + DAY_S };
    }
    state = {
      ...state,
      org_enabled: true,
      enabled: true,
      scope: sharing.value.scope,
      min_sync_interval_s: sharing.value.min_sync_interval_s,
      checked_at: nowS,
      next_sync_at: nowS + sharing.value.min_sync_interval_s,
      // Back on after being off: count from now, as a new collector.
      ...(state.collect ? {} : { collect: true, since: nowS }),
    };
    save(state);

    // --- the snapshot ---------------------------------------------------------
    const snapshot: Snapshot = await buildSnapshot({
      paths,
      state,
      collectorId: collectorId(paths),
      tz: ctx.tz,
      nowS,
      extraEmails: readEmails(paths),
      git: ctx.git ?? gitRunner(ctx.env, signal),
    });
    if (signal.aborted) throw new Abandoned();
    writeFile600(paths.repos, snapshot.prunedRepos);

    const answer = await putActivity(creds, JSON.stringify(snapshot.body), ctx.nowMs(), signal);
    if (answer.ok) {
      if (signal.aborted) throw new Abandoned();
      rememberKeys(paths, snapshot.sentKeys, nowS);
      compactEvents(paths, nowS);
      rmSync(paths.lastError, { force: true });
      save({
        ...state,
        failures: 0,
        next_sync_at: nowS + state.min_sync_interval_s,
        last_result: { at: nowS, outcome: 'sent', accepted_days: answer.value.accepted_days },
      });
      return {
        kind: 'sent',
        acceptedDays: answer.value.accepted_days,
        deferredKeys: snapshot.deferredKeys,
      };
    }

    if (answer.status === 403 && answer.code === 'local_activity_off') {
      save(stopCollecting(paths, state, nowS));
      return { kind: 'off', recheckAt: nowS + DAY_S };
    }

    if (answer.status === 429) {
      const wait = Math.max(answer.retryAfterS ?? 0, state.min_sync_interval_s);
      save({
        ...state,
        next_sync_at: nowS + wait,
        last_result: { at: nowS, outcome: 'rate_limited', status: 429 },
      });
      return { kind: 'rate-limited', nextAt: nowS + wait };
    }

    return fail(answer.message, answer.status);
  } catch (cause) {
    // The deadline has already recorded this run and answered for it.
    if (signal.aborted || cause instanceof Abandoned) {
      return { kind: 'error', message: 'abandoned', nextAt: nowS, deadline: true };
    }
    // Anything else — a census that throws, a full disk — backs off like any
    // failure, so it is not retried on every session event.
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * What `status` shows: the switch and scope as the board says now, if it can be
 * asked — the same answer the next sync would act on.
 */
export async function currentSharing(ctx: SyncContext): Promise<Sharing | undefined> {
  const state = readState(activityPathsFor(ctx));
  if (state?.board === undefined) return undefined;
  const creds = credentialsFor(ctx.home, ctx.env, state.board);
  if (creds === undefined) return undefined;
  const answer = await getSharing(creds, ctx.nowMs());
  return answer.ok ? answer.value : undefined;
}

/** The snapshot `sync` would send now — for `status`. Writes nothing. */
export async function previewSnapshot(
  ctx: SyncContext,
  scope?: Scope,
): Promise<Snapshot | undefined> {
  const paths = activityPathsFor(ctx);
  const state = readState(paths);
  if (state?.collect !== true) return undefined;
  const existing = readText(paths.collectorId)?.trim();
  return buildSnapshot({
    paths,
    state: scope === undefined ? state : { ...state, scope },
    collectorId: existing !== undefined && existing !== '' ? existing : '(created on first sync)',
    tz: ctx.tz,
    nowS: Math.floor(ctx.nowMs() / 1000),
    extraEmails: readEmails(paths),
    git: ctx.git ?? gitRunner(ctx.env),
  });
}

/**
 * Start collecting for `board`: the directory, the id and the first state. Only
 * called once that board has said sharing is on. Pointing it at a different
 * board starts over — what was counted for one board is not sent to another.
 */
export function startCollecting(
  paths: ActivityPaths,
  sharing: Sharing,
  nowS: number,
  board: string,
): void {
  ensureDir(paths);
  let previous = readState(paths);
  if (previous?.board !== undefined && previous.board !== board) {
    rotate(paths);
    previous = undefined;
  }
  collectorId(paths);
  writeState(paths, {
    collect: true,
    // The first session start sends; nothing is due before that.
    next_sync_at: previous?.collect === true ? previous.next_sync_at : 0,
    org_enabled: sharing.org_enabled,
    enabled: sharing.enabled,
    scope: sharing.scope,
    min_sync_interval_s: sharing.min_sync_interval_s,
    since: previous?.collect === true ? previous.since : nowS,
    checked_at: nowS,
    failures: 0,
    board,
    ...(previous?.last_result === undefined ? {} : { last_result: previous.last_result }),
  });
}

function activityPathsFor(ctx: SyncContext): ActivityPaths {
  return activityPaths(ctx.home);
}
