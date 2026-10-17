import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  addDays,
  hasLaikaBlock,
  localDay,
  MAX_BODY_BYTES,
  rememberedRepos,
} from './activity-census.ts';
import type { SendAnswer } from './activity-lookback.ts';
import {
  DAY_S,
  ensureDir,
  recordError,
  writeFile600,
  type ActivityPaths,
  type ActivityState,
} from './activity-store.ts';

/**
 * Token usage from the agents' own session files (LAI-769, D-084).
 *
 * ## What is read, and what leaves
 *
 * Claude Code transcripts (`~/.claude/projects/**\/*.jsonl`), Codex rollouts
 * (`~/.codex/sessions/**\/rollout-*.jsonl`) and Gemini CLI sessions
 * (`~/.gemini/tmp/*\/chats/session-*.json`). From each record only the
 * numbers in its usage, its model id and its time are kept; the record's text,
 * tool input, path, branch and session id are read past and never sent
 * (D-084 item 1). What leaves is per day × agent × model × task the four
 * counts — input, output, cache write, cache read — in a usage report on the
 * same `PUT /me/local-activity` as the snapshot (SPEC §6.4).
 *
 * ## Which task (D-084 items 5–6, LAI-770)
 *
 * A reply's task is the one its agent **marked** in that session, from its own
 * Laika calls in the session file: `start_working`, or `update_status` into an
 * in-progress status, opens a stretch of work on the task's key; another mark,
 * `finish_task`, or moving that task out of progress ends it. A session that
 * moved between tasks is split **by time** — a mark's own reply is the new
 * task's, a finish's the finished task's. A subagent's own marks are its own;
 * without one it works under its session's. A call the board refused is no
 * mark: Claude Code's `is_error` result, Gemini CLI's `error` status; a Codex
 * call counts only once its answer is read and says it was taken — an answer
 * that is missing or says nothing either way is no mark. No mark counts until
 * the board has named its prefixes. From each call only the tool's name, the task's
 * **key** and whether the status is in progress are kept — never its note,
 * summary, branch or any other argument — and a task named by its id, which
 * cannot be sent, leaves its stretch unattributed.
 *
 * Without a mark, a key in the session's **branch name** counts — `LAI-42-x`,
 * `feature/lai-42` — when its prefix is one the board serves (the sharing
 * answer's `task_prefixes`, kept in the index), so `release-2026` is never a
 * task. Those prefixes include the outside ids the board's cards carry
 * (LAI-780): a branch or a mark named for a repo's `LAI-780`, or a Jira key
 * such as `DATA_ENG-12`, counts as the card's own key does. Claude Code records the branch on every line and Codex in its
 * session's metadata; for an agent whose files hold none, the activity hook
 * keeps each session's id and branch at its start, on this machine
 * (`sessions`). Only the key is kept from a branch, and only the key is sent.
 * Anything else is **unattributed** and stays so — never guessed.
 *
 * The work is done in the background sync, never in a hook: the hook's one
 * addition is a line at a session's start, from the `git` call it already
 * made.
 *
 * ## Counted once (D-084 item 2, REPORT.md §1a and §2)
 *
 * - **Claude Code** writes one reply's usage on several lines, and a resumed
 *   or forked session copies history into a new file: a reply is keyed by its
 *   message id **across every file**, keeping the largest value of each
 *   field. Summing every line over-counts 2.1× on the measured machine.
 * - **Codex** keeps a cumulative total and repeats its events: a day's figure
 *   is the difference of the total across it, never a sum of events.
 * - **Gemini CLI** rewrites a whole file each turn: it is read again when it
 *   changes, and each message counted once by id.
 *
 * ## Cheap (the task's measured target: under 50 ms with nothing new)
 *
 * Two files in `~/.laika/activity`, both 0600:
 *
 * - `usage-index.json` — small, read on every sync: each directory's listing
 *   kept by its mtime (a directory's mtime moves only when an entry is added
 *   or removed, so a sync re-lists only the directories that changed and
 *   `stat`s every file once), each file's size and mtime, the signature of
 *   every day last accepted, and whether anything is waiting to be sent.
 * - `usage-data.json` — the records themselves, read only when a file has new
 *   bytes. Reads start at the byte offset the last one stopped at and end at
 *   the last newline, so a line being written is read whole next time.
 *
 * A first read of a busy machine takes seconds: it runs in the detached
 * background sync, never in a hook, and a file untouched for longer than the
 * window is not read at all.
 *
 * ## Since when (D-079 item 2, D-084 item 11)
 *
 * From the moment the collector began counting (`state.since`), unless the
 * developer said yes to counting the last 30 days, when the whole window is
 * sent once. The data file keeps every reply in the window either way, so a
 * later yes sends at once, and a no sends nothing older.
 */

/** Today and the 30 days before it: D-084 item 11's 30, and today. */
export const USAGE_WINDOW_DAYS = 31;
/** Usage reports in one run, at most — after the snapshot, before the look-back. */
export const USAGE_REPORTS_PER_RUN = 4;
/** No count above this is believed (the server's cap). */
const COUNT_MAX = 1_000_000_000_000;
/** The server's pattern for a model id (§4.33). */
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/** Read this much of a transcript at a time. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/** How long a scope answer for a working directory is believed. */
const SCOPE_TTL_S = DAY_S;
/**
 * The records' format. A collector whose data predates it reads its files
 * once more — in the background sync, as the first read was — so the days in
 * the window get the task keys phase 1 did not read (LAI-770). 3: the keys a
 * branch carries are read in an outside id's wider shape (LAI-780), so lines
 * read before are read again; the re-read's days replace what went, as 2's
 * did.
 */
const DATA_V = 3;

export type UsageAgent = 'claude-code' | 'codex' | 'gemini-cli';

/** Where each agent keeps its session files. */
export interface UsageRoots {
  readonly claude: string;
  readonly codex: string;
  readonly gemini: string;
}

/**
 * The three roots, honouring the agents' own overrides: `CLAUDE_CONFIG_DIR`
 * for Claude Code, `CODEX_HOME` for Codex.
 */
export function usageRoots(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): UsageRoots {
  const set = (value: string | undefined): string | undefined =>
    value !== undefined && value.trim() !== '' ? value.trim() : undefined;
  return {
    claude: join(set(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude'), 'projects'),
    codex: join(set(env.CODEX_HOME) ?? join(home, '.codex'), 'sessions'),
    gemini: join(home, '.gemini', 'tmp'),
  };
}

/** One row of a usage report (SPEC §6.4). */
export interface UsageRow {
  agent: string;
  model: string;
  task: string | null;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

/* -------------------------------------------------------------------------- */
/* The two files                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `[day, model, input, output, cache_write, cache_read, epoch s, cwd index,
 * session index, lane index, branch index]` — the indexes into `UsageData`'s
 * local-only tables. The lane is a subagent's (−1: the session's own thread).
 * The branch index is into `branches`, −1 for a branch with no key in it and
 * −2 for a record whose file names no branch.
 */
type Rec = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number?,
  number?,
  number?,
];

/**
 * A Laika mark (LAI-770): `[session index, lane index, epoch s, key index,
 * kind, state]`. Kind 1 starts work on the key, 0 ends work on it; key −1 is
 * a task named by its id, which cannot be sent. State is absent or 0 for a
 * mark that counts, 1 once the call's answer came back an error, and 2 while
 * a Codex call's answer has not been read (review B1) — only 0 counts.
 */
type Mark = [number, number, number, number, 0 | 1, (0 | 1 | 2)?];

/** A mark's state: refused, or a Codex call whose answer is not yet read. */
const REFUSED = 1;
const UNANSWERED = 2;

/** No branch recorded for the record: the hook's session line may say. */
const NO_BRANCH = -2;

interface CodexFile {
  /** Bytes read so far. */
  o: number;
  /** The cumulative total last seen: input (cached included), cached, cache write, output. */
  prev: [number, number, number, number];
  model: string;
  cwd: number;
  /** The rollout's session (`session_meta`), by index. */
  sid?: number;
  /** Its branch's keys (`session_meta.git.branch`), by index — see `Rec`. */
  br?: number;
  /** One record per event that moved the total, in the window. */
  ev: Rec[];
  /**
   * Per-response records (`token_usage_record`), by response id, when the
   * rollout has them: what is counted then, deduplicated across every rollout,
   * so a fork that copies its parent's history counts it once (review 1).
   */
  r?: Record<string, Rec>;
}

interface GeminiFile {
  /** Per message id. */
  m: Record<string, Rec>;
}

interface UsageData {
  v: typeof DATA_V;
  /** The zone the days were computed in; all are recomputed when it changes. */
  tz: string;
  /** Working directories, by index — local only, never sent. */
  cwds: string[];
  /** Session ids, by index — local only, never sent; to leave automated ones out (LAI-775). */
  sessions: string[];
  /** Subagent ids, by index — local only: a subagent's own marks are its own. */
  lanes: string[];
  /** The task keys a branch name carried, space-separated, by index — never the branch. */
  branches: string[];
  /** Task keys, by index — what a mark keeps, and all of it that is ever sent. */
  keys: string[];
  /** Each mark, by its tool call's id: a resumed session's copy counts once. */
  marks: Record<string, Mark>;
  /** Claude Code replies, by message id. */
  claude: Record<string, Rec>;
  /** Claude Code transcripts: bytes read so far. */
  offsets: Record<string, number>;
  codex: Record<string, CodexFile>;
  gemini: Record<string, GeminiFile>;
  /** `laika-repos` answers per working directory: in scope, and when asked. */
  scope: Record<string, [boolean, number]>;
}

interface DirEntry {
  m: number;
  d: string[];
  f: string[];
}

interface UsageIndex {
  v: 1;
  dirs: Record<string, DirEntry>;
  files: Record<string, { s: number; m: number }>;
  /** Per day, the rows last accepted, as a signature. */
  sent: Record<string, string>;
  /** Something changed since everything was last accepted. */
  dirty: boolean;
  /** The developer's answer to counting the last 30 days. */
  backfill?: 'yes' | 'no';
  /**
   * The days other collectors of this person held tokens for when the 30 days
   * were first sent (the board's `usage_days_elsewhere`), decided once: their
   * older tokens are left out, so a machine counted under an earlier collector
   * — after `off` and `on` — or another machine is not counted again.
   */
  held?: string[];
  /** Days already sent marked `backfill`: the mark goes once a day. */
  marked: string[];
  /** `skip-sessions` as last read (size and mtime): a change means a resend. */
  skip: string;
  /** No usage report before this (a refusal or a 429). */
  next_at: number;
  /** The board's `task_prefixes`, as last answered: which branch keys may count. */
  prefixes?: string[];
  /** The format of `usage-data.json` the offsets in `files` belong to. */
  data_v?: number;
}

export function usageIndexFile(paths: ActivityPaths): string {
  return join(paths.dir, 'usage-index.json');
}

export function usageDataFile(paths: ActivityPaths): string {
  return join(paths.dir, 'usage-data.json');
}

function emptyIndex(): UsageIndex {
  return { v: 1, dirs: {}, files: {}, sent: {}, dirty: false, marked: [], skip: '', next_at: 0 };
}

function emptyData(tz: string): UsageData {
  return {
    v: DATA_V,
    tz,
    cwds: [],
    sessions: [],
    lanes: [],
    branches: [],
    keys: [],
    marks: {},
    claude: {},
    offsets: {},
    codex: {},
    gemini: {},
    scope: {},
  };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function readIndex(paths: ActivityPaths): UsageIndex {
  const raw = readJson(usageIndexFile(paths));
  if (!isRecord(raw) || raw.v !== 1) return emptyIndex();
  return {
    v: 1,
    dirs: isRecord(raw.dirs) ? (raw.dirs as Record<string, DirEntry>) : {},
    files: isRecord(raw.files) ? (raw.files as Record<string, { s: number; m: number }>) : {},
    sent: isRecord(raw.sent) ? (raw.sent as Record<string, string>) : {},
    dirty: raw.dirty === true,
    ...(raw.backfill === 'yes' || raw.backfill === 'no' ? { backfill: raw.backfill } : {}),
    ...(Array.isArray(raw.held) ? { held: (raw.held as unknown[]).filter(isDay) } : {}),
    marked: Array.isArray(raw.marked) ? (raw.marked as unknown[]).filter(isDay) : [],
    skip: typeof raw.skip === 'string' ? raw.skip : '',
    next_at: typeof raw.next_at === 'number' ? raw.next_at : 0,
    ...(Array.isArray(raw.prefixes)
      ? { prefixes: (raw.prefixes as unknown[]).filter((p): p is string => typeof p === 'string') }
      : {}),
    ...(typeof raw.data_v === 'number' ? { data_v: raw.data_v } : {}),
  };
}

function readData(paths: ActivityPaths, tz: string): UsageData | undefined {
  const raw = readJson(usageDataFile(paths));
  if (!isRecord(raw) || raw.v !== DATA_V) return undefined;
  const pick = <T>(value: unknown, fallback: T): T => (isRecord(value) ? (value as T) : fallback);
  const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);
  return {
    v: DATA_V,
    tz: typeof raw.tz === 'string' ? raw.tz : tz,
    cwds: list(raw.cwds),
    sessions: list(raw.sessions),
    lanes: list(raw.lanes),
    branches: list(raw.branches),
    keys: list(raw.keys),
    marks: pick(raw.marks, {}),
    claude: pick(raw.claude, {}),
    offsets: pick(raw.offsets, {}),
    codex: pick(raw.codex, {}),
    gemini: pick(raw.gemini, {}),
    scope: pick(raw.scope, {}),
  };
}

function writeIndex(paths: ActivityPaths, index: UsageIndex): void {
  writeFile600(usageIndexFile(paths), `${JSON.stringify(index)}\n`);
}

function writeData(paths: ActivityPaths, data: UsageData): void {
  writeFile600(usageDataFile(paths), `${JSON.stringify(data)}\n`);
}

/** The developer's answer to counting the last 30 days, kept until collection starts over. */
export function setUsageBackfill(paths: ActivityPaths, answer: 'yes' | 'no'): void {
  ensureDir(paths);
  const index = readIndex(paths);
  writeIndex(paths, { ...index, backfill: answer, dirty: index.dirty || answer === 'yes' });
}

/* -------------------------------------------------------------------------- */
/* Automated sessions (LAI-775)                                               */
/* -------------------------------------------------------------------------- */

/** Written by the activity hook for a session started with `OMNIGENT=1`, `CI` or `LAIKA_ACTIVITY_SKIP`. */
export function skipSessionsFile(paths: ActivityPaths): string {
  return join(paths.dir, 'skip-sessions');
}

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** Lines kept when the file is compacted: well past the window. */
const SKIP_KEEP_S = 45 * DAY_S;
/** Compacted once it is this large. */
const SKIP_COMPACT_BYTES = 64 * 1024;

/** The ids of sessions nobody was typing in, from the file and its half-compacted copy. */
function skippedSessions(paths: ActivityPaths): Set<string> {
  const ids = new Set<string>();
  for (const path of [skipSessionsFile(paths), `${skipSessionsFile(paths)}.compacting`]) {
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const id = line.split(' ')[1];
      if (id !== undefined && SESSION_ID.test(id)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Written by the activity hook at a person's session start (LAI-770): `<epoch>
 * <session id> <branch>`, 0600, never sent — the branch for an agent whose
 * own files name none. Only the keys in the branch are taken from it.
 */
export function sessionsFile(paths: ActivityPaths): string {
  return join(paths.dir, 'sessions');
}

/** Per session id, its starts — time and the keys its branch carried — oldest first. */
function sessionStarts(paths: ActivityPaths): Map<string, [number, string][]> {
  const starts = new Map<string, [number, string][]>();
  for (const path of [sessionsFile(paths), `${sessionsFile(paths)}.compacting`]) {
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const [at, id, branch] = line.split(' ');
      if (id === undefined || !SESSION_ID.test(id) || !/^\d+$/.test(at ?? '')) continue;
      const list = starts.get(id) ?? [];
      list.push([Number(at), branchKeys(branch)]);
      starts.set(id, list);
    }
  }
  for (const list of starts.values()) list.sort((a, b) => a[0] - b[0]);
  return starts;
}

/** The files' sizes and mtimes, so a sync notices a session marked or started since the last. */
function skipSignature(paths: ActivityPaths): string {
  return [skipSessionsFile(paths), sessionsFile(paths)]
    .map((file) => {
      try {
        const st = statSync(file);
        return `${String(st.size)}:${String(Math.floor(st.mtimeMs))}`;
      } catch {
        return '';
      }
    })
    .join('|')
    .replace(/^\|$/, '');
}

/**
 * Keep the hook's two files small: each moved aside first, so a hook
 * appending meanwhile starts a new one, and the lines still inside 45 days
 * appended back — the event log's compaction (`compactEvents`).
 */
function compactSkipSessions(paths: ActivityPaths, nowS: number): void {
  compactHookFile(skipSessionsFile(paths), nowS);
  compactHookFile(sessionsFile(paths), nowS);
}

function compactHookFile(file: string, nowS: number): void {
  const aside = `${file}.compacting`;
  try {
    if (statSync(file).size < SKIP_COMPACT_BYTES) return;
    renameSync(file, aside);
  } catch {
    return;
  }
  const kept = readFileSync(aside, 'utf8')
    .split('\n')
    .filter((line) => {
      const [at, id] = line.split(' ');
      return id !== undefined && SESSION_ID.test(id) && nowS - Number(at) <= SKIP_KEEP_S;
    });
  if (kept.length > 0) appendFileSync(file, `${kept.join('\n')}\n`, { mode: 0o600 });
  rmSync(aside, { force: true });
}

export function usageBackfill(paths: ActivityPaths): 'yes' | 'no' | undefined {
  return readIndex(paths).backfill;
}

/* -------------------------------------------------------------------------- */
/* Parsing: numbers, a model id and a time — nothing else is kept             */
/* -------------------------------------------------------------------------- */

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), COUNT_MAX)
    : 0;

/**
 * The model id as the server takes it: lower case, the last path segment,
 * Claude Code's `[1m]` context suffix removed. `<synthetic>` and nothing are
 * skipped; anything else that is not an id is `other`, never sent as written.
 */
export function modelId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = (raw.trim().toLowerCase().split('/').pop() ?? '').replace(/\[[^\]]*\]$/, '');
  if (id === '' || id === '<synthetic>') return undefined;
  return MODEL.test(id) ? id : 'other';
}

const epochOf = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
};

/**
 * Local days, fast: an instant's day is the same for every instant in its
 * quarter hour (every zone's offset is a multiple of 15 minutes), so each
 * quarter hour is formatted once.
 */
function dayFinder(tz: string): (epochS: number) => string {
  const memo = new Map<number, string>();
  return (epochS) => {
    const quarter = Math.floor(epochS / 900);
    let day = memo.get(quarter);
    if (day === undefined) {
      day = localDay(quarter * 900, tz);
      memo.set(quarter, day);
    }
    return day;
  };
}

/* -------------------------------------------------------------------------- */
/* Marks and branches: a task's key, and nothing else (LAI-770)               */
/* -------------------------------------------------------------------------- */

/**
 * A Laika tool, as the agents name it: `mcp__laika__start_working` (Claude
 * Code; `mcp__plugin_laika_laika__…` through the plugin), `laika__…` or
 * `mcp__laika__…` (Codex). Another server's `update_status` is not Laika's.
 */
const LAIKA_TOOL =
  /^(?:mcp__)?(?:[A-Za-z0-9_-]*_)?laika__(start_working|update_status|finish_task)$/;
/** Gemini CLI names a server's tool by its own name while no other server has it. */
const BARE_TOOL = /^(start_working|update_status|finish_task)$/;
/**
 * A task key as the server takes it: a Laika key (SPEC §4.3) or a card's
 * outside id (LAI-780) — a prefix of 1–16 letters, digits and `_`, a dash and
 * 1–9 digits, which every board key fits.
 */
const TASK_KEY = /^[A-Z][A-Z0-9_]{0,15}-[0-9]{1,9}$/;
/** `in_progress`, or a project's own status that says so: `In progress`, `in-progress`. */
const IN_PROGRESS = /^in[ _-]?progress$/i;
/**
 * Key-shaped runs of a branch name, in order: `LAI-42-x`, `feature/lai-42`,
 * `data_eng-12`. A run may hold underscores, so it is read for every key it
 * ends in — `feature_lai-42` is `FEATURE_LAI-42`, then `LAI-42`.
 */
const BRANCH_KEY = /(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9_]*-[0-9]{1,9})(?![0-9])/g;

/** A task reference as a key — upper-cased, as the board takes it — or nothing. */
function keyOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toUpperCase();
  return TASK_KEY.test(key) ? key : undefined;
}

/**
 * The keys a branch name carries, space-separated, longest first within a
 * run: the branch itself is never kept. Which one counts is the board's
 * prefixes' to say (`attributor`).
 */
function branchKeys(branch: unknown): string {
  if (typeof branch !== 'string' || branch.length > 255) return '';
  const keys: string[] = [];
  for (const match of branch.matchAll(BRANCH_KEY)) {
    const run = match[1] ?? '';
    // The run itself, then what follows each underscore in it.
    const starts = [0];
    for (let i = run.indexOf('_'); i !== -1; i = run.indexOf('_', i + 1)) starts.push(i + 1);
    for (const at of starts) {
      const key = keyOf(run.slice(at));
      if (key !== undefined && !keys.includes(key)) keys.push(key);
    }
  }
  return keys.join(' ');
}

/**
 * What a Laika call says about the work, from its tool's name and its `task`
 * and `status` alone: `start_working` and a move into progress start work on
 * the task; `finish_task` and any other move end it. `key: null` is a task
 * named by its id.
 */
function markOf(tool: string, input: unknown): { key: string | null; kind: 0 | 1 } | undefined {
  const name = LAIKA_TOOL.exec(tool)?.[1] ?? BARE_TOOL.exec(tool)?.[1];
  if (name === undefined || !isRecord(input) || typeof input.task !== 'string') return undefined;
  const key = keyOf(input.task) ?? null;
  if (name === 'start_working') return { key, kind: 1 };
  if (name === 'finish_task') return { key, kind: 0 };
  if (typeof input.status !== 'string') return undefined;
  return { key, kind: IN_PROGRESS.test(input.status.trim()) ? 1 : 0 };
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* -------------------------------------------------------------------------- */

type Kind = 'claude' | 'codex' | 'gemini';

const MATCH: Readonly<Record<Kind, (name: string) => boolean>> = {
  claude: (name) => name.endsWith('.jsonl'),
  codex: (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'),
  gemini: (name) => name.startsWith('session-') && name.endsWith('.json'),
};

async function statOf(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: Math.floor(s.mtimeMs) };
  } catch {
    return undefined;
  }
}

/**
 * Every session file under `root`: each directory listed again only when its
 * own mtime moved, which is when an entry was added or removed. A directory
 * that is gone is dropped from the cache.
 */
async function discover(
  root: string,
  kind: Kind,
  dirs: Record<string, DirEntry>,
  seen: Set<string>,
): Promise<string[]> {
  const files: string[] = [];
  let level = [root];
  while (level.length > 0) {
    const next: string[] = [];
    const stats = await Promise.all(level.map((dir) => statOf(dir)));
    await Promise.all(
      level.map(async (dir, i) => {
        const st = stats[i];
        if (st === undefined) return;
        seen.add(dir);
        let entry = dirs[dir];
        if (entry?.m !== st.mtimeMs) {
          const listed: DirEntry = { m: st.mtimeMs, d: [], f: [] };
          try {
            for (const e of await readdir(dir, { withFileTypes: true })) {
              if (e.isDirectory()) listed.d.push(e.name);
              else if (e.isFile() && MATCH[kind](e.name)) listed.f.push(e.name);
            }
          } catch {
            return;
          }
          entry = listed;
          dirs[dir] = entry;
        }
        for (const name of entry.f) files.push(join(dir, name));
        for (const name of entry.d) next.push(join(dir, name));
      }),
    );
    level = next;
  }
  return files;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The complete lines of `path` from byte `from`, to the last newline. With
 * `needles`, only the lines that hold one are handed over, each once, in
 * order — found with a byte search, so a transcript's text is never decoded
 * unless its line carries a usage or a refused call's result. Returns where
 * the next read starts.
 */
async function readLines(
  path: string,
  from: number,
  needles: readonly Buffer[] | undefined,
  onLine: (line: string) => void,
): Promise<number> {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    let position = from;
    let want = CHUNK_BYTES;
    let buffer = Buffer.allocUnsafe(want);
    while (position < size) {
      const length = Math.min(want, size - position);
      if (buffer.length < length) buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) break;
      const last = buffer.lastIndexOf(10, bytesRead - 1);
      if (last === -1) {
        // One line longer than the chunk, or a line still being written.
        if (position + bytesRead >= size) break;
        want *= 2;
        continue;
      }
      const view = buffer.subarray(0, last + 1);
      if (needles === undefined) {
        let start = 0;
        while (start < view.length) {
          const end = view.indexOf(10, start);
          if (end > start) onLine(view.toString('utf8', start, end));
          start = end + 1;
        }
      } else {
        // Each needle's next hit, searched again only once the reading has
        // passed it: a rare needle is not scanned for afresh at every line.
        const next = needles.map((n) => view.indexOf(n));
        let after = 0;
        for (;;) {
          let at = -1;
          for (let i = 0; i < needles.length; i += 1) {
            let hit = next[i] ?? -1;
            if (hit !== -1 && hit < after) {
              hit = view.indexOf(needles[i] ?? Buffer.alloc(0), after);
              next[i] = hit;
            }
            if (hit !== -1 && (at === -1 || hit < at)) at = hit;
          }
          if (at === -1) break;
          const start = view.lastIndexOf(10, at) + 1;
          const end = view.indexOf(10, at);
          onLine(view.toString('utf8', start, end));
          after = end + 1;
        }
      }
      position += last + 1;
      want = CHUNK_BYTES;
    }
    return position;
  } finally {
    await handle.close();
  }
}

/** A JSON key followed by an object: never inside a JSON string, where `"` is `\"`. */
const CLAUDE_NEEDLE = Buffer.from('"usage":{');
/** A tool result the agent was told failed — read only for a Laika mark's id. */
const REFUSED_NEEDLE = Buffer.from('"is_error":true');
const TOOL_RESULT_ID = /"tool_use_id":"([A-Za-z0-9_-]{1,128})"/g;

interface Reader {
  readonly data: UsageData;
  readonly dayOf: (epochS: number) => string;
  readonly firstDay: string;
  readonly windowStartS: number;
  cwd: (path: unknown) => number;
  /** A session id's index in the local table, or -1 for none. */
  session: (id: unknown) => number;
  /** A subagent's lane in the local table, or -1 for the session's own thread. */
  lane: (agentId: unknown) => number;
  /** A branch's keys in the local table: −1 for a branch with none, −2 for no branch. */
  branch: (name: unknown) => number;
  /**
   * Keep a Laika call's mark under its id — the first seen, unless `again`
   * (a file that is read whole each time, whose call's status may have moved).
   */
  mark: (
    id: unknown,
    session: number,
    lane: number,
    atS: number,
    tool: string,
    input: unknown,
    state: 0 | typeof REFUSED | typeof UNANSWERED,
    again?: boolean,
  ) => void;
}

/** One Claude Code line: a reply's usage, folded into its message id's maximum. */
function claudeLine(reader: Reader, line: string): void {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(record) || record.type !== 'assistant') return;
  const message = record.message;
  if (!isRecord(message)) return;
  const at = epochOf(record.timestamp);
  // A Laika call sits on its reply's line. Kept even from before the window:
  // a mark there still says what the window's first replies were for. A
  // reply written on several lines is timed from its first, and so is a mark
  // on a later one of them: the whole reply is the mark's (review, item 1).
  if (Array.isArray(message.content) && at !== undefined) {
    const first = typeof message.id === 'string' ? reader.data.claude[message.id]?.[6] : undefined;
    for (const block of message.content as unknown[]) {
      if (!isRecord(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      if (!LAIKA_TOOL.test(block.name)) continue;
      reader.mark(
        block.id,
        reader.session(record.sessionId),
        reader.lane(record.agentId),
        first === undefined ? at : Math.min(first, at),
        block.name,
        block.input,
        0,
      );
    }
  }
  if (typeof message.id !== 'string' || message.id === '') return;
  const usage = message.usage;
  if (!isRecord(usage)) return;
  const model = modelId(message.model);
  if (model === undefined || at === undefined || at < reader.windowStartS) return;
  const day = reader.dayOf(at);
  if (day < reader.firstDay) return;
  // `iterations` sum to the top level already: never added in (REPORT.md §1a).
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const write = count(usage.cache_creation_input_tokens);
  const read = count(usage.cache_read_input_tokens);
  const held = reader.data.claude[message.id];
  if (held === undefined) {
    reader.data.claude[message.id] = [
      day,
      model,
      input,
      output,
      write,
      read,
      at,
      reader.cwd(record.cwd),
      // A subagent's file carries its parent's session id (REPORT.md §1a).
      reader.session(record.sessionId),
      reader.lane(record.agentId),
      reader.branch(record.gitBranch),
    ];
    return;
  }
  // The first line seen keeps the day and the model; each count is the largest.
  held[2] = Math.max(held[2], input);
  held[3] = Math.max(held[3], output);
  held[4] = Math.max(held[4], write);
  held[5] = Math.max(held[5], read);
}

/**
 * A Claude Code tool result marked `is_error`: when it answers a Laika mark,
 * the mark is taken back — the board refused it. Decoded only when it names
 * a mark's id.
 */
function claudeRefusal(reader: Reader, line: string): void {
  let held = false;
  for (const match of line.matchAll(TOOL_RESULT_ID)) {
    if (reader.data.marks[match[1] ?? ''] !== undefined) held = true;
  }
  if (!held) return;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(record) || !isRecord(record.message)) return;
  const content = record.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content as unknown[]) {
    if (!isRecord(block) || block.type !== 'tool_result' || block.is_error !== true) continue;
    const mark =
      typeof block.tool_use_id === 'string' ? reader.data.marks[block.tool_use_id] : undefined;
    if (mark !== undefined) mark[5] = REFUSED;
  }
}

const CODEX_CALL_ID = /"call_id":"([A-Za-z0-9_-]{1,128})"/g;

/**
 * What an MCP answer says about success: `true` taken, `false` refused,
 * `undefined` when it does not say — Codex keeps a tool's result as JSON
 * (`{ content, isError }`), and a refusal from the board is `{ error }`.
 */
function answered(result: unknown): boolean | undefined {
  if (!isRecord(result)) return undefined;
  if (result.isError === true || isRecord(result.error)) return false;
  if (result.isError === false || Array.isArray(result.content)) return true;
  return undefined;
}

/**
 * A Codex call's answer, for a Laika call already held (review, B1): its
 * `function_call_output`, or the `mcp_tool_call_end` event beside it. Only
 * whether it was taken is kept — never what it said — and a refusal from
 * either holds: a call that came back refused is never a mark.
 */
function codexAnswer(reader: Reader, line: string): void {
  let held = false;
  for (const match of line.matchAll(CODEX_CALL_ID)) {
    if (reader.data.marks[`codex:${match[1] ?? ''}`] !== undefined) held = true;
  }
  if (!held) return;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(record) || !isRecord(record.payload)) return;
  const payload = record.payload;
  if (typeof payload.call_id !== 'string') return;
  const mark = reader.data.marks[`codex:${payload.call_id}`];
  if (mark === undefined || mark[5] === REFUSED) return;
  let taken: boolean | undefined;
  if (record.type === 'response_item' && payload.type === 'function_call_output') {
    try {
      taken = answered(
        typeof payload.output === 'string' ? JSON.parse(payload.output) : payload.output,
      );
    } catch {
      taken = undefined;
    }
  } else if (record.type === 'event_msg' && payload.type === 'mcp_tool_call_end') {
    const result = payload.result;
    if (isRecord(result) && 'Err' in result) taken = false;
    else if (isRecord(result)) taken = answered(result.Ok);
  }
  if (taken === false) mark[5] = REFUSED;
  else if (taken === true) mark.length = 5;
}

/** Codex's per-response usage, mapped as its cumulative total is (REPORT.md §2). */
function codexCounts(
  usage: Record<string, unknown>,
): [input: number, output: number, write: number, cached: number] {
  const cached = count(usage.cached_input_tokens);
  const write = count(usage.cache_write_input_tokens);
  return [
    Math.max(0, count(usage.input_tokens) - cached - write),
    count(usage.output_tokens),
    write,
    cached,
  ];
}

/**
 * One Codex line: the session, model and directory in force; each
 * cumulative total's difference; and, in newer rollouts, each response's own
 * record — which, when a rollout has them, is what counts (see `CodexFile.r`).
 */
function codexLine(reader: Reader, file: CodexFile, line: string): void {
  if (
    !line.includes('"token_count"') &&
    !line.includes('"turn_context"') &&
    !line.includes('"session_meta"') &&
    !line.includes('"token_usage_record"') &&
    !(line.includes('"function_call"') && line.includes('laika__'))
  ) {
    if (line.includes('"function_call_output"') || line.includes('"mcp_tool_call_end"')) {
      codexAnswer(reader, line);
    }
    return;
  }
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(record) || !isRecord(record.payload)) return;
  const payload = record.payload;
  if (record.type === 'session_meta' || record.type === 'turn_context') {
    if (typeof payload.cwd === 'string') file.cwd = reader.cwd(payload.cwd);
    const model = modelId(payload.model);
    if (model !== undefined) file.model = model;
    if (record.type === 'session_meta') {
      const sid = reader.session(payload.id ?? payload.session_id);
      if (sid >= 0) file.sid = sid;
      if (isRecord(payload.git) && typeof payload.git.branch === 'string') {
        file.br = reader.branch(payload.git.branch);
      }
    }
    return;
  }
  if (record.type === 'response_item' && payload.type === 'function_call') {
    const at = epochOf(record.timestamp);
    if (typeof payload.name !== 'string' || !LAIKA_TOOL.test(payload.name) || at === undefined) {
      return;
    }
    let args: unknown;
    try {
      args = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : undefined;
    } catch {
      return;
    }
    const id = typeof payload.call_id === 'string' ? `codex:${payload.call_id}` : undefined;
    // Not a mark until its answer is read and says it was taken (review, B1).
    reader.mark(id, file.sid ?? -1, -1, at, payload.name, args, UNANSWERED);
    return;
  }
  if (record.type === 'token_usage_record') {
    if (typeof payload.response_id !== 'string' || !isRecord(payload.usage)) return;
    const at = epochOf(record.timestamp);
    if (at === undefined || at < reader.windowStartS) return;
    const day = reader.dayOf(at);
    if (day < reader.firstDay) return;
    const [input, output, write, cached] = codexCounts(payload.usage);
    const sid = reader.session(payload.session_id);
    (file.r ??= {})[payload.response_id] = [
      day,
      file.model,
      input,
      output,
      write,
      cached,
      at,
      file.cwd,
      sid >= 0 ? sid : (file.sid ?? -1),
      -1,
      file.br ?? NO_BRANCH,
    ];
    return;
  }
  if (record.type !== 'event_msg' || payload.type !== 'token_count') return;
  const info = payload.info;
  if (!isRecord(info) || !isRecord(info.total_token_usage)) return;
  const total = info.total_token_usage;
  const now: [number, number, number, number] = [
    count(total.input_tokens),
    count(total.cached_input_tokens),
    count(total.cache_write_input_tokens),
    count(total.output_tokens),
  ];
  // A total that went down started again: everything in it is new.
  const reset = now.some((n, i) => n < file.prev[i]!);
  const base = reset ? [0, 0, 0, 0] : file.prev;
  const delta = now.map((n, i) => n - base[i]!) as [number, number, number, number];
  file.prev = now;
  if (delta.every((n) => n === 0)) return;
  const at = epochOf(record.timestamp);
  if (at === undefined || at < reader.windowStartS) return;
  const day = reader.dayOf(at);
  if (day < reader.firstDay) return;
  // Codex's input includes the cached part (and any cache write); output
  // includes reasoning (REPORT.md §2).
  const [input, cached, write, output] = delta;
  file.ev.push([
    day,
    file.model,
    Math.max(0, input - cached - write),
    output,
    write,
    cached,
    at,
    file.cwd,
    file.sid ?? -1,
    -1,
    file.br ?? NO_BRANCH,
  ]);
}

/** A whole Gemini CLI session file: every model message's tokens, by its id. */
function geminiFile(reader: Reader, text: string): GeminiFile | undefined {
  let session: unknown;
  try {
    session = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(session) || !Array.isArray(session.messages)) return undefined;
  const cwd = reader.cwd(
    typeof session.projectHash === 'string' ? `gemini:${session.projectHash}` : undefined,
  );
  const sid = reader.session(session.sessionId);
  const m: Record<string, Rec> = {};
  for (const message of session.messages as unknown[]) {
    if (!isRecord(message) || typeof message.id !== 'string' || !isRecord(message.tokens)) continue;
    const model = modelId(message.model);
    const at = epochOf(message.timestamp);
    if (model === undefined || at === undefined || at < reader.windowStartS) continue;
    const day = reader.dayOf(at);
    if (day < reader.firstDay) continue;
    // Its Laika calls: a call that failed or was cancelled is no mark.
    for (const call of Array.isArray(message.toolCalls) ? (message.toolCalls as unknown[]) : []) {
      if (!isRecord(call) || typeof call.name !== 'string') continue;
      reader.mark(
        typeof call.id === 'string' ? `gemini:${call.id}` : undefined,
        sid,
        -1,
        epochOf(call.timestamp) ?? at,
        call.name,
        call.args,
        call.status === 'error' || call.status === 'cancelled' ? REFUSED : 0,
        true,
      );
    }
    const t = message.tokens;
    const cached = count(t.cached);
    // Gemini's input includes the cached part; thoughts are output, tool input is input.
    m[message.id] = [
      day,
      model,
      Math.max(0, count(t.input) - cached) + count(t.tool),
      count(t.output) + count(t.thoughts),
      0,
      cached,
      at,
      cwd,
      sid,
      -1,
      NO_BRANCH,
    ];
  }
  return { m };
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                   */
/* -------------------------------------------------------------------------- */

export interface UsageStats {
  /** Session files found. */
  files: number;
  /** Of them, the ones with something new. */
  changed: number;
  /** Bytes read. */
  bytes: number;
}

export interface UsageReadOptions {
  readonly paths: ActivityPaths;
  readonly roots: UsageRoots;
  readonly state: ActivityState;
  readonly tz: string;
  readonly nowS: number;
  /** Read and count, but write nothing back — `status`. */
  readonly dryRun?: boolean;
  /** `Date.now()` past which no further file is started. */
  readonly stopAt?: number;
  readonly signal?: AbortSignal;
  /** Count the whole window whatever was answered — what `backfill` shows before it asks. */
  readonly all?: boolean;
  /**
   * The board's `task_prefixes` from this sync's sharing answer (LAI-770):
   * kept in the index, so the last answer holds when one names none.
   */
  readonly prefixes?: readonly string[] | undefined;
}

interface Scan {
  readonly index: UsageIndex;
  /** Loaded when anything had to be read, or when asked for. */
  data: UsageData | undefined;
  readonly stats: UsageStats;
  /** Every file was read to its end. */
  readonly complete: boolean;
}

/** The window's first day, and the instant it starts at the earliest. */
function windowOf(nowS: number, tz: string): { firstDay: string; startS: number } {
  const firstDay = addDays(localDay(nowS, tz), -(USAGE_WINDOW_DAYS - 1));
  // A day starts at most 14 hours before its UTC midnight.
  return { firstDay, startS: Math.floor(Date.parse(`${firstDay}T00:00:00Z`) / 1000) - 14 * 3600 };
}

async function scan(options: UsageReadOptions, wantData: boolean): Promise<Scan> {
  const { paths, roots, tz, nowS } = options;
  let index = readIndex(paths);
  // Offsets live with the records: without the data file, every file is new.
  if (!existsSync(usageDataFile(paths)) && Object.keys(index.files).length > 0) {
    index = { ...index, files: {}, sent: index.sent };
  }
  // Records from before this format carry no marks: every file is read once more.
  if (index.data_v !== DATA_V) {
    index = { ...index, files: {}, data_v: DATA_V, dirty: true };
  }
  const seenDirs = new Set<string>();
  const found: [Kind, string][] = [];
  for (const kind of ['claude', 'codex', 'gemini'] as const) {
    for (const path of await discover(roots[kind], kind, index.dirs, seenDirs)) {
      found.push([kind, path]);
    }
  }
  for (const dir of Object.keys(index.dirs)) if (!seenDirs.has(dir)) delete index.dirs[dir];

  const stats = await Promise.all(found.map(([, path]) => statOf(path)));
  const changed: { kind: Kind; path: string; size: number; mtimeMs: number }[] = [];
  const present = new Set<string>();
  found.forEach(([kind, path], i) => {
    const st = stats[i];
    if (st === undefined) return;
    present.add(path);
    const held = index.files[path];
    if (held?.s === st.size && held.m === st.mtimeMs) return;
    changed.push({ kind, path, size: st.size, mtimeMs: st.mtimeMs });
  });
  const gone = Object.keys(index.files).filter((path) => !present.has(path));

  // A session the hook marked since the last read changes what is sent
  // (LAI-775), though no session file did.
  const skip = skipSignature(paths);
  if (skip !== index.skip) {
    index.skip = skip;
    index.dirty = true;
    if (options.dryRun !== true && changed.length === 0 && gone.length === 0) {
      writeIndex(paths, index);
    }
  }

  const result = { files: present.size, changed: 0, bytes: 0 };
  if (changed.length === 0 && gone.length === 0) {
    return {
      index,
      data: wantData ? (readData(paths, tz) ?? emptyData(tz)) : undefined,
      stats: result,
      complete: true,
    };
  }

  const data = readData(paths, tz) ?? emptyData(tz);
  const { firstDay, startS } = windowOf(nowS, tz);
  const dayOf = dayFinder(tz);
  if (data.tz !== tz) {
    // The machine moved zone: every kept day is computed again in the new one.
    for (const rec of allRecords(data)) rec[0] = dayOf(rec[6]);
    data.tz = tz;
  }
  const cwdIndex = new Map(data.cwds.map((c, i) => [c, i]));
  const sessionIndex = new Map(data.sessions.map((id, i) => [id, i]));
  const tableOf = (table: string[]) => {
    const at = new Map(table.map((v, i) => [v, i]));
    return (value: string): number => {
      let i = at.get(value);
      if (i === undefined) {
        i = table.length;
        table.push(value);
        at.set(value, i);
      }
      return i;
    };
  };
  const laneOf = tableOf(data.lanes);
  const branchOf = tableOf(data.branches);
  const keyIndex = tableOf(data.keys);
  const reader: Reader = {
    data,
    dayOf,
    firstDay,
    windowStartS: startS,
    cwd: (value) => {
      if (typeof value !== 'string' || value === '') return -1;
      let i = cwdIndex.get(value);
      if (i === undefined) {
        i = data.cwds.length;
        data.cwds.push(value);
        cwdIndex.set(value, i);
      }
      return i;
    },
    session: (value) => {
      if (typeof value !== 'string' || !SESSION_ID.test(value)) return -1;
      let i = sessionIndex.get(value);
      if (i === undefined) {
        i = data.sessions.length;
        data.sessions.push(value);
        sessionIndex.set(value, i);
      }
      return i;
    },
    lane: (value) => (typeof value === 'string' && SESSION_ID.test(value) ? laneOf(value) : -1),
    branch: (value) => {
      if (typeof value !== 'string') return NO_BRANCH;
      const keys = branchKeys(value);
      return keys === '' ? -1 : branchOf(keys);
    },
    mark: (id, session, lane, atS, tool, input, state, again) => {
      if (typeof id !== 'string' || id === '' || id.length > 160) return;
      if (data.marks[id] !== undefined && again !== true) return;
      const said = markOf(tool, input);
      if (said === undefined) return;
      const mark: Mark = [
        session,
        lane,
        atS,
        said.key === null ? BY_ID : keyIndex(said.key),
        said.kind,
      ];
      if (state !== 0) mark[5] = state;
      data.marks[id] = mark;
    },
  };

  // A file that is gone took no tokens back: its records stay until they
  // leave the window, and only what said where to read next is dropped.
  for (const path of gone) {
    delete index.files[path];
    delete data.offsets[path];
  }

  let complete = true;
  for (const file of changed) {
    if (
      options.signal?.aborted === true ||
      (options.stopAt !== undefined && Date.now() > options.stopAt)
    ) {
      complete = false;
      break;
    }
    try {
      if (file.kind === 'claude') {
        let from = data.offsets[file.path] ?? 0;
        // Shorter than what was read: rewritten. Replies are kept by id, so
        // reading it again from the start counts nothing twice.
        if (file.size < from) from = 0;
        if (from === 0 && index.files[file.path] === undefined && file.mtimeMs / 1000 < startS) {
          // Untouched since before the window: nothing in it can count.
          data.offsets[file.path] = file.size;
        } else {
          const to = await readLines(file.path, from, [CLAUDE_NEEDLE, REFUSED_NEEDLE], (line) => {
            if (line.includes('"usage":{')) claudeLine(reader, line);
            else claudeRefusal(reader, line);
          });
          result.bytes += to - from;
          data.offsets[file.path] = to;
        }
      } else if (file.kind === 'codex') {
        let state = data.codex[file.path];
        // A rollout that shrank starts again, with its records.
        if (state === undefined || file.size < state.o) {
          state = { o: 0, prev: [0, 0, 0, 0], model: 'other', cwd: -1, ev: [] };
        }
        const codexState = state;
        const to = await readLines(file.path, codexState.o, undefined, (line) => {
          codexLine(reader, codexState, line);
        });
        result.bytes += to - codexState.o;
        codexState.o = to;
        data.codex[file.path] = codexState;
      } else {
        const text = await readFile(file.path, 'utf8');
        result.bytes += Buffer.byteLength(text);
        const parsed = geminiFile(reader, text);
        // A file caught half-written is read again next time.
        if (parsed === undefined) continue;
        data.gemini[file.path] = parsed;
      }
    } catch {
      // Unreadable now — gone, or a permission — and tried again next time.
      continue;
    }
    index.files[file.path] = { s: file.size, m: file.mtimeMs };
    result.changed += 1;
  }

  prune(data, firstDay, startS, present);
  index.dirty = true;
  if (options.dryRun !== true) {
    // The records first: an index ahead of its data would skip bytes never kept.
    writeData(paths, data);
    writeIndex(paths, index);
  }
  return { index, data, stats: result, complete };
}

function* allRecords(data: UsageData): Generator<Rec> {
  yield* Object.values(data.claude);
  for (const file of Object.values(data.codex)) {
    yield* file.ev;
    yield* Object.values(file.r ?? {});
  }
  for (const file of Object.values(data.gemini)) yield* Object.values(file.m);
}

/**
 * Drop what has left the window — nothing older is ever sent — and the state
 * of a file that is gone once none of its records is left.
 */
function prune(
  data: UsageData,
  firstDay: string,
  startS: number,
  present: ReadonlySet<string>,
): void {
  for (const [id, rec] of Object.entries(data.claude)) {
    if (rec[0] < firstDay) delete data.claude[id];
  }
  // Marks from before the window: the last of each thread is kept — it may
  // still say what the window's first replies were for — and the rest go.
  const lastBefore = new Map<string, [string, number]>();
  for (const [id, m] of Object.entries(data.marks)) {
    if (m[2] >= startS) continue;
    const thread = `${String(m[0])}:${String(m[1])}`;
    const held = lastBefore.get(thread);
    if (held === undefined || m[2] > held[1]) {
      if (held !== undefined) delete data.marks[held[0]];
      lastBefore.set(thread, [id, m[2]]);
    } else {
      delete data.marks[id];
    }
  }
  for (const [path, file] of Object.entries(data.codex)) {
    file.ev = file.ev.filter((e) => e[0] >= firstDay);
    for (const [id, rec] of Object.entries(file.r ?? {})) {
      if (rec[0] < firstDay) delete file.r?.[id];
    }
    const records = Object.keys(file.r ?? {}).length;
    if (file.ev.length === 0 && records === 0 && !present.has(path)) delete data.codex[path];
  }
  for (const [path, file] of Object.entries(data.gemini)) {
    for (const [id, rec] of Object.entries(file.m)) if (rec[0] < firstDay) delete file.m[id];
    if (Object.keys(file.m).length === 0 && !present.has(path)) delete data.gemini[path];
  }
}

/* -------------------------------------------------------------------------- */
/* The developer's scope (D-079 item 4)                                       */
/* -------------------------------------------------------------------------- */

/** The repository a working directory is in: the nearest parent holding `.git`. */
function toplevelOf(cwd: string): string | undefined {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Which working directories are in scope under `laika-repos`: in a repository
 * whose instructions carry the Laika block (the rule the snapshot uses). A
 * Gemini session names its project by a hash of the directory it started in,
 * so it is in scope when that hash is one of a Laika repository's.
 */
async function scopeFilter(
  data: UsageData,
  paths: ActivityPaths,
  nowS: number,
): Promise<(cwd: number) => boolean> {
  const decided = new Map<number, boolean>();
  const laikaHashes = new Set<string>();
  const check = async (dir: string): Promise<boolean> => {
    const held = data.scope[dir];
    if (held !== undefined && nowS - held[1] < SCOPE_TTL_S) return held[0];
    const top = toplevelOf(dir);
    const inScope = top !== undefined && (await hasLaikaBlock(top));
    data.scope[dir] = [inScope, nowS];
    return inScope;
  };
  for (const repo of rememberedRepos(paths, nowS)) {
    if (await check(repo.path)) laikaHashes.add(sha256(repo.path));
  }
  for (const [i, dir] of data.cwds.entries()) {
    if (dir.startsWith('gemini:')) continue;
    const inScope = await check(dir);
    decided.set(i, inScope);
    if (inScope) {
      laikaHashes.add(sha256(dir));
      const top = toplevelOf(dir);
      if (top !== undefined) laikaHashes.add(sha256(top));
    }
  }
  for (const [i, dir] of data.cwds.entries()) {
    if (dir.startsWith('gemini:')) decided.set(i, laikaHashes.has(dir.slice(7)));
  }
  return (cwd) => decided.get(cwd) === true;
}

/* -------------------------------------------------------------------------- */
/* Which task a reply was for (LAI-770)                                       */
/* -------------------------------------------------------------------------- */

/** No task marked in force: the branch may still say. */
const NONE = -3;
/** A task named by its id: unattributed, and not for the branch to guess. */
const BY_ID = -1;

/** One thread's marks as what is in force from each moment: times rising, keys beside them. */
interface Timeline {
  readonly at: number[];
  readonly key: number[];
}

/** What was in force at `atS` on a thread, or `undefined` before its first mark. */
function inForce(line: Timeline | undefined, atS: number): number | undefined {
  if (line === undefined || line.at.length === 0 || (line.at[0] ?? Infinity) > atS)
    return undefined;
  let lo = 0;
  let hi = line.at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((line.at[mid] ?? Infinity) <= atS) lo = mid;
    else hi = mid - 1;
  }
  return line.key[lo];
}

/**
 * Each reply's task key, or `null`:
 *
 * Nothing at all until the board has named its prefixes.
 *
 * 1. **The mark in force** on the reply's thread at its time — its subagent's
 *    own, else its session's. A mark starts at its own line; a mark that ends
 *    work takes effect after its line, whose reply wrote the finish. A key
 *    whose prefix the board does not serve is another board's task, and a
 *    task named by id cannot be sent: both unattributed.
 * 2. **Else a key in the branch**, the record's own or, for a file that names
 *   none, the branch the hook saw at the session's start — when the board
 *   serves its prefix. Until the board has named its prefixes, none counts.
 * 3. **Else `null`**.
 */
function attributor(
  data: UsageData,
  prefixes: readonly string[] | undefined,
  starts: ReadonlyMap<string, readonly [number, string][]>,
): (rec: Rec) => string | null {
  // Until the board has named its prefixes nothing is tied — a mark no more
  // than a branch — so a key-shaped argument to another server's tool of the
  // same name (Gemini CLI's bare names) never goes (review, item 2).
  if (prefixes === undefined) return () => null;
  const served = new Set(prefixes);
  const serves = (key: string): boolean => served.has(key.slice(0, key.lastIndexOf('-')));

  const byThread = new Map<string, [number, number, 0 | 1][]>();
  for (const m of Object.values(data.marks)) {
    if ((m[5] ?? 0) !== 0 || m[0] < 0) continue;
    const thread = `${String(m[0])}:${String(m[1])}`;
    const list = byThread.get(thread) ?? [];
    // Work starts at the mark's line and ends just after it.
    list.push([m[4] === 1 ? m[2] : m[2] + 1, m[3], m[4]]);
    byThread.set(thread, list);
  }
  const timelines = new Map<string, Timeline>();
  for (const [thread, list] of byThread) {
    list.sort((a, b) => a[0] - b[0]);
    const line: Timeline = { at: [], key: [] };
    let current = NONE;
    for (const [at, key, kind] of list) {
      if (kind === 1) current = key;
      else if (current === key) current = NONE;
      line.at.push(at);
      line.key.push(current);
    }
    timelines.set(thread, line);
  }
  const sessionsWithMarks = new Set([...byThread.keys()].map((t) => t.split(':')[0]));

  const fromBranch = (keys: string | undefined): string | null => {
    if (keys === undefined || keys === '') return null;
    for (const key of keys.split(' ')) if (serves(key)) return key;
    return null;
  };

  return (rec) => {
    const session = rec[8] ?? -1;
    const at = rec[6];
    if (session >= 0 && sessionsWithMarks.has(String(session))) {
      const lane = rec[9] ?? -1;
      const own =
        lane >= 0 ? inForce(timelines.get(`${String(session)}:${String(lane)}`), at) : undefined;
      const state = own ?? inForce(timelines.get(`${String(session)}:-1`), at) ?? NONE;
      if (state === BY_ID) return null;
      if (state >= 0) {
        const key = data.keys[state];
        return key !== undefined && serves(key) ? key : null;
      }
    }
    const branch = rec[10] ?? NO_BRANCH;
    if (branch >= 0) return fromBranch(data.branches[branch]);
    if (branch === -1 || session < 0) return null;
    const list = starts.get(data.sessions[session] ?? '');
    if (list === undefined || list.length === 0) return null;
    let chosen = list[0];
    for (const start of list) if (start[0] <= at) chosen = start;
    return fromBranch(chosen?.[1]);
  };
}

/* -------------------------------------------------------------------------- */
/* Days                                                                       */
/* -------------------------------------------------------------------------- */

/** Per day in the window, the rows a report would carry, oldest day first. */
interface Days {
  /** Per day in the window, the rows a report would carry, oldest day first. */
  readonly rows: Map<string, UsageRow[]>;
  /** Days whose rows include tokens from before counting began — the backfill. */
  readonly older: ReadonlySet<string>;
}

/**
 * The window's rows per day, by these rules:
 *
 * - **From when counting began** (`state.since`); with a yes to the 30 days,
 *   older tokens too — except on a day in `held`, which another collector of
 *   this person already reported, so its older tokens are left out and only
 *   what came since is sent (LAI-769 review 1). `held: 'unknown'` — the board
 *   has not said yet — leaves every older token out. `all` counts everything:
 *   what `backfill` shows before it asks.
 * - **Never an automated session's** (LAI-775): a record whose session the
 *   hook marked in `skip-sessions` is left out, subagents included.
 * - **A Codex rollout with per-response records counts those**, each response
 *   once across every rollout; one without counts its total's differences.
 */
async function daysOf(
  data: UsageData,
  options: UsageReadOptions,
  backfill: 'yes' | 'no' | undefined,
  held: readonly string[] | 'unknown',
  prefixes: readonly string[] | undefined,
): Promise<Days> {
  const { firstDay } = windowOf(options.nowS, options.tz);
  if (data.tz !== options.tz) {
    // The machine moved zone since these were read: their days, in the new one.
    const dayOf = dayFinder(options.tz);
    for (const rec of allRecords(data)) rec[0] = dayOf(rec[6]);
    data.tz = options.tz;
  }
  const sinceS = options.state.since;
  const all = options.all === true;
  const older = backfill === 'yes' || all;
  const heldDays = new Set(held === 'unknown' ? [] : held);
  const skip = skippedSessions(options.paths);
  const skippedIndex = new Set(data.sessions.flatMap((id, i) => (skip.has(id) ? [i] : [])));
  const inScope =
    options.state.scope === 'laika-repos'
      ? await scopeFilter(data, options.paths, options.nowS)
      : () => true;
  const taskOf = attributor(data, prefixes, sessionStarts(options.paths));

  const days = new Map<string, Map<string, UsageRow>>();
  const olderDays = new Set<string>();
  const add = (agent: UsageAgent, rec: Rec): void => {
    if (rec[0] < firstDay || !inScope(rec[7])) return;
    if (rec[8] !== undefined && skippedIndex.has(rec[8])) return;
    if (rec[6] < sinceS) {
      if (!older) return;
      if (!all && (held === 'unknown' || heldDays.has(rec[0]))) return;
      olderDays.add(rec[0]);
    }
    let rows = days.get(rec[0]);
    if (rows === undefined) {
      rows = new Map();
      days.set(rec[0], rows);
    }
    // The 30 days counted once from files already here go unattributed
    // (D-084 item 11): a task is tied from when counting began.
    const task = rec[6] < sinceS ? null : taskOf(rec);
    const key = `${agent} ${rec[1]} ${task ?? ''}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = {
        agent,
        model: rec[1],
        task,
        input: 0,
        output: 0,
        cache_write: 0,
        cache_read: 0,
      };
      rows.set(key, row);
    }
    row.input += rec[2];
    row.output += rec[3];
    row.cache_write += rec[4];
    row.cache_read += rec[5];
  };
  for (const rec of Object.values(data.claude)) add('claude-code', rec);
  const responses = new Set<string>();
  for (const file of Object.values(data.codex)) {
    const records = Object.entries(file.r ?? {});
    if (records.length === 0) {
      for (const rec of file.ev) add('codex', rec);
      continue;
    }
    for (const [id, rec] of records) {
      if (responses.has(id)) continue;
      responses.add(id);
      add('codex', rec);
    }
  }
  const geminiSeen = new Set<string>();
  for (const file of Object.values(data.gemini)) {
    for (const [id, rec] of Object.entries(file.m)) {
      if (geminiSeen.has(id)) continue;
      geminiSeen.add(id);
      add('gemini-cli', rec);
    }
  }

  const out = new Map<string, UsageRow[]>();
  for (const day of [...days.keys()].sort()) {
    const rows = [...(days.get(day)?.values() ?? [])]
      .map((r) => ({
        ...r,
        input: Math.min(r.input, COUNT_MAX),
        output: Math.min(r.output, COUNT_MAX),
        cache_write: Math.min(r.cache_write, COUNT_MAX),
        cache_read: Math.min(r.cache_read, COUNT_MAX),
      }))
      .filter((r) => r.input + r.output + r.cache_write + r.cache_read > 0)
      .sort(
        (a, b) =>
          a.agent.localeCompare(b.agent) ||
          a.model.localeCompare(b.model) ||
          (a.task ?? '').localeCompare(b.task ?? ''),
      );
    if (rows.length > 0) out.set(day, rows);
  }
  return { rows: out, older: olderDays };
}

export interface UsageRead {
  readonly days: Map<string, UsageRow[]>;
  readonly stats: UsageStats;
}

/**
 * Read what is new and answer the window's rows per day — for tests, `status`
 * and `backfill`. Nothing is sent from here, so a day another collector holds
 * is the board's question, not this one's: none are taken as held unless the
 * caller has the board's answer.
 */
export async function readUsage(
  options: UsageReadOptions & { readonly held?: readonly string[] },
): Promise<UsageRead> {
  const scanned = await scan(options, true);
  const data = scanned.data ?? emptyData(options.tz);
  const { rows } = await daysOf(
    data,
    options,
    scanned.index.backfill,
    options.held ?? scanned.index.held ?? [],
    options.prefixes ?? scanned.index.prefixes,
  );
  return { days: rows, stats: scanned.stats };
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

export interface UsageReport {
  readonly body: string;
  /** The days it carries, each whole. */
  readonly days: readonly string[];
}

/**
 * The days as usage reports of at most 16 KB each, oldest day first. **A day
 * is never split**: the server replaces a (collector, day) with what one
 * report carries, so half a day would be a day's total halved.
 */
export function usageReports(options: {
  readonly collectorId: string;
  readonly tz: string;
  readonly days: readonly {
    readonly day: string;
    /** Tokens from before counting began, sent once marked (SPEC §6.4). */
    readonly backfill?: true | undefined;
    readonly rows: readonly UsageRow[];
  }[];
}): UsageReport[] {
  const base = { v: 1, collector_id: options.collectorId, tz: options.tz, usage: true, days: [] };
  const baseBytes = Buffer.byteLength(JSON.stringify(base));
  const reports: UsageReport[] = [];
  let entries: string[] = [];
  let days: string[] = [];
  let bytes = baseBytes;
  const flush = (): void => {
    if (entries.length === 0) return;
    const body = JSON.stringify(base).replace('"days":[]', `"days":[${entries.join(',')}]`);
    reports.push({ body, days });
    entries = [];
    days = [];
    bytes = baseBytes;
  };
  const sorted = [...options.days].sort((a, b) => a.day.localeCompare(b.day));
  for (const { day, backfill, rows } of sorted) {
    const entry = JSON.stringify({
      day,
      ...(backfill === true ? { backfill } : {}),
      rows: fitted(rows, MAX_BODY_BYTES - baseBytes),
    });
    const cost = Buffer.byteLength(entry) + (entries.length > 0 ? 1 : 0);
    if (bytes + cost > MAX_BODY_BYTES) flush();
    entries.push(entry);
    days.push(day);
    bytes += Buffer.byteLength(entry) + (entries.length > 1 ? 1 : 0);
  }
  flush();
  return reports;
}

/**
 * A day's rows within `room` bytes. Phase 1's rows are one per agent and
 * model, a handful a day; should task rows ever not fit, the smallest are
 * folded into their model's unattributed row — the day's total kept whole.
 */
function fitted(rows: readonly UsageRow[], room: number): UsageRow[] {
  let out = [...rows];
  const size = () => Buffer.byteLength(JSON.stringify(out)) + 30;
  while (size() > room && out.some((r) => r.task !== null)) {
    const smallest = out
      .filter((r) => r.task !== null)
      .sort((a, b) => a.input + a.output + a.cache_write - (b.input + b.output + b.cache_write))[0];
    if (smallest === undefined) break;
    out = out.filter((r) => r !== smallest);
    const home = out.find(
      (r) => r.task === null && r.agent === smallest.agent && r.model === smallest.model,
    );
    if (home === undefined) out.push({ ...smallest, task: null });
    else {
      home.input += smallest.input;
      home.output += smallest.output;
      home.cache_write += smallest.cache_write;
      home.cache_read += smallest.cache_read;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* One step of the sync                                                       */
/* -------------------------------------------------------------------------- */

export interface UsageContext extends UsageReadOptions {
  readonly collectorId: string;
  readonly send: (body: string) => Promise<SendAnswer>;
  /**
   * The board's `usage_days_elsewhere` from this sync's sharing answer: the
   * days other collectors of this person hold tokens for. `undefined` when
   * the board did not say — an older Laika — and then no older token goes.
   */
  readonly heldElsewhere?: readonly string[] | undefined;
}

export type UsageOutcome =
  | { readonly kind: 'idle'; readonly stats: UsageStats }
  | {
      readonly kind: 'sent';
      readonly reports: number;
      readonly days: number;
      /** Days still to send after this run's reports. */
      readonly pending: number;
      readonly stats: UsageStats;
    }
  | { readonly kind: 'waiting'; readonly nextAt: number }
  | { readonly kind: 'rate-limited'; readonly nextAt: number }
  | { readonly kind: 'off' }
  | { readonly kind: 'refused'; readonly message: string; readonly nextAt: number }
  | { readonly kind: 'error'; readonly message: string; readonly nextAt: number };

const signature = (rows: readonly UsageRow[]): string => JSON.stringify(rows);

/**
 * Every day whose rows are not what the board last accepted — a day that
 * emptied is sent empty, so the board's copy empties too.
 */
function dueDays(
  index: UsageIndex,
  days: Days,
): { day: string; backfill?: true; rows: UsageRow[] }[] {
  const due: { day: string; backfill?: true; rows: UsageRow[] }[] = [];
  const marked = new Set(index.marked);
  for (const day of new Set([...days.rows.keys(), ...Object.keys(index.sent)])) {
    const rows = days.rows.get(day) ?? [];
    if ((index.sent[day] ?? signature([])) === signature(rows)) continue;
    // Marked the first time a day with older tokens goes: the board then
    // replaces every collector's rows for it (SPEC §6.4). After that the day
    // is this collector's, and a resend replaces only its own.
    const mark = days.older.has(day) && !marked.has(day);
    due.push({ day, ...(mark ? { backfill: true as const } : {}), rows });
  }
  return due.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The board's prefixes, when this sync's answer named them: a change re-reads
 * which branch keys count, so every day is compared again.
 */
function takePrefixes(index: UsageIndex, prefixes: readonly string[] | undefined): void {
  if (prefixes === undefined) return;
  const next = [...new Set(prefixes)].sort();
  if (JSON.stringify(next) === JSON.stringify(index.prefixes)) return;
  index.prefixes = next;
  index.dirty = true;
}

/** What `daysOf` is told about held days, for this index: frozen once known. */
function heldFor(index: UsageIndex): readonly string[] | 'unknown' {
  return index.backfill === 'yes' ? (index.held ?? 'unknown') : [];
}

/**
 * The usage reports the next sync would send — `status`. Reads what is new
 * and writes nothing.
 */
export async function previewUsage(
  options: UsageReadOptions & { readonly collectorId: string },
): Promise<UsageReport[]> {
  const scanned = await scan({ ...options, dryRun: true }, true);
  takePrefixes(scanned.index, options.prefixes);
  if (!scanned.index.dirty) return [];
  const { firstDay } = windowOf(options.nowS, options.tz);
  for (const day of Object.keys(scanned.index.sent)) {
    if (day < firstDay) delete scanned.index.sent[day];
  }
  const days = await daysOf(
    scanned.data ?? emptyData(options.tz),
    options,
    scanned.index.backfill,
    heldFor(scanned.index),
    scanned.index.prefixes,
  );
  return usageReports({
    collectorId: options.collectorId,
    tz: options.tz,
    days: dueDays(scanned.index, days),
  });
}

/**
 * Read what is new and send the days whose totals changed — after the
 * snapshot, inside the same lock and deadline. With nothing new and nothing
 * waiting, it reads only the index and `stat`s the files.
 */
export async function usageStep(ctx: UsageContext): Promise<UsageOutcome> {
  const scanned = await scan(ctx, false);
  const { index, stats } = scanned;
  takePrefixes(index, ctx.prefixes);
  if (!index.dirty) return { kind: 'idle', stats };
  if (ctx.nowS < index.next_at) return { kind: 'waiting', nextAt: index.next_at };

  // The days other collectors hold, decided once, the first time the 30 days
  // could go: later machines do not change which older days this one sent.
  if (index.backfill === 'yes' && index.held === undefined && ctx.heldElsewhere !== undefined) {
    index.held = [...ctx.heldElsewhere].filter(isDay);
  }
  if (ctx.dryRun !== true) compactSkipSessions(ctx.paths, ctx.nowS);

  const data = scanned.data ?? readData(ctx.paths, ctx.tz) ?? emptyData(ctx.tz);
  const days = await daysOf(data, ctx, index.backfill, heldFor(index), index.prefixes);
  const { firstDay } = windowOf(ctx.nowS, ctx.tz);
  for (const day of Object.keys(index.sent)) if (day < firstDay) delete index.sent[day];
  index.marked = index.marked.filter((day) => day >= firstDay);

  const due = dueDays(index, days);
  const save = (): void => {
    writeIndex(ctx.paths, index);
  };
  if (due.length === 0) {
    index.dirty = !scanned.complete;
    save();
    return { kind: 'idle', stats };
  }

  const reports = usageReports({ collectorId: ctx.collectorId, tz: ctx.tz, days: due });
  const rowsOf = new Map(due.map((d) => [d.day, d.rows]));
  const markedNow = new Set(due.filter((d) => d.backfill === true).map((d) => d.day));
  let sent = 0;
  let sentDays = 0;
  const stopped = (): boolean =>
    ctx.signal?.aborted === true || (ctx.stopAt !== undefined && Date.now() > ctx.stopAt);
  for (const report of reports) {
    if (sent >= USAGE_REPORTS_PER_RUN || stopped()) break;
    const answer = await ctx.send(report.body);
    if (!answer.ok) {
      const interval = ctx.state.min_sync_interval_s;
      if (answer.status === 429) {
        index.next_at = ctx.nowS + Math.max(answer.retryAfterS ?? 0, interval);
        save();
        return { kind: 'rate-limited', nextAt: index.next_at };
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
      index.next_at = ctx.nowS + (refused ? DAY_S : interval);
      save();
      const message = refused
        ? `the board does not take token usage reports — it needs a newer Laika (${answer.message})`
        : `token usage: ${answer.message}`;
      recordError(ctx.paths, ctx.nowS, message);
      return refused
        ? { kind: 'refused', message, nextAt: index.next_at }
        : { kind: 'error', message, nextAt: index.next_at };
    }
    sent += 1;
    for (const day of report.days) {
      index.sent[day] = signature(rowsOf.get(day) ?? []);
      if (markedNow.has(day)) index.marked.push(day);
      sentDays += 1;
    }
    save();
  }
  const pending = due.length - sentDays;
  index.dirty = pending > 0 || !scanned.complete;
  index.next_at = 0;
  save();
  return { kind: 'sent', reports: sent, days: sentDays, pending, stats };
}

/* -------------------------------------------------------------------------- */
/* For people: what is counted                                                */
/* -------------------------------------------------------------------------- */

export interface UsageSummary {
  /** Days with tokens. */
  readonly days: number;
  /** input + output + cache write, the headline (D-084 item 8). */
  readonly tokens: number;
  readonly cacheRead: number;
  readonly byAgent: ReadonlyMap<string, number>;
  /** Of `tokens`, the part tied to a task (D-084 item 6). */
  readonly attributed: number;
}

export function summarise(days: ReadonlyMap<string, readonly UsageRow[]>): UsageSummary {
  let tokens = 0;
  let cacheRead = 0;
  let attributed = 0;
  const byAgent = new Map<string, number>();
  for (const rows of days.values()) {
    for (const r of rows) {
      const headline = r.input + r.output + r.cache_write;
      tokens += headline;
      if (r.task !== null) attributed += headline;
      cacheRead += r.cache_read;
      byAgent.set(r.agent, (byAgent.get(r.agent) ?? 0) + headline);
    }
  }
  return { days: days.size, tokens, cacheRead, byAgent, attributed };
}
