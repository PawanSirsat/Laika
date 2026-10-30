import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The git half of the checkpoint helper (LAI-547, proposal §4.3.1, D-115,
 * D-116). Every rule that keeps a save from hurting the repo lives here, each
 * a refusal with a reason rather than a best effort:
 *
 * - **Only an isolated task worktree** — a linked `git worktree`, never the
 *   primary checkout unless `git config laika.checkpoint.allowPrimary true`
 *   says so for that repo — **on a dedicated branch**: not detached, not
 *   `master`, `main` or the remote's default branch.
 * - **Never while git is busy**: an `index.lock`, a `HEAD.lock`, or a merge,
 *   rebase, cherry-pick, revert or bisect in progress is a refusal, and the
 *   helper's own lock keeps two saves apart.
 * - **Never a blind `git add -A`.** Each path is staged by name, as a literal
 *   pathspec, after it passes the deny list (secret-shaped names), the size
 *   cap and the secret patterns on what it adds. Ignored files are never
 *   candidates. One refused file refuses the whole save and is named.
 * - **Never a force push and never a protected branch.** Every push names its
 *   refspec in full, with no `+`, and `--force` appears nowhere in this file;
 *   a remote that has moved on is a refusal, not an overwrite.
 *
 * **Untrusted text is never executed.** Branch names, paths and notes go to
 * git as arguments of `execFileSync` — no shell — after `--`, and the repo's
 * own hooks are switched off for the helper's commit and pushes
 * (`core.hooksPath=/dev/null`, `--no-verify`), because a hook is repo content.
 */

export class Refusal extends Error {
  readonly code: string;
  readonly paths: readonly string[];

  constructor(message: string, code: string, paths: readonly string[] = []) {
    super(message);
    this.name = 'Refusal';
    this.code = code;
    this.paths = paths;
  }
}

/* -------------------------------------------------------------------------- */
/* Running git                                                                */
/* -------------------------------------------------------------------------- */

const GIT_TIMEOUT_MS = 120_000;

/**
 * What git and every process it starts may see of the caller's environment:
 * **an allowlist**, so no credential of any name reaches a hook, a helper, an
 * ssh command or a remote's `receive-pack` — not `AWS_SECRET_ACCESS_KEY`,
 * not `GH_TOKEN`, not the agent's or the person's Laika token. What is kept
 * is what a push needs: a path and a home (where git's config and credential
 * helpers live), a temp dir, the user's names, the ssh agent's socket and an
 * ssh command the user set. Prompts are off (a background save must fail,
 * not wait for a password) and messages are in English so a refusal can be
 * read.
 */
export const GIT_ENV_ALLOW: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'XDG_CONFIG_HOME',
  'GH_CONFIG_DIR',
  'SSH_AUTH_SOCK',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
];

export function gitEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const name of GIT_ENV_ALLOW) {
    const value = env[name];
    if (value !== undefined && value !== '') next[name] = value;
  }
  next.GIT_TERMINAL_PROMPT = '0';
  next.LC_ALL = 'C';
  next.LANG = 'C';
  return next;
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (cwd: string, args: readonly string[]) => GitResult;

/**
 * Set on **every** git call the helper makes, not only its commit and push:
 * `git status`, `diff` and `add` start the repo's `core.fsmonitor` command,
 * and any command can run a hook. Both are repo content, and repo content is
 * never run. The untracked cache is off too, so a cache written by another
 * tool cannot decide which files are seen.
 */
export const SAFE_CONFIG: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.untrackedCache=false',
];

export function gitRunner(env: Readonly<Record<string, string | undefined>>): GitRunner {
  const clean = gitEnv(env);
  return (cwd, args) => {
    try {
      const stdout = execFileSync('git', [...SAFE_CONFIG, ...args], {
        cwd,
        env: clean,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      return { code: 0, stdout, stderr: '' };
    } catch (cause) {
      const e = cause as { status?: number | null; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };
}

/** Switches off every hook for one git call: a hook is repo content, and is never run. */
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];

function must(git: GitRunner, cwd: string, args: readonly string[]): string {
  const r = git(cwd, args);
  if (r.code !== 0) {
    throw new Refusal(
      `git ${args[0] === '-c' ? (args[2] ?? '') : (args[0] ?? '')} failed: ${firstLine(r.stderr)}`,
      'git_failed',
    );
  }
  return r.stdout;
}

const firstLine = (text: string): string => text.trim().split('\n')[0]?.slice(0, 300) ?? '';

/** A literal pathspec: a file name is never read as a glob or as magic. */
export const literal = (path: string): string => `:(literal)${path}`;

/* -------------------------------------------------------------------------- */
/* Where we are                                                               */
/* -------------------------------------------------------------------------- */

export interface Worktree {
  readonly top: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly primary: boolean;
}

export function worktreeAt(git: GitRunner, cwd: string): Worktree {
  const r = git(cwd, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']);
  if (r.code !== 0) throw new Refusal('not inside a git repository', 'not_a_repo');
  const [top = '', gitDir = '', commonRaw = ''] = r.stdout.trim().split('\n');
  const commonDir = isAbsolute(commonRaw) ? commonRaw : resolve(top, commonRaw);
  return { top, gitDir, commonDir, primary: resolve(gitDir) === resolve(commonDir) };
}

function configBool(git: GitRunner, cwd: string, key: string): boolean {
  const r = git(cwd, ['config', '--type=bool', '--get', key]);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export function configValue(git: GitRunner, cwd: string, key: string): string | undefined {
  const r = git(cwd, ['config', '--get', key]);
  const value = r.stdout.trim();
  return r.code === 0 && value !== '' ? value : undefined;
}

/** Refuses the primary checkout unless this repo's own config allows it. */
export function assertIsolated(git: GitRunner, wt: Worktree): void {
  if (wt.primary && !configBool(git, wt.top, 'laika.checkpoint.allowPrimary')) {
    throw new Refusal(
      `${wt.top} is the repository's primary checkout. Checkpoints run only in a task's own ` +
        'worktree (`git worktree add -b LAI-NNN-name ../repo-LAI-NNN`); to allow this checkout, ' +
        'run `git config laika.checkpoint.allowPrimary true` in it.',
      'primary_checkout',
    );
  }
}

/** Never these, whatever the remote says its default is. */
export const PROTECTED_BRANCHES: readonly string[] = ['master', 'main'];

export function currentBranch(git: GitRunner, wt: Worktree): string {
  const r = git(wt.top, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const branch = r.stdout.trim();
  if (r.code !== 0 || branch === '') {
    throw new Refusal('HEAD is detached: a checkpoint saves a branch', 'detached_head');
  }
  return branch;
}

/** The remote a branch pushes to: its configured one, else `origin`. */
export function remoteFor(git: GitRunner, wt: Worktree, branch: string): string {
  const remote = configValue(git, wt.top, `branch.${branch}.remote`) ?? 'origin';
  if (remote === '.' || !/^[A-Za-z0-9._-]{1,100}$/.test(remote)) {
    throw new Refusal(`branch ${branch} pushes to "${remote}", which is not a remote`, 'no_remote');
  }
  if (git(wt.top, ['remote', 'get-url', remote]).code !== 0) {
    throw new Refusal(`there is no remote named ${remote}`, 'no_remote');
  }
  if (configBool(git, wt.top, `remote.${remote}.mirror`)) {
    throw new Refusal(
      `remote ${remote} is a mirror: a push to it would overwrite every ref`,
      'mirror_remote',
    );
  }
  return remote;
}

/** The remote's default branch as this clone last saw it (`refs/remotes/<r>/HEAD`). */
export function remoteDefault(git: GitRunner, wt: Worktree, remote: string): string | undefined {
  const r = git(wt.top, ['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`]);
  const full = r.stdout.trim();
  return r.code === 0 && full.startsWith(`${remote}/`) ? full.slice(remote.length + 1) : undefined;
}

export function assertWorkBranch(branch: string, remoteDefaultBranch: string | undefined): void {
  const protectedNames = new Set([
    ...PROTECTED_BRANCHES,
    ...(remoteDefaultBranch === undefined ? [] : [remoteDefaultBranch]),
  ]);
  if (protectedNames.has(branch)) {
    throw new Refusal(
      `${branch} is a protected branch: checkpoints never commit to or push it. ` +
        'Work on the task’s own branch, LAI-NNN-short-name.',
      'protected_branch',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Busy                                                                       */
/* -------------------------------------------------------------------------- */

/** What git leaves in a worktree's git dir while an operation is running. */
const BUSY_MARKERS: readonly (readonly [string, string])[] = [
  ['index.lock', 'another git process holds index.lock'],
  ['HEAD.lock', 'another git process holds HEAD.lock'],
  ['MERGE_HEAD', 'a merge is in progress'],
  ['CHERRY_PICK_HEAD', 'a cherry-pick is in progress'],
  ['REVERT_HEAD', 'a revert is in progress'],
  ['rebase-merge', 'a rebase is in progress'],
  ['rebase-apply', 'a rebase or `git am` is in progress'],
  ['BISECT_LOG', 'a bisect is in progress'],
];

export function busyReason(wt: Worktree): string | undefined {
  for (const [name, why] of BUSY_MARKERS) {
    if (existsSync(join(wt.gitDir, name))) return `${why} (${join(wt.gitDir, name)})`;
  }
  return undefined;
}

export function assertNotBusy(wt: Worktree): void {
  const why = busyReason(wt);
  if (why !== undefined) {
    throw new Refusal(
      `git is busy here — ${why}. Nothing was staged, committed or pushed; try again when it finishes.`,
      'git_busy',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Secrets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * File names that are refused whatever they hold. Matched on the base name,
 * case-insensitively, except where a directory is part of the shape.
 */
const DENY_NAMES: readonly RegExp[] = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$|dist$)[^/]+$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg|tfstate|tfvars)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass)$/i,
  /^(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /^service[-_]?account.*\.json$/i,
];

const DENY_PATHS: readonly RegExp[] = [/(^|\/)\.aws\/(credentials|config)$/, /(^|\/)\.laika\//];

export function deniedName(path: string): boolean {
  const name = basename(path);
  return DENY_NAMES.some((re) => re.test(name)) || DENY_PATHS.some((re) => re.test(path));
}

/**
 * Secret-shaped text: the patterns a save's added lines, and its continuation
 * note, are checked against (D-115 item 5). **A mitigation, not a guarantee**:
 * no pattern can prove free text holds nothing sensitive.
 */
export const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  // `lai_` and 40 base62 characters: TOKEN_PREFIX + TOKEN_SECRET_LENGTH in
  // server/src/auth/tokens.ts (SPEC §4.9) — a person's token or an agent's.
  ['a Laika token', /\blai_[0-9A-Za-z]{40}\b/],
  ['a private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['an AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['an API secret key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['a Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a bearer credential', /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/-]{20,}/i],
  ['a URL with a password', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]{6,}@[^/\s]+/i],
];

/** What the text looks like it holds, or `undefined`. */
export function secretIn(text: string): string | undefined {
  for (const [what, re] of SECRET_PATTERNS) if (re.test(text)) return what;
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Staging                                                                    */
/* -------------------------------------------------------------------------- */

export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
export const MAX_CHANGED_FILES = 1000;

interface Change {
  readonly path: string;
  readonly deleted: boolean;
  readonly untracked: boolean;
}

/** `git status --porcelain -z`: every change, tracked or not. Ignored files are never listed. */
export function changes(git: GitRunner, wt: Worktree): Change[] {
  const out = must(git, wt.top, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--ignore-submodules=all',
  ]);
  const list: Change[] = [];
  for (const entry of out.split('\0')) {
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    list.push({
      path,
      untracked: xy === '??',
      deleted: xy.includes('D'),
    });
  }
  return list;
}

export interface StageOptions {
  /**
   * New (untracked) files to include, relative to the worktree's top — the
   * only way one is saved. Tracked changes are always included.
   */
  readonly add?: readonly string[];
  readonly maxFileBytes: number;
}

/** What a tracked file's change adds, line by line; the whole file for a new one. */
function addedText(git: GitRunner, wt: Worktree, change: Change, hasHead: boolean): string {
  const full = join(wt.top, change.path);
  if (change.untracked || !hasHead) return readFileSync(full, 'latin1');
  const r = git(wt.top, [
    'diff',
    'HEAD',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '-U0',
    '--',
    literal(change.path),
  ]);
  if (/^Binary files /m.test(r.stdout) || r.stdout === '') return readFileSync(full, 'latin1');
  return r.stdout
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function inside(top: string, path: string): string | undefined {
  const rel = relative(top, resolve(top, path));
  return rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)
    ? undefined
    : rel.split(sep).join('/');
}

/**
 * Checks every candidate and, only when all pass, stages them by name.
 * Returns the staged paths. **Throws before staging anything** when one is
 * refused, naming each refused path.
 */
export function stageSafely(git: GitRunner, wt: Worktree, options: StageOptions): string[] {
  const all = changes(git, wt);
  const listed = new Set<string>();
  for (const raw of options.add ?? []) {
    const rel = inside(wt.top, raw);
    if (rel === undefined) {
      throw new Refusal(`${raw} is outside this worktree`, 'outside_worktree', [raw]);
    }
    listed.add(rel);
  }
  const ignored = [...listed].filter(
    (p) => git(wt.top, ['check-ignore', '-q', '--', p]).code === 0,
  );
  if (ignored.length > 0) {
    throw new Refusal(
      `refused: ${ignored.join(', ')} ${ignored.length === 1 ? 'is' : 'are'} gitignored, and a checkpoint never stages an ignored file`,
      'ignored_file',
      ignored,
    );
  }
  const unchanged = [...listed].filter((p) => !all.some((c) => c.path === p));
  if (unchanged.length > 0) {
    throw new Refusal(
      `refused: ${unchanged.join(', ')} ${unchanged.length === 1 ? 'has' : 'have'} no change to save`,
      'not_changed',
      unchanged,
    );
  }
  // **Tracked changes only, by default.** A file git has never seen is saved
  // only when it is named: a scratch file, a local build, a dump — none of
  // them is work in progress just because it is in the worktree.
  const candidates = all.filter((c) => !c.untracked || listed.has(c.path));
  if (candidates.length > MAX_CHANGED_FILES) {
    throw new Refusal(
      `refused: ${String(candidates.length)} changed files is more than a checkpoint takes ` +
        `(${String(MAX_CHANGED_FILES)}). Is a build output missing from .gitignore?`,
      'too_many_files',
    );
  }

  const hasHead = git(wt.top, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']).code === 0;
  const refused: string[] = [];
  const why: string[] = [];
  for (const change of candidates) {
    if (change.deleted) continue;
    if (deniedName(change.path)) {
      refused.push(change.path);
      why.push(`${change.path} (a secret-shaped file name)`);
      continue;
    }
    let stat;
    try {
      stat = lstatSync(join(wt.top, change.path));
    } catch {
      continue;
    }
    if (stat.isDirectory()) continue;
    if (stat.size > options.maxFileBytes) {
      refused.push(change.path);
      why.push(
        `${change.path} (${String(stat.size)} bytes, over the ${String(options.maxFileBytes)}-byte cap)`,
      );
      continue;
    }
    if (!stat.isFile()) continue;
    const found = secretIn(addedText(git, wt, change, hasHead));
    if (found !== undefined) {
      refused.push(change.path);
      why.push(`${change.path} (looks like it holds ${found})`);
    }
  }
  if (refused.length > 0) {
    throw new Refusal(
      `refused — nothing was staged, committed or pushed. ${why.join('; ')}.`,
      'secret_refused',
      refused,
    );
  }

  const paths = candidates.map((c) => c.path);
  for (let at = 0; at < paths.length; at += 200) {
    must(git, wt.top, ['add', '--', ...paths.slice(at, at + 200).map(literal)]);
  }
  return paths;
}

/**
 * The index as it is, as a tree: what {@link restoreIndex} puts back. Taken
 * before staging, so a person's own partial staging — a hunk added with
 * `git add -p` — survives a save that stops. An index git cannot write as a
 * tree (an unresolved conflict) is a refusal: there is nothing exact to
 * restore to.
 */
export function indexSnapshot(git: GitRunner, wt: Worktree): string {
  const r = git(wt.top, ['write-tree']);
  const tree = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Refusal(
      'the index cannot be saved as it is (an unresolved conflict?); nothing was staged',
      'index_unmerged',
    );
  }
  return tree;
}

/**
 * Undo {@link stageSafely} for these paths: each index entry goes back to
 * what the snapshot held — a partially staged blob stays partially staged,
 * and a file that was not in the index leaves it again. Used only when a
 * save stops between staging and committing.
 */
export function restoreIndex(
  git: GitRunner,
  wt: Worktree,
  snapshot: string,
  paths: readonly string[],
): void {
  for (let at = 0; at < paths.length; at += 200) {
    must(git, wt.top, ['reset', '-q', snapshot, '--', ...paths.slice(at, at + 200).map(literal)]);
  }
}

/* -------------------------------------------------------------------------- */
/* Committing and the manifest                                                */
/* -------------------------------------------------------------------------- */

/** Commits what is staged, with the repo's hooks off. `undefined` when nothing was. */
export function commitStaged(git: GitRunner, wt: Worktree, message: string): string | undefined {
  if (git(wt.top, ['diff', '--cached', '--quiet']).code === 0) return undefined;
  must(git, wt.top, [...NO_HOOKS, 'commit', '--no-verify', '--quiet', '-m', message]);
  return headSha(git, wt);
}

export function headSha(git: GitRunner, wt: Worktree): string {
  const sha = must(git, wt.top, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Refusal('HEAD is not a commit', 'no_commit');
  return sha;
}

export interface ManifestEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The files the branch changed, with line counts — **names only** (D-115
 * item 4): against where it left the remote's default branch, or its parent
 * when that cannot be told.
 */
export function manifest(
  git: GitRunner,
  wt: Worktree,
  sha: string,
  remote: string,
  base: string | undefined,
): ManifestEntry[] {
  let from: string | undefined;
  if (base !== undefined) {
    const r = git(wt.top, ['merge-base', sha, `refs/remotes/${remote}/${base}`]);
    if (r.code === 0) from = r.stdout.trim();
  }
  if (from === undefined) {
    const parent = git(wt.top, ['rev-parse', '-q', '--verify', `${sha}^1`]);
    from = parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE;
  }
  const out = must(git, wt.top, ['diff', '--numstat', '-z', '--no-renames', from, sha]);
  const entries: ManifestEntry[] = [];
  for (const record of out.split('\0')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record);
    if (m === null) continue;
    entries.push({
      path: m[3] ?? '',
      added: m[1] === '-' ? 0 : Number(m[1]),
      removed: m[2] === '-' ? 0 : Number(m[2]),
    });
  }
  return entries.slice(0, MAX_CHANGED_FILES).filter((e) => e.path.length <= 1024);
}

/* -------------------------------------------------------------------------- */
/* Pushing                                                                    */
/* -------------------------------------------------------------------------- */

export const TAG_PREFIX = 'refs/tags/laika-ckpt/';

/**
 * One ref, one push, no `+`, no `--force`: the only shape a push here takes.
 * A rejection — the remote moved on, or a ruleset refused — is a refusal.
 */
function pushOne(git: GitRunner, wt: Worktree, remote: string, sha: string, dst: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Refusal('not a commit SHA', 'bad_sha');
  // Exactly the one ref: `push.followTags` would add every annotated tag
  // reachable from the commit, and `push.recurseSubmodules` other repos.
  const r = git(wt.top, [
    ...NO_HOOKS,
    '-c',
    'push.followTags=false',
    'push',
    '--no-verify',
    '--no-follow-tags',
    '--recurse-submodules=no',
    '--porcelain',
    '--',
    remote,
    `${sha}:${dst}`,
  ]);
  if (r.code === 0) return;
  const text = `${r.stdout}\n${r.stderr}`;
  if (/non-fast-forward|fetch first|\[rejected\]/.test(text)) {
    throw new Refusal(
      `the push of ${dst} was rejected: the remote has commits this branch does not. ` +
        'Fetch and merge them, then save again. A checkpoint never force-pushes.',
      'non_fast_forward',
    );
  }
  if (text.includes('already exists')) {
    throw new Refusal(`${dst} already exists on ${remote} at another commit`, 'ref_exists');
  }
  throw new Refusal(
    `the push of ${dst} to ${remote} failed: ${firstLine(r.stderr)}`,
    'push_failed',
  );
}

/** A URL as it may be printed: any `user:password@` taken out. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1***@');
}

/**
 * Every URL a push to `remote` reaches — each `remote.<r>.pushurl`, or every
 * `remote.<r>.url` when there is none — expanded as git expands them
 * (`insteadOf`, `pushInsteadOf`). A push goes to all of them, so each is
 * asked; asking only the fetch URL checks a repository the push may never
 * touch.
 */
export function pushDestinations(git: GitRunner, wt: Worktree, remote: string): string[] {
  const r = git(wt.top, ['remote', 'get-url', '--push', '--all', remote]);
  const urls = r.stdout
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u !== '');
  if (r.code !== 0 || urls.length === 0) {
    throw new Refusal(`cannot tell where a push to ${remote} goes`, 'remote_default_unknown');
  }
  return urls;
}

/** Every remote named in the config here — `remote.<name>.<key>`, any key, includes followed. */
function configuredRemoteNames(git: GitRunner, wt: Worktree): Set<string> {
  const r = git(wt.top, ['config', '-z', '--includes', '--name-only', '--get-regexp', '^remote\\.']);
  return new Set(
    r.stdout
      .split('\0')
      .filter((key) => key.startsWith('remote.') && key.lastIndexOf('.') > 'remote.'.length)
      .map((key) => key.slice('remote.'.length, key.lastIndexOf('.'))),
  );
}

/**
 * A destination git reads as a local path: no `scheme://`, and no `host:`
 * before the first `/` (git's own test for the scp-like ssh form).
 */
function localPath(url: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  const colon = url.indexOf(':');
  const slash = url.indexOf('/');
  return colon === -1 || (slash !== -1 && slash < colon);
}

/** Every `url.<base>.insteadOf` value in effect here, includes followed. */
function insteadOfValues(git: GitRunner, wt: Worktree): string[] {
  const r = git(wt.top, ['config', '-z', '--includes', '--get-regexp', '^url\\..*\\.insteadof$']);
  return r.stdout
    .split('\0')
    .map((entry) => entry.slice(entry.indexOf('\n') + 1))
    .filter((value) => value !== '');
}

/**
 * The branch one push destination's `HEAD` names **now**, asked of **that
 * destination** (`ls-remote --symref`), never the clone's cached
 * `refs/remotes/<r>/HEAD`.
 *
 * `url` is already where the push goes: `git remote get-url --push` applied
 * git's one rewrite (`pushInsteadOf` before `insteadOf`, none for a
 * `pushurl`), as `git push` does. `ls-remote` would rewrite it **again** —
 * a chain `alias → A`, `A → B` pushes to A and asks B (round-3 #1). So the
 * query carries `-c url.<url>.insteadOf=<url>`: git takes the longest
 * matching rule, and no rule can be longer than the URL itself, so the
 * rewrite is to itself. The one rule it cannot beat is one whose value is
 * the URL exactly — git keeps the first of equal length, and a configured
 * rule comes first — so that destination is refused rather than asked
 * somewhere else.
 *
 * **Fails closed**: a destination that cannot be asked as itself, that does
 * not answer, or whose `HEAD` names no branch (unborn, detached) is a
 * refusal — a push that cannot be told apart from a push to the default is
 * not made.
 */
export function currentDefaultAt(
  git: GitRunner,
  wt: Worktree,
  remote: string,
  url: string,
): string {
  const unknown = (why: string): Refusal =>
    new Refusal(
      `cannot tell the default branch of ${remote}'s push destination ${redactUrl(url)} ` +
        `(${why}), so nothing was pushed: a checkpoint never risks pushing to a default branch`,
      'remote_default_unknown',
    );
  if (/[=\n\r\0]/.test(url)) throw unknown('its URL cannot be asked without rewriting');
  // `ls-remote <x>` reads `x` as a remote's name first (round-4 #1): a
  // pushurl `A.git` beside a remote named `A.git` would be asked as that
  // remote. So a destination that is a remote's name is refused, and a local
  // path is asked as the absolute `file://` URL of the repo the push reaches
  // — resolved from the worktree, where the push runs — which no name is.
  const names = configuredRemoteNames(git, wt);
  const query = localPath(url)
    ? url.includes('%')
      ? undefined
      : `file://${resolve(wt.top, url)}`
    : url;
  if (query === undefined) throw unknown('a local path holding % cannot be asked as a URL');
  if (names.has(url) || names.has(query)) {
    throw unknown('it is also the name of a configured remote, so asking it would ask that remote');
  }
  if (insteadOfValues(git, wt).some((v) => v === url || v === query)) {
    throw unknown('an insteadOf rule names it exactly, so asking it would ask somewhere else');
  }
  const r = git(wt.top, [
    '-c',
    `url.${query}.insteadOf=${query}`,
    'ls-remote',
    '--symref',
    '--',
    query,
    'HEAD',
  ]);
  const m = r.code === 0 ? /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(r.stdout) : null;
  if (m?.[1] === undefined) throw unknown('its HEAD names no branch, or it did not answer');
  return m[1];
}

/** Refuses `branch` if it is master, main, or the current default of **any** push destination. */
export function assertPushable(git: GitRunner, wt: Worktree, remote: string, branch: string): void {
  assertWorkBranch(branch, undefined);
  for (const url of pushDestinations(git, wt, remote)) {
    assertWorkBranch(branch, currentDefaultAt(git, wt, remote, url));
  }
}

export function pushBranch(
  git: GitRunner,
  wt: Worktree,
  remote: string,
  branch: string,
  sha: string,
): void {
  // Asked again here, at the push, of every place the push goes, as each is
  // now: nothing reaches master, main or whatever a destination's default
  // has become.
  assertPushable(git, wt, remote, branch);
  if (git(wt.top, ['check-ref-format', '--branch', branch]).code !== 0) {
    throw new Refusal(`${branch} is not a valid branch name`, 'bad_branch');
  }
  pushOne(git, wt, remote, sha, `refs/heads/${branch}`);
}

/** The lightweight tag, **alone in its own push** (D-116 item 1). */
export function pushTag(
  git: GitRunner,
  wt: Worktree,
  remote: string,
  sha: string,
  ref: string,
): void {
  if (!ref.startsWith(TAG_PREFIX) || git(wt.top, ['check-ref-format', ref]).code !== 0) {
    throw new Refusal(`${ref} is not a checkpoint tag`, 'bad_ref');
  }
  pushOne(git, wt, remote, sha, ref);
}

/** What the remote's ref points at now, by asking it. */
export function remoteRef(
  git: GitRunner,
  wt: Worktree,
  remote: string,
  ref: string,
): string | undefined {
  const r = git(wt.top, ['ls-remote', '--', remote, ref]);
  if (r.code !== 0) return undefined;
  for (const line of r.stdout.split('\n')) {
    const [sha, name] = line.split('\t');
    if (name === ref && sha !== undefined) return sha;
  }
  return undefined;
}

/** `owner/name` from a remote URL: GitHub's https, ssh and scp forms. */
export function repoFromUrl(url: string): string | undefined {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)[^/:]+[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return m === null ? undefined : `${m[1] ?? ''}/${m[2] ?? ''}`.toLowerCase();
}

/** The repo the checkpoint is in: `laika.checkpoint.repo`, else the remote's URL. */
export function repoName(git: GitRunner, wt: Worktree, remote: string): string {
  const configured = configValue(git, wt.top, 'laika.checkpoint.repo');
  const repo =
    configured?.toLowerCase() ?? repoFromUrl(must(git, wt.top, ['remote', 'get-url', remote]));
  if (repo === undefined || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo)) {
    throw new Refusal(
      `cannot tell the repository (owner/name) from remote ${remote}; set it with ` +
        '`git config laika.checkpoint.repo owner/name`',
      'no_repo',
    );
  }
  return repo;
}

/* -------------------------------------------------------------------------- */
/* Ids                                                                        */
/* -------------------------------------------------------------------------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID (SPEC §4): 48 bits of time, 80 of randomness, Crockford base 32. */
export function ulid(now: number, random: (n: number) => Uint8Array = randomBytes): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = (CROCKFORD[t % 32] ?? '0') + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(16);
  let rest = '';
  for (let i = 0; i < 16; i += 1) rest += CROCKFORD[(bytes[i] ?? 0) % 32] ?? '0';
  return time + rest;
}
