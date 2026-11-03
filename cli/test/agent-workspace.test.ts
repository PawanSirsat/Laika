/**
 * A work request's worktree (LAI-1039, D-117a item 3), against real git: a
 * bare remote whose path ends in the project's `owner/name`, under the
 * operator-named local mirror root, and the owner's own clone of it.
 *
 * What it proves: the worktree is at the remote default branch's head, on
 * `<KEY>-auto-<6>`; the primary checkout is untouched; a second attempt takes
 * fresh names and removes nothing; the branch is never the default branch,
 * `master` or `main`; a remote that is not the project's repository, and a
 * repository whose `info/attributes` sets anything, are refused before
 * anything is fetched.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { gitRunner, LOCAL_ROOT_ENV } from '../src/agent-handoff.ts';
import {
  autoBranch,
  branchAllowed,
  parseSymrefHead,
  prepareWorkspace,
  validDefaultBranch,
} from '../src/agent-workspace.ts';

const REPO = 'kvell/laika';
/** A refusal's words, or the workspace as JSON: what an assertion message can show. */
const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
const OFFER = '01M6G9MFEQ5GT1Q7NBFDVMY12B';
let root: string;
let bare: string;
let sender: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=S', '-c', 'user.email=s@example.test', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: root, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function clone(name = 'laika'): string {
  const dir = join(mkdtempSync(join(root, 'owner-')), name);
  git(root, 'clone', '-q', bare, dir);
  return dir;
}

const env = (): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  HOME: root,
  [LOCAL_ROOT_ENV]: join(root, 'remotes'),
});

const fingerprint = (repo: string): string =>
  [
    git(repo, 'rev-parse', 'HEAD'),
    git(repo, 'symbolic-ref', 'HEAD'),
    git(repo, 'status', '--porcelain', '--untracked-files=all'),
  ].join('|');

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'laika-1039-ws-')));
  bare = join(root, 'remotes', 'kvell', 'laika.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  sender = join(root, 'sender');
  git(root, 'clone', '-q', bare, sender);
  git(sender, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(sender, 'README'), 'base\n');
  git(sender, 'add', '--', 'README');
  git(sender, 'commit', '-q', '-m', 'base');
  git(sender, 'push', '-q', 'origin', 'main');
});

after(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

void describe('names', () => {
  void test('the branch is built from the key and the offer id only', () => {
    assert.equal(autoBranch('LAI-1039', OFFER), 'LAI-1039-auto-vmy12b');
    assert.equal(autoBranch('LAI-1039', OFFER, 3), 'LAI-1039-auto-vmy12b-3');
    assert.equal(autoBranch('LAI-1039 fix main', OFFER), undefined);
    assert.equal(autoBranch('LAI-1039', 'not-an-id'), undefined);
  });

  void test('a branch equal to the default branch, master or main is never allowed', () => {
    assert.equal(branchAllowed('LAI-1-auto-abcdef', 'main'), true);
    assert.equal(branchAllowed('LAI-1-auto-abcdef', 'LAI-1-auto-abcdef'), false);
    assert.equal(branchAllowed('lai-1-auto-abcdef'.toUpperCase(), 'lai-1-auto-abcdef'), false);
    assert.equal(branchAllowed('main', 'trunk'), false);
    assert.equal(branchAllowed('master', 'trunk'), false);
    assert.equal(branchAllowed('feature/x', 'main'), false);
  });

  void test('the remote’s default branch is read from ls-remote --symref, and checked', () => {
    const sha = 'a'.repeat(40);
    assert.deepEqual(parseSymrefHead(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`), {
      branch: 'main',
      sha,
    });
    assert.match(text(parseSymrefHead(`${sha}\tHEAD\n`)), /no default branch/);
    assert.match(text(parseSymrefHead('ref: refs/heads/main\tHEAD\n')), /no commit/);
    assert.equal(validDefaultBranch('release/2026'), true);
    for (const bad of ['a..b', '-x', 'x.lock', 'x/', 'a b', 'x;rm']) {
      assert.equal(validDefaultBranch(bad), false, bad);
    }
  });
});

void describe('prepareWorkspace (real git)', () => {
  void test('a fresh worktree at the remote default branch’s head; the primary checkout untouched', () => {
    // The remote moves on after the owner cloned: the worktree must be at the new head.
    const repo = clone();
    git(sender, 'commit', '-q', '--allow-empty', '-m', 'newer');
    git(sender, 'push', '-q', 'origin', 'main');
    const head = git(bare, 'rev-parse', 'refs/heads/main');
    const before = fingerprint(repo);
    const ws = prepareWorkspace({
      git: gitRunner(env()),
      env: env(),
      repoDir: repo,
      boardRepo: REPO,
      offerId: OFFER,
      taskKey: 'LAI-1039',
    });
    assert.equal(typeof ws, 'object', text(ws));
    if (typeof ws === 'string') return;
    assert.equal(ws.branch, 'LAI-1039-auto-vmy12b');
    assert.equal(ws.default_branch, 'main');
    assert.equal(ws.base_sha, head);
    assert.equal(git(ws.worktree, 'rev-parse', 'HEAD'), head);
    assert.equal(git(ws.worktree, 'symbolic-ref', 'HEAD'), 'refs/heads/LAI-1039-auto-vmy12b');
    assert.equal(fingerprint(repo), before, 'the primary checkout is exactly as it was');
    assert.notEqual(git(repo, 'rev-parse', 'HEAD'), head, 'its HEAD did not move to the new head');
    // Nothing was pushed.
    assert.throws(() => git(bare, 'rev-parse', '--verify', 'refs/heads/LAI-1039-auto-vmy12b'));
  });

  void test('a second attempt takes fresh names and removes nothing', () => {
    const repo = clone();
    const args = {
      git: gitRunner(env()),
      env: env(),
      repoDir: repo,
      boardRepo: REPO,
      offerId: OFFER,
      taskKey: 'LAI-7',
    };
    const first = prepareWorkspace(args);
    const second = prepareWorkspace(args);
    assert.ok(
      typeof first === 'object' && typeof second === 'object',
      `${text(first)} ${text(second)}`,
    );
    if (typeof first === 'string' || typeof second === 'string') return;
    assert.equal(second.branch, 'LAI-7-auto-vmy12b-2');
    assert.ok(existsSync(first.worktree), 'the first worktree is still there');
  });

  void test('a remote that is not the project’s repository is refused, nothing fetched', () => {
    const repo = clone();
    const before = git(repo, 'for-each-ref', '--format=%(refname)');
    const ws = prepareWorkspace({
      git: gitRunner(env()),
      env: env(),
      repoDir: repo,
      boardRepo: 'someone/else',
      offerId: OFFER,
      taskKey: 'LAI-8',
    });
    assert.match(text(ws), /no remote of this repository is someone\/else/);
    assert.equal(git(repo, 'for-each-ref', '--format=%(refname)'), before);
  });

  void test('a remote whose default branch would be the launcher’s branch is refused', () => {
    const odd = join(root, 'remotes', 'kvell', 'odd.git');
    mkdirSync(odd, { recursive: true });
    git(odd, 'init', '-q', '--bare', '-b', 'LAI-9-auto-vmy12b');
    const seed = join(root, 'odd-seed');
    git(root, 'clone', '-q', odd, seed);
    git(seed, 'checkout', '-q', '-b', 'LAI-9-auto-vmy12b');
    git(seed, 'commit', '-q', '--allow-empty', '-m', 'odd');
    git(seed, 'push', '-q', 'origin', 'LAI-9-auto-vmy12b');
    const repo = join(mkdtempSync(join(root, 'owner-')), 'odd');
    git(root, 'clone', '-q', odd, repo);
    const ws = prepareWorkspace({
      git: gitRunner(env()),
      env: env(),
      repoDir: repo,
      boardRepo: 'kvell/odd',
      offerId: OFFER,
      taskKey: 'LAI-9',
    });
    assert.match(text(ws), /would be the default branch, master or main; refusing/);
  });

  void test('a repository whose info/attributes sets anything is refused before any fetch', () => {
    const repo = clone();
    writeFileSync(join(repo, '.git', 'info', 'attributes'), '* filter=evil\n');
    const ws = prepareWorkspace({
      git: gitRunner(env()),
      env: env(),
      repoDir: repo,
      boardRepo: REPO,
      offerId: OFFER,
      taskKey: 'LAI-10',
    });
    assert.match(text(ws), /sets attributes/);
  });

  void test('a local remote outside the operator’s mirror root is refused', () => {
    const repo = clone();
    const ws = prepareWorkspace({
      git: gitRunner(env()),
      env: { PATH: process.env.PATH ?? '', HOME: root },
      repoDir: repo,
      boardRepo: REPO,
      offerId: OFFER,
      taskKey: 'LAI-11',
    });
    assert.match(text(ws), /only under LAIKA_HANDOFF_LOCAL_REMOTE_ROOT/);
  });
});
