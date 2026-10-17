import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
 * tool input, path, branch and session id are read past and never kept or
 * sent (D-084 item 1). What leaves is per day × agent × model × task the four
 * counts — input, output, cache write, cache read — in a usage report on the
 * same `PUT /me/local-activity` as the snapshot (SPEC §6.4). Phase 1 sends no
 * task key: that is LAI-770, from the session's own Laika tool calls.
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
/** The server's pattern for a model id (§4.32). */
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
/** Read this much of a transcript at a time. */
const CHUNK_BYTES = 8 * 1024 * 1024;
/** How long a scope answer for a working directory is believed. */
const SCOPE_TTL_S = DAY_S;

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

/** `[day, model, input, output, cache_write, cache_read, epoch s, cwd index]` */
type Rec = [string, string, number, number, number, number, number, number];

interface CodexFile {
  /** Bytes read so far. */
  o: number;
  /** The cumulative total last seen: input (cached included), cached, cache write, output. */
  prev: [number, number, number, number];
  model: string;
  cwd: number;
  /** One record per event that moved the total, in the window. */
  ev: Rec[];
}

interface GeminiFile {
  /** Per message id. */
  m: Record<string, Rec>;
}

interface UsageData {
  v: 1;
  /** The zone the days were computed in; all are recomputed when it changes. */
  tz: string;
  /** Working directories, by index — local only, never sent. */
  cwds: string[];
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
  /** No usage report before this (a refusal or a 429). */
  next_at: number;
}

export function usageIndexFile(paths: ActivityPaths): string {
  return join(paths.dir, 'usage-index.json');
}

export function usageDataFile(paths: ActivityPaths): string {
  return join(paths.dir, 'usage-data.json');
}

function emptyIndex(): UsageIndex {
  return { v: 1, dirs: {}, files: {}, sent: {}, dirty: false, next_at: 0 };
}

function emptyData(tz: string): UsageData {
  return { v: 1, tz, cwds: [], claude: {}, offsets: {}, codex: {}, gemini: {}, scope: {} };
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
    next_at: typeof raw.next_at === 'number' ? raw.next_at : 0,
  };
}

function readData(paths: ActivityPaths, tz: string): UsageData | undefined {
  const raw = readJson(usageDataFile(paths));
  if (!isRecord(raw) || raw.v !== 1) return undefined;
  const pick = <T>(value: unknown, fallback: T): T => (isRecord(value) ? (value as T) : fallback);
  return {
    v: 1,
    tz: typeof raw.tz === 'string' ? raw.tz : tz,
    cwds: Array.isArray(raw.cwds) ? (raw.cwds as string[]) : [],
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
 * The complete lines of `path` from byte `from`, to the last newline. With a
 * `needle`, only the lines that hold it are handed over — found with a byte
 * search, so a transcript's text is never decoded unless its line carries a
 * usage. Returns where the next read starts.
 */
async function readLines(
  path: string,
  from: number,
  needle: Buffer | undefined,
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
      if (needle === undefined) {
        let start = 0;
        while (start < view.length) {
          const end = view.indexOf(10, start);
          if (end > start) onLine(view.toString('utf8', start, end));
          start = end + 1;
        }
      } else {
        let at = view.indexOf(needle);
        while (at !== -1) {
          const start = view.lastIndexOf(10, at) + 1;
          const end = view.indexOf(10, at);
          onLine(view.toString('utf8', start, end));
          at = view.indexOf(needle, end + 1);
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

interface Reader {
  readonly data: UsageData;
  readonly dayOf: (epochS: number) => string;
  readonly firstDay: string;
  readonly windowStartS: number;
  cwd: (path: unknown) => number;
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
  if (!isRecord(message) || typeof message.id !== 'string' || message.id === '') return;
  const usage = message.usage;
  if (!isRecord(usage)) return;
  const model = modelId(message.model);
  const at = epochOf(record.timestamp);
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
    ];
    return;
  }
  // The first line seen keeps the day and the model; each count is the largest.
  held[2] = Math.max(held[2], input);
  held[3] = Math.max(held[3], output);
  held[4] = Math.max(held[4], write);
  held[5] = Math.max(held[5], read);
}

/** One Codex line: the model and directory in force, and each total's difference. */
function codexLine(reader: Reader, file: CodexFile, line: string): void {
  if (!line.includes('"token_count"') && !line.includes('"turn_context"')) {
    if (!line.includes('"session_meta"')) return;
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
  const m: Record<string, Rec> = {};
  for (const message of session.messages as unknown[]) {
    if (!isRecord(message) || typeof message.id !== 'string' || !isRecord(message.tokens)) continue;
    const model = modelId(message.model);
    const at = epochOf(message.timestamp);
    if (model === undefined || at === undefined || at < reader.windowStartS) continue;
    const day = reader.dayOf(at);
    if (day < reader.firstDay) continue;
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
          const to = await readLines(file.path, from, CLAUDE_NEEDLE, (line) => {
            claudeLine(reader, line);
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

  prune(data, firstDay, present);
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
  for (const file of Object.values(data.codex)) yield* file.ev;
  for (const file of Object.values(data.gemini)) yield* Object.values(file.m);
}

/**
 * Drop what has left the window — nothing older is ever sent — and the state
 * of a file that is gone once none of its records is left.
 */
function prune(data: UsageData, firstDay: string, present: ReadonlySet<string>): void {
  for (const [id, rec] of Object.entries(data.claude)) {
    if (rec[0] < firstDay) delete data.claude[id];
  }
  for (const [path, file] of Object.entries(data.codex)) {
    file.ev = file.ev.filter((e) => e[0] >= firstDay);
    if (file.ev.length === 0 && !present.has(path)) delete data.codex[path];
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
/* Days                                                                       */
/* -------------------------------------------------------------------------- */

/** Per day in the window, the rows a report would carry, oldest day first. */
async function daysOf(
  data: UsageData,
  options: UsageReadOptions,
  backfill: 'yes' | 'no' | undefined,
): Promise<Map<string, UsageRow[]>> {
  const { firstDay } = windowOf(options.nowS, options.tz);
  if (data.tz !== options.tz) {
    // The machine moved zone since these were read: their days, in the new one.
    const dayOf = dayFinder(options.tz);
    for (const rec of allRecords(data)) rec[0] = dayOf(rec[6]);
    data.tz = options.tz;
  }
  // From when counting began, unless the developer said yes to the window.
  const sinceS = options.all === true || backfill === 'yes' ? 0 : options.state.since;
  const inScope =
    options.state.scope === 'laika-repos'
      ? await scopeFilter(data, options.paths, options.nowS)
      : () => true;

  const days = new Map<string, Map<string, UsageRow>>();
  const add = (agent: UsageAgent, rec: Rec): void => {
    if (rec[6] < sinceS || rec[0] < firstDay || !inScope(rec[7])) return;
    let rows = days.get(rec[0]);
    if (rows === undefined) {
      rows = new Map();
      days.set(rec[0], rows);
    }
    const key = `${agent} ${rec[1]}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = {
        agent,
        model: rec[1],
        task: null,
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
  for (const file of Object.values(data.codex)) for (const rec of file.ev) add('codex', rec);
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
      .sort((a, b) => a.agent.localeCompare(b.agent) || a.model.localeCompare(b.model));
    if (rows.length > 0) out.set(day, rows);
  }
  return out;
}

export interface UsageRead {
  readonly days: Map<string, UsageRow[]>;
  readonly stats: UsageStats;
}

/** Read what is new and answer the window's rows per day — for tests, `status` and `backfill`. */
export async function readUsage(options: UsageReadOptions): Promise<UsageRead> {
  const scanned = await scan(options, true);
  const data = scanned.data ?? emptyData(options.tz);
  const days = await daysOf(data, options, scanned.index.backfill);
  return { days, stats: scanned.stats };
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
  readonly days: readonly { readonly day: string; readonly rows: readonly UsageRow[] }[];
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
  for (const { day, rows } of [...options.days].sort((a, b) => a.day.localeCompare(b.day))) {
    const entry = JSON.stringify({ day, rows: fitted(rows, MAX_BODY_BYTES - baseBytes) });
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
  days: ReadonlyMap<string, UsageRow[]>,
): { day: string; rows: UsageRow[] }[] {
  const due: { day: string; rows: UsageRow[] }[] = [];
  for (const day of new Set([...days.keys(), ...Object.keys(index.sent)])) {
    const rows = days.get(day) ?? [];
    if ((index.sent[day] ?? signature([])) !== signature(rows)) due.push({ day, rows });
  }
  return due.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The usage reports the next sync would send — `status`. Reads what is new
 * and writes nothing.
 */
export async function previewUsage(
  options: UsageReadOptions & { readonly collectorId: string },
): Promise<UsageReport[]> {
  const scanned = await scan({ ...options, dryRun: true }, true);
  if (!scanned.index.dirty) return [];
  const { firstDay } = windowOf(options.nowS, options.tz);
  for (const day of Object.keys(scanned.index.sent)) {
    if (day < firstDay) delete scanned.index.sent[day];
  }
  const days = await daysOf(scanned.data ?? emptyData(options.tz), options, scanned.index.backfill);
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
  if (!index.dirty) return { kind: 'idle', stats };
  if (ctx.nowS < index.next_at) return { kind: 'waiting', nextAt: index.next_at };

  const data = scanned.data ?? readData(ctx.paths, ctx.tz) ?? emptyData(ctx.tz);
  const days = await daysOf(data, ctx, index.backfill);
  const { firstDay } = windowOf(ctx.nowS, ctx.tz);
  for (const day of Object.keys(index.sent)) if (day < firstDay) delete index.sent[day];

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
}

export function summarise(days: ReadonlyMap<string, readonly UsageRow[]>): UsageSummary {
  let tokens = 0;
  let cacheRead = 0;
  const byAgent = new Map<string, number>();
  for (const rows of days.values()) {
    for (const r of rows) {
      const headline = r.input + r.output + r.cache_write;
      tokens += headline;
      cacheRead += r.cache_read;
      byAgent.set(r.agent, (byAgent.get(r.agent) ?? 0) + headline);
    }
  }
  return { days: days.size, tokens, cacheRead, byAgent };
}
