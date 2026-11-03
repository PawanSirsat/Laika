import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
 * The marker is `OMNIGENT=1`, the one `plugin/scripts/laika-activity-hook`
 * reads (D-080): Omnigent sets it on polly and on every worker it starts; a
 * session started by hand never has it.
 *
 * **Our own environment is not enough.** Codex runs its helpers with an
 * allowlisted environment (`HOME LANG LC_ALL LOGNAME PATH PWD SHELL SHLVL TERM
 * TMPDIR USER`, measured on 0.162.1), so `OMNIGENT` never reaches them even
 * when the codex process has it. So it is read from the **nearest** harness
 * ancestor (`claude`, `claude.exe`, `codex…`) and from nothing above it:
 * everything above a harness started inside Omnigent's own terminal carries
 * `OMNIGENT=1` too, plain or not, so "any ancestor" would call every such run
 * Omnigent's.
 *
 * `omnigent`, `plain`, or `unknown` when no harness is found or the process
 * table cannot be read. Callers decide what unknown means; nothing here
 * guesses.
 */
export type OmnigentVerdict = 'omnigent' | 'plain' | 'unknown';

/** The harness executables whose environment decides. */
export const MARKER_HARNESS = /^(?:claude(?:\.exe)?|codex.*)$/;

/** A process's environment as `NAME=value` words, or `undefined` when it cannot be read. */
export type EnvironReader = (pid: number) => readonly string[] | undefined;

/**
 * Linux keeps it in `/proc/<pid>/environ`; macOS has no `/proc`, and `ps -E`
 * prints the environment after the command (for the caller's own processes
 * only). Either way only `OMNIGENT=1` as a whole word is looked for.
 */
export function environReader(exec: Exec = execFileSync): EnvironReader {
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 1) return undefined;
    try {
      return readFileSync(`/proc/${String(pid)}/environ`, 'utf8').split('\0');
    } catch {
      // Not Linux, or not readable: ask ps.
    }
    try {
      const out = exec('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...PS_ENV },
        timeout: PS_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      return out.trim() === '' ? undefined : out.split(/\s+/);
    } catch {
      return undefined;
    }
  };
}

export const readEnviron: EnvironReader = environReader();

export function omnigentMarker(
  env: Readonly<Record<string, string | undefined>>,
  from: number,
  proc: ProcReader = readProc,
  environ: EnvironReader = readEnviron,
): OmnigentVerdict {
  if (env.OMNIGENT === '1') return 'omnigent';
  // A harness launched under another name is named outright (findHarness's rule).
  const named = env.LAIKA_AGENT_HARNESS_PID;
  let pid = named !== undefined && /^\d+$/.test(named) ? Number(named) : from;
  const outright = named !== undefined && /^\d+$/.test(named);
  for (let depth = 0; depth < 16 && pid > 1; depth += 1) {
    const info = proc(pid);
    if (info === undefined || info === UNKNOWN) return 'unknown';
    if (outright || MARKER_HARNESS.test(info.comm)) {
      const words = environ(pid);
      if (words === undefined) return 'unknown';
      return words.includes('OMNIGENT=1') ? 'omnigent' : 'plain';
    }
    pid = info.ppid;
  }
  return 'unknown';
}
