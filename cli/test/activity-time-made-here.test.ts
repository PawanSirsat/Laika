/**
 * Only a commit made on this machine names a drafted block's card or counts
 * in it (LAI-864). Two laptops commit under one email, so the email cannot
 * tell them apart: a commit that arrived by fetch, merge or pull is the other
 * laptop's. Real git throughout — a bare remote and two clones, A (this
 * machine) and B (the other laptop), both under one email.
 *
 * Every negative sits beside a positive in the same draft: A's own commit
 * naming LAI-7 ties the 10:00 block and counts 1, so a setup that ties
 * nothing cannot pass.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { gitRunner } from '../src/activity-census.ts';
import { activityPaths, writeState, type ActivityState } from '../src/activity-store.ts';
import { buildDraft, timeStep, type Block } from '../src/activity-time.ts';
import { usageRoots } from '../src/activity-usage.ts';

const MIN = 60;
/** Tuesday 20 October 2026, 09:00 UTC. */
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0) / 1000;
const NOW_S = T0 + 4 * 3600;
const DAY = '2026-10-20';
const EMAIL = 'dev@example.test';
const SESSION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const scratch: string[] = [];
after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(made);
  return made;
}

/** `git` as one person on either laptop: the same name and email, no global config. */
function git(cwd: string, args: string[], at?: number): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Dev',
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: EMAIL,
      ...(at === undefined
        ? {}
        : { GIT_AUTHOR_DATE: `@${String(at)} +0000`, GIT_COMMITTER_DATE: `@${String(at)} +0000` }),
    },
  });
}

function state(): ActivityState {
  return {
    collect: true,
    next_sync_at: 0,
    org_enabled: true,
    enabled: true,
    scope: 'agent-repos',
    min_sync_interval_s: 600,
    since: T0 - 30 * 86_400,
    checked_at: NOW_S,
    failures: 0,
  };
}

function reply(id: string, at: number, cwd: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at * 1000).toISOString(),
    sessionId: SESSION,
    cwd,
    gitBranch: 'main',
    message: {
      id,
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'done' }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

/**
 * Two laptops on one remote. On A, one untied session on `main`: 09:00–09:10
 * and 10:00–10:10. A's own commit naming LAI-7 at 10:12, which the 10:00
 * stretch takes. B's commit naming LAI-7 at 09:12, pushed: it would tie the
 * 09:00 stretch if A took it as A's.
 */
function laptops() {
  const root = dir('laika-madehere-');
  const remote = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const seed = join(root, 'seed');
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  git(seed, ['commit', '-q', '--allow-empty', '-m', 'start'], T0 - 86_400);
  git(seed, ['push', '-q', remote, 'main']);
  const clone = (name: string) => {
    const path = join(root, name);
    git(root, ['clone', '-q', remote, path]);
    git(path, ['config', 'user.email', EMAIL]);
    git(path, ['config', 'user.name', 'Dev']);
    return git(path, ['rev-parse', '--show-toplevel']).trim();
  };
  const a = clone('a');
  const b = clone('b');
  git(b, ['commit', '-q', '--allow-empty', '-m', 'LAI-7 the other laptop'], T0 + 12 * MIN);
  git(b, ['push', '-q', 'origin', 'main']);
  git(a, ['commit', '-q', '--allow-empty', '-m', 'LAI-7 this laptop'], T0 + 72 * MIN);

  const home = join(root, 'home');
  const paths = activityPaths(home);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeState(paths, state());
  writeFileSync(paths.repos, `${String(NOW_S - 600)}\t${a}\n`, { mode: 0o600 });
  const projects = join(home, '.claude', 'projects', '-a');
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, `${SESSION}.jsonl`),
    [0, 5, 60, 65].map((m) => reply(`msg_${String(m)}`, T0 + m * MIN, a)).join('\n') + '\n',
  );
  const options = {
    paths,
    roots: usageRoots(home, {}),
    state: state(),
    tz: 'UTC',
    nowS: NOW_S,
    days: 1,
    extraEmails: [],
    git: gitRunner({}),
    prefixes: ['LAI'],
  };
  return { root, a, b, paths, options };
}

const hhmm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);
const rows = (blocks: readonly Block[]) =>
  blocks.map((b) => [hhmm(b.start), b.task, b.signals.commits, b.at?.commits ?? null]);

/** The 10:00 block's commit-time bucket: 10:12, its own minute, held to 10:10's edge. */
const OWN_BUCKET = Math.floor((T0 + 69 * MIN) / 300);

/** B's commit is in A's object store and reachable from what `draftCommits` walks. */
function assertReached(a: string, where: string): void {
  const sha = git(a, ['rev-parse', where]).trim();
  assert.match(git(a, ['log', '--branches', '--remotes', '--format=%H %s']), new RegExp(sha));
}

void describe('a commit this laptop did not make (LAI-864)', () => {
  void test('fetched: B’s commit names no card and counts nowhere; A’s own still ties and counts', async () => {
    const l = laptops();
    git(l.a, ['fetch', '-q', 'origin']);
    assertReached(l.a, 'origin/main');
    const draft = await buildDraft(l.options);
    assert.deepEqual(rows(draft.days.get(DAY) ?? []), [
      ['09:00', null, 0, null],
      ['10:00', 'LAI-7', 1, [[OWN_BUCKET, 1]]],
    ]);
    assert.equal(draft.read.commits, 1, 'only A’s own commit was read');
  });

  for (const how of ['merge', 'pull'] as const) {
    void test(`on a local branch by \`git ${how}\`: the same`, async () => {
      const l = laptops();
      if (how === 'merge') {
        git(l.a, ['fetch', '-q', 'origin']);
        git(l.a, ['merge', '-q', '--no-edit', 'origin/main'], NOW_S - 60);
      } else {
        git(l.a, ['pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main'], NOW_S - 60);
      }
      // B's commit is on A's own `main` now, not only on a remote-tracking ref.
      assert.equal(
        git(l.a, ['merge-base', '--is-ancestor', git(l.b, ['rev-parse', 'HEAD']).trim(), 'main']),
        '',
      );
      const draft = await buildDraft(l.options);
      assert.deepEqual(rows(draft.days.get(DAY) ?? []), [
        ['09:00', null, 0, null],
        ['10:00', 'LAI-7', 1, [[OWN_BUCKET, 1]]],
      ]);
      assert.equal(draft.read.commits, 1, 'only A’s own commit was read');
    });
  }

  void test('rebased here: A’s replayed commit is made here; B’s under it is not', async () => {
    const l = laptops();
    git(l.a, ['fetch', '-q', 'origin']);
    // A's own commit replayed onto B's: a new commit, written by `rebase (pick)`.
    git(l.a, ['rebase', '-q', 'origin/main'], T0 + 72 * MIN);
    const draft = await buildDraft(l.options);
    assert.deepEqual(
      (draft.days.get(DAY) ?? []).map((b) => [hhmm(b.start), b.task, b.signals.commits]),
      [
        ['09:00', null, 0],
        ['10:00', 'LAI-7', 1],
      ],
    );
  });
});

void describe('a commit made in a temporary worktree, merged, then cleaned up (CLAUDE.md §4.2)', () => {
  /** On A: a worktree, a commit naming LAI-8 at 09:12, merged into `main`. */
  function inWorktree(l: ReturnType<typeof laptops>): { readonly worktree: string } {
    const worktree = join(l.root, 'a-build');
    git(l.a, ['worktree', 'add', '-q', '-b', 'build-x', worktree, 'main']);
    git(worktree, ['commit', '-q', '--allow-empty', '-m', 'LAI-8 in a worktree'], T0 + 12 * MIN);
    git(l.a, ['merge', '-q', '--no-ff', '--no-edit', 'build-x'], T0 + 80 * MIN);
    return { worktree };
  }
  function cleanUp(l: ReturnType<typeof laptops>, worktree: string): void {
    git(l.a, ['worktree', 'remove', worktree]);
    git(l.a, ['branch', '-q', '-d', 'build-x']);
    // Both reflogs that said A made it are gone.
    assert.doesNotMatch(git(l.a, ['log', '-g', '--all', '--format=%gs']), /LAI-8/);
  }
  const sync = (l: ReturnType<typeof laptops>) =>
    timeStep({
      ...l.options,
      collectorId: '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a',
      settings: () =>
        Promise.resolve({
          ok: true,
          value: { org_mode: 'drafts', draft_my_time: true, drafting: true },
        }),
      send: () => Promise.resolve({ ok: true, value: { accepted_days: 1 } }),
    });

  void test('a sync drafted while the worktree lived: it still ties and counts after the clean-up', async () => {
    const l = laptops();
    const { worktree } = inWorktree(l);
    assert.equal((await sync(l)).kind, 'sent');
    cleanUp(l, worktree);
    const draft = await buildDraft(l.options);
    assert.deepEqual(
      (draft.days.get(DAY) ?? []).map((b) => [hhmm(b.start), b.task, b.signals.commits]),
      [
        ['09:00', 'LAI-8', 1],
        ['10:00', 'LAI-7', 1],
      ],
    );
  });

  void test('the loss: cleaned up before any draft ran, nothing on the machine says A made it', async () => {
    const l = laptops();
    const { worktree } = inWorktree(l);
    cleanUp(l, worktree);
    const draft = await buildDraft(l.options);
    // Recorded in LAI-864's task file: the commit is treated as not made here.
    assert.deepEqual(
      (draft.days.get(DAY) ?? []).map((b) => [hhmm(b.start), b.task, b.signals.commits]),
      [
        ['09:00', null, 0],
        ['10:00', 'LAI-7', 1],
      ],
    );
  });
});
