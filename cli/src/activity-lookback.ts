import { join } from 'node:path';

import {
  LOOKBACK_DAYS_MAX,
  MAX_BODY_BYTES,
  commonGitDir,
  countLookback,
  rememberedRepos,
  reposInScope,
  windowDays,
  type GitRunner,
  type LookbackCensus,
  type LookbackRepo,
} from './activity-census.ts';
import {
  DAY_S,
  readText,
  recordError,
  writeFile600,
  type ActivityPaths,
  type ActivityState,
} from './activity-store.ts';

/**
 * The look-back (LAI-757, D-080): the developer's own pushed commits of the
 * last year, sent once, as one-way keys per day in reports marked `lookback`
 * (SPEC §6.4). Two ways in: `laika activity backfill`, and the background sync
 * the first time it sees a repo. Never the prompt path — the hook runs no node.
 *
 * ## What is kept here
 *
 * `~/.laika/activity/lookback.json`, 0600, local only:
 *
 * - `repos` — per repo, keyed by its common git dir: when the collector first
 *   saw it (so the census knows which days a snapshot may have counted there)
 *   and when its look-back finished (so it never runs again).
 * - `job` — the look-back under way: which repos, how many days, and the last
 *   day whose keys the board has accepted. A run that stops early — out of
 *   reports, out of time, refused — leaves it for the next sync.
 * - `next_at` — when the next look-back report may go (below), or the next
 *   try after git could not read a repo (`failures`, doubling like a sync's
 *   backoff).
 * - `counting_since` — the first `since` this machine counted from.
 *
 * ## The board's report bucket is never spent
 *
 * The board takes 30 reports at once and one more every 120 s (SPEC §6.3).
 * A run sends at most {@link LOOKBACK_REPORTS_PER_RUN} look-back reports, and
 * after sending `n` waits `(n + 1) × 120 s` before the next look-back report:
 * the time the board needs to give back those and the snapshot a sync sends
 * once per interval. So look-back and snapshots together never ask for more
 * than the bucket refills.
 */

/** At most this many look-back reports in one run. */
export const LOOKBACK_REPORTS_PER_RUN = 4;
/** The board's report bucket gives one back every this many seconds (SPEC §6.3). */
export const REPORT_REFILL_S = 120;

export interface RepoRecord {
  readonly first_seen: number;
  readonly done_at?: number;
  /**
   * When the developer answered no to `laika activity backfill` for this repo.
   * The automatic look-back skips it; a `backfill` answered yes sends it, and
   * one over the full year, once finished, clears this.
   */
  readonly declined_at?: number;
}

export interface LookbackJob {
  readonly paths: readonly string[];
  readonly days: number;
  /** The last day whose keys were all accepted; `''` before the first report. */
  readonly through: string;
  readonly origin: 'auto' | 'command';
}

export interface LookbackFile {
  readonly counting_since: number;
  readonly repos: Readonly<Record<string, RepoRecord>>;
  readonly job?: LookbackJob;
  readonly next_at: number;
  /** Look-backs in a row in which git could not read a repo. */
  readonly failures?: number;
}

/** Git could not read a repo: try again after this, doubling, as a sync backs off. */
const MAX_LOOKBACK_BACKOFF_S = 6 * 3600;

export function lookbackFile(paths: ActivityPaths): string {
  return join(paths.dir, 'lookback.json');
}

export function readLookback(paths: ActivityPaths): LookbackFile | undefined {
  const raw = readText(lookbackFile(paths));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LookbackFile>;
    const repos: Record<string, RepoRecord> = {};
    for (const [dir, rec] of Object.entries(parsed.repos ?? {})) {
      if (typeof rec.first_seen !== 'number') continue;
      repos[dir] = {
        first_seen: rec.first_seen,
        ...(typeof rec.done_at === 'number' ? { done_at: rec.done_at } : {}),
        ...(typeof rec.declined_at === 'number' ? { declined_at: rec.declined_at } : {}),
      };
    }
    const job = parsed.job;
    const validJob =
      job !== undefined &&
      Array.isArray(job.paths) &&
      typeof job.days === 'number' &&
      typeof job.through === 'string';
    return {
      counting_since: typeof parsed.counting_since === 'number' ? parsed.counting_since : 0,
      repos,
      ...(validJob ? { job } : {}),
      next_at: typeof parsed.next_at === 'number' ? parsed.next_at : 0,
      ...(typeof parsed.failures === 'number' ? { failures: parsed.failures } : {}),
    };
  } catch {
    return undefined;
  }
}

function writeLookback(paths: ActivityPaths, file: LookbackFile): void {
  writeFile600(lookbackFile(paths), `${JSON.stringify(file)}\n`);
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

export interface LookbackReport {
  readonly body: string;
  /** The last day all of whose keys are in this report or an earlier one. */
  readonly through: string;
  readonly keys: number;
}

/** `"0123456789abcdef"` and the comma after it. */
const KEY_JSON_BYTES = 19;

/**
 * The keys for days after `through`, oldest day first, as look-back reports of
 * at most {@link MAX_BODY_BYTES} each. A day is split across two reports only
 * when it does not fit in what is left of one; no report holds a day twice.
 */
export function lookbackReports(options: {
  readonly collectorId: string;
  readonly tz: string;
  readonly byDay: ReadonlyMap<string, readonly string[]>;
  readonly through: string;
}): LookbackReport[] {
  const base = {
    v: 1,
    collector_id: options.collectorId,
    tz: options.tz,
    lookback: true,
    days: [] as { day: string; pushed_keys: string[] }[],
  };
  const baseBytes = Buffer.byteLength(JSON.stringify(base));
  const reports: LookbackReport[] = [];
  let days: { day: string; pushed_keys: string[] }[] = [];
  let bytes = baseBytes;
  let keys = 0;
  let complete = options.through;
  const flush = (): void => {
    if (days.length === 0) return;
    reports.push({ body: JSON.stringify({ ...base, days }), through: complete, keys });
    days = [];
    bytes = baseBytes;
    keys = 0;
  };

  for (const day of [...options.byDay.keys()].sort()) {
    if (day <= options.through) continue;
    let rest = [...(options.byDay.get(day) ?? [])];
    while (rest.length > 0) {
      // `{"day":"…","pushed_keys":[]}`, a comma before it unless it is first,
      // and per key its 18 quoted bytes and a comma (one fewer than keys).
      const entry =
        Buffer.byteLength(JSON.stringify({ day, pushed_keys: [] })) + (days.length > 0 ? 1 : 0);
      const room = Math.floor((MAX_BODY_BYTES - bytes - entry + 1) / KEY_JSON_BYTES);
      if (room < 1) {
        flush();
        continue;
      }
      const take = rest.slice(0, room);
      rest = rest.slice(room);
      days.push({ day, pushed_keys: take });
      bytes += entry + KEY_JSON_BYTES * take.length - 1;
      keys += take.length;
      if (rest.length === 0) complete = day;
      else flush();
    }
  }
  flush();
  return reports;
}

/* -------------------------------------------------------------------------- */
/* Which repos                                                                */
/* -------------------------------------------------------------------------- */

interface Resolved {
  readonly repos: LookbackRepo[];
  readonly gitDirs: string[];
}

/** Each path with the first day a snapshot may have counted there (see `countLookback`). */
async function resolveRepos(
  paths: readonly string[],
  file: LookbackFile,
  git: GitRunner,
  tz: string,
): Promise<Resolved> {
  const repos: LookbackRepo[] = [];
  const gitDirs: string[] = [];
  for (const path of paths) {
    const gitDir = await commonGitDir(git, path);
    if (gitDir === undefined) continue;
    gitDirs.push(gitDir);
    const record = file.repos[gitDir];
    repos.push(
      record === undefined
        ? { path }
        : { path, snapshotFrom: windowDays(record.first_seen, tz)[0] ?? '' },
    );
  }
  return { repos, gitDirs };
}

/**
 * The repos a snapshot counts — remembered and in scope — each given a record
 * the first time it is seen. **When there is no file yet**, every one of them
 * is taken to have been counted since sharing went on: the conservative side,
 * since a snapshot may already hold their commits.
 */
async function noteKnownRepos(options: {
  readonly paths: ActivityPaths;
  readonly state: ActivityState;
  readonly nowS: number;
  readonly git: GitRunner;
  readonly file: LookbackFile | undefined;
}): Promise<{ file: LookbackFile; known: { path: string; gitDir: string }[] }> {
  const { state, nowS, git } = options;
  const fresh = options.file === undefined;
  const repos: Record<string, RepoRecord> = { ...(options.file?.repos ?? {}) };
  const known: { path: string; gitDir: string }[] = [];
  const inScope = await reposInScope(rememberedRepos(options.paths, nowS), state.scope);
  for (const path of inScope) {
    const gitDir = await commonGitDir(git, path);
    if (gitDir === undefined) continue;
    repos[gitDir] ??= { first_seen: fresh ? state.since : nowS };
    known.push({ path, gitDir });
  }
  return {
    file: {
      ...options.file,
      counting_since: options.file?.counting_since ?? state.since,
      repos,
      next_at: options.file?.next_at ?? 0,
    },
    known,
  };
}

/* -------------------------------------------------------------------------- */
/* One step                                                                   */
/* -------------------------------------------------------------------------- */

/** What a PUT answered — the shape of `activity-sync.ts`'s `Call`. */
export type SendAnswer =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status?: number;
      readonly code?: string;
      readonly reason?: string;
      readonly retryAfterS?: number;
      readonly message: string;
    };

export type LookbackOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting'; readonly nextAt: number }
  | {
      readonly kind: 'sent';
      readonly reports: number;
      readonly keys: number;
      readonly finished: boolean;
      /** Repos git could not read this time: left due, tried again later. */
      readonly unread: number;
    }
  | { readonly kind: 'rate-limited'; readonly nextAt: number }
  | { readonly kind: 'off' }
  /** The board refused the report itself (422): an older Laika, most likely. */
  | { readonly kind: 'refused'; readonly message: string; readonly nextAt: number }
  | { readonly kind: 'error'; readonly message: string; readonly nextAt: number }
  | { readonly kind: 'stopped' };

export interface LookbackContext {
  readonly paths: ActivityPaths;
  readonly state: ActivityState;
  readonly collectorId: string;
  readonly tz: string;
  readonly nowS: number;
  readonly extraEmails: readonly string[];
  readonly git: GitRunner;
  readonly send: (body: string) => Promise<SendAnswer>;
  readonly signal?: AbortSignal;
  /** `Date.now()` past which no new report starts; the run's hard deadline stays the backstop. */
  readonly stopAt?: number;
}

/** What `backfill` counts, before it asks: the repos and their census. */
export interface Plan {
  readonly job: LookbackJob;
  readonly census: Census;
  /** How many of `job.paths` were given on the command line and are not remembered. */
  readonly given: number;
}

/**
 * Count a look-back for `laika activity backfill`: the remembered repos in
 * scope plus `given` (already resolved to their top levels). Writes the
 * records of repos seen for the first time; sends nothing.
 */
export async function planBackfill(
  ctx: Omit<LookbackContext, 'send' | 'collectorId' | 'stopAt'>,
  options: { readonly days: number; readonly given: readonly string[] },
): Promise<Plan> {
  const noted = await noteKnownRepos({ ...ctx, file: readLookback(ctx.paths) });
  writeLookback(ctx.paths, noted.file);
  const remembered = new Set(noted.known.map((k) => k.path));
  const extra = options.given.filter((p) => !remembered.has(p));
  const job: LookbackJob = {
    paths: [...remembered, ...extra],
    days: options.days,
    through: '',
    origin: 'command',
  };
  const census = await censusFor(ctx, noted.file, job);
  return { job, census, given: extra.length };
}

/**
 * The developer answered no to `backfill`: every repo in the plan is marked
 * declined — given paths too, so a session started there later does not send
 * them either — and any look-back under way stops. Sends nothing.
 */
export function declineBackfill(paths: ActivityPaths, plan: Plan, nowS: number): void {
  const file = readLookback(paths);
  if (file === undefined) return;
  const repos: Record<string, RepoRecord> = { ...file.repos };
  for (const gitDir of plan.census.gitDirs) {
    repos[gitDir] = { first_seen: repos[gitDir]?.first_seen ?? nowS, declined_at: nowS };
  }
  const { job: _dropped, ...rest } = file;
  writeLookback(paths, { ...rest, repos });
}

type Census = LookbackCensus & { readonly gitDirs: readonly string[] };

async function censusFor(
  ctx: Omit<LookbackContext, 'send' | 'collectorId' | 'stopAt'>,
  file: LookbackFile,
  job: LookbackJob,
): Promise<Census> {
  const resolved = await resolveRepos(job.paths, file, ctx.git, ctx.tz);
  const census = await countLookback({
    repos: resolved.repos,
    extraEmails: ctx.extraEmails,
    days: Math.min(job.days, LOOKBACK_DAYS_MAX),
    tz: ctx.tz,
    nowS: ctx.nowS,
    sinceS: Math.min(file.counting_since, ctx.state.since),
    git: ctx.git,
  });
  return { ...census, gitDirs: resolved.gitDirs };
}

/**
 * Send what is due of the look-back: the job under way, or — when there is
 * none — the one for every repo seen for the first time. With `plan`, the
 * command's job replaces whatever was under way.
 */
export async function lookbackStep(ctx: LookbackContext, plan?: Plan): Promise<LookbackOutcome> {
  const { paths, nowS } = ctx;
  const stopped = (): boolean =>
    ctx.signal?.aborted === true || (ctx.stopAt !== undefined && Date.now() > ctx.stopAt);

  let file = readLookback(paths);
  let job = plan?.job ?? file?.job;
  if (job === undefined) {
    const noted = await noteKnownRepos({ ...ctx, file });
    file = noted.file;
    const due = noted.known.filter((k) => {
      const record = file?.repos[k.gitDir];
      return record?.done_at === undefined && record?.declined_at === undefined;
    });
    if (due.length > 0) {
      job = { paths: due.map((k) => k.path), days: LOOKBACK_DAYS_MAX, through: '', origin: 'auto' };
    }
  }
  file ??= { counting_since: ctx.state.since, repos: {}, next_at: 0 };
  if (job === undefined) {
    writeLookback(paths, file);
    return { kind: 'idle' };
  }
  let current: LookbackFile = { ...file, job };
  const save = (): void => {
    writeLookback(paths, current);
  };
  save();
  if (nowS < current.next_at) return { kind: 'waiting', nextAt: current.next_at };
  if (stopped()) return { kind: 'stopped' };

  const census = plan?.census ?? (await censusFor(ctx, current, job));
  if (stopped()) return { kind: 'stopped' };
  const reports = lookbackReports({
    collectorId: ctx.collectorId,
    tz: ctx.tz,
    byDay: census.byDay,
    through: job.through,
  });

  let sent = 0;
  let keys = 0;
  const pause = (): number => nowS + (sent + 1) * REPORT_REFILL_S;
  for (const report of reports) {
    if (sent >= LOOKBACK_REPORTS_PER_RUN || stopped()) break;
    const answer = await ctx.send(report.body);
    if (!answer.ok) {
      const interval = ctx.state.min_sync_interval_s;
      if (answer.status === 429) {
        const nextAt = nowS + Math.max(answer.retryAfterS ?? 0, interval);
        current = { ...current, next_at: nextAt };
        save();
        return { kind: 'rate-limited', nextAt };
      }
      if (
        answer.status === 403 &&
        (answer.reason === 'local_activity_off' || answer.code === 'local_activity_off')
      ) {
        return { kind: 'off' };
      }
      // A board that refuses the report itself will not take it tomorrow
      // either, until it is upgraded: ask again in a day, not every sync.
      const refused = answer.status === 422;
      const nextAt = nowS + (refused ? DAY_S : interval);
      const message = refused
        ? `the board does not take a look-back report — it needs a newer Laika (${answer.message})`
        : `look-back: ${answer.message}`;
      recordError(paths, nowS, message);
      current = { ...current, next_at: nextAt };
      save();
      return refused ? { kind: 'refused', message, nextAt } : { kind: 'error', message, nextAt };
    }
    sent += 1;
    keys += report.keys;
    job = { ...job, through: report.through };
    current = { ...current, job, next_at: pause() };
    save();
  }

  const unread = new Set(census.unread);
  if (unread.size > 0) {
    // Git could not read some repo: it stays due, and the next try waits as a
    // failed sync would — the interval, doubling, at most 6 hours.
    const failures = (current.failures ?? 0) + 1;
    const wait = Math.min(
      ctx.state.min_sync_interval_s * 2 ** (failures - 1),
      MAX_LOOKBACK_BACKOFF_S,
    );
    recordError(
      paths,
      nowS,
      `look-back: git could not read ${String(unread.size)} ${unread.size === 1 ? 'repo' : 'repos'}; tried again after the backoff`,
    );
    current = { ...current, failures, next_at: Math.max(current.next_at, nowS + wait) };
  } else if (current.failures !== undefined) {
    const { failures: _reset, ...rest } = current;
    current = rest;
  }
  save();

  const finished = sent === reports.length;
  if (finished) {
    const repos: Record<string, RepoRecord> = { ...current.repos };
    // Only a full year counts as a repo's look-back; a narrower one asked for
    // by hand leaves the automatic one still to come. A path given by hand that
    // no session ran in has no record, and gets none here: if one runs there
    // later, it is seen for the first time then.
    if (job.days >= LOOKBACK_DAYS_MAX) {
      for (const gitDir of census.gitDirs) {
        const record = repos[gitDir];
        // Written without `declined_at`: a full year answered yes takes back
        // an earlier no. A narrower one is never marked done, so a repo
        // declined before stays out of the automatic look-back.
        if (record !== undefined && !unread.has(gitDir)) {
          repos[gitDir] = { first_seen: record.first_seen, done_at: nowS };
        }
      }
    }
    const { job: _finished, ...rest } = current;
    current = { ...rest, repos };
    save();
  }
  return { kind: 'sent', reports: sent, keys, finished, unread: unread.size };
}
