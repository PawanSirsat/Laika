import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  readonly isTTY: boolean;
}

const CONSOLE: AgentIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  stdin: () => {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  },
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
  '  laika agent handoff inbox|show|prepare|accept|decline   receive a hand-off (laika agent handoff --help)',
  '  laika agent inbox | accept <offer>                      the same as the handoff forms',
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

export function childEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const name of CHILD_ENV) {
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
  mode: '_watch' | '_end',
  harness: Harness,
  harnessSessionId: string,
  credential: AgentCredential,
): number | undefined {
  const child = spawn(process.execPath, [MAIN, mode, harness, harnessSessionId], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: childEnv(io.env),
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
  tool: 'PostToolUse',
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
    input = JSON.parse(raw.slice(0, 64 * 1024));
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
  const input = hookInput(io.stdin());
  const harnessSessionId = input === undefined ? undefined : hookSessionId(input);
  if (input === undefined || harnessSessionId === undefined) return '';
  const credential = readCredential(io.home, harness, io.env);
  if (credential === undefined) return '';
  const path = statePath(io.home, harness, harnessSessionId);

  if (event === 'session-end') {
    const state = readState(path);
    if (state?.status === 'live') spawnChild(io, '_end', harness, harnessSessionId, credential);
    return '';
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
  mode: '_watch' | '_end',
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

  if (command === '_watch' || command === '_end') return child(io, command, argv.slice(1));
  if (command === 'session') return session(io, argv.slice(1));

  if (command === 'handoff' || command === 'inbox' || command === 'accept') {
    const { handoff } = await import('./agent-handoff.ts');
    const rest = command === 'handoff' ? argv.slice(1) : argv;
    return handoff(
      {
        out: io.out,
        err: io.err,
        home: io.home,
        env: io.env,
        cwd: process.cwd(),
        fetch: (input, init) => fetch(input, init),
        now: () => Date.now(),
      },
      rest,
    );
  }

  if (command === 'login' || command === 'logout' || command === 'hooks') {
    const { setup } = await import('./agent-setup.ts');
    return setup(io, argv);
  }

  io.err(`laika agent: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}
