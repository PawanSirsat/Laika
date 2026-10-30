import { spawn } from 'node:child_process';
import { readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type AgentCredential,
  asLost,
  beatOnce,
  type Deps,
  endSession,
  findHarness,
  type Harness,
  HARNESSES,
  heartbeatIntervalMs,
  isAlive,
  isHarness,
  isLaikaId,
  listStates,
  log,
  type LostClaim,
  lostNotice,
  noteSelfReport,
  readCredential,
  readProc,
  readSelfReport,
  readState,
  runWatcher,
  type SelfReport,
  type SessionState,
  startSession,
  UNKNOWN,
  statePath,
  writeState,
} from './agent-session.ts';
import {
  autoCheckpoint,
  type BackgroundTask,
  clearInflight,
  awaitSave,
  markInflight,
  MUTATING_TOOLS,
  readActivity,
  reconcileAtStop,
  shouldTrigger,
  writeActivity,
} from './agent-checkpoint.ts';

/**
 * `laika agent …` — the local helper (proposal §4.7, LAI-542).
 *
 * ## How a session is kept alive, and why this way
 *
 * **A background watcher, started at `SessionStart` and bound to the harness
 * PID**, does the renewing. The hook events alone cannot: both harnesses run
 * hooks only at boundaries — a prompt, a tool call — and a model thinking for
 * five minutes, or a person reading for ten, produces none, so a
 * `PostToolUse`-only renewal lets a working session's claim lapse at the
 * server's five-minute expiry. The watcher beats every 30 s whatever the
 * harness is doing, and checks before each beat that the harness process is
 * still the one it started with (PID and start time). When it is not, the
 * watcher sends nothing more and exits.
 *
 * `UserPromptSubmit` and `PostToolUse` are the backstop, and cost no network
 * when the session is open: they open it if `SessionStart` did not (hooks
 * installed mid-session, or a start that failed on the network, retried with
 * its key), restart a watcher that has died while its harness lives (a laptop
 * sleep can kill it), and deliver, once, a notice that a claim was lost.
 * `SessionEnd` hands the end to a background process, so the harness's
 * one-to-three-second budget never cuts it short.
 *
 * The trade-off: one more process per session, and a session whose watcher
 * dies goes unrenewed until the next prompt or tool call restarts it.
 */

export interface AgentIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: () => string;
  /**
   * A hook's input, read with a deadline (round-5 #4): `undefined` when it
   * cannot be read whole — a writer that never closes, past
   * {@link STDIN_MAX_BYTES}, an error. Absent in tests that pass `stdin`.
   */
  readonly readHookInput?: () => Promise<string | undefined>;
  readonly isTTY: boolean;
}

/** The most a hook, a child or `login` reads from stdin; past it nothing is read. */
export const STDIN_MAX_BYTES = 4 * 1024 * 1024;

/**
 * How long a hook waits for its input. With {@link PRE_TOOL_WAIT_MS} it must
 * fit inside PreToolUse's 30 s timeout, or the harness kills the hook and
 * runs the tool undecided.
 */
export const HOOK_READ_MS = 5_000;

/**
 * Stdin, read as a stream with a deadline: a blocking `readSync` cannot be
 * interrupted, so a writer that holds the pipe open would hold the hook until
 * the harness killed it. Whole input, or `undefined` — on the deadline, past
 * `maxBytes`, or on an error — after which stdin is let go so the process
 * can exit.
 */
export function readStdinBounded(
  maxBytes = STDIN_MAX_BYTES,
  timeoutMs = HOOK_READ_MS,
  stream: NodeJS.ReadableStream & { destroy?: () => void } = process.stdin,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      stream.destroy?.();
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(undefined);
    }, timeoutMs);
    stream.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += bytes.length;
      if (total > maxBytes) {
        finish(undefined);
        return;
      }
      chunks.push(bytes);
    });
    stream.on('end', () => {
      finish(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', () => {
      finish(undefined);
    });
  });
}

/**
 * All of stdin, up to {@link STDIN_MAX_BYTES}, or `''`. **Not `readFileSync(0)`**
 * (round-4 #2): once anything touches `process.stdin` — `isTTY` below does —
 * Node makes fd 0 non-blocking, and `readFileSync` then throws `EAGAIN` as
 * soon as it catches up with a slower writer, so a hook input past a few
 * tens of KB was never read at all: a large `PostToolUse` cleared no marker,
 * and a long `background_tasks` list was never looked at. This loops, waits
 * out `EAGAIN` for up to 10 s, and gives up whole — an input it cannot read
 * entirely is no input, which leaves every marker where it is.
 */
export function readStdin(fd = 0, maxBytes = STDIN_MAX_BYTES, waitMs = 10_000): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + waitMs;
  let total = 0;
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, buffer, 0, buffer.length, null);
    } catch (cause) {
      const code = (cause as { code?: unknown }).code;
      if (code === 'EAGAIN' && Date.now() < until) {
        Atomics.wait(pause, 0, 0, 5);
        continue;
      }
      if (code === 'EOF') break;
      return '';
    }
    if (n === 0) break;
    total += n;
    if (total > maxBytes) return '';
    chunks.push(Buffer.from(buffer.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const CONSOLE: AgentIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  stdin: () => readStdin(),
  readHookInput: () => readStdinBounded(),
  isTTY: process.stdin.isTTY === true,
};

const USAGE = [
  'laika agent — a registered agent’s session, renewed while its harness runs.',
  '',
  'Usage:',
  '  laika agent login <claude-code|codex> [--url URL]   save the agent’s own token (read from stdin)',
  '  laika agent logout <claude-code|codex>              forget it',
  '  laika agent hooks on|off [--harness H]              install the session hooks (opt-in)',
  '  laika agent session start --harness H --harness-session ID [--pid PID]',
  '  laika agent session heartbeat --harness H --harness-session ID',
  '  laika agent session end --harness H --harness-session ID',
  '  laika agent session status',
  '  laika agent checkpoint save|note|status|reverify|consent   (laika agent checkpoint --help)',
  '  laika agent checkpoints prune --dry-run',
  '',
  'The token is the agent’s, from the Agents screen — never your own. It is kept',
  'in ~/.laika/agents/<harness>.json (0600), or read from LAIKA_AGENT_TOKEN, and',
  'is never printed, logged, or put on a command line.',
].join('\n');

/** The file this module's entry is, beside it: `.ts` from source, `.js` once built. */
export const MAIN = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? './agent-main.ts' : './agent-main.js', import.meta.url),
);

export function deps(io: AgentIo): Deps {
  return {
    home: io.home,
    env: io.env,
    fetch: (input, init) => fetch(input, init),
    proc: readProc,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/* -------------------------------------------------------------------------- */
/* Background children                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a background child may see of its parent's environment: an allowlist,
 * not a blocklist, so no credential of any name — the agent's, the person's,
 * a cloud key — reaches it. The child needs a home, a path and the interval.
 */
const CHILD_ENV = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LAIKA_AGENT_HEARTBEAT_SECONDS'];

/**
 * A background save also pushes, so it keeps what git needs to reach the
 * remote — the ssh agent's socket and an ssh command — and the checkpoint
 * settings. Still an allowlist: no token of any name (LAI-547).
 */
const CHECKPOINT_CHILD_ENV = [
  ...CHILD_ENV,
  'SSH_AUTH_SOCK',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'XDG_CONFIG_HOME',
  'USER',
  'LOGNAME',
  'LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS',
];

export function childEnv(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[] = CHILD_ENV,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) next[name] = value;
  }
  return next;
}

/**
 * A detached child of this entry: `_watch` or `_end`. **The credential goes on
 * its stdin**, never in argv or the environment, where `ps` would show it.
 */
export function spawnChild(
  io: AgentIo,
  mode: '_watch' | '_end' | '_checkpoint',
  harness: Harness,
  harnessSessionId: string,
  credential: AgentCredential,
): number | undefined {
  const child = spawn(process.execPath, [MAIN, mode, harness, harnessSessionId], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: childEnv(io.env, mode === '_watch' ? CHILD_ENV : CHECKPOINT_CHILD_ENV),
  });
  child.on('error', () => undefined);
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(credential));
  child.unref();
  return child.pid;
}

function watcherRunning(state: SessionState): boolean {
  return (
    state.watcher_pid !== undefined &&
    state.watcher_started !== undefined &&
    isAlive(state.watcher_pid, state.watcher_started)
  );
}

function ensureWatcher(io: AgentIo, state: SessionState, credential: AgentCredential): void {
  if (state.status !== 'live' || watcherRunning(state)) return;
  if (!isAlive(state.harness_pid, state.harness_started)) return;
  const pid = spawnChild(io, '_watch', state.harness, state.harness_session_id, credential);
  log(io.home, `watcher ${state.session_id ?? ''} spawned pid=${String(pid ?? 0)}`);
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

const HOOK_EVENTS = {
  'session-start': 'SessionStart',
  prompt: 'UserPromptSubmit',
  'pre-tool': 'PreToolUse',
  tool: 'PostToolUse',
  'tool-failed': 'PostToolUseFailure',
  stop: 'Stop',
  'session-end': 'SessionEnd',
} as const;

type HookEvent = keyof typeof HOOK_EVENTS;

const NAMES: Readonly<Record<Harness, string>> = { 'claude-code': 'Claude Code', codex: 'Codex' };

/** The most a hook ever hands a model, all notes together. */
export const MAX_CONTEXT = 1200;

/** Nothing when the session id is not a Laika id: an answer of any other shape is not repeated. */
export function sessionContext(state: SessionState): string {
  if (!isLaikaId(state.session_id)) return '';
  return (
    `Laika: agent session ${state.session_id ?? ''} is open for this ${NAMES[state.harness]} ` +
    'session and is renewed only while this process runs. When you claim a Laika task ' +
    `(start_working), pass session_id: "${state.session_id ?? ''}" so this session holds the claim.`
  );
}

/**
 * The documented output both harnesses read: `hookSpecificOutput.additionalContext`.
 * Capped at {@link MAX_CONTEXT} whatever is passed — the notes are bounded
 * already, and this is the backstop.
 */
export function contextOutput(event: HookEvent, text: string): string {
  const capped = text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 1)}…` : text;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: HOOK_EVENTS[event], additionalContext: capped },
  });
}

/** The hook's input, as the harness documents it: a JSON object on stdin. */
function hookInput(raw: string): Record<string, unknown> | undefined {
  let input: unknown;
  try {
    // `raw` is already bounded by {@link readStdin}; a cut here would only
    // turn a large, whole input into one that does not parse.
    input = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function hookSessionId(input: Readonly<Record<string, unknown>>): string | undefined {
  const id = input.session_id;
  return typeof id === 'string' && id !== '' && id.length <= 512 ? id : undefined;
}

/** A synchronous pause for the hook's short wait: nothing else runs in it. */
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/** The longest `background_tasks` list judged; a longer one clears nothing. */
export const MAX_BACKGROUND_TASKS = 1000;

/** The subagent a tool event came from, when the harness names one (`agent_id`). */
function subagentOf(input: Readonly<Record<string, unknown>>): string | undefined {
  const id = input.agent_id;
  return typeof id === 'string' && id !== '' && id.length <= 512 ? id : undefined;
}

/**
 * `Stop`'s `background_tasks` as documented: `{ id, type, status, … }` per
 * task in flight. `undefined` when the input does not carry the field — the
 * harness did not say, which is not the same as "nothing runs". An entry of
 * another shape is kept with no status, which counts as still running.
 *
 * **Every entry is read** (round-4 #2): one running task among any number of
 * finished ones keeps every marker. A list longer than
 * {@link MAX_BACKGROUND_TASKS} is not judged, and counts as running.
 */
function backgroundTasks(input: Readonly<Record<string, unknown>>): BackgroundTask[] | undefined {
  const tasks = input.background_tasks;
  if (!Array.isArray(tasks)) return undefined;
  // Past the cap the list is not judged: one task of no status stands for
  // it, which counts as running, so nothing is cleared.
  if (tasks.length > MAX_BACKGROUND_TASKS) return [{}];
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' && value.length <= 512 ? value : undefined;
  return tasks.map((t: unknown) => {
    const entry = typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {};
    const id = text(entry.id);
    const type = text(entry.type);
    const status = text(entry.status);
    return {
      ...(id === undefined ? {} : { id }),
      ...(type === undefined ? {} : { type }),
      ...(status === undefined ? {} : { status }),
    };
  });
}

/** One tool call's key, the same at `PreToolUse` and `PostToolUse`. */
function toolKey(input: Readonly<Record<string, unknown>>): string {
  const id = input.tool_use_id;
  if (typeof id === 'string' && id !== '' && id.length <= 512) return id;
  return `${String(input.tool_name)}:${JSON.stringify(input.tool_input ?? null).slice(0, 4096)}`;
}

/**
 * The checkpoint half of a hook (LAI-547): no network, a few small files.
 * `PreToolUse` marks a tool as running; `PostToolUse` clears it and counts a
 * mutating call; when {@link shouldTrigger} says so — or at `Stop` — a
 * background `_checkpoint` child is started, which asks the board for consent
 * before it saves anything.
 */
/**
 * `PreToolUse`'s documented refusal, the same in both harnesses
 * (code.claude.com/docs/en/hooks, learn.chatgpt.com/docs/hooks).
 */
export function denyOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/**
 * A `PreToolUse` whose input could not be read (round-5 #3): too large, cut
 * off, or not JSON. It names no session and no tool, so it is bound to the
 * sessions of the harness process above this hook — every live one of this
 * harness when that cannot be told — and treated as a tool that runs: a
 * conservative marker for each, then the same wait on a save's interlock as
 * any `PreToolUse`, and a deny if a save still holds it. The marker is
 * cleared by the next readable `Stop` that shows nothing running — not by a
 * `PostToolUse`, which cannot be matched to it and could be a parallel
 * tool's.
 */
function unreadablePreTool(io: AgentIo, harness: Harness): string {
  const live = listStates(io.home).filter((s) => s.harness === harness && s.status === 'live');
  if (live.length === 0) return '';
  const proc = findHarness(harness, process.ppid, io.env);
  const mine =
    proc === undefined
      ? []
      : live.filter((s) => s.harness_pid === proc.pid && s.harness_started === proc.started);
  const sessions = mine.length > 0 ? mine : live;
  const key = `unread:${String(process.pid)}:${String(Date.now())}`;
  for (const s of sessions) {
    markInflight(io.home, harness, s.harness_session_id, key, {
      pid: s.harness_pid,
      started: s.harness_started,
    });
  }
  for (const s of sessions) {
    const verdict = awaitSave(io.home, harness, s.harness_session_id, (ms) => {
      Atomics.wait(PAUSE, 0, 0, ms);
    });
    if (verdict === 'deny') {
      for (const t of sessions) clearInflight(io.home, harness, t.harness_session_id, key);
      log(io.home, `checkpoint hook pre-tool ${harness}: unreadable input during a save; denied`);
      return denyOutput(
        'Laika is finishing a checkpoint of this worktree. Run the same tool again in a few seconds.',
      );
    }
  }
  log(io.home, `checkpoint hook pre-tool ${harness}: unreadable input; marked as running`);
  return '';
}

function noteActivity(
  io: AgentIo,
  event: HookEvent,
  harness: Harness,
  harnessSessionId: string,
  input: Readonly<Record<string, unknown>>,
  credential: AgentCredential,
): string {
  const now = Date.now();
  if (event === 'pre-tool') {
    // The tool runs in the harness process the session is bound to; without
    // a session there is nothing to bind it to, and no automatic save either.
    const session = readState(statePath(io.home, harness, harnessSessionId));
    if (session === undefined) return '';
    const key = toolKey(input);
    markInflight(
      io.home,
      harness,
      harnessSessionId,
      key,
      { pid: session.harness_pid, started: session.harness_started },
      subagentOf(input),
    );
    // Marked first, then wait while an automatic save holds the interlock:
    // the save sees this marker and stops before it commits, or commits and
    // lets go. A save still holding it past its deadline is not raced: the
    // tool is denied, and its marker goes with it, since it will not run.
    const verdict = awaitSave(io.home, harness, harnessSessionId, (ms) => {
      Atomics.wait(PAUSE, 0, 0, ms);
    });
    if (verdict === 'clear') return '';
    clearInflight(io.home, harness, harnessSessionId, key);
    log(io.home, `checkpoint hook pre-tool ${harness}: a save overran its deadline; tool denied`);
    return denyOutput(
      'Laika is finishing a checkpoint of this worktree. Run the same tool again in a few seconds.',
    );
  }
  if (event === 'stop') {
    const running = backgroundTasks(input);
    const session = readState(statePath(io.home, harness, harnessSessionId));
    if (running !== undefined && session !== undefined) {
      reconcileAtStop(
        io.home,
        harness,
        harnessSessionId,
        { pid: session.harness_pid, started: session.harness_started },
        running,
      );
    }
  }
  const activity = readActivity(io.home, harness, harnessSessionId);
  if (typeof input.cwd === 'string' && input.cwd.startsWith('/') && input.cwd.length < 4096) {
    activity.cwd = input.cwd;
  }
  if (event === 'tool' || event === 'tool-failed') {
    clearInflight(io.home, harness, harnessSessionId, toolKey(input));
    if (typeof input.tool_name === 'string' && MUTATING_TOOLS.has(input.tool_name)) {
      activity.mutations += 1;
      activity.first_mutation_at ??= now;
    }
  }
  const trigger = shouldTrigger(activity, now, event === 'stop');
  if (trigger) activity.last_attempt_at = now;
  writeActivity(io.home, harness, harnessSessionId, activity);
  if (trigger) {
    const pid = spawnChild(io, '_checkpoint', harness, harnessSessionId, credential);
    log(io.home, `auto checkpoint ${harness}: started pid=${String(pid ?? 0)} at ${event}`);
  }
  return '';
}

async function open(
  io: AgentIo,
  harness: Harness,
  harnessSessionId: string,
  credential: AgentCredential,
  pid?: number,
  self?: SelfReport,
): Promise<{ state?: SessionState; why?: string }> {
  const named = pid === undefined ? undefined : readProc(pid);
  const proc =
    pid === undefined
      ? findHarness(harness, process.ppid, io.env)
      : named === UNKNOWN
        ? undefined
        : named;
  if (proc === undefined) {
    log(io.home, `start ${harness}: no ${harness} process found above this hook — not opened`);
    return { why: `no running ${NAMES[harness]} process was found to bind the session to` };
  }
  const outcome = await startSession(deps(io), {
    harness,
    harnessSessionId,
    harnessProc: proc,
    credential,
    clientVersion: `laika-agent/${harness}`,
    ...(self === undefined ? {} : { self }),
  });
  if (outcome.kind === 'busy') return { why: 'another start for this session is in progress' };
  if (outcome.kind === 'failed') return { state: outcome.state, why: outcome.why };
  ensureWatcher(io, outcome.state, credential);
  return { state: outcome.state };
}

/**
 * What an installed hook runs. **Never fails the harness and never prints
 * anything but the documented JSON**: every path exits 0, and errors go to
 * the helper's log, which `laika agent session status` points at.
 */
export async function hook(io: AgentIo, event: HookEvent, harness: Harness): Promise<string> {
  const raw = io.readHookInput === undefined ? io.stdin() : await io.readHookInput();
  const input = raw === undefined ? undefined : hookInput(raw);
  const harnessSessionId = input === undefined ? undefined : hookSessionId(input);
  if (input === undefined || harnessSessionId === undefined) {
    // An input that cannot be read cannot say which tool runs — or that it
    // will not touch the worktree — so a PreToolUse is held to the safe side.
    return event === 'pre-tool' ? unreadablePreTool(io, harness) : '';
  }
  const credential = readCredential(io.home, harness, io.env);
  if (credential === undefined) return '';
  const path = statePath(io.home, harness, harnessSessionId);

  if (event === 'session-end') {
    const state = readState(path);
    if (state?.status === 'live') spawnChild(io, '_end', harness, harnessSessionId, credential);
    return '';
  }

  if (event === 'pre-tool' || event === 'tool' || event === 'tool-failed' || event === 'stop') {
    let out = '';
    try {
      out = noteActivity(io, event, harness, harnessSessionId, input, credential);
    } catch (cause) {
      log(io.home, `checkpoint hook ${event}: ${cause instanceof Error ? cause.name : 'error'}`);
    }
    // `Stop` prints nothing, and `PreToolUse` prints only the deny above:
    // never an `allow`, which would skip the person's own permission rules.
    if (event !== 'tool') return out;
  }

  let state = readState(path);
  const notes: string[] = [];
  // Read at every hook, so a model switched mid-session reaches the next
  // heartbeat (LAI-588). A file read, bounded; no network.
  const self = readSelfReport(harness, input);
  if (event === 'session-start' || state === undefined || state.status === 'starting') {
    const opened = await open(io, harness, harnessSessionId, credential, undefined, self);
    if (opened.state?.status === 'live') {
      state = opened.state;
      const context = sessionContext(state);
      if (context !== '') notes.push(context);
    }
  } else if (state.status === 'live') {
    ensureWatcher(io, state, credential);
  }
  // A start that found its session already open (resume, compact) sent
  // nothing: what this hook read reaches the board on the next beat instead.
  noteSelfReport(io.home, path, self);

  state = readState(path);
  if (
    state !== undefined &&
    event !== 'session-start' &&
    (state.pending_lost !== undefined || state.notice !== undefined)
  ) {
    // Re-checked here, not trusted from the file: what reaches the model is
    // only what passes `asLost` now, rendered by `lostNotice`.
    const lost = (state.pending_lost ?? [])
      .slice(0, 50)
      .map(asLost)
      .filter((c): c is LostClaim => c !== undefined);
    if (lost.length > 0) notes.push(lostNotice(lost));
    delete state.pending_lost;
    delete state.notice;
    writeState(io.home, state);
  }
  return notes.length === 0 ? '' : contextOutput(event, notes.join('\n\n'));
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function target(
  io: AgentIo,
  argv: readonly string[],
): { harness: Harness; id: string; credential: AgentCredential } | string {
  const harness = option(argv, '--harness');
  const id = option(argv, '--harness-session');
  if (!isHarness(harness)) return `--harness must be one of ${HARNESSES.join(', ')}`;
  if (id === undefined || id === '') return '--harness-session <id> is required';
  const credential = readCredential(io.home, harness, io.env);
  if (credential === undefined) {
    return `no agent token for ${harness}: run \`laika agent login ${harness}\` first`;
  }
  return { harness, id, credential };
}

function printState(io: AgentIo, s: SessionState): void {
  const age = s.last_beat_at === undefined ? 'never' : new Date(s.last_beat_at).toISOString();
  io.out(
    `${s.harness} ${s.harness_session_id}: ${s.status}` +
      `${s.session_id === undefined ? '' : ` — session ${s.session_id}`}`,
  );
  io.out(
    `  harness pid ${String(s.harness_pid)}, ${String(s.beats)} heartbeats, last ${age}` +
      `${s.end_reason === undefined ? '' : `, end_reason ${s.end_reason}`}` +
      `${s.last_error === undefined ? '' : `, last error: ${s.last_error}`}`,
  );
}

async function session(io: AgentIo, argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  if (sub === 'status') {
    const states = listStates(io.home);
    if (states.length === 0) {
      io.out('No agent sessions on this machine.');
      return 0;
    }
    for (const s of states.slice(0, 20)) printState(io, s);
    io.out(`Log: ${join(io.home, '.laika', 'agent-sessions', 'helper.log')}`);
    return 0;
  }

  const t = target(io, argv);
  if (typeof t === 'string') {
    io.err(`laika agent session: ${t}`);
    return 1;
  }
  const path = statePath(io.home, t.harness, t.id);

  if (sub === 'start') {
    const pidRaw = option(argv, '--pid');
    if (pidRaw !== undefined && !/^\d+$/.test(pidRaw)) {
      io.err('laika agent session: --pid must be a process id');
      return 1;
    }
    const opened = await open(
      io,
      t.harness,
      t.id,
      t.credential,
      pidRaw === undefined ? undefined : Number(pidRaw),
    );
    if (opened.state?.status !== 'live') {
      io.err(`laika agent session: not started — ${opened.why ?? 'unknown'}`);
      return 1;
    }
    printState(io, opened.state);
    return 0;
  }

  if (sub === 'heartbeat') {
    const outcome = await beatOnce(deps(io), path, t.credential);
    if (outcome === 'renewed') {
      io.out('renewed');
      return 0;
    }
    if (outcome === 'harness_gone') {
      io.err('not renewed: the harness process that held this session is gone');
      return 3;
    }
    io.err(`not renewed: ${outcome}`);
    return 1;
  }

  if (sub === 'end') {
    const outcome = await endSession(deps(io), path, t.credential);
    const state = readState(path);
    if (outcome === 'ended') {
      io.out(`ended — end_reason ${state?.end_reason ?? 'ended'}`);
      return 0;
    }
    io.err(outcome === 'idle' ? 'no open session to end' : `not ended: ${state?.last_error ?? ''}`);
    return 1;
  }

  io.err(`laika agent session: unknown subcommand "${sub ?? ''}"\n\n${USAGE}`);
  return 1;
}

/** `_watch` and `_end`: the background children. The credential arrives on stdin. */
async function child(
  io: AgentIo,
  mode: '_watch' | '_end' | '_checkpoint',
  argv: readonly string[],
): Promise<number> {
  const [harness, id] = argv;
  if (!isHarness(harness) || id === undefined) return 1;
  let credential: AgentCredential;
  try {
    const parsed = JSON.parse(io.stdin()) as Partial<AgentCredential>;
    if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string') return 1;
    credential = { url: parsed.url, token: parsed.token };
  } catch {
    return 1;
  }
  const path = statePath(io.home, harness, id);
  const d = deps(io);

  if (mode === '_checkpoint' || mode === '_end') {
    // The session's claims end with it, and a save needs the live claim: so
    // the last automatic save runs first, then the end (LAI-547).
    const { checkpointDeps } = await import('./agent-checkpoint-cli.ts');
    const outcome = await autoCheckpoint(
      checkpointDeps(io),
      harness,
      id,
      credential,
      mode === '_end' ? 10_000 : 30_000,
    );
    log(io.home, `auto checkpoint ${harness}: ${outcome} (${mode})`);
    if (mode === '_checkpoint') return 0;
  }

  if (mode === '_end') {
    await endSession(d, path, credential);
    return 0;
  }

  const found = readProc(process.pid);
  const self = found === UNKNOWN ? undefined : found;
  const state = readState(path);
  if (self === undefined || state?.status !== 'live') return 0;
  // Take the slot; an older watcher sees it is no longer named and stops.
  state.watcher_pid = self.pid;
  state.watcher_started = self.started;
  writeState(io.home, state);
  process.on('SIGTERM', () => process.exit(0));
  const outcome = await runWatcher(d, path, credential, self, heartbeatIntervalMs(io.env));
  log(io.home, `watcher ${state.session_id ?? ''} stopped: ${outcome}`);
  return 0;
}

export async function agent(argv: readonly string[], io: AgentIo = CONSOLE): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === '--help' || command === '-h') {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }

  if (command === 'hook') {
    const event = argv[1];
    const harness = argv[2];
    if (event === undefined || !(event in HOOK_EVENTS) || !isHarness(harness)) return 0;
    try {
      const out = await hook(io, event as HookEvent, harness);
      if (out !== '') io.out(out);
    } catch (cause) {
      log(
        io.home,
        `hook ${event} ${harness} error: ${cause instanceof Error ? cause.name : 'error'}`,
      );
    }
    return 0;
  }

  if (command === '_watch' || command === '_end' || command === '_checkpoint') {
    return child(io, command, argv.slice(1));
  }
  if (command === 'session') return session(io, argv.slice(1));
  if (command === 'checkpoint' || command === 'checkpoints') {
    const { checkpointCommand } = await import('./agent-checkpoint-cli.ts');
    return checkpointCommand(io, command, argv.slice(1));
  }

  if (command === 'login' || command === 'logout' || command === 'hooks') {
    const { setup } = await import('./agent-setup.ts');
    return setup(io, argv);
  }

  io.err(`laika agent: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}
