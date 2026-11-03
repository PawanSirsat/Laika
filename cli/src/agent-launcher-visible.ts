import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { type Harness, isLaikaId } from './agent-session.ts';
import { shellQuote } from './agents.ts';

/**
 * What the owner sees of an unattended launcher run on the laptop itself
 * (LAI-1113, D-128): a notification when a run starts and when it ends, and
 * — opt-in, macOS — a Terminal window running the read-only viewer
 * `laika agent launcher watch --run <id>`.
 *
 * **Nothing written by another person or agent reaches either.** A
 * notification is fixed words, a task key that matches {@link NOTIFY_KEY}, a
 * harness's own display name and numbers; the Terminal command is the
 * config's absolute `laika` path, single-quoted, and a run id that is a ULID.
 * No card text, no device label, no note. Both are started with an argv
 * array, never a shell, and both scripts take their values as `on run argv`
 * arguments, so no value is ever spliced into AppleScript source.
 *
 * Both are fire and forget: a notification or a window that cannot be shown
 * changes nothing about the run, which stays the launcher's child.
 */

/**
 * The folder a Claude Code session started in `worktree` writes its transcript
 * to: `~/.claude/projects/` and the worktree's path with every character that
 * is not a letter or a digit as `-`. Measured on Belka, 2026-11-03, over every
 * folder there: `/…/Laika-LAIKA-968-auto-sy6csr` is
 * `-Users-…-Laika-LAIKA-968-auto-sy6csr`, `/…/Laika/.polly/wt-1001` is
 * `-Users-…-Laika--polly-wt-1001`. A launched run reads `~/.claude`, never a
 * `CLAUDE_CONFIG_DIR` (its environment has none).
 */
export function claudeProjectDir(home: string, worktree: string): string {
  return join(home, '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'));
}

/** A task key a notification may show: `LAIKA-970`, and nothing that is not one. */
export const NOTIFY_KEY = /^[A-Z][A-Z0-9]*-[0-9]+$/;

/** The harness names a notification shows: the known list, as people write them. */
export const HARNESS_LABELS: Readonly<Record<Harness, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  'copilot-cli': 'Copilot CLI',
  'copilot-vscode': 'Copilot in VS Code',
  'copilot-cloud': 'Copilot cloud agent',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'Antigravity',
  omnigent: 'Omnigent',
};

const harnessLabel = (harness: string): string | undefined =>
  Object.hasOwn(HARNESS_LABELS, harness) ? HARNESS_LABELS[harness as Harness] : undefined;

/** How a run ended, in the words a notification uses. */
export type RunEnding = 'finished' | 'timed out' | 'was stopped';

/** The words for an `exit` line's `reason`: `exited`, `timeout`, or any stop. */
export const runEnding = (reason: string | undefined): RunEnding =>
  reason === 'timeout' ? 'timed out' : reason === 'exited' ? 'finished' : 'was stopped';

export type RunMoment =
  | { readonly kind: 'start'; readonly taskKey: string; readonly harness: string }
  | {
      readonly kind: 'exit';
      readonly taskKey: string;
      readonly harness: string;
      readonly ending: RunEnding;
      readonly code: number | null;
      readonly signal: string | null;
      readonly runtimeMs: number;
    };

export interface Notice {
  readonly title: string;
  readonly body: string;
}

const ENDINGS: ReadonlySet<string> = new Set(['finished', 'timed out', 'was stopped']);

/** `18 s`, `3 min 5 s`, `2 h 0 min`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${String(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)} min ${String(s % 60)} s`;
  return `${String(Math.floor(m / 60))} h ${String(m % 60)} min`;
}

/**
 * The notification for a start or an exit, or `undefined` when a value is not
 * one the launcher made: a harness off the known list, a number that is not
 * one. **A task key that is not a key is left out**, never escaped: the run is
 * then "a run".
 */
export function notice(moment: RunMoment): Notice | undefined {
  const name = harnessLabel(moment.harness);
  if (name === undefined) return undefined;
  const key = NOTIFY_KEY.test(moment.taskKey) && moment.taskKey.length <= 24 ? moment.taskKey : '';
  if (moment.kind === 'start') {
    return { title: 'Laika', body: `started ${key === '' ? 'a run' : key} (${name})` };
  }
  if (!ENDINGS.has(moment.ending)) return undefined;
  if (!Number.isFinite(moment.runtimeMs) || moment.runtimeMs < 0) return undefined;
  const how =
    moment.code !== null
      ? Number.isInteger(moment.code) && moment.code >= -255 && moment.code <= 255
        ? `exit ${String(moment.code)}`
        : undefined
      : moment.signal !== null
        ? /^SIG[A-Z0-9]{1,10}$/.test(moment.signal)
          ? `signal ${moment.signal}`
          : undefined
        : 'no exit code';
  if (how === undefined) return undefined;
  return {
    title: 'Laika',
    body: `${key === '' ? 'a run' : key} (${name}) ${moment.ending} → ${how}, ${duration(moment.runtimeMs)}`,
  };
}

export const OSASCRIPT = '/usr/bin/osascript';

/** The values arrive as `argv`: AppleScript never parses them as source. */
export const NOTIFY_SCRIPT: readonly string[] = [
  'on run argv',
  'display notification (item 2 of argv) with title (item 1 of argv)',
  'end run',
];

export const TERMINAL_SCRIPT: readonly string[] = [
  'on run argv',
  'tell application "Terminal" to do script (item 1 of argv)',
  'end run',
];

export interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

/** osascript's argv for `script` with `values` as its `on run argv` arguments. */
export const scriptArgs = (script: readonly string[], values: readonly string[]): string[] => [
  ...script.flatMap((line) => ['-e', line]),
  // osascript reads `--` as the end of its options, so a value is never one.
  '--',
  ...values,
];

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * The command that shows `n`: osascript on macOS, `notify-send` on Linux when
 * there is one (`notifySend`, an absolute path), else `undefined` — no
 * notification, silently. A title or body with a control character is refused
 * here too, whoever built it.
 */
export function notifyCommand(
  platform: NodeJS.Platform,
  n: Notice,
  notifySend: string | undefined,
): Command | undefined {
  if (UNSAFE.test(n.title) || UNSAFE.test(n.body)) return undefined;
  if (platform === 'darwin')
    return { file: OSASCRIPT, args: scriptArgs(NOTIFY_SCRIPT, [n.title, n.body]) };
  if (platform === 'linux' && notifySend !== undefined && isAbsolute(notifySend)) {
    // Neither value starts with `-`: the title is fixed, the body a word or a key.
    return { file: notifySend, args: ['--app-name=Laika', n.title, n.body] };
  }
  return undefined;
}

/** An executable file named `name` in one of `path`'s absolute folders, or `undefined`. */
export function onPath(name: string, path: string | undefined): string | undefined {
  for (const dir of (path ?? '').split(':')) {
    if (!isAbsolute(dir)) continue;
    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/** Why `laika` is not a path the Terminal command may name, or `undefined`. */
export function laikaPathProblem(laika: unknown): string | undefined {
  if (typeof laika !== 'string' || !isAbsolute(laika)) {
    return 'laika must be the absolute path of the laika command';
  }
  if (laika.length > 1000) return 'laika is at most 1000 characters';
  if (UNSAFE.test(laika)) return 'laika holds a control character';
  // fish reads `\\` and `\'` inside single quotes as escapes, so the quoting would not hold there.
  if (laika.includes('\\')) return 'laika holds a backslash, which not every shell quotes the same';
  return undefined;
}

/**
 * The line the Terminal window runs: `'<laika>' agent launcher watch --run <id>`.
 * The path is single-quoted — inside single quotes no shell expands anything —
 * and the id is a ULID, which needs no quoting. Anything else is `undefined`.
 */
export function viewerLine(laika: string, runId: string): string | undefined {
  if (laikaPathProblem(laika) !== undefined || !isLaikaId(runId)) return undefined;
  return `${shellQuote(laika)} agent launcher watch --run ${runId}`;
}

export function terminalCommand(laika: string, runId: string): Command | undefined {
  const line = viewerLine(laika, runId);
  return line === undefined
    ? undefined
    : { file: OSASCRIPT, args: scriptArgs(TERMINAL_SCRIPT, [line]) };
}

/** Runs a command and calls back with why it failed, in words this module chose, or `undefined`. */
export type CommandRunner = (command: Command, done: (failed: string | undefined) => void) => void;

/**
 * Why osascript failed, as a fixed phrase: its AppleScript error number when it
 * printed one — `-1743` is "not allowed to control Terminal" — or its exit code.
 * Nothing else of its output is repeated.
 */
export function failure(cause: unknown, stderr: string): string {
  const number = /\((-\d{3,5})\)/.exec(stderr)?.[1];
  if (number === '-1743') {
    return 'AppleScript error -1743: this Mac has not allowed the launcher to control Terminal (System Settings → Privacy & Security → Automation)';
  }
  if (number !== undefined) return `AppleScript error ${number}`;
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === 'number') return `exit ${String(code)}`;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code)) return code;
  return 'it could not be run';
}

/**
 * The environment osascript and notify-send run with: `PATH`, `HOME` and
 * `LANG`, and the two a Linux desktop's notification needs to reach its
 * session bus, `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` (review).
 * Nothing else of the launcher's — no token, no ssh agent.
 */
export function commandEnv(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<string, string> {
  const out: Record<string, string> = {
    PATH: env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    LANG: env.LANG ?? 'C',
  };
  for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'] as const) {
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

export function realRunner(env: Readonly<Record<string, string>>): CommandRunner {
  return (command, done) => {
    try {
      execFile(
        command.file,
        [...command.args],
        { timeout: 15_000, env: { ...env } },
        (cause, _stdout, stderr) => {
          done(cause === null ? undefined : failure(cause, String(stderr)));
        },
      );
    } catch (cause) {
      done(failure(cause, ''));
    }
  };
}

/** Show `n`, if this platform can; a failure is not reported (a notification is a courtesy). */
export function showNotice(
  run: CommandRunner,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  n: Notice,
): void {
  const command = notifyCommand(
    platform,
    n,
    platform === 'linux' ? onPath('notify-send', env.PATH) : undefined,
  );
  if (command !== undefined) run(command, () => undefined);
}

/**
 * Open a Terminal window on the viewer for `runId`. **It is a viewer only**: the
 * run is the launcher's child in its own process group, so closing the window
 * — which ends `watch` — never reaches it. When the window cannot be opened (no
 * GUI session, Automation not allowed, not macOS) `log` gets one line and the
 * run goes on.
 */
export function openViewer(
  run: CommandRunner,
  platform: NodeJS.Platform,
  laika: string,
  runId: string,
  log: (line: string) => void,
): void {
  const say = (why: string): void =>
    log(
      `laika agent launcher: no Terminal viewer for run ${isLaikaId(runId) ? runId : '(not an id)'} (${why}); the run goes on`,
    );
  if (platform !== 'darwin') {
    say('a Terminal viewer opens only on macOS');
    return;
  }
  const command = terminalCommand(laika, runId);
  if (command === undefined) {
    say('its command could not be built from the config');
    return;
  }
  run(command, (failed) => {
    if (failed !== undefined) say(failed);
  });
}
