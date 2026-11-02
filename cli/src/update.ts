import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADAPTERS, HARNESSES, HOOK_HARNESSES, type Harness, isHarness } from './agent-adapters.ts';
import { AGENT_MARKER, hookFile } from './agent-hooks.ts';
import { agentsDir, credentialPath, isRecord, readCredential } from './agent-session.ts';
import { codexLaikaLines, USER_CONFIG } from './agents.ts';
import { normaliseUrl } from './api.ts';
import { type Helper, reportOutcome, sendClientReport } from './client-report.ts';
import { boardOriginOf } from './device.ts';
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
 * ## The board names the commit; this machine names where it comes from
 *
 * The target is `cli.source.commit` from the board's public compatibility
 * answer. "Newest master" is never the answer: the board runs one commit, and
 * the helper that matches it is that commit.
 *
 * **Where it is fetched from is anchored on this machine**, because the
 * staging self-check runs the fetched `cli/bin/laika`: whoever picks the
 * repository picks code this machine executes. So the board's `cli.source.url`
 * is used only when it is (normalised) one of the checkout's own remotes, or
 * when the board is https or loopback and names a fork. `--source <url>` names
 * it on this machine instead. A board over plain http off loopback is refused
 * for an update unless `--allow-http`, and even then only with an anchored
 * source: an on-path attacker can change the commit, but only to one the
 * anchored repository published.
 *
 * ## What is trusted (L3)
 *
 * The full 40-character commit id **is** the pin. It must be reachable from a
 * branch or tag the source advertises (`ls-remote`, then fetched by tip, which
 * every git host allows), `rev-parse` must give back exactly the advertised id,
 * and it must be a descendant of `HEAD` unless `--allow-downgrade`. Git runs
 * with only https and ssh allowed (and local paths for a loopback board or an
 * anchored local remote), `transfer.fsckObjects`, and none of the caller's
 * `GIT_DIR`-style overrides. Signed release tags are the follow-up hardening.
 *
 * ## What it refuses rather than risks
 *
 * A checkout with **any** local change, tracked or untracked, is refused; so is
 * one whose `HEAD` the source does not have (local commits). Nothing is ever
 * stashed, reset, cleaned or forced.
 *
 * ## The order
 *
 * 1. **Recover** an interrupted earlier run (`in-flight.json` left behind); with
 *    none, sweep any backup copy or staging tree an older run left.
 * 2. **Ask the board**, check the checkout, anchor the source, **fetch and
 *    verify** the target.
 * 3. **Mark, then back up**: `in-flight.json` is written *before* anything is
 *    copied, so no copy can outlive a crash unrecorded.
 * 4. **Stage**: a detached worktree at the target; `laika version --json` and
 *    `laika doctor --offline --json` must run there. Nothing has changed yet.
 * 5. **Switch**: `checkout --detach <commit>`.
 * 6. **Refresh**: the new checkout's own `laika agent hooks on` for each tool
 *    whose hooks were already on. The digest after each is written to the
 *    marker. MCP entries hold the board URL and an env-var name, never a
 *    checkout path, so nothing in them changes: each config's **laika
 *    entries** — only those, never the rest of the file, which Claude Code and
 *    others rewrite as they run (LAI-1089) — are hashed before and after, and a
 *    difference is a failure.
 * 7. **Verify** from the switched checkout. Any failure from 4 on **rolls
 *    back**, each item named.
 * 8. **Report** (LAI-1068): when the board's manifest says `client_reports`,
 *    each installed tool credential for this board sends the board one client
 *    report with its own token, so the Devices tab shows the new version
 *    without waiting for the tool to reconnect. Version, commit and protocol
 *    are the **new** checkout's, from its `laika version --json` in step 7 —
 *    this process is still the old CLI. A report that fails is one line; it
 *    never changes the exit code and never rolls anything back. A checkout that
 *    version calls `dirty` is not the board's build and sends none, and every
 *    other `~/.laika/agents/*.json` is named on one line with why it was
 *    passed over (LAI-1089).
 *
 * A checkout already at the board's commit stops after step 2, and still
 * sends the step-8 reports by the same rules (LAI-1085), with that checkout's
 * own `laika version --json`, then one line saying sent or skipped and why: a
 * machine moved there by plain `git`, or set up before `laika tool add`
 * reported anything, has no other way to tell the board. `--check` and
 * `--dry-run` never send one.
 *
 * ## Putting back never overwrites somebody else's change
 *
 * The checkout moves back only while `HEAD` is still the target (or the
 * previous commit) and the tree is clean. A file is restored only while its
 * digest is still the one this run wrote; anything else is "changed since —
 * left alone". A `.bak` the refresh created is removed only while it still
 * holds the original bytes.
 *
 * ## What it never touches
 *
 * `~/.laika/env`, `~/.laika/agents/*`, `~/.laika/device/*`, consent, grants
 * and any repository's instruction files are not written, copied or printed.
 * `~/.laika/agents/*` is the one of them it **opens, read-only**, and only
 * after a successful update or on a checkout already at the board's commit:
 * each credential's URL decides whether it belongs to this board, and its
 * token goes in that one report's `Authorization` header to that board
 * (step 8) — nowhere else. The one secret-bearing file it may copy is `~/.claude/settings.json`
 * (when `laika init` put a token there, and only when its hooks are on): the
 * copy is `0600` in a `0700` directory and is deleted on **every** way out —
 * success, refusal, rollback, exception and recovery — except an incomplete
 * rollback, where the marker and the copy are kept on purpose for the next run.
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
const SCP = /^([\w.-]+)@([\w.-]+):(?!\/\/)(.+)$/;

/** `~/.laika/update/` — backups, staging and the in-flight marker. */
export const updateDir = (home: string): string => join(home, '.laika', 'update');
export const inFlightPath = (home: string): string => join(updateDir(home), 'in-flight.json');

export interface BackedUpFile {
  readonly path: string;
  readonly copy: string;
  readonly mode: number;
  /** sha256 of the file before the update. */
  readonly original: string;
  /** sha256 after this run wrote it; `null` until the refresh has run. */
  readonly post: string | null;
  /** Whether `<path>.bak` existed before the refresh (which may create one). */
  readonly bakExisted: boolean;
}

/** What a run leaves behind so a later one can put things back. */
export interface InFlight {
  readonly checkout: string;
  readonly previous: string;
  /** The branch `HEAD` was on, or `null` when it was detached. */
  readonly branch: string | null;
  readonly target: string;
  readonly backup: string;
  readonly staging: string;
  readonly files: readonly BackedUpFile[];
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

const GIT_OVERRIDES = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PROXY_COMMAND',
  'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR',
]);

/**
 * The caller's environment without anything that points git somewhere else:
 * `GIT_DIR` and friends, and every `GIT_CONFIG*` (which can carry `-c`
 * settings). Used for git and for the checkout's own CLI alike.
 *
 * `GIT_SSH` and `GIT_SSH_COMMAND` are kept: they are how a person reaches an
 * ssh remote at all (a key, a jump host), and they choose how to connect,
 * not what is fetched — the commit is still pinned and checked.
 */
export function cleanEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const clean: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (GIT_OVERRIDES.has(key) || key.startsWith('GIT_CONFIG')) continue;
    clean[key] = value;
  }
  // Never stop to ask for a password: a fetch that needs one fails, and says so.
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', SSH_ASKPASS: 'true' };
}

/** `-c` settings for every command that talks to the source. */
function transportConfig(allowLocal: boolean): string[] {
  return [
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'protocol.ssh.allow=always',
    ...(allowLocal ? ['-c', 'protocol.file.allow=always'] : []),
    '-c',
    'transfer.fsckObjects=true',
  ];
}

function makeGit(run: Runner, env: Readonly<Record<string, string | undefined>>, cwd: string) {
  const genv = cleanEnv(env);
  return {
    run: (args: readonly string[], config: readonly string[] = []): RunResult =>
      run('git', [...config, '-C', cwd, ...args], { env: genv }),
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

/** A local path or `file:` URL: this machine's own disk. */
export function isLocalSource(url: string): boolean {
  return isAbsolute(url) || url.startsWith('file:');
}

/**
 * Whether a source is one git authenticates in transit. `https:`, `ssh:` and
 * scp-style `user@host:path` are; a local path or `file:` is this machine's own
 * disk (allowed only where the caller says). `http:` and `git:` are refused.
 */
export function sourceProblem(url: string): string | undefined {
  if (url === '' || url.startsWith('-')) return 'is not a repository address';
  if (isAbsolute(url)) return undefined;
  if (SCP.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'is not a repository address';
  }
  if (parsed.protocol === 'file:') {
    // `file://host/path` names another machine's share, not this disk.
    return parsed.host === '' || parsed.host === 'localhost'
      ? undefined
      : 'is a file: URL with a host';
  }
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

const trimRepo = (path: string): string =>
  path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');

/**
 * One repository, however it is spelt: `https://github.com/A/B.git`,
 * `git@github.com:A/B` and `ssh://git@github.com/A/B/` are the same key. The
 * user part and the port are dropped (both authenticated transports reach the
 * same host); a local path is resolved, against `base` when relative.
 */
export function sourceKey(url: string, base: string = process.cwd()): string | undefined {
  if (url === '' || url.startsWith('-')) return undefined;
  const scp = SCP.exec(url);
  if (scp !== null) return `${(scp[2] ?? '').toLowerCase()}/${trimRepo(scp[3] ?? '')}`;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || /^[a-z]:$/i.test(parsed.protocol)) {
    return `local:${resolve(base, url).replace(/\/+$/, '')}`;
  }
  if (parsed.protocol === 'file:') {
    try {
      return `local:${resolve(fileURLToPath(parsed)).replace(/\/+$/, '')}`;
    } catch {
      return undefined; // `file://host/…`: not a path on this machine.
    }
  }
  if (['https:', 'ssh:', 'http:', 'git:'].includes(parsed.protocol)) {
    return `${parsed.hostname.toLowerCase()}/${trimRepo(parsed.pathname)}`;
  }
  return undefined;
}

/** The source as it may be printed: a URL without credentials, a path with `~`. */
function shownSource(url: string, home: string): string {
  if (isAbsolute(url)) return tildePath(url, home);
  if (SCP.test(url)) return url;
  return url.startsWith('file:') ? url : displayUrl(url);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type Transport = 'https' | 'loopback' | 'http';

export function boardTransport(url: string): Transport {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return 'https';
  return LOOPBACK.has(parsed.hostname) ? 'loopback' : 'http';
}

interface Remote {
  readonly name: string;
  readonly key: string;
  /** What `git remote get-url` says: the one this machine configured. */
  readonly url: string;
}

/** The checkout's remotes, by name, with their keys and their own URLs. */
function remotes(git: Git, checkout: string): Remote[] {
  const names = (git.out(['remote']) ?? '').split('\n').filter((n) => n.trim() !== '');
  const found: Remote[] = [];
  for (const name of names) {
    const url = git.out(['remote', 'get-url', '--', name]);
    const key = url === undefined ? undefined : sourceKey(url, checkout);
    if (url !== undefined && key !== undefined) found.push({ name, key, url });
  }
  return found;
}

interface Anchor {
  /** What is fetched from. */
  readonly url: string;
  /** How this machine vouches for it, or `null` when only the board does. */
  readonly by: string | null;
}

/**
 * Where to fetch from, and who vouches for it (B1). `--source` wins; the
 * board's URL is anchored when it matches a remote; otherwise only a board
 * reached over https or loopback may name a fork.
 */
function anchorSource(
  git: Git,
  checkout: string,
  target: Target,
  userSource: string | undefined,
  home: string,
): Anchor {
  if (userSource !== undefined) {
    const problem = sourceProblem(userSource);
    if (problem !== undefined) {
      throw new Refusal(
        `Refused: --source ${problem}${problem === 'carries credentials' ? '' : ` (${shownSource(userSource, home)})`}. Nothing was changed.`,
        1,
      );
    }
    return { url: userSource, by: '--source' };
  }
  const advertised = target.source;
  const problem = sourceProblem(advertised);
  if (problem !== undefined) {
    throw new Refusal(
      `Refused: the CLI source the board names ${problem}${problem === 'carries credentials' ? '' : ` (${shownSource(advertised, home)})`}. Nothing was changed.`,
      1,
    );
  }
  const key = sourceKey(advertised, checkout);
  const match = remotes(git, checkout).find((r) => r.key === key);
  if (match !== undefined) {
    // Fetch from the remote's own URL, never the board's string: the match
    // ignores the user and the port, so `ssh://x@github.com:2222/…` from an
    // on-path attacker would match origin and then reach their server.
    const url = match.key.startsWith('local:') ? match.key.slice('local:'.length) : match.url;
    return { url, by: `remote ${match.name}` };
  }
  if (target.transport === 'http') {
    throw new Refusal(
      `Refused: the board is plain http and names a source this checkout has no remote for (${shownSource(advertised, home)}), so anyone on the way could have chosen it. Pass --source <url> to name the repository yourself. Nothing was changed.`,
      1,
    );
  }
  if (isLocalSource(advertised) && target.transport !== 'loopback') {
    throw new Refusal(
      `Refused: the board names a path on this machine (${shownSource(advertised, home)}) as the CLI source; only a board on this machine may do that. Pass --source to name it yourself. Nothing was changed.`,
      1,
    );
  }
  return { url: advertised, by: null };
}

/** Every branch and tag tip the source advertises, peeled to commits. */
function listTips(git: Git, source: string, config: readonly string[]): string[] {
  const result = git.run(['ls-remote', '--heads', '--tags', '--', source], config);
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
  return [...new Set(byRef.values())];
}

/** Fetch the tips by id into the object store only: no ref, no FETCH_HEAD. */
function fetchTips(
  git: Git,
  source: string,
  tips: readonly string[],
  config: readonly string[],
): void {
  const missing = tips.filter((sha) => !git.ok(['cat-file', '-e', `${sha}^{commit}`]));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const result = git.run(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        '--',
        source,
        ...batch,
      ],
      config,
    );
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

/**
 * The laika entries in one MCP config's text, `undefined` when it has none;
 * throws when the text is not the format at all.
 */
type LaikaEntries = (text: string) => unknown;

interface McpFile {
  readonly path: string;
  readonly entries: LaikaEntries;
}

const jsonEntry =
  (container: string): LaikaEntries =>
  (text) => {
    const doc: unknown = JSON.parse(text);
    const servers = isRecord(doc) ? doc[container] : undefined;
    return isRecord(servers) ? servers.laika : undefined;
  };

/** Claude Code's: the user-scope `mcpServers.laika`, and each project's own. */
function claudeEntries(text: string): unknown {
  const doc: unknown = JSON.parse(text);
  if (!isRecord(doc)) return undefined;
  const user = isRecord(doc.mcpServers) ? doc.mcpServers.laika : undefined;
  const projects: Record<string, unknown> = {};
  for (const [dir, project] of Object.entries(isRecord(doc.projects) ? doc.projects : {})) {
    const servers = isRecord(project) ? project.mcpServers : undefined;
    if (isRecord(servers) && servers.laika !== undefined) projects[dir] = servers.laika;
  }
  return user === undefined && Object.keys(projects).length === 0 ? undefined : { user, projects };
}

/** Where each user-scope file keeps its laika entry: `detectAgents`'s containers. */
const USER_ENTRIES: { readonly [K in keyof typeof USER_CONFIG]: LaikaEntries } = {
  cursor: jsonEntry('mcpServers'),
  codex: (text) => {
    const lines = codexLaikaLines(text);
    return lines.length === 0 ? undefined : lines;
  },
  'gemini-cli': jsonEntry('mcpServers'),
  opencode: jsonEntry('mcp'),
  antigravity: jsonEntry('mcpServers'),
};

/** Every file a laika MCP entry may live in at user scope (`detectAgents`'s). */
function mcpFiles(home: string): McpFile[] {
  const user = Object.keys(USER_CONFIG) as (keyof typeof USER_CONFIG)[];
  return [
    { path: join(home, '.claude.json'), entries: claudeEntries },
    ...user.map((name) => ({ path: USER_CONFIG[name](home), entries: USER_ENTRIES[name] })),
  ];
}

/** JSON with every object's keys in order, so a rewrite that reorders them is no change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * What the MCP guard compares (LAI-1089): a digest of the file's laika
 * entries, never of the rest of it, which Claude Code rewrites every few
 * seconds while it runs. Nothing else is kept, and only the path is ever
 * printed. `none` for no file or no entry; a file that is not the format at
 * all is compared whole, as before.
 */
export function entriesDigest(file: McpFile): string {
  let text: string;
  try {
    text = readFileSync(file.path, 'utf8');
  } catch {
    return 'none';
  }
  let entries: unknown;
  try {
    entries = file.entries(text);
  } catch {
    return `whole:${createHash('sha256').update(text).digest('hex')}`;
  }
  if (entries === undefined) return 'none';
  return createHash('sha256').update(canonical(entries)).digest('hex');
}

export function digest(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return 'absent';
  }
}

/** Written atomically, `0600`: a half-written marker would be worse than none. */
export function saveState(path: string, state: InFlight, exclusive = false): void {
  const body = `${JSON.stringify(state, null, 2)}\n`;
  if (exclusive) {
    writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
    return;
  }
  const temp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, path);
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
    env: { ...cleanEnv(env), HOME: home },
  });
}

/**
 * The self-check the plan names: `version --json` must say it is the target,
 * and `doctor --offline --json` must run and answer (`0`, `1` or `2` — a
 * finding about this machine is not a broken build).
 */
type SelfCheck =
  | { readonly ok: false; readonly problem: string }
  /**
   * `helper` is what `laika version --json` said, when it said all of it;
   * `dirty` that it saw local changes under `cli/` or `plugin/`, so it is not
   * exactly the commit it names (LAI-1089).
   */
  | { readonly ok: true; readonly helper: Helper | undefined; readonly dirty: boolean };

const failed = (problem: string): SelfCheck => ({ ok: false, problem });

/** The checkout's own `laika version --json`, which must say it is `target`. */
function versionAt(
  run: Runner,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  checkout: string,
  target: string,
): SelfCheck {
  const version = laika(run, env, home, checkout, ['version', '--json']);
  if (version.code !== 0) return failed(`laika version exited ${String(version.code)}`);
  let said: { version?: unknown; commit?: unknown; protocol?: unknown; dirty?: unknown };
  try {
    said = JSON.parse(version.stdout) as typeof said;
  } catch {
    return failed('laika version --json did not print JSON');
  }
  if (said.commit !== target) {
    return failed(`laika version reports commit ${String(said.commit)}, not ${target}`);
  }
  const helper =
    typeof said.version === 'string' && typeof said.protocol === 'number'
      ? { version: said.version, commit: target, protocol: said.protocol }
      : undefined;
  return { ok: true, helper, dirty: said.dirty === true };
}

function selfCheck(
  run: Runner,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  checkout: string,
  target: string,
): SelfCheck {
  const version = versionAt(run, env, home, checkout, target);
  if (!version.ok) return version;

  const doctor = laika(run, env, home, checkout, ['doctor', '--offline', '--json']);
  if (![0, 1, 2].includes(doctor.code)) return failed(`laika doctor exited ${String(doctor.code)}`);
  try {
    const body = JSON.parse(doctor.stdout) as { checks?: unknown };
    if (!Array.isArray(body.checks)) return failed('laika doctor --json printed no checks');
  } catch {
    return failed('laika doctor --json did not print JSON');
  }
  return version;
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
/* Putting back                                                                */
/* -------------------------------------------------------------------------- */

interface PutBack {
  readonly done: string[];
  /** Not ours to undo any more: reported, not failures. */
  readonly leftAlone: string[];
  readonly failed: string[];
}

/**
 * Put the checkout and the backed-up files back — but only what is still as
 * this run left it (B3). Anything changed since is reported and left alone.
 */
function putBack(git: Git, state: InFlight, home: string): PutBack {
  const done: string[] = [];
  const leftAlone: string[] = [];
  const failed: string[] = [];
  const short = state.previous.slice(0, 7);

  const head = git.out(['rev-parse', 'HEAD']);
  const on = git.out(['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? null;
  if (head !== state.previous || on !== state.branch) {
    const clean = git.out(['status', '--porcelain', '--untracked-files=normal']);
    if (head !== state.target && head !== state.previous) {
      leftAlone.push(
        `the checkout has moved since (HEAD is now ${head?.slice(0, 7) ?? 'unknown'}) — left alone; it was at ${short}`,
      );
    } else if (clean !== '') {
      leftAlone.push(
        `the checkout has local changes since — left alone at ${head.slice(0, 7)}; it was at ${short}${state.branch === null ? '' : ` on ${state.branch}`}`,
      );
    } else {
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
  }

  for (const file of state.files) {
    const shown = tildePath(file.path, home);
    const current = digest(file.path);
    if (current !== file.original) {
      if (file.post !== null && current === file.post) {
        try {
          if (digest(file.copy) !== file.original) throw new Error('the backup copy is not intact');
          copyFileSync(file.copy, file.path);
          chmodSync(file.path, file.mode);
          done.push(`restored ${shown} from the backup`);
        } catch (cause) {
          failed.push(
            `could not restore ${shown} (${cause instanceof Error ? cause.message : String(cause)})`,
          );
        }
      } else {
        leftAlone.push(
          `${shown} changed since the update wrote it — left alone; run laika agent hooks on to re-apply the hooks if they are wrong`,
        );
      }
    }
    // A `.bak` the refresh made holds the original bytes, which may include a token.
    const bak = `${file.path}.bak`;
    if (!file.bakExisted && existsSync(bak)) {
      if (digest(bak) === file.original) {
        rmSync(bak, { force: true });
        done.push(`removed ${tildePath(bak, home)}, which the refresh had made`);
      } else {
        leftAlone.push(`${tildePath(bak, home)} is not the one the refresh made — left alone`);
      }
    }
  }
  return { done, leftAlone, failed };
}

function removeStaging(git: Git, staging: string): string | undefined {
  if (existsSync(staging)) {
    // Never --force: a staging tree with changes in it is reported, not deleted.
    const result = git.run(['worktree', 'remove', '--', staging]);
    if (result.code !== 0) {
      return `the staging copy at ${staging} was left in place (${why(result)})`;
    }
  }
  git.run(['worktree', 'prune']);
  return undefined;
}

/** Remove the copies (which may hold a token) and, unless kept, the marker. */
function dropCopies(state: InFlight): void {
  for (const file of state.files) rmSync(file.copy, { force: true });
}

function readInFlight(home: string): InFlight | 'unreadable' | undefined {
  const path = inFlightPath(home);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<InFlight>;
    const filesOk =
      Array.isArray(raw.files) &&
      raw.files.every(
        (f: Partial<BackedUpFile>) =>
          typeof f.path === 'string' &&
          typeof f.copy === 'string' &&
          typeof f.mode === 'number' &&
          typeof f.original === 'string' &&
          (f.post === null || typeof f.post === 'string') &&
          typeof f.bakExisted === 'boolean',
      );
    if (
      typeof raw.checkout !== 'string' ||
      typeof raw.previous !== 'string' ||
      !FULL_SHA.test(raw.previous) ||
      typeof raw.target !== 'string' ||
      typeof raw.backup !== 'string' ||
      typeof raw.staging !== 'string' ||
      (raw.branch !== null && typeof raw.branch !== 'string') ||
      !filesOk
    ) {
      return 'unreadable';
    }
    return raw as InFlight;
  } catch {
    return 'unreadable';
  }
}

function report(io: UpdateIo, result: PutBack, to: 'out' | 'err'): void {
  const say = to === 'out' ? io.out : io.err;
  for (const line of result.done) say(`  ✓ ${line}`);
  for (const line of result.leftAlone) say(`  · ${line}`);
  for (const line of result.failed) io.err(`  ! ${line}`);
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
  io.out('An earlier laika update was interrupted. Putting back what it changed:');
  const result = putBack(git, state, io.home);
  const staging = removeStaging(git, state.staging);
  if (staging !== undefined) result.failed.push(staging);
  report(io, result, 'out');
  if (result.done.length === 0 && result.leftAlone.length === 0 && result.failed.length === 0) {
    io.out('  · nothing had changed');
  }
  if (result.failed.length > 0) {
    io.err(`  ${marker} and its backup are kept, so the next run tries again.`);
    return 1;
  }
  dropCopies(state);
  rmSync(inFlightPath(io.home), { force: true });
  io.out('');
  io.out('Run laika update again to retry.');
  return 1;
}

/**
 * With no marker, nothing should be under `~/.laika/update/` but each run's
 * `state.json`. A copy or a staging tree there is from a run that died before
 * this version wrote its marker first: remove it.
 */
function sweep(io: UpdateIo, git: Git | undefined): void {
  const dir = updateDir(io.home);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const sub = join(dir, entry);
    let names: string[];
    try {
      names = readdirSync(sub);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('-hooks')) rmSync(join(sub, name), { force: true });
    }
    if (git !== undefined && names.includes('staging')) {
      const left = removeStaging(git, join(sub, 'staging'));
      if (left !== undefined) io.err(`  · ${left}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The command                                                                 */
/* -------------------------------------------------------------------------- */

const USAGE =
  'Usage: laika update [--check] [--dry-run] [--board <url>] [--source <url>] [--allow-http] [--allow-downgrade]';

interface Target {
  readonly board: string;
  readonly transport: Transport;
  readonly body: Compatibility;
  readonly commit: string;
  readonly source: string;
}

async function askBoard(io: UpdateIo, flag: string | undefined): Promise<Target> {
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
  const transport = boardTransport(board);

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
  return { board, transport, body, commit, source };
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

interface Options {
  board?: string;
  source?: string;
  check: boolean;
  dryRun: boolean;
  allowHttp: boolean;
  allowDowngrade: boolean;
}

export async function update(argv: readonly string[], io: UpdateIo = CONSOLE): Promise<number> {
  const options: Options = { check: false, dryRun: false, allowHttp: false, allowDowngrade: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-http') options.allowHttp = true;
    else if (arg === '--allow-downgrade') options.allowDowngrade = true;
    else if (arg === '--board' || arg === '--source') {
      const value = argv[++i];
      if (value === undefined || value === '') {
        io.err(`laika update: ${arg} needs a URL. ${USAGE}`);
        return USAGE_EXIT;
      }
      if (arg === '--board') options.board = value;
      else options.source = value;
    } else {
      io.err(`laika update: unknown option "${arg ?? ''}". ${USAGE}`);
      return USAGE_EXIT;
    }
  }
  if (options.check && options.dryRun) {
    io.err(`laika update: --check and --dry-run are separate questions. ${USAGE}`);
    return USAGE_EXIT;
  }

  const run = io.run ?? realRun;
  const interrupted = existsSync(inFlightPath(io.home));
  if (interrupted && !options.check && !options.dryRun) return recover(io, run);

  try {
    return await go(io, run, options, interrupted);
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
  options: Options,
  interrupted: boolean,
): Promise<number> {
  const cliDir = io.cliDir ?? CLI_DIR;
  const top = makeGit(run, io.env, cliDir).out(['rev-parse', '--show-toplevel']);
  const head = top === undefined ? undefined : makeGit(run, io.env, top).out(['rev-parse', 'HEAD']);
  const asking = options.check || options.dryRun;

  if (interrupted) {
    io.err(
      `An earlier laika update was interrupted (${tildePath(inFlightPath(io.home), io.home)}); run laika update to put things back first.`,
    );
  } else if (!asking) {
    sweep(io, top === undefined ? undefined : makeGit(run, io.env, top));
  }

  const target = await askBoard(io, options.board);
  const plainHttp = `${displayUrl(target.board)} is plain http, so the commit it names could have been changed on the way`;
  if (target.transport === 'http' && (asking || options.allowHttp))
    io.err(`Warning: ${plainHttp}.`);

  if (options.check) {
    const line = checkLine(target, head ?? null);
    io.out(line);
    return line.startsWith('Update required') ? 1 : 0;
  }

  if (target.transport === 'http' && !options.dryRun && !options.allowHttp) {
    throw new Refusal(
      `Refused: ${plainHttp}. Put the board behind https, or pass --allow-http, which is accepted only with a source this checkout already has as a remote or one you name with --source. Nothing was changed.`,
      1,
    );
  }

  if (top === undefined || head === undefined) {
    throw new Refusal(
      `Refused: ${tildePath(cliDir, io.home)} is not inside a git checkout, so there is nothing laika update can move. Clone it: git clone <the Laika repository> ~/laika`,
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
    // LAI-1085: a checkout moved here by plain git has never reported, and
    // nothing else would until the next release.
    if (!options.dryRun)
      for (const line of await reportCurrent(io, run, checkout, target)) io.out(line);
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

  const anchor = anchorSource(git, checkout, target, options.source, io.home);
  const allowLocal =
    isLocalSource(anchor.url) && (target.transport === 'loopback' || anchor.by !== null);
  if (isLocalSource(anchor.url) && !allowLocal) {
    throw new Refusal('Refused: a local path as the source needs a board on this machine.', 1);
  }
  const config = transportConfig(allowLocal);

  const branch = git.out(['symbolic-ref', '--quiet', '--short', 'HEAD']) ?? null;
  const source = shownSource(anchor.url, io.home);
  const vouched =
    anchor.by === null ? 'named by the board, which is https or loopback' : `matches ${anchor.by}`;
  const plan = [
    `  board    ${displayUrl(target.board)} — Laika ${target.body.server.version}, protocol ${String(target.body.protocol.current)}`,
    `  source   ${source} (${anchor.by === '--source' ? 'named with --source' : vouched})`,
    `  from     ${head.slice(0, 7)}${branch === null ? ' (detached)' : ` on ${branch}`} in ${shown}`,
    `  to       ${target.commit} (detached; your branches are left where they are)`,
  ];
  const hookHarnesses = HOOK_HARNESSES.filter((h) => hooksOn(io.home, h));

  if (options.dryRun) {
    io.out('laika update --dry-run — nothing is fetched or written.');
    io.out('');
    for (const line of plan) io.out(line);
    io.out('');
    io.out('Would:');
    io.out(
      `  1. fetch the source's branch and tag tips and check ${target.commit.slice(0, 7)} is one of them or behind one`,
    );
    io.out(
      `  2. refuse if this checkout has commits the source does not, or if ${target.commit.slice(0, 7)} is not ahead of ${head.slice(0, 7)}${options.allowDowngrade ? ' (--allow-downgrade: a step back is allowed)' : ''}`,
    );
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
      'Never written: ~/.laika/env, ~/.laika/agents/, ~/.laika/device/, MCP entries, consent, grants.',
    );
    if (target.transport === 'http' && !options.allowHttp) {
      io.out('');
      io.out('A real run is refused while the board is plain http, unless --allow-http.');
    }
    return 0;
  }

  io.out(`laika update — moving ${shown} to the commit the board was built from.`);
  io.out('');
  for (const line of plan) io.out(line);
  io.out('');

  // Fetch and verify: reachable from what the source advertises, exactly the id.
  const tips = listTips(git, anchor.url, config);
  if (tips.length === 0)
    throw new Refusal('Could not check: the source advertises no branch or tag', 2);
  fetchTips(git, anchor.url, tips, config);
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
  if (!options.allowDowngrade && !git.ok(['merge-base', '--is-ancestor', head, target.commit])) {
    throw new Refusal(
      `Refused: ${target.commit.slice(0, 7)} is not ahead of ${head.slice(0, 7)}, so this would move ${shown} back or sideways. Pass --allow-downgrade if that is what you want. Nothing was changed.`,
      1,
    );
  }

  return switchTo(io, run, git, {
    checkout,
    shown,
    head,
    branch,
    target: target.commit,
    hookHarnesses,
    board: target.board,
    clientReports: target.body.features.client_reports === true,
  });
}

interface SwitchPlan {
  readonly checkout: string;
  readonly shown: string;
  readonly head: string;
  readonly branch: string | null;
  readonly target: string;
  readonly hookHarnesses: readonly Harness[];
  /** The board the target came from, and whether its manifest takes client reports. */
  readonly board: string;
  readonly clientReports: boolean;
}

const problemOf = (check: SelfCheck): string | undefined => (check.ok ? undefined : check.problem);

interface ToolCredential {
  readonly harness: Harness;
  readonly url: string;
  readonly token: string;
}

interface Credentials {
  readonly tools: readonly ToolCredential[];
  /** Every other `~/.laika/agents/*.json`, as `name (why)` — names only, never contents. */
  readonly passed: readonly string[];
}

/**
 * Each installed tool credential whose board is this one, and each other
 * credential file with why it was passed over (LAI-1089). A file not named
 * for a tool (`polly.json`, LAI-589) is **not opened**: it is listed by name.
 */
function credentialsFor(home: string, board: string): Credentials {
  const origin = boardOriginOf(board);
  if (origin === undefined) return { tools: [], passed: [] };
  const tools: ToolCredential[] = [];
  const passed: string[] = [];
  for (const harness of HARNESSES) {
    const pass = (why: string): void => {
      if (existsSync(credentialPath(home, harness))) passed.push(`${harness}.json (${why})`);
    };
    // `{}`: the saved file only, never a token from this process's environment.
    const saved = readCredential(home, harness, {});
    if (saved === undefined) pass('no saved URL and token');
    else if (urlProblem(saved.url) !== undefined) pass('its board URL cannot be used');
    else if (boardOriginOf(saved.url) !== origin) pass('another board');
    else tools.push({ harness, url: saved.url, token: saved.token });
  }
  let names: string[] = [];
  try {
    names = readdirSync(agentsDir(home));
  } catch {
    // No credentials directory: nothing set up, nothing passed over.
  }
  for (const name of names) {
    if (name.endsWith('.json') && !isHarness(name.slice(0, -'.json'.length))) {
      passed.push(`${name} (not a tool laika knows)`);
    }
  }
  return { tools, passed: passed.sort() };
}

const notExact = (shown: string): string =>
  `${shown} has local changes under cli/ or plugin/, so it is not the board’s exact build`;

/** One client report per credential, with its own token; a throw is an outcome, never thrown. */
async function sendReports(
  io: UpdateIo,
  tools: readonly ToolCredential[],
  helper: Helper,
): Promise<{ readonly name: string; readonly outcome: string }[]> {
  const outcomes: { name: string; outcome: string }[] = [];
  for (const tool of tools) {
    let outcome: string;
    try {
      const hooks = ADAPTERS[tool.harness].hooks && hooksOn(io.home, tool.harness);
      outcome = reportOutcome(
        // The tool's own name, so a generic harness can read Ready (LAI-1088).
        await sendClientReport(
          io,
          normaliseUrl(tool.url),
          tool.token,
          helper,
          hooks,
          ADAPTERS[tool.harness].agentHarness,
        ),
      );
    } catch {
      outcome = 'failed';
    }
    outcomes.push({ name: ADAPTERS[tool.harness].name, outcome });
  }
  return outcomes;
}

const shortHelper = (helper: Helper): string =>
  helper.commit === null ? helper.version : helper.commit.slice(0, 7);

/**
 * Step 8: one client report per installed tool credential whose board is this
 * one, with that credential's own token — none when `dirty` names the
 * checkout, which has local changes. Never fails the update: every outcome is
 * a line, and a throw is caught here.
 */
async function reportUpdate(
  io: UpdateIo,
  board: string,
  helper: Helper,
  dirty: string | undefined,
): Promise<void> {
  const { tools, passed } = credentialsFor(io.home, board);
  if (dirty !== undefined) io.out(`  · version report skipped: ${notExact(dirty)}`);
  else {
    for (const { name, outcome } of await sendReports(io, tools, helper)) {
      io.out(
        outcome === 'sent'
          ? `  ✓ told the board ${name} now runs ${shortHelper(helper)}`
          : `  · could not tell the board ${name}'s new version (${outcome}); the update stands`,
      );
    }
  }
  if (passed.length > 0) io.out(`  · passed over in ~/.laika/agents: ${passed.join(', ')}`);
}

/**
 * The same report when the checkout is already the board's commit (LAI-1085),
 * by the same rules as step 8, with the checkout's own `laika version --json`.
 * Returns the line saying what happened, then the passed-over line when there
 * is one; never throws, so a report can never change the exit code.
 */
async function reportCurrent(
  io: UpdateIo,
  run: Runner,
  checkout: string,
  target: Target,
): Promise<string[]> {
  const skipped = (why: string): string => `Version report skipped: ${why}.`;
  if (target.body.features.client_reports !== true)
    return [skipped('the board does not take client reports')];
  let passed: readonly string[] = [];
  const say = (line: string): string[] =>
    passed.length === 0 ? [line] : [line, `Passed over in ~/.laika/agents: ${passed.join(', ')}.`];
  try {
    const found = credentialsFor(io.home, target.board);
    ({ passed } = found);
    const { tools } = found;
    if (tools.length === 0) {
      return say(
        skipped('no tool on this machine is set up for this board (laika tool add sets one up)'),
      );
    }
    const version = versionAt(run, io.env, io.home, checkout, target.commit);
    if (!version.ok) return say(skipped(version.problem));
    if (version.dirty) return say(skipped(notExact(tildePath(checkout, io.home))));
    if (version.helper === undefined)
      return say(skipped('laika version --json did not say its version and protocol'));
    const outcomes = await sendReports(io, tools, version.helper);
    const sent = outcomes.filter((o) => o.outcome === 'sent').map((o) => o.name);
    const notSent = outcomes
      .filter((o) => o.outcome !== 'sent')
      .map((o) => `${o.name} (${o.outcome})`);
    const parts = [
      ...(sent.length > 0 ? [`sent for ${sent.join(', ')}`] : []),
      ...(notSent.length > 0 ? [`not sent for ${notSent.join(', ')}`] : []),
    ];
    return say(`Version report for ${shortHelper(version.helper)}: ${parts.join('; ')}.`);
  } catch {
    // `sendReports` never throws, so whatever did, nothing was sent.
    return say(skipped('it failed before anything was sent'));
  }
}

/** Steps 3–8: marker first, then backup, stage, switch, refresh, verify, report. */
async function switchTo(io: UpdateIo, run: Runner, git: Git, p: SwitchPlan): Promise<number> {
  const stamp = (io.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backup = join(updateDir(io.home), stamp);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  chmodSync(updateDir(io.home), 0o700);
  chmodSync(backup, 0o700);
  const marker = inFlightPath(io.home);
  let state: InFlight = {
    checkout: p.checkout,
    previous: p.head,
    branch: p.branch,
    target: p.target,
    backup,
    staging: join(backup, 'staging'),
    files: p.hookHarnesses.map((harness, i) => {
      const path = hookFile(io.home, harness);
      return {
        path,
        copy: join(backup, `${String(i)}-${harness}-hooks`),
        mode: statSync(path).mode & 0o777,
        original: digest(path),
        post: null,
        bakExisted: existsSync(`${path}.bak`),
      };
    }),
  };
  // The marker before any copy: nothing can be copied that a crash leaves unrecorded.
  saveState(marker, state, true);

  // Kept only when a rollback could not finish: the next run needs them.
  let keep = false;
  try {
    for (const file of state.files) {
      copyFileSync(file.path, file.copy);
      chmodSync(file.copy, 0o600);
      if (digest(file.copy) !== file.original) {
        throw new Refusal(
          `Failed: ${tildePath(file.path, io.home)} changed while it was being backed up. Nothing was changed.`,
          1,
        );
      }
    }
    writeFileSync(join(backup, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    io.out(`  ✓ backed up to ${tildePath(backup, io.home)}/`);
    const mcpBefore = mcpFiles(io.home).map((file) => [file, entriesDigest(file)] as const);

    // Stage.
    const added = git.run(['worktree', 'add', '--quiet', '--detach', state.staging, p.target]);
    if (added.code !== 0) {
      throw new Refusal(
        `Failed: could not make the staging copy (${why(added)}). Nothing was changed.`,
        1,
      );
    }
    const deps = runtimeDependencies(state.staging);
    const staged =
      deps.length > 0
        ? `the target needs runtime dependencies installed (${deps.join(', ')}), which laika update does not do yet`
        : problemOf(selfCheck(run, io.env, io.home, state.staging, p.target));
    if (staged !== undefined) {
      const left = removeStaging(git, state.staging);
      io.err(`  ! the staging self-check failed: ${staged}`);
      if (left !== undefined) io.err(`  ! ${left}`);
      io.err('');
      io.err(
        `Failed before switching: ${p.shown} is still at ${p.head.slice(0, 7)}, and nothing else was changed.`,
      );
      return 1;
    }
    io.out(
      '  ✓ staged and self-checked: laika version and laika doctor --offline run at the target',
    );

    // Switch.
    const failures: string[] = [];
    const switched = git.run(['checkout', '--quiet', '--detach', p.target]);
    if (switched.code !== 0) failures.push(`git checkout failed (${why(switched)})`);

    // Refresh: hooks only where they were on, with the new CLI's own installer.
    let codexChanged = false;
    if (failures.length === 0) {
      for (const [i, file] of state.files.entries()) {
        const harness = p.hookHarnesses[i];
        if (harness === undefined) continue;
        const result = laika(run, io.env, io.home, p.checkout, [
          'agent',
          'hooks',
          'on',
          '--harness',
          harness,
        ]);
        const post = digest(file.path);
        state = {
          ...state,
          files: state.files.map((f, j) => (j === i ? { ...f, post } : f)),
        };
        saveState(marker, state);
        if (result.code !== 0) {
          failures.push(
            `re-applying the ${harness} hooks failed (laika agent hooks on exited ${String(result.code)})`,
          );
          break;
        }
        const changed = post !== file.original;
        if (harness === 'codex' && changed) codexChanged = true;
        io.out(
          `  ✓ ${harness} session hooks ${changed ? 're-applied' : 'already current'} in ${tildePath(file.path, io.home)}`,
        );
      }
    }
    if (failures.length === 0) {
      const moved = mcpBefore
        .filter(([file, before]) => entriesDigest(file) !== before)
        .map(([file]) => tildePath(file.path, io.home));
      if (moved.length > 0)
        failures.push(`a laika MCP entry changed during the update: ${moved.join(', ')}`);
    }

    // Verify from the switched checkout.
    let helper: Helper | undefined;
    let dirty = false;
    if (failures.length === 0) {
      const verified = selfCheck(run, io.env, io.home, p.checkout, p.target);
      if (verified.ok) ({ helper, dirty } = verified);
      else failures.push(`the switched checkout failed its check: ${verified.problem}`);
    }

    if (failures.length > 0) {
      for (const line of failures) io.err(`  ! ${line}`);
      io.err('');
      io.err('Rolling back:');
      const result = putBack(git, state, io.home);
      const left = removeStaging(git, state.staging);
      if (left !== undefined) result.failed.push(left);
      report(io, result, 'err');
      if (result.failed.length > 0) {
        keep = true;
        io.err(
          `The rollback is incomplete; ${tildePath(marker, io.home)} and its backup are kept so the next laika update tries again.`,
        );
        return 1;
      }
      io.err(
        result.leftAlone.length > 0
          ? 'Rolled back what was still as the update left it; the rest is listed above.'
          : `Rolled back: ${p.shown} is at ${p.head.slice(0, 7)} again, as before the update.`,
      );
      return 1;
    }

    const left = removeStaging(git, state.staging);
    if (left !== undefined) io.out(`  · ${left}`);
    io.out('  ✓ the switched checkout passes laika version and laika doctor --offline');
    if (p.clientReports && helper !== undefined)
      await reportUpdate(io, p.board, helper, dirty ? p.shown : undefined);
    io.out('');
    io.out(
      `Updated: ${p.shown} is at ${p.target.slice(0, 7)}, the commit the board was built from.`,
    );
    io.out(
      `To go back: git -C ${p.shown} checkout ${p.branch ?? `--detach ${p.head.slice(0, 7)}`}`,
    );
    io.out('');
    io.out(
      'Restart Claude Code (quit, then start it with laika-claude) so it loads the updated plugin.',
    );
    if (codexChanged)
      io.out(
        'Codex runs a changed hook only after you trust it again: start codex and open /hooks.',
      );
    io.out('Then run laika doctor to check this machine against the board.');
    return 0;
  } catch (cause) {
    if (cause instanceof Refusal) {
      removeStaging(git, state.staging);
      throw cause;
    }
    // Something unexpected: put back what is still ours, then let it surface.
    io.err('');
    io.err('Something went wrong mid-update. Rolling back:');
    const result = putBack(git, state, io.home);
    const left = removeStaging(git, state.staging);
    if (left !== undefined) result.failed.push(left);
    report(io, result, 'err');
    if (result.failed.length > 0) keep = true;
    throw cause;
  } finally {
    if (!keep) {
      dropCopies(state);
      rmSync(marker, { force: true });
    }
  }
}
