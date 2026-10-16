import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { AGENTS } from './agents.ts';
import {
  DAY_S,
  readText,
  type ActivityPaths,
  type ActivityState,
  type Scope,
} from './activity-store.ts';

/**
 * What the next sync would send, computed from local files and local git
 * (LAI-752). Pure apart from reading: nothing here writes or talks to the
 * network, so `laika activity status` can print exactly what `sync` sends.
 *
 * ## The body is the contract's, and nothing else
 *
 * `/tmp/laika-activity/CONTRACT.md`, `PUT /api/v1/me/local-activity`:
 * `{ v, collector_id, tz, days: [{ day, prompts, sessions, commits_local,
 * pushed_keys }] }`. Never prompt text, file names, repo names or paths,
 * remote URLs, branch names, commit messages, author emails or raw SHAs —
 * those stay in this module's locals and die with it.
 */

/** How many local days a snapshot covers: today and the 13 before it. */
export const WINDOW_DAYS = 14;
/** Contract caps, per day. A value above one is clamped, never sent. */
export const CAPS = { prompts: 5000, sessions: 500, commits_local: 2000, pushed_keys: 2000 };
/** Contract: the body is at most 16 KB. */
export const MAX_BODY_BYTES = 16 * 1024;
/** `"0123456789abcdef",` */
const KEY_JSON_BYTES = 19;
/** Repos not used by a session for this long are forgotten. */
export const REPO_TTL_S = 30 * DAY_S;

export interface DayEntry {
  day: string;
  prompts: Record<string, number>;
  sessions: number;
  commits_local: number;
  pushed_keys: string[];
}

export interface LocalActivityBody {
  v: 1;
  collector_id: string;
  tz: string;
  days: DayEntry[];
}

/** A pushed commit the board has not acknowledged yet. */
export interface PendingKey {
  readonly key: string;
  readonly identity: string;
  readonly at: number;
}

/* -------------------------------------------------------------------------- */
/* Days                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `candidate` if it is a time zone `Intl` (and so the board) knows, else `UTC`.
 * The contract's `tz` must be one: an unknown zone is a 422 `invalid_tz`, and
 * the days could not be computed in it anyway.
 */
export function ianaTimeZone(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate === '' || candidate.length > 64) return 'UTC';
  if (candidate === 'Etc/Unknown') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * The machine's IANA zone — what the contract's `tz` carries. With a `TZ` the
 * system does not know, Node reports `undefined` (`TZ=Garbage/Zone`) or
 * `Etc/Unknown` (`TZ=`); both become `UTC`, and the days are counted in it.
 */
export function machineTimeZone(): string {
  return ianaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** `YYYY-MM-DD` of an instant in `tz`. */
export function localDay(epochS: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochS * 1000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar arithmetic on `YYYY-MM-DD`, independent of any zone. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Today and the 13 days before it, oldest first. */
export function windowDays(nowS: number, tz: string): string[] {
  const today = localDay(nowS, tz);
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i - (WINDOW_DAYS - 1)));
}

/* -------------------------------------------------------------------------- */
/* Agent kinds                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The contract's agent kind ids are "the same ids `laika connect` and the
 * Connect wizard use", with "unknown → `other`". That list is `AGENTS` (and the
 * server's `AGENT_CLIENTS`, which it mirrors). A hook installed for an agent
 * neither knows — Copilot CLI is the one today — is sent as `other`.
 */
const KNOWN_KINDS: ReadonlySet<string> = new Set(AGENTS.map((a) => a.slug));

export function wireKind(kind: string): string {
  return KNOWN_KINDS.has(kind) ? kind : 'other';
}

/* -------------------------------------------------------------------------- */
/* The event log                                                              */
/* -------------------------------------------------------------------------- */

export interface EventCounts {
  prompts: Record<string, number>;
  sessions: number;
}

const EVENT_LINE = /^([ps]) ([a-z0-9-]{1,40}) (\d{1,12})$/;

/**
 * Per local day, from `events.log` (and the half-compacted file a crashed sync
 * may have left). A line that does not parse is skipped — the log is written by
 * a shell hook and a torn line is possible, an exception is not useful.
 */
export function countEvents(
  paths: ActivityPaths,
  tz: string,
  sinceS: number,
): Map<string, EventCounts> {
  const days = new Map<string, EventCounts>();
  const text = `${readText(paths.eventsCompacting) ?? ''}\n${readText(paths.events) ?? ''}`;
  for (const line of text.split('\n')) {
    const match = EVENT_LINE.exec(line.trim());
    if (match === null) continue;
    const [, kind, agent, at] = match;
    const epoch = Number(at);
    if (epoch < sinceS) continue;
    const day = localDay(epoch, tz);
    let entry = days.get(day);
    if (entry === undefined) {
      entry = { prompts: {}, sessions: 0 };
      days.set(day, entry);
    }
    if (kind === 's') entry.sessions += 1;
    else {
      const wire = wireKind(agent ?? 'other');
      entry.prompts[wire] = (entry.prompts[wire] ?? 0) + 1;
    }
  }
  return days;
}

/* -------------------------------------------------------------------------- */
/* Repos                                                                      */
/* -------------------------------------------------------------------------- */

export interface RememberedRepo {
  readonly path: string;
  readonly lastUsed: number;
}

/** `repos` as written by the session-start hook: deduped, unexpired, existing. */
export function rememberedRepos(paths: ActivityPaths, nowS: number): RememberedRepo[] {
  const latest = new Map<string, number>();
  for (const line of (readText(paths.repos) ?? '').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const at = Number(line.slice(0, tab));
    const path = line.slice(tab + 1);
    if (!Number.isFinite(at) || path === '' || !path.startsWith('/')) continue;
    if (nowS - at > REPO_TTL_S) continue;
    latest.set(path, Math.max(at, latest.get(path) ?? 0));
  }
  return [...latest].map(([path, lastUsed]) => ({ path, lastUsed }));
}

/**
 * Does a path exist? **Asynchronous on purpose**, like every other touch of a
 * repo path here: a repo on a network mount that has gone away can block a
 * `stat` for minutes, and a blocking call would stop the sync's deadline timer
 * from ever firing.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `repos` rewritten without the entries that are expired or gone from disk. */
export async function prunedReposFile(repos: readonly RememberedRepo[]): Promise<string> {
  const present = await Promise.all(repos.map((r) => exists(r.path)));
  const kept = repos.filter((_, i) => present[i] === true);
  return kept.map((r) => `${String(r.lastUsed)}\t${r.path}\n`).join('');
}

/**
 * The line the Connect screen's "Share with your project" step writes into a
 * repo (`server/web/src/routes/screens/connect/connect-copy.ts`,
 * `projectBlock`), and the files it tells each agent to put it in
 * (`connect-agents.ts`, `instructionsTarget`, including the files its notes say
 * win over AGENTS.md). Read only. "the" is accepted for "a": a block a person
 * adapted by hand (naming their board) reads "tracked on the Laika board".
 */
export const LAIKA_BLOCK_MARKER = 'This project is tracked on a Laika board.';
const LAIKA_BLOCK_PATTERN = /This project is tracked on (?:a|the) Laika board/;
export const LAIKA_BLOCK_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursor/rules/laika.mdc',
  '.github/copilot-instructions.md',
  '.windsurf/rules/laika.md',
  '.clinerules/laika.md',
  '.roo/rules/laika.md',
  '.continue/rules/laika.md',
  '.kiro/steering/laika.md',
  '.junie/AGENTS.md',
  'WARP.md',
  '.hermes.md',
  'HERMES.md',
  'AGENTS.override.md',
] as const;

/** At most this much of each file is read looking for the marker. */
const MARKER_READ_BYTES = 256 * 1024;

async function fileHead(path: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    if (!(await handle.stat()).isFile()) return undefined;
    const buffer = Buffer.alloc(MARKER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MARKER_READ_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

export async function hasLaikaBlock(toplevel: string): Promise<boolean> {
  const heads = await Promise.all(LAIKA_BLOCK_FILES.map((file) => fileHead(join(toplevel, file))));
  return heads.some((head) => LAIKA_BLOCK_PATTERN.test(head ?? ''));
}

/* -------------------------------------------------------------------------- */
/* Git                                                                        */
/* -------------------------------------------------------------------------- */

/** The contract's key: 16 hex of sha256("laika-commit:" + full SHA). */
export function pushedKey(sha: string): string {
  return createHash('sha256').update(`laika-commit:${sha}`).digest('hex').slice(0, 16);
}

/**
 * A commit's authorship, hashed: the same author at the same second. An amend,
 * a rebase or a cherry-pick keeps both and changes the SHA, so this is how a
 * rewritten commit is recognised as work already counted. Local only.
 */
export function authorIdentity(email: string, at: number): string {
  return createHash('sha256')
    .update(`laika-author:${email.toLowerCase()}:${String(at)}`)
    .digest('hex')
    .slice(0, 16);
}

/** How far back git is asked to look, past the window: `--since` is the COMMITTER date. */
const WIDE_SINCE_S = 45 * DAY_S;
/** How long one git call may run unless it asks for another limit. */
const GIT_TIMEOUT_MS = 10_000;
/**
 * The look-back's year-long `git log` (LAI-757): a 20,000-commit history took
 * 10.4 s on a CI runner, past the default. Still well inside the sync's soft
 * stop (90 s of its 120 s), so a look-back that needs it all still sends.
 */
export const LOOKBACK_GIT_TIMEOUT_MS = 60_000;

export interface GitOptions {
  /** This call's limit, in place of the default 10 s. */
  readonly timeoutMs?: number;
}

export type GitRunner = (
  cwd: string,
  args: readonly string[],
  options?: GitOptions,
) => Promise<string | undefined>;

/**
 * `git` with nothing from the environment that could change what it prints:
 * no prompt for credentials, no optional locks, C locale. Mailmap, signatures
 * and colour are turned off per command. `undefined` on any failure — a repo
 * that cannot be read counts nothing, it does not stop the sync.
 *
 * Asynchronous, and never allowed to hold the sync open: a `git` that runs
 * past its limit — 10 s, unless the call asks for another — is sent SIGKILL by
 * `execFile`'s own timeout, and when `signal` aborts
 * (the sync's overall deadline) it is sent SIGKILL at once and the call
 * answers `undefined` without waiting for it. SIGKILL, not SIGTERM: these
 * commands only read, so there is nothing for git to clean up, and SIGTERM can
 * be ignored. (A process blocked inside the kernel on a dead mount dies when
 * the mount lets go; nothing here waits for that.)
 */
export function gitRunner(
  env: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
): GitRunner {
  const childEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  };
  return (cwd, args, options) =>
    new Promise((done) => {
      if (signal?.aborted === true) {
        done(undefined);
        return;
      }
      // Not execFile's `signal` option: on an abort that sends SIGTERM, and
      // clears the timeout that would have sent SIGKILL.
      const onAbort = (): void => {
        child.kill('SIGKILL');
        done(undefined);
      };
      const child = execFile(
        'git',
        ['-C', cwd, ...args],
        {
          encoding: 'utf8',
          env: childEnv,
          timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout) => {
          signal?.removeEventListener('abort', onAbort);
          done(error === null ? stdout : undefined);
        },
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin?.end();
    });
}

/**
 * The repo's common git directory, absolute and resolved — what its worktrees
 * share. `--git-common-dir` exists since git 2.5; `--path-format=absolute`
 * only since 2.31, and an older `rev-parse` **echoes** a flag it does not know
 * and exits 0, which once made every repo look like the same one. So the path
 * is made absolute here, and anything that is not one plain path is refused.
 */
export async function commonGitDir(git: GitRunner, repo: string): Promise<string | undefined> {
  const out = (await git(repo, ['rev-parse', '--git-common-dir']))?.trim();
  if (out === undefined || out === '' || out.includes('\n') || out.startsWith('-'))
    return undefined;
  const absolute = isAbsolute(out) ? out : resolve(repo, out);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

interface Commit {
  readonly sha: string;
  readonly at: number;
  readonly email: string;
}

const LOG_FORMAT = '--format=%H%x09%at%x09%ae';

function parseLog(out: string | undefined): Commit[] {
  const commits: Commit[] = [];
  for (const line of (out ?? '').split('\n')) {
    const [sha, at, email] = line.split('\t');
    if (sha === undefined || at === undefined || email === undefined) continue;
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) continue;
    const epoch = Number(at);
    if (!Number.isFinite(epoch)) continue;
    commits.push({ sha, at: epoch, email: email.trim().toLowerCase() });
  }
  return commits;
}

export interface CommitCensus {
  /** Unpushed commits by me, per local day. */
  readonly local: Map<string, number>;
  /** Pushed commits by me, not yet acknowledged by the board. */
  readonly pending: PendingKey[];
  /** Per local day, the pending keys (a view of `pending`). */
  readonly pendingByDay: Map<string, PendingKey[]>;
}

export interface SentMemory {
  readonly keys: ReadonlySet<string>;
  readonly identities: ReadonlySet<string>;
}

export function readSentMemory(paths: ActivityPaths): SentMemory {
  const keys = new Set<string>();
  const identities = new Set<string>();
  for (const line of (readText(paths.sentKeys) ?? '').split('\n')) {
    const [key, identity] = line.split(' ');
    if (key !== undefined && /^[0-9a-f]{16}$/.test(key)) keys.add(key);
    if (identity !== undefined && /^[0-9a-f]{16}$/.test(identity)) identities.add(identity);
  }
  return { keys, identities };
}

/**
 * Count my commits in each repo, by **author** day.
 *
 * - **Mine** = the author email is that repo's `user.email` or one of the extra
 *   emails, compared exactly and case-insensitively. The email is `%ae`, the
 *   one recorded in the commit — not `%aE`, the mailmapped one — so a repo's
 *   `.mailmap` cannot make someone else's commit mine. `--no-use-mailmap` is
 *   a second lock on the same door, not the one the test exercises.
 * - **Pushed** = reachable from any `refs/remotes/*`. **Local** = reachable
 *   from a branch or HEAD and from no remote-tracking ref.
 * - **Worktrees share refs**, so repos are deduped by their common git dir and
 *   each is walked once. Commits are also keyed by SHA and by authorship, so a
 *   commit reached from two clones still counts once.
 * - **Already counted** work is not counted again: a local commit whose
 *   authorship matches a pushed commit (an amend or rebase not yet pushed), or
 *   matches one the board already acknowledged (an amend force-pushed, or a
 *   branch whose remote was deleted after a squash merge), is not local, and a
 *   pushed key with an acknowledged authorship is not sent twice.
 * - Merge commits are not counted: they record that two lines met, not work.
 * - **Nothing authored before `sinceS`**, pushed or not: the developer agreed
 *   to share from the moment sharing was turned on, not before (D-079 item 2).
 */
export async function countCommits(options: {
  readonly repos: readonly string[];
  readonly extraEmails: readonly string[];
  readonly days: readonly string[];
  readonly tz: string;
  readonly nowS: number;
  readonly sinceS: number;
  readonly sent: SentMemory;
  readonly git: GitRunner;
}): Promise<CommitCensus> {
  const { days, tz, nowS, sinceS, sent, git } = options;
  const inWindow = new Set(days);
  const wideSince = `--since=@${String(nowS - WIDE_SINCE_S)}`;
  const common = ['--no-merges', '--no-use-mailmap', '--no-show-signature', '--no-color'];

  const seenGitDirs = new Set<string>();
  const pushed = new Map<string, Commit>();
  const local = new Map<string, Commit>();

  for (const repo of options.repos) {
    const gitDir = await commonGitDir(git, repo);
    if (gitDir === undefined || seenGitDirs.has(gitDir)) continue;
    seenGitDirs.add(gitDir);

    const own = (await git(repo, ['config', '--get', 'user.email']))?.trim().toLowerCase();
    const mine = new Set(options.extraEmails.map((e) => e.toLowerCase()));
    if (own !== undefined && own !== '') mine.add(own);
    if (mine.size === 0) continue;

    const keep = (c: Commit): boolean => mine.has(c.email) && inWindow.has(localDay(c.at, tz));

    const onRemotes = await git(repo, ['log', '--remotes', ...common, wideSince, LOG_FORMAT]);
    for (const c of parseLog(onRemotes)) {
      if (keep(c)) pushed.set(c.sha, c);
    }

    const hasHead = (await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) !== undefined;
    const tips = hasHead ? ['--branches', 'HEAD'] : ['--branches'];
    const unpushed = await git(repo, [
      'log',
      ...tips,
      '--not',
      '--remotes',
      ...common,
      wideSince,
      LOG_FORMAT,
    ]);
    for (const c of parseLog(unpushed)) {
      if (keep(c)) local.set(c.sha, c);
    }
  }

  // A SHA pushed in one clone and not in another is pushed.
  for (const sha of pushed.keys()) local.delete(sha);

  const pushedIdentities = new Set<string>();
  const pending: PendingKey[] = [];
  for (const c of [...pushed.values()].sort((a, b) => a.at - b.at)) {
    const identity = authorIdentity(c.email, c.at);
    const key = pushedKey(c.sha);
    const fresh = !sent.keys.has(key) && !sent.identities.has(identity);
    // Like unpushed work: nothing authored before sharing was turned on here.
    const counted = c.at >= sinceS;
    if (counted && fresh && !pushedIdentities.has(identity))
      pending.push({ key, identity, at: c.at });
    pushedIdentities.add(identity);
  }

  const localByDay = new Map<string, number>();
  const localIdentities = new Set<string>();
  for (const c of local.values()) {
    if (c.at < sinceS) continue;
    const identity = authorIdentity(c.email, c.at);
    if (pushedIdentities.has(identity) || sent.identities.has(identity)) continue;
    if (localIdentities.has(identity)) continue;
    localIdentities.add(identity);
    const day = localDay(c.at, tz);
    localByDay.set(day, (localByDay.get(day) ?? 0) + 1);
  }

  const pendingByDay = new Map<string, PendingKey[]>();
  for (const p of pending) {
    const day = localDay(p.at, tz);
    pendingByDay.set(day, [...(pendingByDay.get(day) ?? []), p]);
  }
  return { local: localByDay, pending, pendingByDay };
}

/* -------------------------------------------------------------------------- */
/* The look-back (LAI-757, D-080)                                             */
/* -------------------------------------------------------------------------- */

/** The most days a look-back covers: today and the 364 before it. */
export const LOOKBACK_DAYS_MAX = 365;

/** A repo to look back over. */
export interface LookbackRepo {
  readonly path: string;
  /**
   * The first local day a snapshot may have counted in this repo — the start
   * of the 14-day window when the collector first saw it — or `undefined` for
   * a repo no snapshot counts (a path given only to `laika activity backfill`).
   */
  readonly snapshotFrom?: string;
}

export interface LookbackCensus {
  /** One-way keys per local day, each day's keys oldest first. */
  readonly byDay: Map<string, string[]>;
  /** How many keys `byDay` holds. */
  readonly commits: number;
  /**
   * Common git dirs whose log git did not give — an error, a timeout, an
   * abort. Their commits are missing from `byDay`, so their look-back is not
   * finished.
   */
  readonly unread: readonly string[];
}

/**
 * My pushed commits over the last `days` local days, by **author** day, as the
 * contract's keys — by the same rules as {@link countCommits}: the repo's
 * `user.email` or an extra email, compared on `%ae` (a `.mailmap` cannot make
 * a commit mine), no merges, a SHA or an authorship counted once. A key the
 * board already holds may be sent again: keys are a set there.
 *
 * **What a snapshot may count is left to it.** A commit authored at or after
 * `sinceS` on a day at or after its repo's `snapshotFrom` is the snapshot's:
 * pushed it is already a snapshot key, and unpushed it is a snapshot's local
 * commit — which, pushed later, must not also become a look-back key. So the
 * look-back takes only commits from before counting began, or from days no
 * snapshot covered in that repo. A commit that is the snapshot's in any repo
 * is the snapshot's.
 */
export async function countLookback(options: {
  readonly repos: readonly LookbackRepo[];
  readonly extraEmails: readonly string[];
  readonly days: number;
  readonly tz: string;
  readonly nowS: number;
  readonly sinceS: number;
  readonly git: GitRunner;
}): Promise<LookbackCensus> {
  const { tz, nowS, sinceS, git } = options;
  const span = Math.min(Math.max(Math.trunc(options.days), 1), LOOKBACK_DAYS_MAX);
  const today = localDay(nowS, tz);
  const first = addDays(today, -(span - 1));
  // `--since` is the committer date, never earlier than the author's for a
  // commit made here; the margin keeps a rebased one whose author day is in range.
  const wideSince = `--since=@${String(nowS - (span + 31) * DAY_S)}`;
  const common = ['--no-merges', '--no-use-mailmap', '--no-show-signature', '--no-color'];

  const seenGitDirs = new Set<string>();
  const picked = new Map<string, Commit>();
  const snapshots = new Set<string>();
  const unread: string[] = [];

  for (const repo of options.repos) {
    const gitDir = await commonGitDir(git, repo.path);
    if (gitDir === undefined || seenGitDirs.has(gitDir)) continue;
    seenGitDirs.add(gitDir);

    const own = (await git(repo.path, ['config', '--get', 'user.email']))?.trim().toLowerCase();
    const mine = new Set(options.extraEmails.map((e) => e.toLowerCase()));
    if (own !== undefined && own !== '') mine.add(own);
    if (mine.size === 0) continue;

    const onRemotes = await git(repo.path, ['log', '--remotes', ...common, wideSince, LOG_FORMAT], {
      timeoutMs: LOOKBACK_GIT_TIMEOUT_MS,
    });
    // A repo with no remote answers an empty log; no answer at all is a failure.
    if (onRemotes === undefined) {
      unread.push(gitDir);
      continue;
    }
    for (const c of parseLog(onRemotes)) {
      if (!mine.has(c.email)) continue;
      const day = localDay(c.at, tz);
      if (day < first || day > today) continue;
      if (c.at >= sinceS && repo.snapshotFrom !== undefined && day >= repo.snapshotFrom) {
        snapshots.add(c.sha);
      } else {
        picked.set(c.sha, c);
      }
    }
  }

  const identities = new Set<string>();
  const byDay = new Map<string, string[]>();
  let commits = 0;
  for (const c of [...picked.values()].sort((a, b) => a.at - b.at)) {
    if (snapshots.has(c.sha)) continue;
    const identity = authorIdentity(c.email, c.at);
    if (identities.has(identity)) continue;
    identities.add(identity);
    const day = localDay(c.at, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), pushedKey(c.sha)]);
    commits += 1;
  }
  return { byDay, commits, unread };
}

/* -------------------------------------------------------------------------- */
/* The body                                                                   */
/* -------------------------------------------------------------------------- */

export interface Snapshot {
  readonly body: LocalActivityBody;
  /** The keys actually in `body`, to remember once the board accepts them. */
  readonly sentKeys: readonly PendingKey[];
  /** Pushed keys left out to keep the body under 16 KB; they go next time. */
  readonly deferredKeys: number;
  /** `repos` as it should be once expired and deleted paths are dropped. */
  readonly prunedRepos: string;
}

/** Repos in scope, given the developer's choice (contract: `local_activity_scope`). */
export async function reposInScope(
  repos: readonly RememberedRepo[],
  scope: Scope,
): Promise<string[]> {
  const kept: string[] = [];
  for (const r of repos) {
    if (!(await exists(r.path))) continue;
    if (scope === 'laika-repos' && !(await hasLaikaBlock(r.path))) continue;
    kept.push(r.path);
  }
  return kept;
}

export async function buildSnapshot(options: {
  readonly paths: ActivityPaths;
  readonly state: ActivityState;
  readonly collectorId: string;
  readonly tz: string;
  readonly nowS: number;
  readonly extraEmails: readonly string[];
  readonly git: GitRunner;
}): Promise<Snapshot> {
  const { paths, state, tz, nowS } = options;
  const days = windowDays(nowS, tz);
  const events = countEvents(paths, tz, state.since);
  const remembered = rememberedRepos(paths, nowS);
  const census = await countCommits({
    repos: await reposInScope(remembered, state.scope),
    extraEmails: options.extraEmails,
    days,
    tz,
    nowS,
    sinceS: state.since,
    sent: readSentMemory(paths),
    git: options.git,
  });

  const entries: DayEntry[] = days.map((day) => {
    const counted = events.get(day);
    const prompts: Record<string, number> = {};
    for (const [kind, n] of Object.entries(counted?.prompts ?? {})) {
      prompts[kind] = Math.min(n, CAPS.prompts);
    }
    return {
      day,
      prompts,
      sessions: Math.min(counted?.sessions ?? 0, CAPS.sessions),
      commits_local: Math.min(census.local.get(day) ?? 0, CAPS.commits_local),
      pushed_keys: [],
    };
  });

  // Keys oldest day first: those fall out of the window soonest, so if the
  // body is full they are the ones that must go now. Each key adds at most
  // `"<16 hex>",` — 19 bytes — to the JSON, so the budget is counted, not
  // re-measured per key.
  const body: LocalActivityBody = { v: 1, collector_id: options.collectorId, tz, days: entries };
  let budget = MAX_BODY_BYTES - Buffer.byteLength(JSON.stringify(body));
  const sentKeys: PendingKey[] = [];
  let deferred = 0;
  for (const entry of entries) {
    for (const p of census.pendingByDay.get(entry.day) ?? []) {
      if (entry.pushed_keys.length >= CAPS.pushed_keys || budget < KEY_JSON_BYTES) {
        deferred += 1;
        continue;
      }
      entry.pushed_keys.push(p.key);
      budget -= KEY_JSON_BYTES;
      sentKeys.push(p);
    }
  }

  return {
    body,
    sentKeys,
    deferredKeys: deferred,
    prunedRepos: await prunedReposFile(remembered),
  };
}
