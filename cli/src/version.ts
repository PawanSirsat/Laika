import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTOCOL } from './protocol.ts';

/**
 * `laika version` / `laika --version` (LAI-1043, the LAI-1042 plan §F.1).
 *
 * Everything comes from this machine: the package version, the checkout's
 * commit and whether `cli/` or `plugin/` have local changes, the protocol, and
 * node. **No network**, so it answers on a plane, and before a board exists.
 *
 * The checkout is the distribution (`bin/laika`), so its commit is the
 * version that matters: `0.1.0` has never been bumped, and two machines on the
 * same `0.1.0` can be months apart.
 */

/** `cli/`, one level up from this file in `src/` and in `dist/` alike. */
export const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));

export interface VersionInfo {
  readonly version: string;
  /** The checkout's `HEAD`, or `null` when this is not a git checkout. */
  readonly commit: string | null;
  /** Local changes under `cli/` or `plugin/`; `null` when unknown. */
  readonly dirty: boolean | null;
  readonly protocol: number;
  readonly node: string;
  /** The checkout's top directory, or `null` when this is not a git checkout. */
  readonly checkout: string | null;
  /** Running TypeScript straight from `src/`, which needs node ≥ 22.18. */
  readonly fromSource: boolean;
}

/** Runs git; throws when git fails. Injectable so a test can say "not a checkout". */
export type GitRunner = (args: readonly string[]) => string;

export interface VersionDeps {
  readonly cliDir?: string;
  readonly git?: GitRunner;
}

const realGit: GitRunner = (args) =>
  execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function packageVersion(cliDir: string): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'version' in raw) {
      const { version } = raw;
      if (typeof version === 'string' && version !== '') return version;
    }
  } catch {
    // Reported as unknown below rather than thrown: `version` must always answer.
  }
  return 'unknown';
}

export function versionInfo(deps: VersionDeps = {}): VersionInfo {
  const cliDir = deps.cliDir ?? CLI_DIR;
  const git = deps.git ?? realGit;

  let checkout: string | null = null;
  let commit: string | null = null;
  let dirty: boolean | null = null;
  try {
    checkout = git(['-C', cliDir, 'rev-parse', '--show-toplevel']);
    commit = git(['-C', checkout, 'rev-parse', 'HEAD']);
    dirty = git(['-C', checkout, 'status', '--porcelain', '--', 'cli', 'plugin']) !== '';
  } catch {
    // Not a checkout, or no git: each field stays as far as it got.
  }

  return {
    version: packageVersion(cliDir),
    commit: commit === '' ? null : commit,
    dirty,
    protocol: PROTOCOL,
    node: process.versions.node,
    checkout,
    fromSource: import.meta.url.endsWith('.ts'),
  };
}

/** `~/…` for a path under the home directory: shorter, and no user name on a screenshot. */
export function tildePath(path: string, home: string = homedir()): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function versionLine(info: VersionInfo, home: string = homedir()): string {
  const commit =
    info.commit === null
      ? 'commit unknown'
      : `commit ${info.commit.slice(0, 7)}${info.dirty === true ? '+dirty' : ''}`;
  const checkout =
    info.checkout === null ? 'not a git checkout' : `checkout ${tildePath(info.checkout, home)}`;
  return `laika ${info.version} (cli) · ${commit} · protocol ${String(info.protocol)} · node ${info.node} · ${checkout}`;
}

export interface VersionIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home?: string;
  readonly deps?: VersionDeps;
}

const CONSOLE: VersionIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export function version(argv: readonly string[], io: VersionIo = CONSOLE): number {
  const unknown = argv.filter((a) => a !== '--json');
  if (unknown.length > 0) {
    io.err(`laika version: unknown option "${unknown[0] ?? ''}". Usage: laika version [--json]`);
    return 1;
  }
  const info = versionInfo(io.deps);
  if (argv.includes('--json')) {
    io.out(JSON.stringify(info, null, 2));
  } else {
    io.out(versionLine(info, io.home));
  }
  return 0;
}
