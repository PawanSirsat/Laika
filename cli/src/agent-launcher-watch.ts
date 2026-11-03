import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { TASK_KEY } from './agent-events.ts';
import { auditPath, type LauncherIo, runDir, statusPath } from './agent-launcher.ts';
import { claudeProjectDir, duration, HARNESS_LABELS, runEnding } from './agent-launcher-visible.ts';
import { type Harness, isHarness, isLaikaId, isRecord, readJson } from './agent-session.ts';

/**
 * `laika agent launcher watch [--run <id>] [--once]` (LAI-1113): a live view
 * of what the launcher does on this device, **read-only**. It reads the
 * launcher's audit log and, for a Claude Code run, that run's own transcript,
 * and prints what they say; it writes nothing, signals nothing and holds no
 * lock, so closing it — or the Terminal window it runs in — never reaches a
 * run, which is the launcher's child, not this one's.
 *
 * What it prints of a transcript is the assistant's text (💬) and the name of
 * each tool it calls (🔧) with a short one-line summary of the call. Every
 * value is stripped of control and bidi characters and capped, because a
 * transcript quotes whatever the run read — board text included.
 */

const USAGE = 'usage: laika agent launcher watch [--run <offer-or-run-id>] [--once]';

/** A printable form of `text`: no control, format (bidi, zero-width) or line-separator characters. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu;

/**
 * A credential a run may have quoted — a Laika token (`lai_…`), an
 * `Authorization: Bearer` value — shown as redacted (review). Applied after the
 * unsafe characters are gone, so a zero-width character cannot split a token
 * past it.
 */
export function redacted(text: string): string {
  return text
    .replace(/lai_[A-Za-z0-9_-]+/g, 'lai_…[redacted]')
    .replace(/\bBearer\s+[^\s"'`,;)]+/gi, 'Bearer [redacted]');
}

/**
 * One line: whitespace runs as one space, unsafe characters gone, credentials
 * {@link redacted}, at most `max` characters.
 */
export function oneLine(text: string, max: number): string {
  const flat = redacted(text.replace(/\s+/g, ' ').replace(UNSAFE, '').trim());
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

const MAX_TEXT_LINES = 40;
const MAX_LINE = 300;
const MAX_SUMMARY = 120;

/** An assistant message's text as lines, each made safe and capped; at most {@link MAX_TEXT_LINES}. */
export function textLines(text: string): string[] {
  const lines = text
    .split(/\r\n|\r|\n|\u2028|\u2029/u)
    .map((l) => oneLine(l.replace(/\t/g, ' '), MAX_LINE))
    .filter((l, i, all) => l !== '' || (i > 0 && i < all.length - 1 && all[i - 1] !== ''));
  if (lines.length <= MAX_TEXT_LINES) return lines;
  return [
    ...lines.slice(0, MAX_TEXT_LINES),
    `… (${String(lines.length - MAX_TEXT_LINES)} more lines)`,
  ];
}

/** The input fields that say most about a call, in the order they are looked for. */
const SUMMARY_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'path',
  'pattern',
  'url',
  'query',
  'task',
  'skill',
  'description',
  'prompt',
];

/** A tool call's input as one short line: its telling field, else a few `key=value`s. */
export function toolSummary(input: unknown): string {
  if (!isRecord(input)) return '';
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value, MAX_SUMMARY);
  }
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (pairs.length === 3) break;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      pairs.push(`${oneLine(key, 24)}=${oneLine(String(value), 40)}`);
    }
  }
  return oneLine(pairs.join(' '), MAX_SUMMARY);
}

/**
 * The lines one transcript record prints: an assistant message's text and its
 * tool calls; nothing for anything else (the prompt, tool results, thinking,
 * hooks, bookkeeping). A subagent's (`isSidechain`) are indented.
 */
export function renderTranscript(line: string): string[] {
  let record: unknown;
  try {
    record = JSON.parse(line) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(record) || record.type !== 'assistant' || !isRecord(record.message)) return [];
  const content = record.message.content;
  if (!Array.isArray(content)) return [];
  const side = record.isSidechain === true ? '    ↳ ' : '';
  const out: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      textLines(block.text).forEach((l, i) => {
        out.push(`${side}${i === 0 ? '💬 ' : '   '}${l}`);
      });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const summary = toolSummary(block.input);
      out.push(`${side}🔧 ${oneLine(block.name, 80)}${summary === '' ? '' : `  ${summary}`}`);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The audit log                                                              */
/* -------------------------------------------------------------------------- */

/** An audit line as watch reads it: every field checked before it is used. */
export interface AuditLine {
  readonly at: number;
  readonly event: string;
  readonly offer_id?: string;
  readonly task_key?: string;
  readonly harness?: Harness;
  readonly reason?: string;
  readonly detail?: string;
  readonly code?: number | null;
  readonly signal?: string | null;
  readonly runtime_ms?: number;
  readonly worktree?: string;
  readonly transcript_dir?: string;
  readonly subtype?: string;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
}

const WORD = /^[a-z0-9_.:-]{1,60}$/i;

export function parseAudit(line: string): AuditLine | undefined {
  let v: unknown;
  try {
    v = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(v) || typeof v.event !== 'string' || !WORD.test(v.event)) return undefined;
  const at = typeof v.at === 'string' ? Date.parse(v.at) : NaN;
  if (!Number.isFinite(at)) return undefined;
  const word = (x: unknown): string | undefined =>
    typeof x === 'string' && WORD.test(x) ? x : undefined;
  const num = (x: unknown): number | undefined =>
    typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  const path = (x: unknown): string | undefined =>
    typeof x === 'string' &&
    isAbsolute(x) &&
    x.length <= 1000 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(x)
      ? x
      : undefined;
  const out: Record<string, unknown> = { at, event: v.event };
  if (isLaikaId(v.offer_id)) out.offer_id = v.offer_id;
  if (typeof v.task_key === 'string' && (TASK_KEY.test(v.task_key) || isLaikaId(v.task_key))) {
    out.task_key = v.task_key;
  }
  if (typeof v.harness === 'string' && isHarness(v.harness)) out.harness = v.harness;
  for (const k of ['reason', 'detail', 'subtype'] as const) {
    const w = word(v[k]);
    if (w !== undefined) out[k] = w;
  }
  if (v.code === null || (Number.isInteger(v.code) && Math.abs(v.code as number) <= 255)) {
    out.code = v.code;
  }
  if (v.signal === null || (typeof v.signal === 'string' && /^SIG[A-Z0-9]{1,10}$/.test(v.signal))) {
    out.signal = v.signal;
  }
  for (const k of ['runtime_ms', 'num_turns', 'total_cost_usd'] as const) {
    const n = num(v[k]);
    if (n !== undefined) out[k] = n;
  }
  for (const k of ['worktree', 'transcript_dir'] as const) {
    const p = path(v[k]);
    if (p !== undefined) out[k] = p;
  }
  return out as unknown as AuditLine;
}

const SHOWN: ReadonlySet<string> = new Set([
  'daemon_start',
  'daemon_stop',
  'start',
  'exit',
  'timeout',
  'stopped',
  'reaped',
  'refused',
  'skipped',
]);

const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 8);
const label = (h: Harness | undefined): string =>
  h === undefined ? 'a harness' : HARNESS_LABELS[h];

/** Why a check was skipped, in words (LAI-1114); a reason this CLI does not know is shown as itself. */
function skippedWhy(reason: string | undefined): string {
  if (reason === 'owner_unknown') {
    return 'could not reach the board to confirm the owner (will retry)';
  }
  return `${reason ?? 'no reason given'} (will retry)`;
}

/** One audit event as a line, or `undefined` for one this view does not show. */
export function renderAudit(e: AuditLine): string | undefined {
  if (!SHOWN.has(e.event)) return undefined;
  const t = clock(e.at);
  const key = e.task_key ?? 'a task';
  const run = e.offer_id === undefined ? '' : ` · run ${e.offer_id}`;
  switch (e.event) {
    case 'daemon_start':
      return `${t} · the launcher started`;
    case 'daemon_stop':
      return `${t} · the launcher stopped`;
    case 'start':
      return `${t} ▶ started ${key} (${label(e.harness)})${run}`;
    case 'exit': {
      const how =
        e.code !== undefined && e.code !== null
          ? `exit ${String(e.code)}`
          : typeof e.signal === 'string'
            ? `signal ${e.signal}`
            : 'no exit code';
      const ending = runEnding(e.reason);
      const extra = [
        e.subtype,
        e.num_turns === undefined ? undefined : `${String(e.num_turns)} turns`,
        e.total_cost_usd === undefined ? undefined : `$${e.total_cost_usd.toFixed(2)}`,
      ].filter((x) => x !== undefined);
      return `${t} ■ ${key} ${ending} → ${how}, ${duration(e.runtime_ms ?? 0)}${extra.length === 0 ? '' : ` (${extra.join(', ')})`}${run}`;
    }
    case 'timeout':
      return `${t} ⏱ ${key} reached its time limit after ${duration(e.runtime_ms ?? 0)}; stopping it${run}`;
    case 'stopped':
      return `${t} ■ stopping ${key}${e.reason === undefined ? '' : `: ${e.reason}`}${run}`;
    case 'reaped':
      return `${t} ■ ended a run a gone launcher left${e.reason === undefined ? '' : ` (${e.reason})`}${run}`;
    case 'skipped':
      return `${t} · skipped a check: ${skippedWhy(e.reason)}`;
    default:
      return `${t} ✖ refused ${key}: ${e.reason ?? 'no reason given'}${e.detail === undefined ? '' : ` (${e.detail})`}${run}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading files that grow                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A file read as it grows, by whole lines: bytes are kept until their line
 * ends, so a line being written is never half-printed and a character is never
 * split. A file that shrank (replaced) is read again from its start.
 */
export class Follow {
  readonly path: string;
  private offset: number;
  private rest: Buffer = Buffer.alloc(0);
  /** Started inside the file: its first line is a part of one, and is dropped. */
  private skipPartial: boolean;

  constructor(path: string, from: 'start' | number) {
    this.path = path;
    this.offset = from === 'start' ? 0 : from;
    this.skipPartial = typeof from === 'number' && from > 0;
  }

  /** The whole lines written since the last read; none when the file is not there. */
  lines(maxBytes = 8 * 1024 * 1024): string[] {
    let fd: number;
    try {
      fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return [];
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) return [];
      if (st.size < this.offset) {
        this.offset = 0;
        this.rest = Buffer.alloc(0);
        this.skipPartial = false;
      }
      const length = Math.min(st.size - this.offset, maxBytes);
      if (length <= 0) return [];
      const chunk = Buffer.alloc(length);
      const read = readSync(fd, chunk, 0, length, this.offset);
      this.offset += read;
      let data = Buffer.concat([this.rest, chunk.subarray(0, read)]);
      const out: string[] = [];
      for (let nl = data.indexOf(0x0a); nl !== -1; nl = data.indexOf(0x0a)) {
        const line = data.subarray(0, nl).toString('utf8');
        data = data.subarray(nl + 1);
        if (this.skipPartial) {
          this.skipPartial = false;
          continue;
        }
        if (line.trim() !== '') out.push(line);
      }
      this.rest = Buffer.from(data);
      return out;
    } finally {
      closeSync(fd);
    }
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Finding a run's transcript                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The folder a run's Claude Code transcript is in: the `transcript_dir` its
 * `start` recorded, else one made from its worktree — recorded on `start`, or
 * in the run's `workspace.json` (a work request started before LAI-1113).
 * Only a folder under `~/.claude/projects` is read.
 */
export function transcriptDir(home: string, start: AuditLine): string | undefined {
  if (start.harness !== 'claude-code') return undefined;
  const projects = join(home, '.claude', 'projects');
  const under = (dir: string): boolean => {
    const rel = relative(projects, dir);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.includes('/');
  };
  if (start.transcript_dir !== undefined && under(start.transcript_dir))
    return start.transcript_dir;
  let worktree = start.worktree;
  if (worktree === undefined && start.offer_id !== undefined) {
    const ws = readJson(join(runDir(home, start.offer_id), 'workspace.json'));
    if (isRecord(ws) && typeof ws.worktree === 'string' && isAbsolute(ws.worktree)) {
      worktree = ws.worktree;
    }
  }
  if (worktree === undefined) return undefined;
  const dir = claudeProjectDir(home, worktree);
  return under(dir) ? dir : undefined;
}

/**
 * The run's transcript in `dir`: of the `.jsonl` files written to since the
 * run started (5 s of slack for clocks), the one written to last.
 */
export function findTranscript(dir: string, since: number): string | undefined {
  let best: { path: string; mtime: number } | undefined;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile() || st.mtimeMs < since - 5000) continue;
      if (best === undefined || st.mtimeMs > best.mtime) best = { path, mtime: st.mtimeMs };
    } catch {
      // Gone between the listing and the look.
    }
  }
  return best?.path;
}

/* -------------------------------------------------------------------------- */
/* The command                                                                */
/* -------------------------------------------------------------------------- */

export interface WatchIo extends LauncherIo {
  readonly sleep: (ms: number) => Promise<void>;
  /** True once the viewer should end: Ctrl+C, or a test's limit. */
  readonly stopped: () => boolean;
}

const ENDS: ReadonlySet<string> = new Set(['exit', 'reaped']);

/** A run being followed: its start, its transcript (once found), and whether it has ended. */
interface Followed {
  readonly start: AuditLine;
  readonly dir: string | undefined;
  transcript: Follow | undefined;
  said: boolean;
}

function noTranscriptLine(home: string, start: AuditLine): string {
  if (start.harness === 'omnigent') {
    return '   (an Omnigent run’s transcript lives in Omnigent, in its own session: open Omnigent to read it; this view shows the launcher’s events only)';
  }
  if (start.harness === 'codex') {
    return `   (a Codex run prints its events to ${join(runDir(home, start.offer_id ?? ''), 'output.log')}; this view shows the launcher’s events only)`;
  }
  return `   (no transcript this view can read for a ${label(start.harness)} run; the launcher’s events only)`;
}

export async function watchCommand(
  base: LauncherIo & Partial<Pick<WatchIo, 'sleep' | 'stopped'>>,
  argv: readonly string[],
): Promise<number> {
  let runId: string | undefined;
  let once = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--once') once = true;
    else if (a === '--run') {
      runId = argv[i + 1];
      i += 1;
      if (runId === undefined || !isLaikaId(runId)) {
        base.err(
          `laika agent launcher watch: --run takes a run id (the offer id, a ULID)\n${USAGE}`,
        );
        return 2;
      }
    } else if (a === '--help' || a === '-h') {
      base.out(USAGE);
      return 0;
    } else {
      base.err(`laika agent launcher watch: unknown argument "${String(a)}"\n${USAGE}`);
      return 2;
    }
  }
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
  };
  const io: WatchIo = {
    ...base,
    sleep: base.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    stopped: base.stopped ?? (() => interrupted),
  };
  if (base.stopped === undefined) process.on('SIGINT', onSignal);
  try {
    return await watch(io, runId, once);
  } finally {
    if (base.stopped === undefined) process.off('SIGINT', onSignal);
  }
}

async function watch(io: WatchIo, runId: string | undefined, once: boolean): Promise<number> {
  const audit = auditPath(io.home);
  io.out(
    runId === undefined
      ? 'Watching the launcher on this device. Read-only: closing this never stops a run.'
      : `Watching run ${runId}. Read-only: closing this never stops the run.`,
  );
  // The history: the log's last 4 MB, whole lines only; then the same reader follows it.
  const log = new Follow(audit, Math.max(0, sizeOf(audit) - 4 * 1024 * 1024));
  const history = log
    .lines()
    .map(parseAudit)
    .filter((e): e is AuditLine => e !== undefined);
  const mine = (e: AuditLine): boolean => runId === undefined || e.offer_id === runId;

  // The run to follow: the chosen one, or the last one started that has not ended.
  const ended = new Set(history.filter((e) => ENDS.has(e.event)).map((e) => e.offer_id));
  const starts = history.filter((e) => e.event === 'start' && mine(e));
  const latest = starts.at(-1);
  let followed: Followed | undefined;
  const follow = (start: AuditLine): Followed => ({
    start,
    dir: transcriptDir(io.home, start),
    transcript: undefined,
    said: false,
  });
  if (latest !== undefined && (runId !== undefined || !ended.has(latest.offer_id))) {
    followed = follow(latest);
  }
  const drain = (f: Followed): void => {
    if (f.dir === undefined) {
      if (!f.said) io.out(noTranscriptLine(io.home, f.start));
      f.said = true;
      return;
    }
    if (f.transcript === undefined) {
      const file = findTranscript(f.dir, f.start.at);
      if (file === undefined) {
        if (!f.said) io.out(`   (waiting for its transcript in ${oneLine(f.dir, 400)})`);
        f.said = true;
        return;
      }
      f.transcript = new Follow(file, 'start');
      // A file name is whatever was written to that folder: printed as safely as any text.
      io.out(`   transcript: ${oneLine(file, 400)}`);
    }
    for (const line of f.transcript.lines()) for (const l of renderTranscript(line)) io.out(l);
  };

  // What has happened, in order; the followed run's transcript comes right after its start.
  const shown = history.filter((e) => mine(e) && renderAudit(e) !== undefined);
  const recent = runId === undefined ? shown.slice(-10) : shown;
  for (const e of recent) {
    io.out(renderAudit(e)!);
    if (e === followed?.start) drain(followed);
  }
  if (followed !== undefined && !recent.includes(followed.start)) drain(followed);
  if (shown.length === 0) {
    io.out(
      runId === undefined
        ? 'Nothing in the launcher’s audit log yet.'
        : `Run ${runId} is not in the launcher’s audit log yet.`,
    );
  }
  const finishedRun = (): boolean => runId !== undefined && ended.has(runId);
  if (finishedRun()) {
    io.out('The run has ended.');
    return 0;
  }
  if (once) return runId !== undefined && starts.length === 0 ? 1 : 0;
  if (runId === undefined && !isRecord(readJson(statusPath(io.home)))) {
    io.out('The launcher has not run on this device yet; waiting for it.');
  }

  // Live: new audit lines as they come, and the followed run's transcript.
  while (!io.stopped()) {
    await io.sleep(500);
    for (const e of log.lines().map(parseAudit)) {
      if (e === undefined || !mine(e)) continue;
      if (e.event === 'start') {
        if (followed !== undefined) drain(followed);
        followed = follow(e);
      }
      if (ENDS.has(e.event) && followed !== undefined && followed.start.offer_id === e.offer_id) {
        drain(followed);
      }
      const line = renderAudit(e);
      if (line !== undefined) io.out(line);
      if (ENDS.has(e.event)) {
        ended.add(e.offer_id);
        if (followed?.start.offer_id === e.offer_id) followed = undefined;
        if (finishedRun()) {
          io.out('The run has ended. This window can be closed.');
          return 0;
        }
      }
    }
    if (followed !== undefined) drain(followed);
  }
  return 0;
}
