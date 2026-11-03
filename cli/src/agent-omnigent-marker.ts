import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { Harness } from './agent-adapters.ts';
import {
  type Exec,
  PS_ENV,
  PS_TIMEOUT_MS,
  type ProcReader,
  readProc,
  UNKNOWN,
} from './agent-session.ts';

/**
 * Is the harness this hook runs under one that Omnigent started? (LAI-1101; a
 * port of LAI-589's `~/.laika/agents/omnigent-marker`.)
 *
 * The marker is `OMNIGENT=1`: Omnigent 0.19 stamps it on its runner
 * (`runner/identity.py`, `OMNIGENT_SESSION_ENV_VAR`), and every worker,
 * terminal and SDK harness the runner starts inherits it.
 *
 * - **Our own `OMNIGENT=1` decides first.** A hook's environment is its
 *   harness's: Claude Code passes its whole environment to its hooks (and to
 *   `headersHelper`, which therefore makes the same choice from the same
 *   variable). For Claude Code that is the whole rule — no process table.
 * - **Codex** runs its `http_headers_helper` with an allowlisted environment
 *   that drops `OMNIGENT` (measured on 0.162.1), so for Codex the variable is
 *   read from the **nearest** harness process above us — `codex…`, or
 *   `claude` — and from nothing above it; the Codex helper reads the same
 *   process the same way (`mcp-headers.ts`).
 *
 * What it cannot tell apart: a harness started by hand in a terminal Omnigent
 * opened inherits `OMNIGENT=1` too, and counts as an Omnigent run — as it did
 * under LAI-589's marker. "Nearest" matters only for a harness started with
 * the variable removed inside an Omnigent run, which is then plain.
 *
 * `unknown`: no harness found, `ps` failed, or its environment could not be
 * read. Callers fail closed on it; nothing here guesses.
 */
export type OmnigentVerdict = 'omnigent' | 'plain' | 'unknown';

/** The harness executables whose environment decides. */
export const MARKER_HARNESS = /^(?:claude(?:\.exe)?|codex.*)$/;

/** A process's environment as `NAME=value` entries, or `undefined` when it cannot be read. */
export type EnvironReader = (pid: number) => readonly string[] | undefined;

/**
 * Linux keeps it in `/proc/<pid>/environ`, NUL-separated: exact. macOS has no
 * `/proc`; `ps -E` prints the process's command line, a space, then its
 * environment (measured), so the command line — `ps -o command=`, the same
 * text without the environment — is cut off first, and a word in the
 * process's **arguments** is never read as an entry. The rest is split on
 * spaces, as `ps -E` joins it, so an environment *value* that itself
 * contains ` OMNIGENT=1` cannot be told from the entry on macOS. `ps -E`
 * shows nothing for a platform binary (`/bin/sh`): that is `undefined`.
 */
export function environReader(exec: Exec = execFileSync): EnvironReader {
  const ps = (args: readonly string[]): string =>
    exec('ps', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...PS_ENV },
      timeout: PS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).replace(/\n+$/, '');
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 1) return undefined;
    try {
      return readFileSync(`/proc/${String(pid)}/environ`, 'utf8').split('\0');
    } catch {
      // Not Linux, or not readable: ask ps.
    }
    try {
      const command = ps(['-ww', '-o', 'command=', '-p', String(pid)]);
      const whole = ps(['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
      if (command === '' || !whole.startsWith(`${command} `)) return undefined;
      const entries = whole.slice(command.length + 1).split(' ');
      return entries.length === 0 || entries[0] === '' ? undefined : entries;
    } catch {
      return undefined;
    }
  };
}

export const readEnviron: EnvironReader = environReader();

/**
 * The environment of the **nearest** harness process above `from` — or of the
 * one `LAIKA_AGENT_HARNESS_PID` names outright — as {@link EnvironReader}
 * reads it; `undefined` when no harness is found, `ps` fails, or its
 * environment cannot be read.
 */
export function harnessEnviron(
  env: Readonly<Record<string, string | undefined>>,
  from: number,
  proc: ProcReader = readProc,
  environ: EnvironReader = readEnviron,
): readonly string[] | undefined {
  // A harness launched under another name is named outright (findHarness's rule).
  const named = env.LAIKA_AGENT_HARNESS_PID;
  const outright = named !== undefined && /^\d+$/.test(named);
  let pid = outright ? Number(named) : from;
  for (let depth = 0; depth < 16 && pid > 1; depth += 1) {
    const info = proc(pid);
    if (info === undefined || info === UNKNOWN) return undefined;
    if (outright || MARKER_HARNESS.test(info.comm)) return environ(pid);
    pid = info.ppid;
  }
  return undefined;
}

export function omnigentMarker(
  env: Readonly<Record<string, string | undefined>>,
  from: number,
  harness: Harness,
  proc: ProcReader = readProc,
  environ: EnvironReader = readEnviron,
): OmnigentVerdict {
  if (env.OMNIGENT === '1') return 'omnigent';
  if (harness === 'claude-code') return 'plain';
  const entries = harnessEnviron(env, from, proc, environ);
  if (entries === undefined) return 'unknown';
  return entries.includes('OMNIGENT=1') ? 'omnigent' : 'plain';
}

/**
 * The environment a hook reads its harness's **own config** under (LAI-1108,
 * from PR #252's review). For Codex, `CODEX_HOME` is taken from the `codex`
 * process — the one {@link omnigentMarker} reads `OMNIGENT` from — whatever
 * the hook's own environment says: Omnigent gives each Codex worker a private
 * copy of its config there, and that copy is what the worker's MCP reads, so
 * the hook must read the same one to decide as its MCP does. `codex` without
 * `CODEX_HOME` reads `~/.codex`, and so does the hook then. When `codex`'s
 * environment cannot be read, the hook's own is used; the marker, reading the
 * same process, then says `unknown` unless the hook's own environment holds
 * `OMNIGENT=1`.
 *
 * On macOS the entries come from `ps -E`, split on spaces, so a `CODEX_HOME`
 * with a space in it is cut short there: its `config.toml` is then not found,
 * and the hook keeps the harness's own agent. Every other harness: `env`.
 */
export function harnessConfigEnv(
  env: Readonly<Record<string, string | undefined>>,
  from: number,
  harness: Harness,
  proc: ProcReader = readProc,
  environ: EnvironReader = readEnviron,
): Readonly<Record<string, string | undefined>> {
  if (harness !== 'codex') return env;
  const entries = harnessEnviron(env, from, proc, environ);
  if (entries === undefined) return env;
  const own = entries.find((entry) => entry.startsWith('CODEX_HOME='));
  const next: Record<string, string | undefined> = { ...env };
  delete next.CODEX_HOME;
  if (own !== undefined) next.CODEX_HOME = own.slice('CODEX_HOME='.length);
  return next;
}
