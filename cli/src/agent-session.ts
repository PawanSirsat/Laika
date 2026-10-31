import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { adapter, type Harness, isHarness } from './agent-adapters.ts';

/**
 * The local helper's engine: an agent session that lives exactly as long as
 * the harness process holding it (proposal §4.2, §4.7; SPEC §9.1.1; LAI-542).
 *
 * ## The one rule
 *
 * **Heartbeats come from the working process.** A session is bound, at start,
 * to one harness process — its PID **and its start time**, so a PID the OS
 * hands to something else later is not mistaken for it. Every renewal checks
 * that process first. When it is gone, the helper sends nothing more: no
 * heartbeat, and no `end` either, so the claim lapses and is *expired* — the
 * recovery path (SPEC §9.1.1) — rather than quietly *released* as if the work
 * had been finished. A clean exit (`SessionEnd`) is the only thing that ends a
 * session.
 *
 * ## What is never written anywhere
 *
 * The agent's token. It is read from `~/.laika/agents/<harness>.json` (0600)
 * or `LAIKA_AGENT_TOKEN`, sent as a header, and handed to a background child
 * on its stdin — never in argv, never in a state file, never in the log, never
 * in hook output, and stripped from the child's environment.
 * `LAIKA_TOKEN` — the person's own token — is never read here at all: an
 * agent acts through its own credential (D-114).
 *
 * Everything here takes its clock, its sleep, its `fetch` and its view of the
 * process table as arguments, so the tests drive time and death directly.
 */

/** The harnesses and their adapters live in one table (LAI-557). */
export { HARNESSES, isHarness, type Harness } from './agent-adapters.ts';

export const DEFAULT_INTERVAL_MS = 30_000;

/** `LAIKA_AGENT_HEARTBEAT_SECONDS`, whole seconds 1–3600; the server's default otherwise. */
export function heartbeatIntervalMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.LAIKA_AGENT_HEARTBEAT_SECONDS;
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_INTERVAL_MS;
  const seconds = Number(raw);
  return seconds >= 1 && seconds <= 3600 ? seconds * 1000 : DEFAULT_INTERVAL_MS;
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

export const agentsDir = (home: string): string => join(home, '.laika', 'agents');
export const credentialPath = (home: string, harness: Harness): string =>
  join(agentsDir(home), `${harness}.json`);
export const sessionsDir = (home: string): string => join(home, '.laika', 'agent-sessions');
export const logPath = (home: string): string => join(sessionsDir(home), 'helper.log');

/** A harness session id as a file name: kept when it is a plain id, hashed otherwise. */
export function sessionFileKey(harnessSessionId: string): string {
  if (/^[A-Za-z0-9._-]{1,128}$/.test(harnessSessionId) && !harnessSessionId.startsWith('.')) {
    return harnessSessionId;
  }
  return createHash('sha256').update(harnessSessionId).digest('hex').slice(0, 32);
}

export const statePath = (home: string, harness: Harness, harnessSessionId: string): string =>
  join(sessionsDir(home), `${harness}-${sessionFileKey(harnessSessionId)}.json`);

/* -------------------------------------------------------------------------- */
/* Private files                                                              */
/* -------------------------------------------------------------------------- */

export function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** Temp file created 0600 beside the target, then renamed over it: never wider, never half-written. */
export function writePrivate(path: string, content: string): void {
  const temp = `${path}.${String(process.pid)}-${String(Date.now())}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } catch (cause) {
    rmSync(temp, { force: true });
    throw cause;
  }
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A Laika id is a ULID (SPEC §4): 26 Crockford base-32 characters, nothing else. */
export const isLaikaId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

/** One line per event, 0600, capped. Callers never pass the token; nothing here could know it. */
export function log(home: string, line: string): void {
  try {
    privateDir(sessionsDir(home));
    const path = logPath(home);
    try {
      if (statSync(path).size > 256 * 1024) rmSync(path, { force: true });
    } catch {
      // No log yet.
    }
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    // A log that cannot be written must never stop a heartbeat.
  }
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

export interface AgentCredential {
  readonly url: string;
  readonly token: string;
}

export function writeCredential(home: string, harness: Harness, credential: AgentCredential): void {
  privateDir(join(home, '.laika'));
  privateDir(agentsDir(home));
  writePrivate(credentialPath(home, harness), `${JSON.stringify(credential, null, 2)}\n`);
}

/**
 * The agent's credential: `LAIKA_AGENT_TOKEN` (with `LAIKA_AGENT_URL`, or the
 * saved URL) when the harness supplies one, otherwise the saved file.
 * **Never `LAIKA_TOKEN`** — that is the person's.
 */
export function readCredential(
  home: string,
  harness: Harness,
  env: Readonly<Record<string, string | undefined>>,
): AgentCredential | undefined {
  const saved = readJson(credentialPath(home, harness));
  const savedUrl = isRecord(saved) && typeof saved.url === 'string' ? saved.url : undefined;
  const savedToken = isRecord(saved) && typeof saved.token === 'string' ? saved.token : undefined;
  const envToken = env.LAIKA_AGENT_TOKEN;
  if (envToken !== undefined && envToken !== '') {
    const url = env.LAIKA_AGENT_URL ?? savedUrl;
    return url === undefined || url === '' ? undefined : { url, token: envToken };
  }
  if (savedUrl === undefined || savedToken === undefined || savedToken === '') return undefined;
  return { url: savedUrl, token: savedToken };
}

/* -------------------------------------------------------------------------- */
/* The process table                                                          */
/* -------------------------------------------------------------------------- */

export interface ProcInfo {
  readonly pid: number;
  readonly ppid: number;
  /** `ps -o lstart=`: the process's start time, which a reused PID does not share. */
  readonly started: string;
  /** The executable's base name. */
  readonly comm: string;
  /** `ps -o stat=`: the run state and its flags, e.g. `S`, `R+`, `Z`. */
  readonly state: string;
}

/**
 * `ps` could not say: it timed out, failed, or printed something unreadable.
 * Not the same as "no such process" (`undefined`), which `ps` says plainly.
 */
export const UNKNOWN = 'unknown' as const;

/** A process, `undefined` when `ps` says there is none, or {@link UNKNOWN}. */
export type ProcReader = (pid: number) => ProcInfo | undefined | typeof UNKNOWN;

const PS_LINE =
  /^\s*(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/;

/**
 * The environment every subprocess this helper runs gets: a fixed `PATH` and
 * the C locale, **and nothing of the caller's** — so no credential the caller
 * holds (`LAIKA_AGENT_TOKEN`, `LAIKA_TOKEN`, anything else) reaches it.
 */
export const PS_ENV: Readonly<Record<string, string>> = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LC_ALL: 'C',
  LANG: 'C',
};

export const PS_TIMEOUT_MS = 5000;

export type Exec = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
) => string;

/**
 * A process gone in all but its table entry: a zombie (`Z`, exited and not
 * yet reaped), dead (`X`), or exiting (`E`, macOS). None of them is working.
 */
export function isDeadState(state: string): boolean {
  return /^[ZX]/.test(state) || state.includes('E');
}

/**
 * Does a process with this PID exist, by the kernel's word? `kill(pid, 0)`
 * sends nothing; `ESRCH` is the one answer that means there is none. Success
 * or `EPERM` means one exists — which says nothing about whether it is *ours*
 * or healthy, so it is never used to renew; anything else is unknown.
 */
export type Probe = (pid: number) => 'absent' | 'present' | 'unknown';

/** A {@link Probe} over a given `kill`, so its errno handling can be tested without the kernel. */
export function probeWith(kill: (pid: number, signal: 0) => unknown): Probe {
  return (pid) => {
    try {
      kill(pid, 0);
      return 'present';
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;
      if (code === 'ESRCH') return 'absent';
      if (code === 'EPERM') return 'present';
      return 'unknown';
    }
  };
}

export const probeKill: Probe = probeWith((pid, signal) => process.kill(pid, signal));

/**
 * `ps` for one PID. **Three answers, kept apart**: the process, as `ps`
 * printed it; `undefined` only when the kernel confirms there is no such
 * process; and {@link UNKNOWN} for anything else.
 *
 * **A failed `ps` is never evidence of death by itself.** `ps` exits 1 with
 * nothing on stdout for a missing PID — and also when it fails to start
 * (Apple's on an allocation failure, procps-ng's on an init failure). So
 * every failed run asks the kernel, through {@link Probe}: only `ESRCH`
 * means absent. A process that exists but that `ps` could not describe is
 * unknown — renewal still needs a `ps` answer with the right start time.
 */
export function procReader(exec: Exec = execFileSync, probe: Probe = probeKill): ProcReader {
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    let out: string;
    try {
      // A `ps` that hangs is killed and is UNKNOWN: nothing is renewed on a
      // check that did not complete, and nothing is abandoned on one either.
      out = exec(
        'ps',
        ['-o', 'ppid=', '-o', 'stat=', '-o', 'lstart=', '-o', 'comm=', '-p', String(pid)],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...PS_ENV },
          timeout: PS_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        },
      );
    } catch {
      return probe(pid) === 'absent' ? undefined : UNKNOWN;
    }
    const match = PS_LINE.exec(out.split('\n')[0] ?? '');
    if (match === null) return UNKNOWN;
    return {
      pid,
      ppid: Number(match[1]),
      state: match[2] ?? '',
      started: (match[3] ?? '').replace(/\s+/g, ' '),
      comm: basename(match[4] ?? ''),
    };
  };
}

export const readProc: ProcReader = procReader();

/**
 * The harness process this hook runs under: the nearest ancestor whose
 * executable is the harness's. Hooks reach us through a shell or two, so the
 * parent alone is not it. `LAIKA_AGENT_HARNESS_PID` names it outright, for a
 * harness launched under another name.
 */
export function findHarness(
  harness: Harness,
  from: number,
  env: Readonly<Record<string, string | undefined>>,
  proc: ProcReader = readProc,
): ProcInfo | undefined {
  const named = env.LAIKA_AGENT_HARNESS_PID;
  if (named !== undefined && named !== '') {
    const info = /^\d+$/.test(named) ? proc(Number(named)) : undefined;
    return info === undefined || info === UNKNOWN || isDeadState(info.state) ? undefined : info;
  }
  // A harness with no known executable name is never guessed at (LAI-557):
  // its session is bound by `--pid` or `LAIKA_AGENT_HARNESS_PID` only.
  const comm = adapter(harness).comm;
  if (comm === undefined) return undefined;
  let pid = from;
  for (let depth = 0; depth < 16 && pid > 1; depth += 1) {
    const info = proc(pid);
    // Unknown is not good enough to bind a session to.
    if (info === undefined || info === UNKNOWN) return undefined;
    if (comm.test(info.comm)) return isDeadState(info.state) ? undefined : info;
    pid = info.ppid;
  }
  return undefined;
}

/**
 * The same process as at start, and still running: there, started at the same
 * moment, and not a zombie or exiting. A harness that has exited but not been
 * reaped keeps its PID and start time — and must not keep its claims.
 */
export function isAlive(pid: number, started: string, proc: ProcReader = readProc): boolean {
  return liveness(pid, started, proc) === 'alive';
}

/**
 * `dead` only on evidence: no such process, a different start time (the PID
 * was reused), or a zombie, dead or exiting state. A check that could not
 * complete is `unknown` — it renews nothing, and abandons nothing.
 */
export function liveness(
  pid: number,
  started: string,
  proc: ProcReader = readProc,
): 'alive' | 'dead' | 'unknown' {
  const info = proc(pid);
  if (info === UNKNOWN) return 'unknown';
  // Absent, a reused PID, or a zombie: each is evidence.
  if (info?.started !== started || isDeadState(info.state)) return 'dead';
  return 'alive';
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export type SessionStatus =
  /** Being opened, or a start that failed on the network: retried with its key. */
  | 'starting'
  /** Open and renewed by the watcher. */
  | 'live'
  /** Closed by `end`, or found already ended by the board. */
  | 'ended'
  /** The harness died; nothing renews it, and its claims lapse. */
  | 'abandoned'
  /** The board refused the credential or the session; nothing retries. */
  | 'failed';

export interface LostClaim {
  readonly id: string;
  readonly task_id: string;
  readonly generation: number;
  readonly state: string;
}

export interface SessionState {
  readonly version: 1;
  readonly harness: Harness;
  readonly harness_session_id: string;
  readonly url: string;
  status: SessionStatus;
  session_id?: string;
  /**
   * The registered agent this session is, as the board's answer named it
   * (LAI-547): the checkpoint helper reads the agent's consent by it.
   */
  agent_id?: string;
  /**
   * The start's `Idempotency-Key` (SPEC §6.3), written before the first
   * attempt: every retry of this start sends it, so the board answers a retry
   * of a start that did arrive with the session it already made.
   */
  start_key?: string;
  /**
   * The body sent with {@link start_key}, kept with it: the board answers a
   * key reused with a different body `409` (SPEC §6.3), so every retry of a
   * start sends exactly this, whatever has been learned since (LAI-588).
   */
  start_body?: Record<string, string>;
  harness_pid: number;
  harness_started: string;
  watcher_pid?: number;
  watcher_started?: string;
  started_at: number;
  last_beat_at?: number;
  beats: number;
  failures: number;
  last_error?: string;
  claims: { task_id: string; generation: number; lease_expires_at: number }[];
  /** Every lost claim already told to the agent, `id:generation`. */
  noticed: string[];
  /**
   * Lost claims not yet shown to the model, as data. The next hook that can
   * add context renders them through {@link lostNotice} after checking each
   * again with {@link asLost}, and clears them.
   */
  pending_lost?: LostClaim[];
  /**
   * Rendered text an older helper kept here. **Never shown** — it was written
   * before the checks — and dropped at the next hook.
   */
  notice?: string;
  end_reason?: string;
  /**
   * What the harness last said about itself, as {@link readSelfReport} read
   * it (D-118, LAI-588). Absent when it could not be told; a value once read
   * is kept until a different one is read, never cleared by not knowing.
   */
  self?: SelfReport;
  /** What the board was last told of {@link self}: a heartbeat sends only what differs. */
  reported?: SelfReport;
}

export function readState(path: string): SessionState | undefined {
  const value = readJson(path);
  if (!isRecord(value) || value.version !== 1 || !isHarness(value.harness as string)) {
    return undefined;
  }
  return value as unknown as SessionState;
}

export function writeState(home: string, state: SessionState): void {
  privateDir(join(home, '.laika'));
  privateDir(sessionsDir(home));
  writePrivate(
    statePath(home, state.harness, state.harness_session_id),
    `${JSON.stringify(state)}\n`,
  );
}

export function listStates(home: string): SessionState[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir(home));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => readState(join(sessionsDir(home), n)))
    .filter((s): s is SessionState => s !== undefined)
    .sort((a, b) => b.started_at - a.started_at);
}

/* -------------------------------------------------------------------------- */
/* What the session says about itself                                         */
/* -------------------------------------------------------------------------- */

/**
 * The harness's version and the model, **self-reported** (D-118, LAI-588):
 * each field present only when the harness itself wrote it down, never
 * inferred. The harness is not here — it is always known, from the hook.
 */
export interface SelfReport {
  readonly harness_version?: string;
  readonly model?: string;
}

/**
 * The board's shapes for the two fields (`server/src/http/routes/agent-sessions.ts`,
 * `SELF_REPORTED`): a version is 1–64 printable characters with no spaces, a
 * model 1–120 printable characters. Anything else is not sent — a value the
 * board would refuse would cost the whole start.
 */
const asVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return /^[\x21-\x7e]{1,64}$/.test(v) ? v : undefined;
};

const asModel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  // Claude Code writes `<synthetic>` for a reply no model made.
  return /^[\x20-\x7e]{1,120}$/.test(v) && v !== '<synthetic>' ? v : undefined;
};

/** How much of a transcript is read, from each end. A transcript of any size costs the same. */
export const TRANSCRIPT_WINDOW = 256 * 1024;

/** The filesystem calls {@link transcriptEnds} makes. */
export interface TranscriptFs {
  readonly open: (path: string, flags: number) => number;
  readonly fstat: (fd: number) => { isFile(): boolean; size: number };
  readonly read: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => number;
}

const TRANSCRIPT_FS: TranscriptFs = { open: openSync, fstat: fstatSync, read: readSync };

/**
 * The first and last {@link TRANSCRIPT_WINDOW} bytes of a regular file, or
 * nothing. **Opened first, then checked**: the descriptor is what is
 * `fstat`ed, so a FIFO or device swapped in for the path after any check is
 * still refused, and `O_NONBLOCK` keeps the open itself from waiting on a
 * FIFO with no writer. The calls are parameters only so a test can swap the
 * path at the moment it is opened, or say what the descriptor is.
 */
export function transcriptEnds(
  path: unknown,
  fs: Partial<TranscriptFs> = {},
): { head: string; tail: string } | undefined {
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  const { open, fstat, read: readAt } = { ...TRANSCRIPT_FS, ...fs };
  let fd: number | undefined;
  try {
    const handle = open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    fd = handle;
    // A FIFO or a device would block or never end: only a regular file is read.
    const stat = fstat(handle);
    const size = stat.isFile() ? stat.size : -1;
    if (size <= 0) return undefined;
    const read = (at: number, length: number): string => {
      const buffer = Buffer.alloc(length);
      return buffer.toString('utf8', 0, readAt(handle, buffer, 0, length, at));
    };
    const length = Math.min(size, TRANSCRIPT_WINDOW);
    return { head: read(0, length), tail: read(size - length, length) };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Each line that is a JSON object; a line cut by the window does not parse and is skipped. */
function records(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (isRecord(value)) out.push(value);
    } catch {
      // Cut by the window, or not JSON.
    }
  }
  return out;
}

/**
 * What the harness says about itself in a hook's input and its own
 * transcript (`transcript_path`, both harnesses), read 2026-10-29 from real
 * files of each:
 *
 * | | version | model |
 * | --- | --- | --- |
 * | Claude Code | `version` on each `user` / `assistant` line | the input's `model`, else the last `assistant` line's `message.model` |
 * | Codex | `session_meta`'s `payload.cli_version` (the first line) | the input's `model`, else the last `turn_context`'s `payload.model` |
 *
 * Any other harness (LAI-557) reports only the input's `model`: its
 * transcript has not been read here, so nothing is guessed from it.
 *
 * The newest line wins: a model switched mid-session is the one the last
 * reply used. **Nothing found is nothing sent** — a new session's transcript
 * may not exist yet at `SessionStart`, and the version then waits for a later
 * hook and goes on a heartbeat.
 */
export function readSelfReport(
  harness: Harness,
  input: Readonly<Record<string, unknown>>,
): SelfReport {
  const ends = transcriptEnds(input.transcript_path);
  const newest = ends === undefined ? [] : records(ends.tail).reverse();
  let version: string | undefined;
  let model = asModel(input.model);
  if (harness === 'claude-code') {
    for (const r of newest) {
      version ??= asVersion(r.version);
      if (r.type === 'assistant' && isRecord(r.message)) model ??= asModel(r.message.model);
      if (version !== undefined && model !== undefined) break;
    }
  } else if (harness === 'codex') {
    const meta = ends === undefined ? undefined : records(ends.head)[0];
    if (meta?.type === 'session_meta' && isRecord(meta.payload)) {
      version = asVersion(meta.payload.cli_version);
    }
    for (const r of newest) {
      if (model !== undefined) break;
      if (r.type === 'turn_context' && isRecord(r.payload)) model = asModel(r.payload.model);
    }
  }
  return {
    ...(version === undefined ? {} : { harness_version: version }),
    ...(model === undefined ? {} : { model }),
  };
}

/**
 * Keep what a hook read about the harness in the session's state, for the
 * watcher's next heartbeat to send. A field not read now keeps its old value.
 * Writes only when something changed.
 */
export function noteSelfReport(home: string, path: string, report: SelfReport): void {
  const state = readState(path);
  if (state === undefined) return;
  const next: SelfReport = { ...state.self, ...report };
  if (next.harness_version === state.self?.harness_version && next.model === state.self?.model) {
    return;
  }
  state.self = next;
  writeState(home, state);
}

/** The fields of {@link SelfReport} the board has not been told yet. */
function unreported(state: SessionState): SelfReport {
  const self = state.self ?? {};
  const told = state.reported ?? {};
  return {
    ...(self.harness_version !== undefined && self.harness_version !== told.harness_version
      ? { harness_version: self.harness_version }
      : {}),
    ...(self.model !== undefined && self.model !== told.model ? { model: self.model } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The board                                                                  */
/* -------------------------------------------------------------------------- */

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type ApiResult =
  | {
      readonly kind: 'ok';
      readonly status: number;
      readonly body: unknown;
      /** The board's clock at the answer (its `Date` header), when it sent one. */
      readonly date?: number;
    }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly code?: string;
      readonly reason?: string;
    }
  /**
   * `sent: false` only when the request provably never left: the connection
   * was refused or the name did not resolve. Anything else — a reset, a
   * timeout — may have reached the board, and is treated as if it did.
   */
  | { readonly kind: 'network'; readonly sent: boolean; readonly message: string };

const NOT_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
]);

/**
 * The network error's code, from the error or its causes. A fetch that fails
 * with no code at all is an abort or a timeout — which may have been sent.
 */
function errorCode(cause: unknown): string | undefined {
  let current: unknown = cause;
  for (let i = 0; i < 4 && isRecord(current); i += 1) {
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

export async function callBoard(
  fetchFn: Fetch,
  credential: AgentCredential,
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
  timeoutMs = 10_000,
  method: 'POST' | 'GET' = 'POST',
): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetchFn(`${credential.url.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential.token}`,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: body === undefined ? '' : JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const code = errorCode(cause);
    return {
      kind: 'network',
      sent: code === undefined || !NOT_SENT.has(code),
      message: code ?? (cause instanceof Error ? cause.name : 'error'),
    };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // **A success whose body did not arrive whole is not a success.** The
    // board did whatever it did — made the session, renewed the claims — and
    // the answer was lost on the way, which is exactly the ambiguous case: it
    // is retried (a start with its same key), never taken as done or refused.
    if (response.ok) return { kind: 'network', sent: true, message: 'incomplete body' };
    parsed = undefined;
  }
  if (response.ok) {
    const date = Date.parse(response.headers.get('date') ?? '');
    return {
      kind: 'ok',
      status: response.status,
      body: parsed,
      ...(Number.isFinite(date) ? { date } : {}),
    };
  }
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const details = error !== undefined && isRecord(error.details) ? error.details : undefined;
  return {
    kind: 'http',
    status: response.status,
    ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    ...(typeof details?.reason === 'string' ? { reason: details.reason } : {}),
  };
}

/** A result in a few words, for the log and `status`. Never carries the token. */
export function describe(result: ApiResult): string {
  if (result.kind === 'ok') return `HTTP ${String(result.status)}`;
  if (result.kind === 'http') {
    return `HTTP ${String(result.status)}${result.reason === undefined ? '' : ` ${result.reason}`}`;
  }
  return `network ${result.message}${result.sent ? '' : ' (not sent)'}`;
}

/* -------------------------------------------------------------------------- */
/* Opening                                                                    */
/* -------------------------------------------------------------------------- */

export interface Deps {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: Fetch;
  readonly proc: ProcReader;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface StartRequest {
  readonly harness: Harness;
  readonly harnessSessionId: string;
  readonly harnessProc: ProcInfo;
  readonly credential: AgentCredential;
  readonly clientVersion?: string;
  /** The harness's version and model, when they could be told ({@link readSelfReport}). */
  readonly self?: SelfReport;
}

export type StartOutcome =
  | { readonly kind: 'reused' | 'started'; readonly state: SessionState }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed'; readonly state: SessionState; readonly why: string };

/**
 * One start at a time per harness session — `SessionStart` and the first
 * `PostToolUse` can race. A lock older than a minute is a crashed start's.
 */
function takeLock(lock: string, now: number): boolean {
  const take = (): boolean => {
    try {
      closeSync(openSync(lock, 'wx', 0o600));
      return true;
    } catch {
      return false;
    }
  };
  if (take()) return true;
  try {
    if (now - statSync(lock).mtimeMs < 60_000) return false;
  } catch {
    return false;
  }
  rmSync(lock, { force: true });
  return take();
}

/** A state that already names a live session for this same harness process. */
function reusable(state: SessionState, proc: ProcInfo): boolean {
  return (
    state.status === 'live' &&
    state.session_id !== undefined &&
    state.harness_pid === proc.pid &&
    state.harness_started === proc.started
  );
}

/**
 * Open the session, once.
 *
 * **Idempotent per harness session**: a second `SessionStart` (resume,
 * compact, a racing hook) for the same harness process finds the live session
 * in the state file and uses it. **A start that fails on the network is
 * retried with the same `Idempotency-Key`** — here, and by the next hook if
 * these attempts all fail — so a start whose answer was lost after the board
 * made the session gets that same session back (the board replays a keyed
 * `POST` for 24 h) rather than a second one.
 */
export async function startSession(deps: Deps, request: StartRequest): Promise<StartOutcome> {
  const path = statePath(deps.home, request.harness, request.harnessSessionId);
  privateDir(join(deps.home, '.laika'));
  privateDir(sessionsDir(deps.home));

  // **The lock first, then the state.** Read before locking, a second starter
  // can see "nothing yet", wait out the first, and then open a second
  // session from that stale reading. A starter that finds the lock held waits
  // for it, and then reads what the first one left.
  let locked = takeLock(`${path}.lock`, deps.now());
  for (let waited = 0; !locked && waited < LOCK_WAIT_TRIES; waited += 1) {
    await deps.sleep(100);
    locked = takeLock(`${path}.lock`, deps.now());
  }
  if (!locked) return { kind: 'busy' };
  try {
    return await startLocked(deps, request, path);
  } finally {
    rmSync(`${path}.lock`, { force: true });
  }
}

const LOCK_WAIT_TRIES = 100;

/**
 * Worth sending again: the network, or an answer that says "not now" — 5xx,
 * 408, 429. Any other 4xx is the board refusing, and resending will not change it.
 */
function retryable(result: ApiResult): boolean {
  if (result.kind === 'network') return true;
  if (result.kind === 'ok') return false;
  return result.status >= 500 || result.status === 408 || result.status === 429;
}

/** Must hold the start lock. */
async function startLocked(deps: Deps, request: StartRequest, path: string): Promise<StartOutcome> {
  const existing = readState(path);
  if (existing !== undefined && reusable(existing, request.harnessProc)) {
    return { kind: 'reused', state: existing };
  }
  // **One key per logical start, until the board confirms a session.** Any
  // earlier attempt of this same harness process that was never confirmed —
  // dropped, answered 5xx, refused, or interrupted — may have made a session,
  // so its key is reused, whatever came after it. Only a confirmed session
  // (since ended or abandoned) or a different harness process starts afresh.
  // Reusing a key that made nothing is harmless: the board keeps only
  // successful answers.
  const resumable =
    existing?.start_key !== undefined &&
    existing.session_id === undefined &&
    existing.harness_pid === request.harnessProc.pid &&
    existing.harness_started === request.harnessProc.started
      ? existing
      : undefined;

  {
    const fresh: SessionState = {
      version: 1,
      harness: request.harness,
      harness_session_id: request.harnessSessionId,
      url: request.credential.url,
      status: 'starting',
      start_key: `laika-agent-start-${randomUUID()}`,
      harness_pid: request.harnessProc.pid,
      harness_started: request.harnessProc.started,
      started_at: deps.now(),
      beats: 0,
      failures: 0,
      claims: [],
      noticed: [],
    };
    const state: SessionState =
      resumable === undefined ? fresh : { ...resumable, status: 'starting' };
    // What the session says about itself (D-118): the harness always — the
    // hook names it — and its version and model only when they were read. A
    // field not known is left out, never sent empty. What was learned after a
    // key was first sent waits for the first heartbeat, which sends whatever
    // `reported` does not already hold.
    state.self = { ...state.self, ...request.self };
    state.start_body ??=
      resumable === undefined
        ? {
            ...(request.clientVersion === undefined
              ? {}
              : { client_version: request.clientVersion }),
            harness: request.harness,
            ...state.self,
          }
        : // A key an older helper wrote, with the body it sent then.
          request.clientVersion === undefined
          ? {}
          : { client_version: request.clientVersion };
    const body = state.start_body;
    // The key, and its body, are on disk before anything is sent.
    writeState(deps.home, state);
    const key = { 'Idempotency-Key': state.start_key ?? '' };

    let result: ApiResult = { kind: 'network', sent: false, message: 'not tried' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await deps.sleep(500 * 2 ** (attempt - 1));
      result = await callBoard(deps.fetch, request.credential, '/api/v1/agent-sessions', body, key);
      // A success that does not name a session is not one: the board answered
      // something, so it is the ambiguous case, retried with the same key.
      if (result.kind === 'ok' && !(isRecord(result.body) && isLaikaId(result.body.id))) {
        result = { kind: 'network', sent: true, message: 'no session id in the answer' };
      }
      if (result.kind === 'ok' || !retryable(result)) break;
      state.failures += 1;
    }

    if (result.kind === 'ok' && isRecord(result.body) && isLaikaId(result.body.id)) {
      state.status = 'live';
      state.session_id = result.body.id;
      if (isLaikaId(result.body.agent_id)) state.agent_id = result.body.agent_id;
      state.reported = {
        ...(body.harness_version === undefined ? {} : { harness_version: body.harness_version }),
        ...(body.model === undefined ? {} : { model: body.model }),
      };
      state.last_beat_at = deps.now();
      delete state.last_error;
      writeState(deps.home, state);
      log(
        deps.home,
        `start ${request.harness} ${state.session_id} harness_pid=${String(state.harness_pid)}`,
      );
      return { kind: 'started', state };
    }

    const why = describe(result);
    state.last_error = why;
    // Retryable — the network, 5xx, 408, 429 — stays `starting`, tried again
    // by the next hook. A refusal is `failed`, tried again only by the next
    // `SessionStart`. **Both keep the key** (see `resumable`).
    state.status = retryable(result) ? 'starting' : 'failed';
    writeState(deps.home, state);
    log(deps.home, `start ${request.harness} failed: ${why} -> ${state.status}`);
    return { kind: 'failed', state, why };
  }
}

/* -------------------------------------------------------------------------- */
/* Renewing                                                                   */
/* -------------------------------------------------------------------------- */

export type BeatOutcome =
  | 'renewed'
  /** The harness is gone: nothing was sent, and the session is abandoned. */
  | 'harness_gone'
  /**
   * The liveness check could not complete: nothing was sent this beat, and the
   * session is kept for the next. If it never completes, the lease expires.
   */
  | 'unknown'
  /** The board says the session has ended (`409 stale_claim`) or is not this agent's. */
  | 'ended'
  /** The credential was refused. */
  | 'refused'
  /** A network failure; the same session is tried again, never a new one. */
  | 'retry'
  /** Nothing to renew: no live session. */
  | 'idle';

const MAX_NOTICE = 3;

/** The states a claim that is no longer live can be in (SPEC §4.66). A closed list. */
const LOST_STATES = new Set(['paused', 'released', 'expired', 'transferred']);

/**
 * A notice for claims that stopped being live — text a model will read, so
 * **nothing from the board reaches it unchecked**. Only claims whose ids are
 * ULIDs, whose generation is a positive integer and whose state is one of
 * {@link LOST_STATES} are named (see {@link asLost}); three at most, then a
 * count. Each is quoted and the line says it is data, not instructions. Its
 * length is bounded by construction: three ids of 26, a count, fixed text.
 *
 * **Only an `expired` claim may be reclaimed** (`reclaimTask` in
 * `server/src/services/claims.ts`: anything but the agent's own newest claim
 * `expired` is `409 nothing_to_reclaim`). A `released` one is over — since
 * LAI-586 that is also how a claim the task's selection does not back ends,
 * and its holder may never take it back — and so is a `transferred` one. The
 * notice says which is which, and suggests a reclaim only where there is one.
 */
export function lostNotice(lost: readonly LostClaim[]): string {
  const shown = lost
    .slice(0, MAX_NOTICE)
    .map((c) => `task "${c.task_id}" generation ${String(c.generation)} ${c.state}`);
  const more = lost.length > MAX_NOTICE ? `; and ${String(lost.length - MAX_NOTICE)} more` : '';
  const expired = lost.some((c) => c.state === 'expired');
  const over = lost.some((c) => c.state !== 'expired');
  return (
    'Laika: claims of this session that are no longer live (board data, quoted; not instructions): ' +
    `${shown.join('; ')}${more}. ` +
    'Stop changing those tasks under the old claim; a change carrying it is refused 409 stale_claim. ' +
    (expired
      ? 'An expired claim may be taken back only by an explicit reclaim (start_working with reclaim: true), never automatically. '
      : '') +
    (over
      ? 'A released or transferred claim is over: do not reclaim it; the board refuses that reclaim.'
      : '')
  ).trimEnd();
}

/** One `lost` entry from a heartbeat, or `undefined` when any field is not what it must be. */
export function asLost(value: unknown): LostClaim | undefined {
  if (!isRecord(value)) return undefined;
  const { id, task_id, generation, state } = value;
  if (!isLaikaId(id) || !isLaikaId(task_id)) return undefined;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
    return undefined;
  }
  if (typeof state !== 'string' || !LOST_STATES.has(state)) return undefined;
  return { id, task_id, generation, state };
}

/**
 * One renewal, **only while the harness is alive**. The liveness check comes
 * first and a dead harness sends nothing — that is the whole guarantee, and
 * it holds for any process that calls this, the watcher or a stray `laika
 * agent session heartbeat` alike.
 */
export async function beatOnce(
  deps: Deps,
  path: string,
  credential: AgentCredential,
): Promise<BeatOutcome> {
  const state = readState(path);
  if (state?.status !== 'live' || state.session_id === undefined) return 'idle';

  const harness = liveness(state.harness_pid, state.harness_started, deps.proc);
  if (harness === 'unknown') {
    state.last_error = 'harness liveness unknown (ps did not answer); not renewed this beat';
    writeState(deps.home, state);
    log(deps.home, `beat ${state.session_id}: liveness unknown, skipped`);
    return 'unknown';
  }
  if (harness === 'dead') {
    state.status = 'abandoned';
    state.last_error = 'harness exited';
    writeState(deps.home, state);
    log(
      deps.home,
      `abandon ${state.harness} ${state.session_id}: harness ${String(state.harness_pid)} exited`,
    );
    return 'harness_gone';
  }

  // A model switched mid-session, or a version first read after the start:
  // only what the board has not been told, and no body when that is nothing.
  // An omitted field keeps what the session last said (SPEC §6.4).
  const changed = unreported(state);
  const result = await callBoard(
    deps.fetch,
    credential,
    `/api/v1/agent-sessions/${encodeURIComponent(state.session_id)}/heartbeat`,
    Object.keys(changed).length === 0 ? undefined : changed,
  );
  // Re-read: `end` may have run while the request was in flight.
  const current = readState(path) ?? state;
  if (current.status !== 'live') return current.status === 'ended' ? 'ended' : 'idle';

  if (result.kind === 'ok' && isRecord(result.body)) {
    // Told only by a `200`, the heartbeat's own answer (SPEC §6.4): any other
    // answer, or a beat that failed, leaves the fields to be sent again.
    if (result.status === 200) current.reported = { ...current.reported, ...changed };
    current.beats += 1;
    current.failures = 0;
    current.last_beat_at = deps.now();
    delete current.last_error;
    const session = isRecord(result.body.session) ? result.body.session : undefined;
    if (isLaikaId(session?.agent_id)) current.agent_id = session.agent_id;
    const claims = Array.isArray(result.body.claims) ? result.body.claims : [];
    current.claims = claims
      .slice(0, 200)
      .filter(isRecord)
      .filter((c) => isLaikaId(c.task_id) && Number.isSafeInteger(c.generation))
      .map((c) => ({
        task_id: c.task_id as string,
        generation: c.generation as number,
        lease_expires_at: Number(c.lease_expires_at),
      }));
    // Bounded before it is read: a board answer of any size costs the same.
    const lost = (
      Array.isArray(result.body.lost) ? (result.body.lost as unknown[]).slice(0, 200) : []
    )
      .map(asLost)
      .filter((c): c is LostClaim => c !== undefined);
    const fresh = lost.filter((c) => !current.noticed.includes(`${c.id}:${String(c.generation)}`));
    if (fresh.length > 0) {
      current.noticed = [
        ...current.noticed,
        ...fresh.map((c) => `${c.id}:${String(c.generation)}`),
      ].slice(-200);
      current.pending_lost = [...(current.pending_lost ?? []), ...fresh].slice(-50);
      log(deps.home, `lost ${current.session_id ?? ''}: ${String(fresh.length)} claim(s)`);
    }
    // `end` may have landed while this was being built: never write it back to live.
    if (readState(path)?.status !== 'live') return 'ended';
    writeState(deps.home, current);
    return 'renewed';
  }

  if (result.kind === 'network') {
    current.failures += 1;
    current.last_error = describe(result);
    writeState(deps.home, current);
    log(
      deps.home,
      `beat ${current.session_id ?? ''} ${describe(result)} (retrying the same session)`,
    );
    return 'retry';
  }

  // 409 stale_claim: ended on the board. 404: not this agent's. 401/403: the
  // credential. None of them is retried and none opens a new session.
  current.last_error = describe(result);
  current.status = result.status === 409 || result.status === 404 ? 'ended' : 'failed';
  if (result.status === 409) current.end_reason = 'ended on the board';
  writeState(deps.home, current);
  log(deps.home, `beat ${current.session_id ?? ''} ${describe(result)} -> ${current.status}`);
  return current.status === 'ended' ? 'ended' : 'refused';
}

/**
 * The background renewer. One per session; it stops when the harness dies,
 * when the session ends, or when a newer watcher has taken over.
 */
export async function runWatcher(
  deps: Deps,
  path: string,
  credential: AgentCredential,
  self: { pid: number; started: string },
  intervalMs: number,
): Promise<BeatOutcome> {
  for (;;) {
    const state = readState(path);
    if (state === undefined) return 'idle';
    if (state.watcher_pid !== self.pid || state.watcher_started !== self.started) return 'idle';
    const outcome = await beatOnce(deps, path, credential);
    if (outcome !== 'renewed' && outcome !== 'retry' && outcome !== 'unknown') return outcome;
    const failures = readState(path)?.failures ?? 0;
    // A failed beat is tried again sooner, never later than the interval.
    const wait =
      outcome === 'retry' ? Math.min(intervalMs, 1000 * 2 ** Math.min(failures, 5)) : intervalMs;
    await deps.sleep(wait);
  }
}

/* -------------------------------------------------------------------------- */
/* Ending                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Close the session on the board. Retried on network failure — ending twice is
 * harmless, the second is `409` — and a `409` counts as ended.
 */
export async function endSession(
  deps: Deps,
  path: string,
  credential: AgentCredential,
  attempts = 5,
): Promise<'ended' | 'idle' | 'failed'> {
  const state = readState(path);
  if (state?.session_id === undefined) return 'idle';
  if (state.status === 'ended') return 'ended';
  const sessionId = state.session_id;
  const watcher = state.watcher_pid;
  const watcherStarted = state.watcher_started;
  // Stop renewing first, so no heartbeat races the end.
  state.status = 'ended';
  writeState(deps.home, state);
  if (
    watcher !== undefined &&
    watcherStarted !== undefined &&
    watcher !== process.pid &&
    isAlive(watcher, watcherStarted, deps.proc)
  ) {
    try {
      process.kill(watcher, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  let result: ApiResult = { kind: 'network', sent: false, message: 'not tried' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(500 * 2 ** (attempt - 1));
    result = await callBoard(
      deps.fetch,
      credential,
      `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/end`,
    );
    if (result.kind !== 'network') break;
  }
  const after = readState(path) ?? state;
  // A renewal racing this end may have written `live` back; the end decides.
  after.status = 'ended';
  if (result.kind === 'ok' && isRecord(result.body)) {
    after.end_reason =
      typeof result.body.end_reason === 'string' ? result.body.end_reason : 'ended';
    delete after.last_error;
    writeState(deps.home, after);
    log(deps.home, `end ${sessionId} end_reason=${after.end_reason}`);
    return 'ended';
  }
  if (result.kind === 'http' && result.status === 409) {
    after.end_reason = 'ended on the board';
    writeState(deps.home, after);
    log(deps.home, `end ${sessionId}: already ended`);
    return 'ended';
  }
  after.last_error = describe(result);
  writeState(deps.home, after);
  log(deps.home, `end ${sessionId} failed: ${describe(result)}`);
  return 'failed';
}
