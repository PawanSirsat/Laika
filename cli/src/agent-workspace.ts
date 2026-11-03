import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { TASK_KEY } from './agent-events.ts';
import {
  assertNoLocalAttributes,
  createRef,
  type FetchSource,
  fetchSourceFor,
  firstLine,
  FULL_SHA,
  type GitRunner,
  inert,
  isSymref,
  MISSING_REF,
  plainRef,
  refSnapshot,
  refTaken,
  REMOTE_NAME,
  rewriteRefusal,
} from './agent-handoff.ts';
import { isLaikaId } from './agent-session.ts';

/**
 * The worktree a **work request** starts in (LAI-1039, D-117a item 3).
 *
 * A work request carries no checkpoint, so there is no commit to verify: the
 * work starts from the project's repository as it is now. This makes a fresh
 * worktree at the **head of the remote's default branch**, on a new branch
 * `<KEY>-auto-<last 6 of the offer id>`, with the same hardening `handoff
 * prepare` uses for a checkpoint (`agent-handoff.ts`):
 *
 * - the fetch goes to the project's configured repository's URL, checked in
 *   full and rebuilt ({@link fetchSourceFor}), never to a remote's name, and
 *   it writes no ref, no `FETCH_HEAD` and no tag;
 * - every git call runs with hooks, fsmonitor, attributes and replace refs off
 *   (`SAFE_CONFIG`), and a repository whose `info/attributes` says anything is
 *   refused before anything is fetched;
 * - each ref is created in one create-only step, and every other ref is
 *   checked unchanged afterwards;
 * - **nothing is pushed, nothing that exists is moved or deleted, and the
 *   primary checkout is never written** — its `HEAD`, branch and files are
 *   exactly as they were.
 *
 * The branch is built only from validated fields — the task key and the
 * offer id — never from the task's title, and it is refused if it would be
 * the default branch, `master` or `main`.
 */

/** A branch name as this helper will accept the remote's default: plain words, no `..`. */
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** The branches a launched run may never be on, whatever the remote calls its default. */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(['master', 'main']);

export function validDefaultBranch(name: string): boolean {
  return (
    BRANCH_NAME.test(name) &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.endsWith('/') &&
    !name.endsWith('.lock') &&
    !name.endsWith('.')
  );
}

/**
 * The branch for a work request, or `undefined` when the fields are not what
 * they must be. `attempt` 1 is the plain name; later attempts add `-<n>`.
 */
export function autoBranch(taskKey: string, offerId: string, attempt = 1): string | undefined {
  if (!TASK_KEY.test(taskKey) || !isLaikaId(offerId)) return undefined;
  const suffix = offerId.slice(-6).toLowerCase();
  return `${taskKey}-auto-${suffix}${attempt === 1 ? '' : `-${String(attempt)}`}`;
}

/** The shape {@link autoBranch} makes, for checking a name read back from a file. */
export const AUTO_BRANCH = /^[A-Z][A-Z0-9]{0,9}-[0-9]{1,7}-auto-[0-9a-z]{6}(-[0-9]{1,2})?$/;

/** Whether a launched run may work on `branch`, given the remote's default. */
export function branchAllowed(branch: string, defaultBranch: string): boolean {
  const lower = branch.toLowerCase();
  return (
    AUTO_BRANCH.test(branch) &&
    lower !== defaultBranch.toLowerCase() &&
    !PROTECTED_BRANCHES.has(lower)
  );
}

export interface WorkspaceArgs {
  readonly git: GitRunner;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The owner's checkout of the project's repository: fetched into, never written. */
  readonly repoDir: string;
  /** The project's configured repository (`owner/name`), as the board holds it. */
  readonly boardRepo: string;
  readonly remote?: string;
  readonly offerId: string;
  readonly taskKey: string;
  /** Tests only: called with each ref's name immediately before it is created. */
  readonly beforeRefWrite?: (ref: string) => void;
}

export interface Workspace {
  readonly worktree: string;
  readonly branch: string;
  readonly base_sha: string;
  readonly default_branch: string;
  readonly local_ref: string;
  readonly repo_dir: string;
}

class Refused extends Error {}
/** The remote could not be reached: nothing was made, and a later try can pass. */
class Unreachable extends Refused {}

/**
 * Why the worktree was not made **this time**: the remote could not be read
 * or fetched from (the network, the host, a timeout). Nothing was made, so the
 * launcher tries it again, backing off, rather than take it as a refusal (LAI-1107).
 */
export interface WorkspaceUnreachable {
  readonly unreachable: string;
}

export const workspaceUnreachable = (v: unknown): v is WorkspaceUnreachable =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { unreachable?: unknown }).unreachable === 'string';

/**
 * The remote's default branch and the commit at its head, from
 * `git ls-remote --symref <url> HEAD`: `ref: refs/heads/<name>\tHEAD` then
 * `<sha>\tHEAD`. Anything else is a refusal.
 */
export function parseSymrefHead(text: string): { branch: string; sha: string } | string {
  let branch: string | undefined;
  let sha: string | undefined;
  for (const line of text.split('\n')) {
    const symref = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
    if (symref !== null) branch = symref[1];
    const at = /^([0-9a-f]{40})\tHEAD$/.exec(line);
    if (at !== null) sha = at[1];
  }
  if (branch === undefined) return 'the remote names no default branch';
  if (!validDefaultBranch(branch))
    return `the remote's default branch ${inert(branch, 100)} is not a plain branch name`;
  if (sha === undefined || !FULL_SHA.test(sha))
    return 'the remote names no commit for its default branch';
  return { branch, sha };
}

/** Make the work request's worktree, or answer why not. Never removes or moves anything. */
export function prepareWorkspace(args: WorkspaceArgs): Workspace | string | WorkspaceUnreachable {
  const { git } = args;
  if (!TASK_KEY.test(args.taskKey)) return 'the task key is not a task key';
  if (!isLaikaId(args.offerId)) return 'the offer id is not a Laika id';

  const top = git(args.repoDir, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return `${args.repoDir} is not inside a git repository`;
  const toplevel = top.stdout.trim();
  const attributes = assertNoLocalAttributes(git, toplevel);
  if (attributes !== undefined) return attributes;

  // The remote's URL, checked against the board's repo exactly as prepare checks it.
  const names = git(toplevel, ['remote'])
    .stdout.split('\n')
    .map((n) => n.trim())
    .filter((n) => REMOTE_NAME.test(n));
  const sourceOf = (name: string): FetchSource | string => {
    const got = git(toplevel, ['remote', 'get-url', '--', name]);
    if (got.code !== 0) return `remote ${name} has no URL`;
    return fetchSourceFor(got.stdout.trim(), args.boardRepo, args.env);
  };
  let source: FetchSource | undefined;
  if (args.remote !== undefined) {
    if (!REMOTE_NAME.test(args.remote) || !names.includes(args.remote)) {
      return `no remote named ${inert(args.remote, 64)}`;
    }
    const found = sourceOf(args.remote);
    if (typeof found === 'string')
      return `remote ${args.remote} is not ${args.boardRepo}: ${found}`;
    source = found;
  } else {
    const why: string[] = [];
    for (const name of names) {
      const found = sourceOf(name);
      if (typeof found === 'string') why.push(`${name}: ${found}`);
      else {
        source = found;
        break;
      }
    }
    if (source === undefined) {
      return (
        `no remote of this repository is ${args.boardRepo}` +
        (why.length === 0 ? '' : ` (${why.slice(0, 5).join('; ')})`)
      );
    }
  }
  const rewrite = rewriteRefusal(git, toplevel, names, source.url);
  if (rewrite !== undefined) return rewrite;
  const remoteArgs = [
    '-c',
    `url.${source.url}.insteadOf=${source.url}`,
    ...(source.local ? ['-c', 'protocol.file.allow=always'] : []),
  ];

  // 1. Which branch is the default, and the commit at its head.
  const listed = git(toplevel, [...remoteArgs, 'ls-remote', '--symref', '--', source.url, 'HEAD']);
  if (listed.code !== 0) {
    return { unreachable: `the remote could not be read: ${firstLine(listed.stderr)}` };
  }
  const head = parseSymrefHead(listed.stdout);
  if (typeof head === 'string') return head;
  const defaultBranch = head.branch;
  const sha = head.sha;

  // 2. The names: the first attempt nobody has. Nothing that exists is reused.
  let picked: { branch: string; worktree: string; localRef: string } | undefined;
  for (let n = 1; n <= 20 && picked === undefined; n += 1) {
    const branch = autoBranch(args.taskKey, args.offerId, n);
    if (branch === undefined) return 'the branch name could not be built';
    if (!branchAllowed(branch, defaultBranch)) {
      return `${branch} would be the default branch, master or main; refusing`;
    }
    const candidate = {
      branch,
      worktree: join(dirname(toplevel), `${basename(toplevel)}-${branch}`),
      localRef: `refs/laika/work/${args.offerId}${n === 1 ? '' : `-${String(n)}`}`,
    };
    const taken =
      existsSync(candidate.worktree) ||
      refTaken(git, toplevel, `refs/heads/${branch}`) ||
      refTaken(git, toplevel, candidate.localRef);
    if (!taken) picked = candidate;
  }
  if (picked === undefined) return 'twenty attempts’ names are all taken; clear some first';
  const { branch, worktree, localRef } = picked;
  const branchRef = `refs/heads/${branch}`;

  try {
    // 3. Fetch the objects only: no destination, no FETCH_HEAD, no tags.
    const before = refSnapshot(git, toplevel, [localRef, branchRef]);
    const fetchHead = git(toplevel, ['rev-parse', '--git-path', 'FETCH_HEAD']).stdout.trim();
    const hadFetchHead = existsSync(resolve(toplevel, fetchHead));
    const fetched = git(toplevel, [
      ...remoteArgs,
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--no-auto-gc',
      '--no-auto-maintenance',
      '--refmap=',
      '--',
      source.url,
      `refs/heads/${defaultBranch}`,
    ]);
    if (fetched.code !== 0) {
      const message = `${defaultBranch} could not be fetched: ${firstLine(fetched.stderr)}`;
      throw MISSING_REF.test(fetched.stderr) ? new Refused(message) : new Unreachable(message);
    }
    if (refSnapshot(git, toplevel, [localRef, branchRef]) !== before) {
      throw new Refused('the fetch changed refs; nothing was checked out');
    }
    if (!hadFetchHead && existsSync(resolve(toplevel, fetchHead))) {
      throw new Refused('the fetch wrote FETCH_HEAD; nothing was checked out');
    }
    if (git(toplevel, ['cat-file', '-t', sha]).stdout.trim() !== 'commit') {
      throw new Refused(`the default branch's head ${sha} is not a commit here after the fetch`);
    }

    // 4. The private ref and the branch, each create-only; then the worktree on that branch.
    const io = {
      ...(args.beforeRefWrite === undefined ? {} : { beforeRefWrite: args.beforeRefWrite }),
    };
    const local = createRef(io, git, toplevel, localRef, sha);
    if (local !== undefined) throw new Refused(`${local}; nothing was checked out`);
    const made = createRef(io, git, toplevel, branchRef, sha);
    if (made !== undefined) throw new Refused(`${made}; nothing was checked out`);
    const added = git(toplevel, ['worktree', 'add', '--', worktree, branch]);
    if (added.code !== 0)
      throw new Refused(`the worktree could not be made: ${firstLine(added.stderr)}`);

    // 5. Checked, not assumed.
    if (refSnapshot(git, toplevel, [localRef, branchRef]) !== before) {
      throw new Refused(`making the worktree changed refs other than ${branchRef}`);
    }
    for (const ref of [localRef, branchRef]) {
      const plain = plainRef(git, toplevel, ref, sha);
      if (plain !== undefined) throw new Refused(`${ref} ${plain}`);
      if (isSymref(git, toplevel, ref)) throw new Refused(`${ref} is a symbolic ref`);
    }
    const wtHead = git(worktree, ['symbolic-ref', '-q', 'HEAD']).stdout.trim();
    if (wtHead !== branchRef) {
      throw new Refused(
        `the new worktree is on ${inert(wtHead, 200) || 'no branch'}, not ${branchRef}`,
      );
    }
    const at = git(worktree, ['rev-parse', 'HEAD']).stdout.trim().toLowerCase();
    if (at !== sha) throw new Refused(`the new worktree is at ${at}, not ${sha}`);
    const status = git(worktree, ['status', '--porcelain', '--untracked-files=all']);
    if (status.code !== 0 || status.stdout.trim() !== '') {
      throw new Refused('the new worktree does not match the default branch head');
    }
  } catch (cause) {
    if (cause instanceof Unreachable) return { unreachable: cause.message };
    if (cause instanceof Refused) return cause.message;
    throw cause;
  }
  return {
    worktree,
    branch,
    base_sha: sha,
    default_branch: defaultBranch,
    local_ref: localRef,
    repo_dir: toplevel,
  };
}

/**
 * Why a worktree an earlier attempt made may not be started in now, or
 * `undefined` when it may (LAI-1107). It must still be that worktree, on
 * `branch`, with `HEAD` at `sha` or a commit after it on that branch, and
 * nothing changed or untracked in it. Every git call runs under the runner's
 * hardening; nothing is written.
 */
export function reusedWorktreeProblem(
  git: GitRunner,
  worktree: string,
  branch: string,
  sha: string,
): string | undefined {
  if (!FULL_SHA.test(sha)) return 'the recorded commit is not a full SHA';
  let real: string;
  try {
    real = realpathSync(worktree);
  } catch {
    return 'the worktree is gone';
  }
  const top = git(worktree, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0 || top.stdout.trim() !== real) return 'it is no longer its own worktree';
  const head = git(worktree, ['symbolic-ref', '-q', 'HEAD']).stdout.trim();
  if (head !== `refs/heads/${branch}`) {
    return `it is on ${inert(head, 200) || 'no branch'}, not ${inert(branch, 200)}`;
  }
  if (git(worktree, ['merge-base', '--is-ancestor', sha, 'HEAD']).code !== 0) {
    return `its HEAD is neither ${sha} nor a commit after it`;
  }
  const status = git(worktree, ['status', '--porcelain', '--untracked-files=all']);
  if (status.code !== 0 || status.stdout.trim() !== '') return 'it has changes or untracked files';
  return undefined;
}
