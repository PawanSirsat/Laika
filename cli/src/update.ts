import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { HOOK_HARNESSES, type Harness } from './agent-adapters.ts';
import { AGENT_MARKER, hookFile } from './agent-hooks.ts';
import { USER_CONFIG } from './agents.ts';
import { normaliseUrl } from './api.ts';
import {
  type Compatibility,
  displayUrl,
  fetchCompatibility,
  pickBoard,
  updateStatus,
  urlProblem,
  USAGE_EXIT,
} from './doctor.ts';
import { PROTOCOL } from './protocol.ts';
import { CLI_DIR, tildePath } from './version.ts';

/**
 * `laika update` — move this machine's Laika checkout to the commit the
 * connected board was built from (LAI-1051, the LAI-1042 plan §F.5, §H, §L3).
 *
 * ## The board names the target, never a branch
 *
 * The target is `cli.source.commit` from the board's public compatibility
 * answer, fetched from `cli.source.url` (a self-hoster's fork when the board
 * sets `LAIKA_CLI_SOURCE_URL`). "Newest master" is never the answer: the board
 * runs one commit, and the helper that matches it is that commit.
 *
 * ## What is trusted (L3)
 *
 * The full 40-character commit id **is** the pin. The board is asked over TLS
 * (or on loopback), the commit must be reachable from a branch or tag the
 * source advertises (`ls-remote`, then fetched by tip, which every git host
 * allows), and `rev-parse` must give back exactly the advertised id. A branch
 * name is never trusted. Signed release tags are the follow-up hardening.
 *
 * ## What it refuses rather than risks
 *
 * A checkout with **any** local change, tracked or untracked, is refused; so is
 * one whose `HEAD` the source does not have (local commits). Nothing is ever
 * stashed, reset, cleaned or forced.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Recover** an interrupted earlier run (an `in-flight.json` left behind).
 * 2. **Ask the board**, check the checkout, **fetch and verify** the target.
 * 3. **Back up**: the previous commit, and every file the refresh may write.
 * 4. **Stage**: a detached worktree at the target; `laika version --json` and
 *    `laika doctor --offline --json` must run there. Nothing has changed yet.
 * 5. **Switch**: `checkout --detach <commit>`, with `in-flight.json` written
 *    first, so a kill between here and step 7 is put back on the next run.
 * 6. **Refresh**: the new checkout's own `laika agent hooks on` for each tool
 *    whose hooks were already on (marker-based, so an identical install is a
 *    no-op). MCP entries carry the board URL and an env-var name, never a
 *    checkout path, so nothing in them changes: they are hashed before and
 *    after, and a difference is a failure.
 * 7. **Verify** from the switched checkout; any failure from 5 on **rolls
 *    back**: the previous commit, then the backed-up files, each one named.
 *
 * ## What it never touches
 *
 * `~/.laika/env`, `~/.laika/agents/*`, `~/.laika/device/*`, consent, grants
 * and any repository's instruction files are not opened for writing, copied or
 * printed. The one secret-bearing file it may copy is `~/.claude/settings.json`
 * (when `laika init` put a token there, and only when its hooks are on): the
 * copy is `0600` in a `0700` directory, and is deleted once the update is
 * verified.
 *
 * ## Exit codes
 *
 * `0` updated, or already up to date; `1` refused, or failed and rolled back;
 * `2` cannot pick a safe target (the board did not answer, or does not say);
 * `64` the command line was wrong.
 */

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a program without a shell. Injectable so a test can see each call. */
export type Runner = (
  program: string,
  args: readonly string[],
  options?: { readonly env?: Readonly<Record<string, string | undefined>> },
) => RunResult;

export interface UpdateIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  /** `cli/` of the checkout to update; the running one by default. */
  readonly cliDir?: string;
  readonly run?: Runner;
  readonly now?: () => Date;
}

const realRun: Runner = (program, args, options) => {
  const result = spawnSync(program, [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
    ...(options?.env === undefined ? {} : { env: { ...options.env } }),
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
};

const CONSOLE: UpdateIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  home: homedir(),
  env: process.env,
  fetch: (input, init) => fetch(input, init),
};

const FULL_SHA = /^[0-9a-f]{40}$/;

/** `~/.laika/update/` — backups, staging and the in-flight marker. */
export const updateDir = (home: string): string => join(home, '.laika', 'update');
export const inFlightPath = (home: string): string => join(updateDir(home), 'in-flight.json');

/** What a run leaves behind so a later one can put things back. */
export interface InFlight {
  readonly checkout: string;
  readonly previous: string;
  /** The branch `HEAD` was on, or `null` when it was detached. */
  readonly branch: string | null;
  readonly target: string;
  readonly backup: string;
  readonly files: readonly {
    readonly path: string;
    readonly copy: string;
    readonly mode: number;
  }[];
}

class Refusal extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* git                                                                         */
/* -------------------------------------------------------------------------- */

function gitEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  // Never stop to ask for a password: a fetch that needs one fails, and says so.
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', SSH_ASKPASS: 'true' };
}

function makeGit(run: Runner, env: Readonly<Record<string, string | undefined>>, cwd: string) {
  const genv = gitEnv(env);
  return {
    run: (args: readonly string[]): RunResult => run('git', ['-C', cwd, ...args], { env: genv }),
    ok(args: readonly string[]): boolean {
      return this.run(args).code === 0;
    },
    out(args: readonly string[]): string | undefined {
      const result = this.run(args);
      return result.code === 0 ? result.stdout.trim() : undefined;
    },
  };
}
type Git = ReturnType<typeof makeGit>;

/** The last line of git's complaint, which is the one that says why. */
function why(result: RunResult): string {
  const lines = result.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.at(-1) ?? `exit ${String(result.code)}`;
}

/* -------------------------------------------------------------------------- */
/* The source                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a source is one git authenticates in transit. `https:`, `ssh:` and
 * scp-style `user@host:path` are; a local path or `file:` is this machine's own
 * disk. `http:` and `git:` are refused: anyone on the path could substitute a
 * repository, and only the commit id would stand between them and this machine.
 */
export function sourceProblem(url: string): string | undefined {
  if (url === '' || url.startsWith('-')) return 'is not a repository address';
  if (isAbsolute(url)) return undefined;
  if (/^[\w.-]+@[\w.-]+:(?!\/\/)/.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'is not a repository address';
  }
  if (parsed.protocol === 'file:') return undefined;
  if (parsed.protocol === 'https:' || parsed.protocol === 'ssh:') {
    if (parsed.password !== '' || (parsed.protocol === 'https:' && parsed.username !== '')) {
      return 'carries credentials';
    }
    if (parsed.search !== '' || parsed.hash !== '' || url.includes('?') || url.includes('#')) {
      return 'carries a query or fragment';
    }
    return undefined;
  }
  return `uses ${parsed.protocol.replace(/:$/, '')}://, which git does not authenticate`;
}

/** The source as it may be printed: a URL without credentials, a path with `~`. */
function shownSource(url: string, home: string): string {
  if (isAbsolute(url)) return tildePath(url, home);
  if (/^[\w.-]+@[\w.-]+:(?!\/\/)/.test(url)) return url;
  return url.startsWith('file:') ? url : displayUrl(url);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Plain `http:` off loopback means the commit pin itself travels unprotected,
 * and it is the whole of the trust (L3). Asking (`--check`, `--dry-run`) is
 * allowed with a warning; acting on it takes `--allow-http`, said out loud.
 */
export function boardTransportProblem(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return undefined;
  if (LOOPBACK.has(parsed.hostname)) return undefined;
  return `${displayUrl(url)} is plain http, so the commit it names could have been changed on the way`;
}

interface SourceTips {
  readonly tips: readonly string[];
}

/** Every branch and tag tip the source advertises, peeled to commits. */
function listTips(git: Git, source: string): SourceTips {
  const result = git.run(['ls-remote', '--heads', '--tags', source]);
  if (result.code !== 0) {
    throw new Refusal(`Could not check: the source did not answer (${why(result)})`, 2);
  }
  const byRef = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha === undefined || ref === undefined || !FULL_SHA.test(sha)) continue;
    // `refs/tags/v1^{}` is the commit an annotated tag points at: prefer it.
    const name = ref.replace(/\^\{\}$/, '');
    if (ref.endsWith('^{}') || !byRef.has(name)) byRef.set(name, sha);
  }
  return { tips: [...new Set(byRef.values())] };
}

/** Fetch the tips by id into the object store only: no ref, no FETCH_HEAD. */
function fetchTips(git: Git, source: string, tips: readonly string[]): void {
  const missing = tips.filter((sha) => !git.ok(['cat-file', '-e', `${sha}^{commit}`]));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const result = git.run([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      source,
      ...batch,
    ]);
    if (result.code !== 0) {
      throw new Refusal(`Could not check: fetching from the source failed (${why(result)})`, 2);
    }
  }
}

function reachableFrom(git: Git, commit: string, tips: readonly string[]): boolean {
  return tips.some((tip) => tip === commit || git.ok(['merge-base', '--is-ancestor', commit, tip]));
}

/* -------------------------------------------------------------------------- */
/* Files the refresh may touch                                                 */
/* -------------------------------------------------------------------------- */

function hooksOn(home: string, harness: Harness): boolean {
  try {
    return readFileSync(hookFile(home, harness), 'utf8').includes(AGENT_MARKER);
  } catch {
    return false;
  }
}

/** Every file a laika MCP entry may live in at user scope (`detectAgents`'s). */
function mcpFiles(home: string): string[] {
  return [join(home, '.claude.json'), ...Object.values(USER_CONFIG).map((f) => f(home))];
}

function digest(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return 'absent';
  }
}

/* -------------------------------------------------------------------------- */
/* Running a checkout's own CLI                                                */
/* -------------------------------------------------------------------------- */

function laika(
  run: Runner,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  checkout: string,
  args: readonly string[],
): RunResult {
  return run('sh', [join(checkout, 'cli', 'bin', 'laika'), ...args], {
    env: { ...env, HOME: home },
  });
}

/**
 * The self-check the plan names: `version --json` must say it is the target,
 * and `doctor --offline --json` must run and answer (`0`, `1` or `2` — a
 * finding about this machine is not a broken build).
 */
function selfCheck(
  run: Runner,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  checkout: string,
  target: string,
): string | undefined {
  const version = laika(run, env, home, checkout, ['version', '--json']);
  if (version.code !== 0) return `laika version exited ${String(version.code)}`;
  let commit: unknown;
  try {
    commit = (JSON.parse(version.stdout) as { commit?: unknown }).commit;
  } catch {
    return 'laika version --json did not print JSON';
  }
  if (commit !== target) return `laika version reports commit ${String(commit)}, not ${target}`;

  const doctor = laika(run, env, home, checkout, ['doctor', '--offline', '--json']);
  if (![0, 1, 2].includes(doctor.code)) return `laika doctor exited ${String(doctor.code)}`;
  try {
    const body = JSON.parse(doctor.stdout) as { checks?: unknown };
    if (!Array.isArray(body.checks)) return 'laika doctor --json printed no checks';
  } catch {
    return 'laika doctor --json did not print JSON';
  }
  return undefined;
}

function runtimeDependencies(checkout: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(checkout, 'cli', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };
    return Object.keys(raw.dependencies ?? {});
  } catch {
    return ['(cli/package.json could not be read)'];
  }
}

/* -------------------------------------------------------------------------- */
/* Rollback and recovery                                                       */
/* -------------------------------------------------------------------------- */

/** Put the checkout and the backed-up files back; one line per thing restored. */
function putBack(git: Git, state: InFlight, home: string): { done: string[]; failed: string[] } {
  const done: string[] = [];
  const failed: string[] = [];
  const short = state.previous.slice(0, 7);
  const head = git.out(['rev-parse', 'HEAD']);
  const on = git.out(['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? null;
  if (head !== state.previous || on !== state.branch) {
    const branchAt =
      state.branch === null ? undefined : git.out(['rev-parse', `refs/heads/${state.branch}`]);
    const args =
      state.branch !== null && branchAt === state.previous
        ? ['checkout', '--quiet', state.branch]
        : ['checkout', '--quiet', '--detach', state.previous];
    const result = git.run(args);
    if (result.code === 0) {
      done.push(
        `the checkout is back at ${short}${args.length === 3 ? ` on ${String(state.branch)}` : ' (detached)'}`,
      );
    } else {
      failed.push(`could not check out ${short} again (${why(result)})`);
    }
  }
  for (const file of state.files) {
    try {
      if (digest(file.path) !== digest(file.copy)) {
        copyFileSync(file.copy, file.path);
        chmodSync(file.path, file.mode);
        done.push(`restored ${tildePath(file.path, home)} from the backup`);
      }
    } catch (cause) {
      failed.push(
        `could not restore ${tildePath(file.path, home)} (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
  }
  return { done, failed };
}

function removeStaging(git: Git, staging: string): string | undefined {
  if (!existsSync(staging)) return undefined;
  // Never --force: a staging tree with changes in it is reported, not deleted.
  const result = git.run(['worktree', 'remove', staging]);
  if (result.code !== 0) return `the staging copy at ${staging} was left in place (${why(result)})`;
  git.run(['worktree', 'prune']);
  return undefined;
}

function readInFlight(home: string): InFlight | 'unreadable' | undefined {
  const path = inFlightPath(home);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<InFlight>;
    if (
      typeof raw.checkout !== 'string' ||
      typeof raw.previous !== 'string' ||
      !FULL_SHA.test(raw.previous) ||
      typeof raw.backup !== 'string' ||
      (raw.branch !== null && typeof raw.branch !== 'string') ||
      !Array.isArray(raw.files)
    ) {
      return 'unreadable';
    }
    return raw as InFlight;
  } catch {
    return 'unreadable';
  }
}

function recover(io: UpdateIo, run: Runner): number {
  const state = readInFlight(io.home);
  const marker = tildePath(inFlightPath(io.home), io.home);
  if (state === 'unreadable' || state === undefined) {
    io.err(`laika update: ${marker} is left from an interrupted update and cannot be read.`);
    io.err('  Check the checkout with git status and git log, then delete that file.');
    return 1;
  }
  const git = makeGit(run, io.env, state.checkout);
  io.out('An earlier laika update was interrupted. Putting things back as they were:');
  const { done, failed } = putBack(git, state, io.home);
  for (const line of done) io.out(`  ✓ ${line}`);
  if (done.length === 0 && failed.length === 0) io.out('  · nothing had changed');
  const staging = removeStaging(git, join(state.backup, 'staging'));
  if (staging !== undefined) failed.push(staging);
  if (failed.length > 0) {
    for (const line of failed) io.err(`  ! ${line}`);
    io.err(`  ${marker} is kept, so the next run tries again.`);
    return 1;
  }
  rmSync(inFlightPath(io.home), { force: true });
  io.out('');
  io.out('Run laika update again to retry.');
  return 1;
}

/* -------------------------------------------------------------------------- */
/* The command                                                                 */
/* -------------------------------------------------------------------------- */

const USAGE = 'Usage: laika update [--check] [--dry-run] [--board <url>] [--allow-http]';

interface Target {
  readonly board: string;
  readonly body: Compatibility;
  readonly commit: string;
  readonly source: string;
}

async function askBoard(
  io: UpdateIo,
  flag: string | undefined,
  http: 'refuse' | 'warn',
): Promise<Target> {
  const picked = pickBoard(io, flag);
  if (picked.url === undefined) {
    throw new Refusal(
      'Could not check: no board configured — pass --board <url>, or run laika init',
      2,
    );
  }
  if (urlProblem(picked.url) !== undefined) {
    throw new Refusal(
      `Could not check: the board URL from ${picked.from} carries credentials or is not a valid http(s) URL, so it was not used`,
      1,
    );
  }
  const board = normaliseUrl(picked.url);
  const transport = boardTransportProblem(board);
  if (transport !== undefined) {
    if (http === 'refuse') {
      throw new Refusal(
        `Refused: ${transport}. Put the board behind https, or pass --allow-http to accept that risk for this run. Nothing was changed.`,
        1,
      );
    }
    io.err(`Warning: ${transport}.`);
  }

  const result = await fetchCompatibility(board, io.fetch);
  const shown = displayUrl(board);
  if (result.kind === 'unreachable') throw new Refusal(`Could not check: ${result.why}`, 2);
  if (result.kind === 'not_set_up') {
    throw new Refusal(`Could not check: ${shown} has not been set up yet`, 2);
  }
  if (result.kind === 'unsupported') {
    throw new Refusal(
      `Version unknown — cannot pick a safe target: ${shown} does not report which commit it runs (a board older than this CLI). Nothing was changed.`,
      2,
    );
  }
  const { body } = result;
  const commit = body.cli.source.commit;
  if (commit === null) {
    throw new Refusal(
      `Version unknown — cannot pick a safe target: ${shown} does not know which commit it was built from. Nothing was changed.`,
      2,
    );
  }
  if (!FULL_SHA.test(commit)) {
    throw new Refusal(
      `Refused: ${shown} names "${commit.slice(0, 40)}", not a full 40-character commit id, so it cannot be pinned exactly. Nothing was changed.`,
      1,
    );
  }
  const source = typeof body.cli.source.url === 'string' ? body.cli.source.url : '';
  const problem = sourceProblem(source);
  if (problem !== undefined) {
    throw new Refusal(
      `Refused: the CLI source the board names ${problem}${problem === 'carries credentials' ? '' : ` (${shownSource(source, io.home)})`}. Nothing was changed.`,
      1,
    );
  }
  return { board, body, commit, source };
}

function checkLine(target: Target, head: string | null): string {
  const local = {
    version: '',
    commit: head,
    dirty: null,
    protocol: PROTOCOL,
    node: process.versions.node,
    checkout: null,
    fromSource: false,
  };
  const status = updateStatus(local, target.body);
  if (status.status === 'action') return status.detail;
  if (head === target.commit) return 'Up to date: this checkout is the board’s own commit';
  return `Update available: the board runs ${target.commit.slice(0, 7)}, this checkout ${head === null ? 'an unknown commit' : head.slice(0, 7)}. Run: laika update`;
}

export async function update(argv: readonly string[], io: UpdateIo = CONSOLE): Promise<number> {
  let board: string | undefined;
  let check = false;
  let dryRun = false;
  let allowHttp = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') check = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--allow-http') allowHttp = true;
    else if (arg === '--board') {
      board = argv[++i];
      if (board === undefined || board === '') {
        io.err(`laika update: --board needs a URL. ${USAGE}`);
        return USAGE_EXIT;
      }
    } else {
      io.err(`laika update: unknown option "${arg ?? ''}". ${USAGE}`);
      return USAGE_EXIT;
    }
  }
  if (check && dryRun) {
    io.err(`laika update: --check and --dry-run are separate questions. ${USAGE}`);
    return USAGE_EXIT;
  }

  const run = io.run ?? realRun;
  const interrupted = existsSync(inFlightPath(io.home));
  if (interrupted && !check && !dryRun) return recover(io, run);

  try {
    return await go(io, run, board, { check, dryRun, interrupted, allowHttp });
  } catch (cause) {
    if (cause instanceof Refusal) {
      io.err(cause.message);
      return cause.code;
    }
    throw cause;
  }
}

async function go(
  io: UpdateIo,
  run: Runner,
  boardFlag: string | undefined,
  mode: { check: boolean; dryRun: boolean; interrupted: boolean; allowHttp: boolean },
): Promise<number> {
  const cliDir = io.cliDir ?? CLI_DIR;
  const top = makeGit(run, io.env, cliDir).out(['rev-parse', '--show-toplevel']);
  const head = top === undefined ? undefined : makeGit(run, io.env, top).out(['rev-parse', 'HEAD']);

  if (mode.interrupted) {
    io.err(
      `An earlier laika update was interrupted (${tildePath(inFlightPath(io.home), io.home)}); run laika update to put things back first.`,
    );
  }

  const target = await askBoard(
    io,
    boardFlag,
    mode.check || mode.dryRun || mode.allowHttp ? 'warn' : 'refuse',
  );

  if (mode.check) {
    const line = checkLine(target, head ?? null);
    io.out(line);
    return line.startsWith('Update required') ? 1 : 0;
  }

  if (top === undefined || head === undefined) {
    throw new Refusal(
      `Refused: ${tildePath(cliDir, io.home)} is not inside a git checkout, so there is nothing laika update can move. Clone it: git clone ${shownSource(target.source, io.home)} ~/laika`,
      1,
    );
  }
  const checkout = top;
  const shown = tildePath(checkout, io.home);
  const git = makeGit(run, io.env, checkout);

  if (head === target.commit) {
    io.out(
      `Up to date: ${shown} is at ${target.commit.slice(0, 7)}, the commit the board was built from.`,
    );
    return 0;
  }

  const status = git.run(['status', '--porcelain', '--untracked-files=normal']);
  if (status.code !== 0)
    throw new Refusal(`Refused: git status failed in ${shown} (${why(status)})`, 1);
  const changed = status.stdout.split('\n').filter((l) => l.trim() !== '').length;
  if (changed > 0) {
    throw new Refusal(
      `Refused: you have local changes in ${shown} (${String(changed)} path${changed === 1 ? '' : 's'}; see git -C ${shown} status). Commit or stash them yourself, then run laika update again. Nothing was changed.`,
      1,
    );
  }

  const branch = git.out(['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? null;
  const source = shownSource(target.source, io.home);
  const plan = [
    `  board    ${displayUrl(target.board)} — Laika ${target.body.server.version}, protocol ${String(target.body.protocol.current)}`,
    `  source   ${source}`,
    `  from     ${head.slice(0, 7)}${branch === null ? ' (detached)' : ` on ${branch}`} in ${shown}`,
    `  to       ${target.commit} (detached; your branches are left where they are)`,
  ];
  const hookHarnesses = HOOK_HARNESSES.filter((h) => hooksOn(io.home, h));

  if (mode.dryRun) {
    io.out('laika update --dry-run — nothing is fetched or written.');
    io.out('');
    for (const line of plan) io.out(line);
    io.out('');
    io.out('Would:');
    io.out(
      `  1. fetch the source's branch and tag tips and check ${target.commit.slice(0, 7)} is one of them or behind one`,
    );
    io.out('  2. refuse if this checkout has commits the source does not');
    io.out(
      `  3. back up the previous commit${hookHarnesses.length > 0 ? ` and ${hookHarnesses.map((h) => tildePath(hookFile(io.home, h), io.home)).join(', ')}` : ''} under ${tildePath(updateDir(io.home), io.home)}/`,
    );
    io.out(
      '  4. check the target out in a staging copy and run laika version and laika doctor --offline there',
    );
    io.out(`  5. switch ${shown} to it with git checkout --detach`);
    io.out(
      hookHarnesses.length > 0
        ? `  6. re-apply the session hooks for ${hookHarnesses.join(', ')} with the new CLI`
        : '  6. no session hooks are on, so none are re-applied',
    );
    io.out('  7. check the result, and roll everything back if anything failed');
    io.out('');
    io.out(
      'Never touched: ~/.laika/env, ~/.laika/agents/, ~/.laika/device/, MCP entries, consent, grants.',
    );
    return 0;
  }

  io.out(`laika update — moving ${shown} to the commit the board was built from.`);
  io.out('');
  for (const line of plan) io.out(line);
  io.out('');

  // Fetch and verify: reachable from what the source advertises, exactly the id.
  const { tips } = listTips(git, target.source);
  if (tips.length === 0)
    throw new Refusal('Could not check: the source advertises no branch or tag', 2);
  fetchTips(git, target.source, tips);
  if (!reachableFrom(git, target.commit, tips)) {
    throw new Refusal(
      `Refused: ${target.commit.slice(0, 7)} is not on any branch or tag of ${source}, so it is not a commit that source published. Nothing was changed.`,
      1,
    );
  }
  const resolved = git.out(['rev-parse', '--verify', '--quiet', `${target.commit}^{commit}`]);
  if (resolved !== target.commit) {
    throw new Refusal(
      `Refused: ${target.commit.slice(0, 7)} did not resolve to exactly the commit the board named. Nothing was changed.`,
      1,
    );
  }
  io.out(
    `  ✓ ${target.commit.slice(0, 7)} is published by the source and matches the board exactly`,
  );
  if (!reachableFrom(git, head, tips)) {
    throw new Refusal(
      `Refused: ${shown} has commits the source does not have (HEAD ${head.slice(0, 7)} is on none of its branches or tags). Push or move them yourself, then run laika update again. Nothing was changed.`,
      1,
    );
  }

  // Back up.
  const stamp = (io.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backup = join(updateDir(io.home), stamp);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  chmodSync(updateDir(io.home), 0o700);
  chmodSync(backup, 0o700);
  const files = hookHarnesses.map((harness, i) => {
    const path = hookFile(io.home, harness);
    const copy = join(backup, `${String(i)}-${harness}-hooks`);
    const mode = statSync(path).mode & 0o777;
    copyFileSync(path, copy);
    chmodSync(copy, 0o600);
    return { path, copy, mode, harness };
  });
  const state: InFlight = {
    checkout,
    previous: head,
    branch,
    target: target.commit,
    backup,
    files: files.map(({ path, copy, mode }) => ({ path, copy, mode })),
  };
  writeFileSync(join(backup, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  io.out(`  ✓ backed up to ${tildePath(backup, io.home)}/`);
  const mcpBefore = mcpFiles(io.home).map((p) => [p, digest(p)] as const);
  const hooksBefore = new Map(files.map((f) => [f.harness, digest(f.path)]));

  // Stage.
  const staging = join(backup, 'staging');
  const added = git.run(['worktree', 'add', '--quiet', '--detach', staging, target.commit]);
  if (added.code !== 0) {
    throw new Refusal(
      `Failed: could not make the staging copy (${why(added)}). Nothing was changed.`,
      1,
    );
  }
  const deps = runtimeDependencies(staging);
  const staged =
    deps.length > 0
      ? `the target needs runtime dependencies installed (${deps.join(', ')}), which laika update does not do yet`
      : selfCheck(run, io.env, io.home, staging, target.commit);
  if (staged !== undefined) {
    const left = removeStaging(git, staging);
    io.err(`  ! the staging self-check failed: ${staged}`);
    if (left !== undefined) io.err(`  ! ${left}`);
    io.err('');
    io.err(
      `Failed before switching: ${shown} is still at ${head.slice(0, 7)}, and nothing else was changed.`,
    );
    return 1;
  }
  io.out('  ✓ staged and self-checked: laika version and laika doctor --offline run at the target');

  // Switch. The marker goes first: a kill from here on is put back next run.
  writeFileSync(inFlightPath(io.home), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  const failures: string[] = [];
  const switched = git.run(['checkout', '--quiet', '--detach', target.commit]);
  if (switched.code !== 0) failures.push(`git checkout failed (${why(switched)})`);

  // Refresh: hooks only where they were on, with the new CLI's own installer.
  let codexChanged = false;
  if (failures.length === 0) {
    for (const file of files) {
      const result = laika(run, io.env, io.home, checkout, [
        'agent',
        'hooks',
        'on',
        '--harness',
        file.harness,
      ]);
      if (result.code !== 0) {
        failures.push(
          `re-applying the ${file.harness} hooks failed (laika agent hooks on exited ${String(result.code)})`,
        );
        break;
      }
      const changed = digest(file.path) !== hooksBefore.get(file.harness);
      if (file.harness === 'codex' && changed) codexChanged = true;
      io.out(
        `  ✓ ${file.harness} session hooks ${changed ? 're-applied' : 'already current'} in ${tildePath(file.path, io.home)}`,
      );
    }
  }
  if (failures.length === 0) {
    const moved = mcpBefore.filter(([p, d]) => digest(p) !== d).map(([p]) => tildePath(p, io.home));
    if (moved.length > 0)
      failures.push(`an MCP config changed during the update: ${moved.join(', ')}`);
  }

  // Verify from the switched checkout.
  if (failures.length === 0) {
    const verified = selfCheck(run, io.env, io.home, checkout, target.commit);
    if (verified !== undefined)
      failures.push(`the switched checkout failed its check: ${verified}`);
  }

  if (failures.length > 0) {
    for (const line of failures) io.err(`  ! ${line}`);
    io.err('');
    io.err('Rolling back:');
    const { done, failed } = putBack(git, state, io.home);
    for (const line of done) io.err(`  ✓ ${line}`);
    const left = removeStaging(git, staging);
    if (left !== undefined) failed.push(left);
    if (failed.length > 0) {
      for (const line of failed) io.err(`  ! ${line}`);
      io.err(
        `The rollback is incomplete; ${tildePath(inFlightPath(io.home), io.home)} is kept so the next laika update tries again.`,
      );
      return 1;
    }
    rmSync(inFlightPath(io.home), { force: true });
    io.err(`Rolled back: ${shown} is at ${head.slice(0, 7)} again, as before the update.`);
    return 1;
  }

  const left = removeStaging(git, staging);
  if (left !== undefined) io.out(`  · ${left}`);
  // The copies may hold a token (settings.json); verified, they are not needed.
  for (const file of files) rmSync(file.copy, { force: true });
  rmSync(inFlightPath(io.home), { force: true });

  io.out('  ✓ the switched checkout passes laika version and laika doctor --offline');
  io.out('');
  io.out(
    `Updated: ${shown} is at ${target.commit.slice(0, 7)}, the commit the board was built from.`,
  );
  io.out(`To go back: git -C ${shown} checkout ${branch ?? `--detach ${head.slice(0, 7)}`}`);
  io.out('');
  io.out(
    'Restart Claude Code (quit, then start it with laika-claude) so it loads the updated plugin.',
  );
  if (codexChanged)
    io.out('Codex runs a changed hook only after you trust it again: start codex and open /hooks.');
  io.out('Then run laika doctor to check this machine against the board.');
  return 0;
}
